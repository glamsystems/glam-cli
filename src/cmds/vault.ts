import {
  WSOL,
  stringToChars,
  charsToString,
  GlamClient,
  StateAccountType,
  fetchMintsAndTokenPrograms,
  PkSet,
  fromUiAmount,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import fs from "fs";
import {
  CliContext,
  executeTxWithErrorHandling,
  parseMintJson,
  parseStateJson,
  validateBooleanInput,
  validateFileExists,
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
            charsToString(stateModel.name),
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
        // @ts-expect-error
        context.glamClient.statePda = undefined;
        console.error("Invalid GLAM state public key.");
        process.exit(1);
      }
    });

  program
    .command("update-owner")
    .argument("<new-owner>", "New owner public key", validatePublicKey)
    .option("-n, --name <name>", "New portfolio manager name")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update the owner of a GLAM vault")
    .action(async (newOwner: PublicKey, options) => {
      const newPortfolioManagerName = options?.name
        ? stringToChars(options.name)
        : undefined;

      const message = newPortfolioManagerName
        ? `Confirm transferring ownership to ${newOwner} (portfolio manager: ${options.name})?`
        : `Confirm transferring ownership to ${newOwner}?`;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.state.update({
            owner: newOwner,
            portfolioManagerName: newPortfolioManagerName,
          }),
        {
          skip: options?.yes,
          message,
        },
        (txSig) => `Vault ownership transferred: ${txSig}`,
      );
    });

  program
    .command("set-enabled")
    .argument("<enabled>", "New vault state", validateBooleanInput)
    .description("Enable or disable a GLAM vault")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (enabled, options) => {
      const stateAccount = await context.glamClient.fetchStateAccount();
      const name = charsToString(stateAccount.name);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.emergencyAccessUpdate(
            { stateEnabled: enabled },
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm ${enabled ? "enabling" : "disabling"} vault: ${name}`,
        },
        (txSig) =>
          `GLAM vault ${name} ${enabled ? "enabled" : "disabled"}: ${txSig}`,
      );
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
    .command("create")
    .argument("<path>", "Path to the JSON file", validateFileExists)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Create a new GLAM vault from a json file")
    .action(async (file, options) => {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!json.state && !json.mint) {
        throw new Error(
          "Invalid JSON file: must contain 'state' or 'mint' property",
        );
      }

      const initStateParams = parseStateJson(json);
      const accountType = initStateParams.accountType;
      const accountTypeStr = Object.keys(accountType)[0];

      if (accountType === StateAccountType.VAULT) {
        await executeTxWithErrorHandling(
          async () => {
            const txSig = await context.glamClient.state.initialize(
              initStateParams,
              context.txOptions,
            );
            context.cliConfig.glamState = context.glamClient.statePda;
            console.log("State PDA:", context.glamClient.statePda.toBase58());
            console.log("Vault PDA:", context.glamClient.vaultPda.toBase58());
            return txSig;
          },
          {
            skip: options?.yes,
            message: `Confirm initializing ${accountTypeStr}: ${charsToString(initStateParams.name)}`,
          },
          (txSig) => `Initialized ${accountTypeStr}: ${txSig}`,
        );
        return;
      }

      const initMintParams = parseMintJson(json, accountType);
      await executeTxWithErrorHandling(
        async () => {
          // mint.initializeWithStateParams creates state with default setup
          // we update state with input after mint initialization to apply state params
          const txSig = await context.glamClient.mint.initializeWithStateParams(
            initMintParams,
            // @ts-expect-error
            initStateParams,
            context.txOptions,
          );
          context.cliConfig.glamState = context.glamClient.statePda;
          console.log("State PDA:", context.glamClient.statePda.toBase58());
          console.log("Vault PDA:", context.glamClient.vaultPda.toBase58());
          console.log("Mint PDA:", context.glamClient.mintPda.toBase58());
          return txSig;
        },
        {
          skip: options?.yes,
          message: `Confirm initializing ${accountTypeStr}: ${charsToString(initMintParams.name)}`,
        },
        (txSig) => `Initialized ${accountTypeStr}: ${txSig}`,
      );
    });

  program
    .command("extend")
    .argument("<bytes>", "New bytes", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Extend GLAM state account")
    .action(async (bytes, options) => {
      await executeTxWithErrorHandling(
        () => context.glamClient.state.extend(bytes),
        {
          skip: options?.yes,
          message: `Confirm extending GLAM state ${context.cliConfig.glamState} by ${bytes} bytes`,
        },
        (txSig) =>
          `GLAM state ${context.cliConfig.glamState} extended: ${txSig}`,
      );
    });

  program
    .command("close")
    .argument("[state]", "Vault state public key", validatePublicKey)
    .description("Close a GLAM vault by its state pubkey")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (state: PublicKey | null, options) => {
      const statePda = state || context.cliConfig.glamState;
      const glamClient = new GlamClient({
        statePda,
        cluster: context.cliConfig.cluster,
      });
      const stateModel = await glamClient.fetchStateModel();

      const preInstructions = new Array<TransactionInstruction>();
      if (stateModel.mint) {
        const closeMintIx = await glamClient.mint.txBuilder.closeMintIx();
        preInstructions.push(closeMintIx);
      }
      await executeTxWithErrorHandling(
        async () => {
          const txSig = await glamClient.state.close({
            ...context.txOptions,
            preInstructions,
          });
          context.cliConfig.glamState = null;
          return txSig;
        },
        {
          skip: options?.yes,
          message: `Confirm closing vault: ${stateModel.nameStr}\n  - state: ${statePda}\n  - vault: ${stateModel.vault}`,
        },
        (txSig) => `${stateModel.nameStr} closed: ${txSig}`,
      );
    });

  program
    .command("wrap")
    .argument("<amount>", "Amount to wrap", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Wrap SOL")
    .action(async (amount: number, options) => {
      const lamports = fromUiAmount(amount, 9);

      if (lamports.lte(new BN(0))) {
        console.error("Error: amount must be greater than 0");
        process.exit(1);
      }

      await executeTxWithErrorHandling(
        () => context.glamClient.vault.wrap(lamports, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm wrapping ${amount} SOL`,
        },
        (txSig) => `Wrapped ${amount} SOL: ${txSig}`,
      );
    });

  program
    .command("unwrap")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Unwrap wSOL")
    .action(async (options) => {
      await executeTxWithErrorHandling(
        () => context.glamClient.vault.unwrap(context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm unwrapping all wSOL`,
        },
        (txSig) => `wSOL unwrapped: ${txSig}`,
      );
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

      const jupApi = context.glamClient.jupiterSwap.jupApi;
      const tokenList = await jupApi.fetchTokensList();

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
        ((tokenList.getByMint(WSOL)?.usdPrice || 0) * solUiAmount).toFixed(6),
      ]);

      tokenAccounts.forEach((ta) => {
        const { uiAmount, mint } = ta;
        const mintStr = mint.toBase58();

        if (all || uiAmount > 0) {
          const token = tokenList.getByMint(mintStr);
          const tokenSymbol =
            token?.symbol === "SOL" ? "wSOL" : token?.symbol || "Unknown";
          const value = (token?.usdPrice || 0) * uiAmount;

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
    .command("list-assets")
    .description("List vault asset allowlist and corresponding token accounts")
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
    .command("allowlist-asset")
    .argument("<asset>", "Asset mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add an asset to the allowlist")
    .action(async (asset: PublicKey, options) => {
      const state = await context.glamClient.fetchStateAccount();
      const assetsSet = new PkSet(state.assets);

      if (assetsSet.has(asset)) {
        console.error(`Asset ${asset} already allowlisted`);
        process.exit(1);
      }

      const assets = Array.from(assetsSet.add(asset));

      await executeTxWithErrorHandling(
        () => context.glamClient.state.update({ assets }, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding ${asset} to allowlist?`,
        },
        (txSig) => `${asset} added to allowlist: ${txSig}`,
      );
    });

  program
    .command("remove-asset")
    .argument("<asset>", "Asset mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove an asset from the allowlist")
    .action(async (asset: PublicKey, options) => {
      const state = await context.glamClient.fetchStateAccount();

      if (asset.equals(state.baseAssetMint)) {
        console.error("Base asset should not be removed from allowlist");
        process.exit(1);
      }

      const assetsSet = new PkSet(state.assets);
      const removed = assetsSet.delete(asset);
      if (!removed) {
        console.error(`${asset} not found in allowlist, nothing to remove`);
        process.exit(1);
      }

      const assets = Array.from(assetsSet);
      await executeTxWithErrorHandling(
        () => context.glamClient.state.update({ assets }, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing ${asset} from allowlist?`,
        },
        (txSig) => `${asset} removed from allowlist: ${txSig}`,
      );
    });

  program
    .command("holdings")
    .description("Get all vault holdings")
    .action(async () => {
      const holdings =
        await context.glamClient.price.getVaultHoldings("confirmed");
      console.log(holdings.toJson());
    });
}
