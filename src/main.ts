import * as anchor from "@coral-xyz/anchor";
import {
  StateModel,
  WSOL,
  getPriorityFeeEstimate,
  GlamClient,
  GlamIntegrations,
  GlamPermissions,
  QuoteParams,
  MintModel,
  PriceDenom,
} from "@glamsystems/glam-sdk";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Command } from "commander";

import fs from "fs";
import inquirer from "inquirer";

import { loadingConfig, parseTxError, setStateToConfig } from "./utils";
import { VersionedTransaction } from "@solana/web3.js";

const cliConfig = loadingConfig();
const txOptions = {
  getPriorityFeeMicroLamports: async (tx: VersionedTransaction) => {
    if (cliConfig.cluster === "localnet" || cliConfig.cluster === "devnet") {
      return 1_000_000;
    }

    const { micro_lamports, helius_api_key, level } =
      cliConfig.priority_fee || {};

    // If micro_lamports is provided, use it
    if (micro_lamports) {
      return micro_lamports;
    }

    // If helius_api_key is not provided, return 0
    return helius_api_key
      ? await getPriorityFeeEstimate(helius_api_key, tx, undefined, level)
      : 0;
  },
  simulate: true,
};

const glamClient = new GlamClient();

const program = new Command();
let globalOpts = { skipSimulation: false };

program
  .name("glam-cli")
  .description("CLI for interacting with the GLAM Protocol")
  .version("0.1.16")
  .option("-S, --skip-simulation", "Skip transaction simulation");

program
  .command("env")
  .description("Show environment setup")
  .action(async () => {
    console.log("Wallet connected:", glamClient.getSigner().toBase58());
    console.log("RPC endpoint:", glamClient.provider.connection.rpcEndpoint);
    console.log("Priority fee:", cliConfig.priority_fee);
    if (cliConfig.glam_state) {
      const vault = glamClient.getVaultPda(new PublicKey(cliConfig.glam_state));
      console.log("GLAM state:", cliConfig.glam_state);
      console.log("Active vault:", vault.toBase58());
    } else {
      console.log("No active GLAM product specified");
    }
  });

program
  .command("list")
  .description(
    "List glam products the wallet has access to (either as owner or delegate)",
  )
  .option("-o, --owner-only", "Only list products the wallet owns")
  .option("-a, --all", "All GLAM products")
  .option("-t, --type <type>", "Filter by account type: vault, mint, or fund")
  .action(async (options) => {
    const { ownerOnly, all, type } = options;
    if (ownerOnly && all) {
      console.error(
        "Options '--owner-only' and '--all' cannot be used together.",
      );
      process.exit(1);
    }

    const signer = glamClient.getSigner();
    const filterOptions = all
      ? { type }
      : ownerOnly
        ? { owner: signer, type }
        : { owner: signer, delegate: signer, type };

    const states = await glamClient.fetchGlamStates(filterOptions);
    states
      .sort((a, b) =>
        a.rawOpenfunds.fundLaunchDate > b.rawOpenfunds.fundLaunchDate ? -1 : 1,
      )
      .forEach((state) => {
        console.log(
          state.productType,
          "\t",
          state.idStr,
          "\t",
          state.launchDate,
          "\t",
          state.name,
        );
      });
  });

program
  .command("set <state>")
  .description("Set the active GLAM product by its state public key")
  .action((state: string) => {
    try {
      new PublicKey(state); // for validation
      setStateToConfig(state);
      console.log("Set active GLAM product to:", state);
    } catch (e) {
      console.error("Not a valid pubkey:", state);
      process.exit(1);
    }
  });

program
  .command("update-owner <new-owner-pubkey>")
  .description("Update the owner of a GLAM product")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (newOwnerPubkey, options) => {
    const glamState = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;
    if (!glamState) {
      console.error("GLAM state not set");
      process.exit(1);
    }

    if (!options?.yes) {
      const confirmation = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: `Confirm update of owner to ${newOwnerPubkey}?`,
          default: false,
        },
      ]);
      if (!confirmation.proceed) {
        console.log("Operation cancelled by the user.");
        process.exit(0);
      }
    }

    try {
      const newOwner = new PublicKey(newOwnerPubkey);
      await glamClient.state.updateState(glamState, {
        owner: {
          portfolioManagerName: null,
          pubkey: newOwner,
          kind: { wallet: {} },
        },
      });
      console.log(`Updated owner of ${glamState} to ${newOwnerPubkey}`);
    } catch (e) {
      console.error("Not a valid pubkey:", newOwnerPubkey);
      process.exit(1);
    }
  });

program
  .command("view [state]")
  .description("View a GLAM product by its state pubkey")
  .option("-c, --compact", "Compact output")
  .action(async (state, options) => {
    try {
      const statePda = new PublicKey(state ? state : cliConfig.glam_state);
      const glamState = await glamClient.fetchState(statePda);
      console.log(
        options?.compact
          ? JSON.stringify(glamState)
          : JSON.stringify(glamState, null, 2),
      );
    } catch (e) {
      console.error("Not a valid GLAM state pubkey:", state);
      process.exit(1);
    }
  });

program
  .command("create <path>")
  .description("Create a new GLAM product from a json file")
  .action(async (file) => {
    const data = fs.readFileSync(file, "utf8");
    const glamState = JSON.parse(data);

    // Convert pubkey strings to PublicKey objects
    glamState.mints?.forEach((mint) => {
      mint.asset = new PublicKey(mint.asset);
      mint.permanentDelegate = mint.permanentDelegate
        ? new PublicKey(mint.permanentDelegate)
        : null;
    });
    glamState.assets = glamState.assets.map((a) => new PublicKey(a));
    glamState.accountType = { [glamState.accountType]: {} };

    try {
      const [txSig, statePda] = await glamClient.state.createState(glamState);
      console.log("txSig:", txSig);
      console.log("GLAM state account created:", statePda.toBase58());
      console.log("Vault:", glamClient.getVaultPda(statePda).toBase58());

      setStateToConfig(statePda.toBase58());
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("close [state]")
  .description("Close a GLAM product by its state pubkey")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (state: string, options) => {
    let statePda: PublicKey;
    try {
      statePda = new PublicKey(state || cliConfig.glam_state);
    } catch (e) {
      console.error("Not a valid pubkey:", state);
      process.exit(1);
    }

    if (!options?.yes) {
      const confirmation = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: `Confirm closure of GLAM product with state pubkey ${statePda.toBase58()}?`,
          default: false,
        },
      ]);
      if (!confirmation.proceed) {
        console.log("Operation cancelled by the user.");
        process.exit(0);
      }
    }

    const preInstructions = [];
    const stateAccount = await glamClient.fetchStateAccount(statePda);
    if (stateAccount.mints.length > 0) {
      const closeMintIx = await glamClient.mint.closeMintIx(statePda, 0);
      preInstructions.push(closeMintIx);
    }
    try {
      const builder = await glamClient.program.methods
        .closeState()
        .accounts({
          glamState: statePda,
        })
        .preInstructions(preInstructions);

      const txSig = await builder.rpc();
      console.log(
        `GLAM product with state pubkey ${statePda.toBase58()} closed:`,
        txSig,
      );
      setStateToConfig(null);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("withdraw <asset> <amount>")
  .description("Withdraw <asset> (mint address) from the vault")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (asset, amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;
    if (!statePda) {
      console.error("GLAM state not set");
      process.exit(1);
    }

    if (asset.toLowerCase() === "sol") {
      asset = WSOL.toBase58();
    }
    // TODO: support more token symbols

    const { mint } = await glamClient.fetchMintWithOwner(new PublicKey(asset));

    if (!options?.yes) {
      const confirmation = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: `Confirm withdrawal of ${amount} ${asset}?`,
          default: false,
        },
      ]);
      if (!confirmation.proceed) {
        console.log("Operation cancelled by the user.");
        process.exit(0);
      }
    }

    try {
      const txSig = await glamClient.state.withdraw(
        statePda,
        new PublicKey(asset),
        new anchor.BN(parseFloat(amount) * 10 ** mint.decimals),
        txOptions,
      );
      console.log(`Withdrawn ${amount} ${asset}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const delegate = program.command("delegate").description("Manage delegates");
delegate
  .command("list")
  .description("List delegates and permissions")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const stateModel = await glamClient.fetchState(statePda);
    const cnt = stateModel.delegateAcls.length;
    console.log(
      `${stateModel.name} (${statePda.toBase58()}) has ${cnt} delegate${cnt > 1 ? "s" : ""}`,
    );
    for (let [i, acl] of stateModel.delegateAcls.entries()) {
      console.log(
        `[${i}] ${acl.pubkey.toBase58()}:`,
        // @ts-ignore
        acl.permissions.map((p) => Object.keys(p)[0]).join(", "),
      );
    }
  });

const allowedPermissions = GlamPermissions.map(
  (p) => p.slice(0, 1).toLowerCase() + p.slice(1),
);
delegate
  .command("set")
  .argument("<pubkey>", "Delegate pubkey")
  .argument(
    "<permissions...>",
    `A space-separated list of permissions to grant. Allowed values: ${allowedPermissions.join(", ")}.`,
  )
  .description("Set delegate permissions")
  .action(async (pubkey, permissions) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    if (!permissions.every((p) => allowedPermissions.includes(p))) {
      console.error(
        `Invalid permissions: ${permissions}. Values must be among: ${allowedPermissions.join(", ")}`,
      );
      process.exit(1);
    }

    try {
      const txSig = await glamClient.state.upsertDelegateAcls(statePda, [
        {
          pubkey: new PublicKey(pubkey),
          permissions: permissions.map((p) => ({
            [p]: {},
          })),
          expiresAt: new anchor.BN(0),
        },
      ]);
      console.log("txSig:", txSig);
      console.log(`Granted ${pubkey} permissions ${permissions}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

delegate
  .command("delete <pubkey>")
  .description("Revoke all delegate permissions for a pubkey")
  .action(async (pubkey) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.state.deleteDelegateAcls(statePda, [
        new PublicKey(pubkey),
      ]);
      console.log("txSig:", txSig);
      console.log(`Revoked ${pubkey} access to ${statePda.toBase58()}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const integration = program
  .command("integration")
  .description("Manage integrations");
integration
  .command("list")
  .description("List enabled integrations")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const stateModel = await glamClient.fetchState(statePda);
    const cnt = stateModel.integrations.length;
    console.log(
      `${stateModel.name} (${statePda.toBase58()}) has ${cnt} integration${
        cnt > 1 ? "s" : ""
      } enabled`,
    );
    for (let [i, integ] of stateModel.integrations.entries()) {
      console.log(`[${i}] ${Object.keys(integ)[0]}`);
    }
  });

const allowIntegrations = GlamIntegrations.map(
  (i) => i.slice(0, 1).toLowerCase() + i.slice(1),
);
const integrationValidation = (input) => {
  if (!allowIntegrations.includes(input)) {
    console.error(
      `Invalid input: "${input}". Allowed values are: ${allowIntegrations.join(", ")}`,
    );
    process.exit(1);
  }
  return input; // Return validated input
};

integration
  .command("enable")
  .description("Enable an integration")
  .argument(
    "<integration>",
    `Integration to enable (must be one of: ${allowIntegrations.join(", ")})`,
    integrationValidation,
  )
  .action(async (integration) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const stateModel = await glamClient.fetchState(statePda);
    const acl = stateModel.integrations.find(
      (integ) => Object.keys(integ)[0] === integration,
    );
    if (acl) {
      console.log(
        `${integration} is already enabled on ${stateModel.name} (${statePda.toBase58()})`,
      );
      process.exit(1);
    }

    const updated = new StateModel({
      // @ts-ignore
      integrations: [...stateModel.integrations, { [integration]: {} }],
    });

    try {
      const txSig = await glamClient.program.methods
        .updateState(updated)
        .accounts({ glamState: statePda })
        .rpc();
      console.log("txSig:", txSig);
      console.log(
        `${integration} enabled on ${stateModel} (${statePda.toBase58()})`,
      );
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

integration
  .command("disable")
  .description("Disable an integration")
  .argument(
    "<integration>",
    `Integration to disable (must be one of: ${allowIntegrations.join(", ")})`,
    integrationValidation,
  )
  .action(async (integration) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const stateModel = await glamClient.fetchState(statePda);
    const updated = new StateModel({
      integrations: stateModel.integrations.filter(
        (integ) => Object.keys(integ)[0] !== integration,
      ),
    });

    try {
      const txSig = await glamClient.program.methods
        .updateState(updated)
        .accounts({ glamState: statePda })
        .rpc();
      console.log("txSig:", txSig);
      console.log(
        `${integration} disabled on ${stateModel.name} (${statePda.toBase58()})`,
      );
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const jup = program.command("jup").description("JUP staking");
jup
  .command("stake <amount>")
  .description("Stake JUP tokens")
  .action(async (amount) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.jupiterVote.stakeJup(
        statePda,
        new anchor.BN(amount * 10 ** 6), // decimals 6
      );
      console.log("txSig", txSig);
      console.log(`Staked ${amount} JUP`);
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

jup
  .command("unstake")
  .description("Unstake all JUP tokens")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.jupiterVote.unstakeJup(statePda);
      console.log("txSig", txSig);
      console.log("Unstaked all JUP tokens");
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

jup
  .command("withdraw")
  .description("Withdraw all unstaked JUP")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.jupiterVote.withdrawJup(statePda);
      console.log("txSig", txSig);
      console.log("Withdrawn all JUP");
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

const vote = program
  .command("vote <proposal> <side>")
  .description("Vote on a proposal")
  .action(async (_proposal, side) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not set");
      process.exit(1);
    }

    let proposal;
    let governor;
    try {
      proposal = new PublicKey(_proposal);
      const proposalAccountInfo =
        await glamClient.provider.connection.getAccountInfo(proposal);
      governor = new PublicKey(proposalAccountInfo.data.subarray(8, 40)); // first 8 bytes are discriminator
      console.log("Proposal governor:", governor.toBase58());
    } catch (e) {
      console.error("Error: invalid proposal:", _proposal);
      process.exit(1);
    }

    try {
      const txId = await glamClient.jupiterVote.voteOnProposal(
        statePda,
        proposal,
        Number(side),
      );
      console.log("castVote:", txId);
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

program
  .command("wrap <amount>")
  .description("Wrap SOL")
  .action(async (amount) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const lamports = new anchor.BN(parseFloat(amount) * LAMPORTS_PER_SOL);
    if (lamports.lte(new anchor.BN(0))) {
      console.error("Error: amount must be greater than 0");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.wsol.wrap(statePda, lamports, txOptions);
      console.log(`Wrapped ${amount} SOL:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("unwrap")
  .description("Unwrap wSOL")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.wsol.unwrap(statePda, txOptions);
      console.log(`All wSOL unwrapped:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("balances")
  .description("Get balances")
  .option(
    "-a, --all",
    "Show all assets including token accounts with 0 balance",
  )
  .action(async (options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const { all } = options;
    const vault = glamClient.getVaultPda(statePda);
    const tokenAccounts = await glamClient.getTokenAccountsByOwner(vault);
    const solBalance = await glamClient.provider.connection.getBalance(vault);

    const mints = tokenAccounts.map((ta) => ta.mint.toBase58());
    if (!mints.includes(WSOL.toBase58())) {
      mints.push(WSOL.toBase58());
    }
    const pricesResp = await fetch(
      `https://api.jup.ag/price/v2?ids=${mints.join(",")}`,
    );
    const tokensResp = await fetch(
      "https://tokens.jup.ag/tokens?tags=verified",
    );

    const { data: pricesData } = await pricesResp.json();
    const tokens = await tokensResp.json(); // an array of tokens

    console.log("Token", "\t", "Mint", "\t", "Amount", "\t", "Value (USD)");
    console.log(
      "SOL",
      "\t",
      "N/A",
      "\t",
      solBalance / LAMPORTS_PER_SOL,
      "\t",
      (parseFloat(pricesData[WSOL.toBase58()].price) * solBalance) /
        LAMPORTS_PER_SOL,
    );
    tokenAccounts.forEach((ta) => {
      const { uiAmount, mint } = ta;
      const mintStr = mint.toBase58();

      if (all || uiAmount > 0) {
        const token = tokens.find((t) => t.address === mintStr);

        console.log(
          token.symbol === "SOL" ? "wSOL" : token.symbol,
          "\t",
          mintStr,
          "\t",
          uiAmount,
          "\t",
          parseFloat(pricesData[mintStr].price) * uiAmount,
        );
      }
    });
  });

program
  .command("swap <from> <to> <amount>")
  .description("Swap assets held in the vault")
  .option("-m, --max-accounts <num>", "Specify max accounts allowed")
  .option("-s, --slippage-bps <bps>", "Specify slippage bps")
  .option("-d, --only-direct-routes", "Direct routes only")
  .action(async (from, to, amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;
    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const { maxAccounts, slippageBps, onlyDirectRoutes } = options;

    const response = await fetch("https://tokens.jup.ag/tokens?tags=verified");
    const data = await response.json(); // an array of tokens

    const tokenFrom = data.find(
      (t) =>
        t.address === from || t.symbol.toLowerCase() === from.toLowerCase(),
    );
    const tokenTo = data.find(
      (t) => t.address === to || t.symbol.toLowerCase() === to.toLowerCase(),
    );

    if (!tokenFrom || !tokenTo) {
      console.error("Error: cannot swap unverified token");
      process.exit(1);
    }

    let quoteParams = {
      inputMint: tokenFrom.address,
      outputMint: tokenTo.address,
      amount: Math.floor(parseFloat(amount) * 10 ** tokenFrom.decimals),
      swapMode: "ExactIn",
      slippageBps: slippageBps ? parseInt(slippageBps) : 5,
      asLegacyTransaction: false,
    } as QuoteParams;
    if (maxAccounts) {
      quoteParams = {
        ...quoteParams,
        maxAccounts: parseInt(maxAccounts),
      };
    }
    if (onlyDirectRoutes) {
      quoteParams = {
        ...quoteParams,
        onlyDirectRoutes,
      };
    }
    console.log("Quote params:", quoteParams);
    try {
      const txSig = await glamClient.jupiterSwap.swap(
        statePda,
        { quoteParams },
        { ...txOptions, simulate: !globalOpts.skipSimulation },
      );
      console.log(`Swapped ${amount} ${from} to ${to}: ${txSig}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const klend = program.command("klend").description("Kamino Lending");
klend
  .command("init")
  .description("Initialize Kamino Lending account")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
    }

    try {
      const txSig = await glamClient.kaminoLending.initialize(statePda);
      console.log(`Initialized Kamino Lending:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

klend
  .command("deposit <amount>")
  .description("Deposit to Kamino Lending vault")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
    }

    if (!options?.yes) {
      const confirmation = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: `Confirm deposit of ${amount} SOL?`,
          default: false,
        },
      ]);
      if (!confirmation.proceed) {
        console.log("Operation cancelled by the user.");
        process.exit(0);
      }
    }

    try {
      const txSig = await glamClient.kaminoLending.deposit(
        statePda,
        parseFloat(amount) * LAMPORTS_PER_SOL,
      );
      console.log(`Deposit ${amount} SOL to Kamino from vault:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      throw e;
    }
  });

const lst = program.command("lst").description("Liquid staking");
lst
  .command("stake <stakepool> <amount>")
  .description("Stake <amount> SOL into <stakepool>")
  .action(async (stakepool, amount) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.staking.stakePoolDepositSol(
        statePda,
        new PublicKey(stakepool),
        //TODO: better decimals (even though all LSTs have 9 right now)
        new anchor.BN(parseFloat(amount) * LAMPORTS_PER_SOL),
        txOptions,
      );
      console.log("txSig", txSig);
      console.log(`Staked ${amount} SOL into ${stakepool}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
lst
  .command("unstake <asset> <amount>")
  .description("Unstake <amount> worth of <asset> (mint address)")
  .action(async (asset, amount) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.staking.unstake(
        statePda,
        new PublicKey(asset),
        //TODO: better decimals (even though all LSTs have 9 right now)
        new anchor.BN(parseFloat(amount) * LAMPORTS_PER_SOL),
        txOptions,
      );
      console.log(`Unstaked ${amount} ${asset}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
lst
  .command("list")
  .description("List all stake accounts")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      let stakeAccounts = await glamClient.staking.getStakeAccountsWithStates(
        glamClient.getVaultPda(statePda),
      );
      console.log(
        "Account                                     ",
        "\t",
        "Lamports",
        "\t",
        "State",
      );
      stakeAccounts.forEach((acc: any) => {
        console.log(
          acc.address.toBase58(),
          "\t",
          acc.lamports,
          "\t",
          acc.state,
        );
      });
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });
lst
  .command("withdraw <accounts...>")
  .description("Withdraw staking accounts (space-separated pubkeys)")
  .action(async (accounts) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.staking.withdraw(
        statePda,
        accounts.map((addr: string) => new PublicKey(addr)),
      );
      console.log(`Withdrew from ${accounts}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
lst
  .command("marinade-list")
  .description("List all Marinade tickets")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      let stakeAccounts = await glamClient.marinade.getTickets(statePda);
      console.log(
        "Ticket                                      ",
        "\t",
        "Lamports",
        "\t",
        "State",
      );
      stakeAccounts.forEach((acc: any) => {
        console.log(
          acc.address.toBase58(),
          "\t",
          acc.lamports,
          "\t",
          acc.state,
        );
      });
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });
lst
  .command("marinade-claim <tickets...>")
  .description("Claim Marinade tickets (space-separated)")
  .action(async (tickets) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.marinade.claim(
        statePda,
        tickets.map((addr: string) => new PublicKey(addr)),
      );
      console.log(`Claimed ${tickets}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const meteora = program.command("meteora").description("Meteora DLMM");
meteora
  .command("init <pool>")
  .description("Initialize Meteora DLMM position")
  .action(async (pool) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }
    try {
      const txSig = await glamClient.meteoraDlmm.initializePosition(
        cliConfig.glam_state,
        pool,
      );
      console.log(`Initialized Meteora DLMM position: ${txSig}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
meteora
  .command("add <position> <amountX> <amountY> <strategy>")
  .description("Add liquidity to position")
  .action(async (position, amountX, amountY, strategy) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.meteoraDlmm.addLiquidityByStrategy(
        cliConfig.glam_state,
        position,
        new anchor.BN(amountX),
        new anchor.BN(amountY),
        strategy.toString(),
      );
      console.log(`Added liquidity to ${position}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
meteora
  .command("remove <position> <bps>")
  .description("Remove liquidity from position")
  .action(async (position, bps) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.meteoraDlmm.removeLiquidityByRange(
        cliConfig.glam_state,
        position,
        bps,
      );
      console.log(`Removed liquidity from ${position}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
meteora
  .command("claim <position>")
  .description("Claim fee")
  .action(async (position) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.meteoraDlmm.claimFee(
        cliConfig.glam_state,
        position,
      );
      console.log(`Claimed fee from ${position}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
meteora
  .command("close <position>")
  .description("Close a Meteora DLMM position")
  .action(async (position) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.meteoraDlmm.closePosition(
        cliConfig.glam_state,
        position,
      );
      console.log(`Closed Meteora DLMM position: ${txSig}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });
meteora
  .command("price <position>")
  .description("Price a Meteora DLMM position")
  .action(async (position) => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    await glamClient.meteoraDlmm.pricePosition(position);
  });

const drift = program.command("drift").description("Drift operations");
drift
  .command("price")
  .description("Price drift")
  .action(async () => {
    if (!cliConfig.glam_state) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }
    try {
      const marketConfigs = await glamClient.drift.fetchMarketConfigs();
      const txSig = await glamClient.drift.priceDrift(
        cliConfig.glam_state,
        marketConfigs,
        PriceDenom.USD,
      );
      console.log(`Pricing tx: ${txSig}`);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

const mint = program.command("mint").description("Mint operations");

mint
  .command("holders")
  .description("List all token holders")
  .action(async () => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const holders = await glamClient.mint.getHolders(statePda);
      console.log(
        "Owner                                      ",
        "\t",
        "Token Account                              ",
        "\t",
        "Amount",
        "\t",
        "Frozen",
      );
      holders.forEach((holder) => {
        console.log(
          holder.owner.toBase58(),
          "\t",
          holder.pubkey.toBase58(),
          "\t",
          holder.uiAmount,
          "\t",
          holder.frozen ? "Yes" : "No",
        );
      });
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("update")
  .description("Update mint policies")
  .option("-l, --lockup <seconds>", "Set lockup period in seconds")
  .option("-f, --frozen <boolean>", "Set default account state frozen")
  .action(async (options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    const mintModel = {} as Partial<MintModel>;

    if (options.lockup) {
      mintModel.lockUpPeriodInSeconds = parseInt(options.lockup);
    }

    if (options.frozen !== undefined) {
      mintModel.defaultAccountStateFrozen = options.frozen === "true";
    }

    if (Object.keys(mintModel).length === 0) {
      console.error("No parameters specified to update");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.mint.update(statePda, 0, mintModel);
      console.log(`Updated mint policies:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("create-account <owner>")
  .description("Create a token account for a user")
  .option("-f, --frozen <boolean>", "Set account frozen state", "true")
  .action(async (owner, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const ownerPubkey = new PublicKey(owner);
      const frozen = options.frozen === "true";
      const txSig = await glamClient.mint.createTokenAccount(
        statePda,
        ownerPubkey,
        0,
        frozen,
        txOptions,
      );
      console.log(`Created token account for ${owner}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("freeze <accounts...>")
  .description("Freeze token accounts (space-separated pubkeys)")
  .action(async (accounts) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const accountPubkeys = accounts.map((acc) => new PublicKey(acc));
      const txSig = await glamClient.mint.setTokenAccountsStates(
        statePda,
        0,
        accountPubkeys,
        true,
        txOptions,
      );
      console.log(`Froze accounts ${accounts}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("unfreeze <accounts...>")
  .description("Unfreeze token accounts (space-separated pubkeys)")
  .action(async (accounts) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const accountPubkeys = accounts.map((acc) => new PublicKey(acc));
      const txSig = await glamClient.mint.setTokenAccountsStates(
        statePda,
        0,
        accountPubkeys,
        false,
        txOptions,
      );
      console.log(`Unfroze accounts ${accounts}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("issue <recipient> <amount>")
  .description("Mint tokens to a recipient")
  .option(
    "-u, --unfreeze",
    "Unfreeze recipient token account before minting",
    false,
  )
  .action(async (recipient, amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const recipientPubkey = new PublicKey(recipient);
      const amountBN = new anchor.BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
      const txSig = await glamClient.mint.mint(
        statePda,
        0,
        recipientPubkey,
        amountBN,
        options.unfreeze,
        txOptions,
      );
      console.log(`Minted ${amount} tokens to ${recipient}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("burn <from> <amount>")
  .description("Burn tokens from an account")
  .option("-u, --unfreeze", "Unfreeze token account before burning", false)
  .action(async (from, amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const fromPubkey = new PublicKey(from);
      const amountBN = new anchor.BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
      const txSig = await glamClient.mint.burn(
        statePda,
        0,
        amountBN,
        fromPubkey,
        options.unfreeze,
        txOptions,
      );
      console.log(`Burned ${amount} tokens from ${from}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

mint
  .command("transfer <from> <to> <amount>")
  .description("Force transfer tokens between accounts")
  .option("-u, --unfreeze", "Unfreeze accounts before transferring", false)
  .action(async (from, to, amount, options) => {
    const statePda = cliConfig.glam_state
      ? new PublicKey(cliConfig.glam_state)
      : null;

    if (!statePda) {
      console.error("GLAM state not found in config file");
      process.exit(1);
    }

    try {
      const fromPubkey = new PublicKey(from);
      const toPubkey = new PublicKey(to);
      const amountBN = new anchor.BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
      const txSig = await glamClient.mint.forceTransfer(
        statePda,
        0,
        amountBN,
        fromPubkey,
        toPubkey,
        options.unfreeze,
        txOptions,
      );
      console.log(`Transferred ${amount} tokens from ${from} to ${to}:`, txSig);
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

//
// Run the CLI in development mode as follows:
// npx nx run cli:dev -- --args="view <pubkey>"
//
if (process.env.NODE_ENV === "development") {
  const argv = [
    process.argv[0], // Node.js binary path
    process.argv[1], // Script path
    ...process.argv[2].split(" "), // Split the concatenated arguments
  ];
  program.parse(argv);
} else {
  program.parse(process.argv);
}
globalOpts = program.opts();
