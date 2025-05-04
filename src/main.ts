import * as anchor from "@coral-xyz/anchor";
import {
  WSOL,
  getPriorityFeeEstimate,
  GlamClient,
} from "@glamsystems/glam-sdk";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Command } from "commander";

import fs from "fs";

import { CliConfig, confirmOperation, parseTxError } from "./utils";
import { VersionedTransaction } from "@solana/web3.js";
import { installDriftCommands } from "./cmds/drift";
import { installMintCommands } from "./cmds/mint";
import { installMeteoraCommands } from "./cmds/meteora";
import { installLstCommands } from "./cmds/lst";
import { installMarinadeCommands } from "./cmds/marinade";
import { installKlendCommands } from "./cmds/klend";
import { installJupCommands } from "./cmds/jup";
import { installIntegrationCommands } from "./cmds/integration";
import { installDelegateCommands } from "./cmds/delegate";
import { installSwapCommands } from "./cmds/swap";
import { installInvestCommands } from "./cmds/invest";
import { installAltCommands } from "./cmds/alt";

const cliConfig = CliConfig.get();

// If glam_state is available from config, use it in GlamClient; otherwise leave it undefined
const glamClient = new GlamClient({
  statePda: cliConfig.glam_state && new PublicKey(cliConfig.glam_state),
});

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

const program = new Command();
let globalOpts = { skipSimulation: false };

program
  .name("glam-cli")
  .description("CLI for interacting with the GLAM Protocol")
  .version("0.1.22")
  .option("-S, --skip-simulation", "Skip transaction simulation");

program
  .command("env")
  .description("Show environment setup")
  .action(async () => {
    console.log("Wallet connected:", glamClient.getSigner().toBase58());
    console.log("RPC endpoint:", glamClient.provider.connection.rpcEndpoint);
    console.log("Priority fee:", cliConfig.priority_fee);
    if (cliConfig.glam_state) {
      const vault = glamClient.vaultPda;
      console.log("GLAM state:", glamClient.statePda.toBase58());
      console.log("✅ Active vault:", vault.toBase58());
    } else {
      console.log("No active GLAM specified");
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
      cliConfig.glamState = new PublicKey(state);
      console.log("Set active GLAM to:", state);
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
    options?.yes ||
      (await confirmOperation(`Confirm updating owner to ${newOwnerPubkey}?`));

    try {
      const newOwner = new PublicKey(newOwnerPubkey);
      await glamClient.state.update({
        owner: {
          portfolioManagerName: null,
          pubkey: newOwner,
          kind: { wallet: {} },
        },
      });
      console.log(`Updated GLAM owner to ${newOwnerPubkey}`);
    } catch (e) {
      console.error("Not a valid pubkey:", newOwnerPubkey);
      process.exit(1);
    }
  });

program
  .command("set-enabled <enabled>")
  .description("Set GLAM state enabled or disabled")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (enabled, options) => {
    const glamState = cliConfig.glamState;

    // Convert string input to boolean
    const enabledBool =
      enabled === "true" || enabled === "1" || enabled === "yes";

    options?.yes ||
      (await confirmOperation(
        `Confirm ${enabledBool ? "enabling" : "disabling"} ${glamState.toBase58()}?`,
      ));

    try {
      const txSig = await glamClient.state.update({
        enabled: enabledBool,
      });
      console.log(
        `Set GLAM state ${glamState.toBase58()} to ${enabledBool ? "enabled" : "disabled"}:`,
        txSig,
      );
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("view [state]")
  .description("View a GLAM product by its state pubkey")
  .option("-c, --compact", "Compact output")
  .action(async (state: string | null, options) => {
    try {
      const statePda = state ? new PublicKey(state) : cliConfig.glamState;
      const glamStateModel = await glamClient.fetchStateModel(statePda);
      console.log(
        options?.compact
          ? JSON.stringify(glamStateModel)
          : JSON.stringify(glamStateModel, null, 2),
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
      const [txSig] = await glamClient.state.create(glamState);
      console.log("txSig:", txSig);
      console.log("GLAM state created:", glamClient.statePda.toBase58());
      console.log("Vault:", glamClient.vaultPda.toBase58());

      cliConfig.glamState = glamClient.statePda;
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

program
  .command("close [state]")
  .description("Close a GLAM product by its state pubkey")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (state: string | null, options) => {
    const statePda = state ? new PublicKey(state) : cliConfig.glamState;
    const glamClient = new GlamClient({ statePda });

    options?.yes ||
      (await confirmOperation(
        `Confirm closing GLAM with state pubkey ${statePda.toBase58()}?`,
      ));

    const preInstructions = [];
    // @ts-ignore
    const stateAccount = await glamClient.fetchStateAccount();
    if (stateAccount.mints.length > 0) {
      const closeMintIx = await glamClient.mint.closeMintIx();
      preInstructions.push(closeMintIx);
    }
    try {
      const txSig = await glamClient.state.close({
        ...txOptions,
        preInstructions,
      });

      console.log(
        `GLAM with state pubkey ${statePda.toBase58()} closed:`,
        txSig,
      );
      cliConfig.glamState = null;
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
    const statePda = cliConfig.glamState;

    if (asset.toLowerCase() === "sol") {
      asset = WSOL.toBase58();
    }
    // TODO: support more token symbols

    const { mint } = await glamClient.fetchMintAndTokenProgram(
      new PublicKey(asset),
    );

    options?.yes ||
      (await confirmOperation(`Confirm withdrawal of ${amount} ${asset}?`));

    try {
      const txSig = await glamClient.state.withdraw(
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

program
  .command("wrap <amount>")
  .description("Wrap SOL")
  .action(async (amount) => {
    const lamports = new anchor.BN(parseFloat(amount) * LAMPORTS_PER_SOL);
    if (lamports.lte(new anchor.BN(0))) {
      console.error("Error: amount must be greater than 0");
      process.exit(1);
    }

    try {
      const txSig = await glamClient.wsol.wrap(lamports, txOptions);
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
    try {
      const txSig = await glamClient.wsol.unwrap(txOptions);
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
    const { all } = options;
    const vault = glamClient.vaultPda;
    const { uiAmount: solUiAmount, tokenAccounts } =
      await glamClient.getSolAndTokenBalances(vault);

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
      solUiAmount,
      "\t",
      parseFloat(pricesData[WSOL.toBase58()].price) * solUiAmount,
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

installSwapCommands(program, glamClient, cliConfig, txOptions);

const delegate = program.command("delegate").description("Manage delegates");
installDelegateCommands(delegate, glamClient, cliConfig, txOptions);

const integration = program
  .command("integration")
  .description("Manage integrations");
installIntegrationCommands(integration, glamClient, cliConfig, txOptions);

const jup = program.command("jup").description("JUP staking");
installJupCommands(jup, glamClient, cliConfig, txOptions);

const klend = program.command("klend").description("Kamino Lending");
installKlendCommands(klend, glamClient, cliConfig, txOptions);

const marinade = program.command("marinade").description("Marinade staking");
installMarinadeCommands(marinade, glamClient, cliConfig, txOptions);

const lst = program.command("lst").description("Liquid staking");
installLstCommands(lst, glamClient, cliConfig, txOptions);

const meteora = program.command("meteora").description("Meteora DLMM");
installMeteoraCommands(meteora, glamClient, cliConfig, txOptions);

const drift = program.command("drift").description("Drift operations");
installDriftCommands(drift, glamClient, cliConfig, txOptions);

const mint = program.command("mint").description("Mint operations");
installMintCommands(mint, glamClient, cliConfig, txOptions);

const invest = program
  .command("invest")
  .description("Tokenized vault operations");
installInvestCommands(invest, glamClient, cliConfig, txOptions);

const alt = program.command("alt").description("Manage address lookup tables");
installAltCommands(alt, glamClient, cliConfig, txOptions);

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
