import {
  WSOL,
  fetchTokenPrices,
  fetchTokensList,
  nameToChars,
  charsToName,
  GlamClient,
  StateAccountType,
  fetchMintsAndTokenPrograms,
  PkSet,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "fs";
import {
  CliContext,
  confirmOperation,
  parseMintJson,
  parseStateJson,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { BN } from "@coral-xyz/anchor";

export function installVaultCommands(program: Command, context: CliContext) {
  program
    .command("list")
    .description("List GLAM vaults")
    .option(
      "-o, --owner-only",
      "Only show vaults owned by the connected wallet",
      false,
    )
    .option("-a, --all", "Show all GLAM vaults", false)
    .option("-t, --type <type>", "Filter by type: vault or tokenizedVault")
    .action(async ({ ownerOnly, all, type }) => {
      if (ownerOnly && all) {
        console.error(
          "Options '--owner-only' and '--all' cannot be used together.",
        );
        process.exit(1);
      }

      const signer = context.glamClient.signer;
      const filterOptions = all
        ? { type }
        : ownerOnly
          ? { owner: signer, type }
          : { owner: signer, delegate: signer, type };

      const glamStates =
        await context.glamClient.fetchGlamStates(filterOptions);

      if (glamStates.length === 0) {
        console.log("No vaults found.");
        return;
      }

      // Define column widths for the table
      const colWidths = [15, 45, 45, 12, 25];
      const printRow = (items: string[]) => {
        console.log(
          items[0].padEnd(colWidths[0]),
          items[1].padEnd(colWidths[1]),
          items[2].padEnd(colWidths[2]),
          items[3].padEnd(colWidths[3]),
          items[4].padEnd(colWidths[4]),
        );
      };

      // Print header
      printRow(["Type", "Glam State", "Vault Address", "Launch Date", "Name"]);
      printRow([
        "-".repeat(colWidths[0]),
        "-".repeat(colWidths[1]),
        "-".repeat(colWidths[2]),
        "-".repeat(colWidths[3]),
        "-".repeat(colWidths[4]),
      ]);

      // Print vault data
      glamStates
        .sort((a, b) => (a.launchDate > b.launchDate ? -1 : 1))
        .forEach((stateModel) => {
          printRow([
            stateModel.productType,
            stateModel.idStr,
            stateModel.vault.toBase58(),
            stateModel.launchDate,
            charsToName(stateModel.name),
          ]);
        });
    });

  program
    .command("set")
    .argument("<state>", "GLAM state public key", validatePublicKey)
    .description("Set the active GLAM vault for subsequent CLI operations")
    .action(async (state: PublicKey) => {
      try {
        context.glamClient.statePda = state;
        const stateModel = await context.glamClient.fetchStateModel();
        context.cliConfig.glamState = state;
        console.log(`Active GLAM state: ${stateModel.idStr}`);
        console.log(`Vault: ${stateModel.vault}`);
      } catch {
        context.glamClient.statePda = null;
        console.error("Invalid GLAM state public key.");
        process.exit(1);
      }
    });

  program
    .command("update-owner")
    .argument("<new-owner>", "New owner public key", validatePublicKey)
    .option("-n, --name <name>", "New portfolio manager name")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Update the owner of a GLAM vault")
    .action(async (newOwner: PublicKey, options) => {
      const newPortfolioManagerName = options?.name
        ? nameToChars(options.name)
        : null;

      if (!options?.yes) {
        if (newPortfolioManagerName) {
          await confirmOperation(
            `Confirm updating owner to ${newOwner} and portfolio manager name to ${options.name}?`,
          );
        } else {
          await confirmOperation(`Confirm updating owner to ${newOwner}?`);
        }
      }

      try {
        const txSig = await context.glamClient.state.update({
          owner: newOwner,
          portfolioManagerName: newPortfolioManagerName,
        });
        if (newPortfolioManagerName) {
          console.log(
            `GLAM owner and portfolio manager name updated: ${txSig}`,
          );
        } else {
          console.log(`GLAM owner updated: ${txSig}`);
        }
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("set-enabled <enabled>")
    .description("Set GLAM state enabled or disabled")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (enabled, options) => {
      const parseBooleanInput = (input: string): boolean => {
        const normalized = input.toLowerCase().trim();
        const truthyValues = ["true", "1", "yes", "y", "on", "enable"];
        const falsyValues = ["false", "0", "no", "n", "off", "disable"];

        if (truthyValues.includes(normalized)) return true;
        if (falsyValues.includes(normalized)) return false;

        throw new Error(
          `Invalid boolean value: "${input}". Use: true/false, yes/no, 1/0, enable/disable`,
        );
      };
      const enabledBool = parseBooleanInput(enabled);
      const glamState = context.cliConfig.glamState;
      options?.yes ||
        (await confirmOperation(
          `Confirm ${enabledBool ? "enabling" : "disabling"} ${glamState}?`,
        ));

      try {
        const txSig = await context.glamClient.access.emergencyAccessUpdate(
          { stateEnabled: enabledBool },
          context.txOptions,
        );
        console.log(
          `Set GLAM state ${glamState} to ${enabledBool ? "enabled" : "disabled"}:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("view")
    .argument("[state]", "GLAM state public key", validatePublicKey)
    .description("View a GLAM product by its state pubkey")
    .option("-c, --compact", "Compact output")
    .action(async (state: PublicKey | null, options) => {
      const glamStateModel = await context.glamClient.fetchStateModel(
        state || context.cliConfig.glamState,
      );
      console.log(
        options?.compact
          ? JSON.stringify(glamStateModel)
          : JSON.stringify(glamStateModel, null, 2),
      );
    });

  program
    .command("create <path>")
    .description("Create a new GLAM from a json file")
    .action(async (file) => {
      if (!fs.existsSync(file)) {
        console.error(`File ${file} does not exist`);
        process.exit(1);
      }

      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!json.state && !json.mint) {
        throw new Error(
          "Invalid JSON file: must contain 'state' or 'mint' property",
        );
      }

      const initStateParams = parseStateJson(json);
      if (
        StateAccountType.equals(
          initStateParams.accountType,
          StateAccountType.VAULT,
        )
      ) {
        try {
          const txSig = await context.glamClient.state.initialize(
            initStateParams,
            context.txOptions,
          );
          context.cliConfig.glamState = context.glamClient.statePda;
          console.log("GLAM vault initialized:", txSig);
          console.log("State PDA:", context.glamClient.statePda.toBase58());
          console.log("Vault PDA:", context.glamClient.vaultPda.toBase58());
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
        return;
      }

      const initMintParams = parseMintJson(json, initStateParams.accountType);
      try {
        // mint.initialize creates state with default setup
        // we update state with input after mint initialization
        const txSig = await context.glamClient.mint.initializeWithStateParams(
          initMintParams,
          initStateParams,
          context.txOptions,
        );
        context.cliConfig.glamState = context.glamClient.statePda;
        console.log("GLAM tokenized vault initialized:", txSig);
        console.log("State PDA:", context.glamClient.statePda.toBase58());
        console.log("Vault PDA:", context.glamClient.vaultPda.toBase58());
        console.log("Mint PDA:", context.glamClient.mintPda.toBase58());
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("extend")
    .argument("<bytes>", "New bytes", parseInt)
    .description("Extend GLAM state account size")
    .action(async (bytes) => {
      const statePda = context.cliConfig.glamState;
      const glamClient = new GlamClient({ statePda });
      try {
        const txSig = await context.glamClient.state.extend(bytes);
        console.log(
          `GLAM state account ${statePda} extended by ${bytes} bytes:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("set-protocol-fees")
    .argument(
      "<state>",
      "GLAM state public key for the tokenized vault",
      validatePublicKey,
    )
    .argument("<base-fee-bps>", "Base fee in basis points", parseInt)
    .argument("<flow-fee-bps>", "Flow fee in basis points", parseInt)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Set protocol fees for a GLAM tokenized vault")
    .action(
      async (
        state: PublicKey,
        baseFeeBps: number,
        flowFeeBps: number,
        options,
      ) => {
        options?.yes ||
          (await confirmOperation(
            `Confirm setting protocol base fee to ${baseFeeBps} and flow fee to ${flowFeeBps} for ${state}?`,
          ));

        try {
          const txSig = await context.glamClient.fees.setProtocolFees(
            baseFeeBps,
            flowFeeBps,
          );
          console.log(`Protocol fees updated for ${state}:`, txSig);
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  program
    .command("close")
    .argument("[state]", "Vault state public key", validatePublicKey)
    .description("Close a GLAM vault by its state pubkey")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (state: PublicKey | null, options) => {
      const statePda = state || context.cliConfig.glamState;
      const glamClient = new GlamClient({ statePda });
      const stateModel = await glamClient.fetchStateModel();

      options?.yes ||
        (await confirmOperation(
          `Confirm closing GLAM: ${stateModel.nameStr} (state pubkey ${statePda})?`,
        ));

      const preInstructions = [];
      if (stateModel.mint) {
        const closeMintIx = await glamClient.mint.txBuilder.closeMintIx();
        preInstructions.push(closeMintIx);
      }
      try {
        const txSig = await glamClient.state.close({
          ...context.txOptions,
          preInstructions,
        });

        console.log(`${stateModel.nameStr} closed:`, txSig);
        context.cliConfig.glamState = null;
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("wrap")
    .argument("<amount>", "Amount to wrap", parseFloat)
    .description("Wrap SOL")
    .action(async (amount: number) => {
      const lamports = new BN(amount * LAMPORTS_PER_SOL);

      if (lamports.lte(new BN(0))) {
        console.error("Error: amount must be greater than 0");
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.vault.wrap(
          lamports,
          context.txOptions,
        );
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
        const txSig = await context.glamClient.vault.unwrap(context.txOptions);
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
      const vault = context.glamClient.vaultPda;
      const { uiAmount: solUiAmount, tokenAccounts } =
        await context.glamClient.getSolAndTokenBalances(vault);

      const mints = tokenAccounts.map((ta) => ta.mint.toBase58());
      if (!mints.includes(WSOL.toBase58())) {
        mints.push(WSOL.toBase58());
      }

      const tokenPrices = await fetchTokenPrices(mints);
      const mintToPrice = new Map(
        tokenPrices.map(({ mint, price }) => [mint, price]),
      );
      const tokenList = await fetchTokensList();

      // Define column widths
      const colWidths = [12, 45, 15, 20];
      const printRow = (items: string[]) => {
        console.log(
          items[0].padEnd(colWidths[0]),
          items[1].padEnd(colWidths[1]),
          items[2].padEnd(colWidths[2]),
          items[3].padEnd(colWidths[3]),
        );
      };

      printRow(["Token", "Mint", "Amount", "Value (USD)"]); // header row
      printRow([
        "SOL",
        "N/A",
        solUiAmount.toFixed(9).toString(),
        (mintToPrice.get(WSOL.toBase58()) * solUiAmount).toFixed(6),
      ]);

      tokenAccounts.forEach((ta) => {
        const { uiAmount, mint } = ta;
        const mintStr = mint.toBase58();

        if (all || uiAmount > 0) {
          const token = tokenList.find((t) => t.address === mintStr);
          const tokenSymbol =
            token?.symbol === "SOL" ? "wSOL" : token?.symbol || "Unknown";
          const value = mintToPrice.get(mintStr) * uiAmount;

          printRow([
            tokenSymbol,
            mintStr,
            uiAmount.toString(),
            value ? value.toFixed(6) : "NaN",
          ]);
        }
      });
    });

  program
    .command("asset-allowlist")
    .description("Get asset allowlist and corresponding token account")
    .action(async () => {
      const state = await context.glamClient.fetchStateAccount();
      const mints = await fetchMintsAndTokenPrograms(
        context.glamClient.connection,
        state.assets,
      );

      const data = mints.map(
        ({ mint: { address, decimals }, tokenProgram }) => {
          const tokenAccount = context.glamClient.getVaultAta(
            address,
            tokenProgram,
          );
          return {
            assetMint: address,
            decimals,
            tokenAccount,
            tokenProgram,
          };
        },
      );
      console.log(JSON.stringify(data, null, 2));
    });

  program
    .command("add-asset")
    .argument("<asset>", "Asset mint public key", validatePublicKey)
    .description("Add a new asset to allowlist")
    .action(async (asset: PublicKey) => {
      const state = await context.glamClient.fetchStateAccount();
      const assetsSet = new PkSet(state.assets);

      if (assetsSet.has(asset)) {
        console.error(`Asset ${asset} already allowlisted`);
        process.exit(1);
      }

      const assets = Array.from(assetsSet.add(asset));
      const txSig = await context.glamClient.state.update(
        { assets },
        context.txOptions,
      );
      console.log(`Allowlisted asset ${asset}: ${txSig}`);
    });

  program
    .command("delete-asset")
    .argument("<asset>", "Asset mint public key", validatePublicKey)
    .description("Delete an asset from allowlist")
    .action(async (asset: PublicKey) => {
      const state = await context.glamClient.fetchStateAccount();

      if (asset.equals(state.baseAssetMint)) {
        console.error("Base asset should not be deleted from allowlist");
        process.exit(1);
      }

      const assetsSet = new PkSet(state.assets);
      let removed = assetsSet.delete(asset);
      if (!removed) {
        console.error(`${asset} not found in allowlist, nothing to delete`);
        process.exit(1);
      }

      const assets = Array.from(assetsSet);
      const txSig = await context.glamClient.state.update(
        { assets },
        context.txOptions,
      );
      console.log(`Deleted asset ${asset} from allowlist: ${txSig}`);
    });

  program
    .command("holdings")
    .description("Get vault holdings")
    .action(async () => {
      const holdings =
        await context.glamClient.price.getVaultHoldings("confirmed");
      console.log(holdings.toJson());
    });
}
