import {
  getPriorityFeeEstimate,
  GlamClient,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { Command } from "commander";

import fs from "fs";

import {
  CliConfig,
  confirmOperation,
  fundJsonToStateModel,
  parseTxError,
  validatePublicKey,
} from "./utils";
import { VersionedTransaction } from "@solana/web3.js";
import { installDriftCommands } from "./cmds/drift";
import { installDriftVaultsCommands } from "./cmds/drift-vaults";
import { installMintCommands } from "./cmds/mint";
import { installMeteoraCommands } from "./cmds/meteora";
import { installLstCommands } from "./cmds/lst";
import { installMarinadeCommands } from "./cmds/marinade";
import { installKLendCommands } from "./cmds/klend";
import { installKVaultsCommands } from "./cmds/kvaults";
import { installJupCommands } from "./cmds/jup";
import { installIntegrationCommands } from "./cmds/integration";
import { installDelegateCommands } from "./cmds/delegate";
import { installSwapCommands } from "./cmds/swap";
import { installInvestCommands } from "./cmds/invest";
import { installAltCommands } from "./cmds/alt";
import { installStakeCommands } from "./cmds/stake";
import { installVaultCommands } from "./cmds/vault";
import { installValidatorCommands } from "./cmds/validator";

let cliConfig: CliConfig;
let glamClient: GlamClient;
let txOptions: TxOptions;

function initialize(configPath?: string) {
  // Load config from the specified path or default
  cliConfig = configPath ? CliConfig.load(configPath) : CliConfig.get();
  glamClient = new GlamClient({
    statePda: cliConfig.glam_state && new PublicKey(cliConfig.glam_state),
  });

  txOptions = {
    simulate: true,
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
  };
}

initialize();

const program = new Command();
program
  .name("glam-cli")
  .description("CLI for interacting with the GLAM Protocol")
  .version("0.1.28");

program
  .command("env")
  .description("Display current environment setup")
  .action(async () => {
    console.log("Wallet connected:", glamClient.getSigner().toBase58());
    console.log("RPC endpoint:", glamClient.provider.connection.rpcEndpoint);
    console.log("Priority fee:", cliConfig.priority_fee);
    if (cliConfig.glam_state) {
      const vault = glamClient.vaultPda;
      console.log("GLAM state:", glamClient.statePda.toBase58());
      console.log("Active vault:", vault.toBase58());
    } else {
      console.log("No active GLAM specified");
    }
  });

program
  .command("list")
  .description("List GLAM instances the wallet has access to")
  .option(
    "-o, --owner-only",
    "Only show instances owned by the connected wallet",
  )
  .option("-a, --all", "Show all GLAM instance")
  .option("-t, --type <type>", "Filter by type: vault, mint, or fund")
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
  .command("set")
  .argument("<state>", "GLAM state public key", validatePublicKey)
  .description("Set the active GLAM instance by its state public key")
  .action((state: PublicKey) => {
    cliConfig.glamState = state;
    console.log(`Set active GLAM to: ${state}`);
  });

program
  .command("update-owner")
  .argument("<new-owner>", "New owner public key", validatePublicKey)
  .description("Update the owner of a GLAM instance")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (newOwner: PublicKey, options) => {
    options?.yes ||
      (await confirmOperation(`Confirm updating owner to ${newOwner}?`));

    const txSig = await glamClient.state.update({
      owner: {
        portfolioManagerName: null,
        pubkey: newOwner,
        kind: { wallet: {} },
      },
    });
    console.log(`Updated GLAM owner to ${newOwner}: ${txSig}`);
  });

program
  .command("add-asset")
  .argument("<asset>", "New asset public key", validatePublicKey)
  .description("Add a new asset to the GLAM")
  .action(async (asset: PublicKey, options) => {
    const stateModel = await glamClient.fetchStateModel();
    const assetsSet = new Set(
      [...stateModel.assets, asset].map((a) => a.toBase58()),
    );
    const assets = Array.from(assetsSet).map((a) => new PublicKey(a));

    const txSig = await glamClient.state.update({
      assets,
    });
    console.log(`Added asset ${asset}: ${txSig}`);
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
  .command("view")
  .argument("[state]", "GLAM state public key", validatePublicKey)
  .description("View a GLAM product by its state pubkey")
  .option("-c, --compact", "Compact output")
  .action(async (state: PublicKey | null, options) => {
    const glamStateModel = await glamClient.fetchStateModel(
      state || cliConfig.glamState,
    );
    console.log(
      options?.compact
        ? JSON.stringify(glamStateModel)
        : JSON.stringify(glamStateModel, null, 2),
    );
  });

program
  .command("create <path>")
  .description("Create a new GLAM product from a json file")
  .action(async (file) => {
    const data = fs.readFileSync(file, "utf8");

    let stateModel = null;
    const json = JSON.parse(data);

    if (json.accountType === "fund") {
      stateModel = fundJsonToStateModel(json);
    } else {
      stateModel = { ...json };
      stateModel.mints?.forEach((mint) => {
        mint.asset = new PublicKey(mint.asset);
        mint.permanentDelegate = mint.permanentDelegate
          ? new PublicKey(mint.permanentDelegate)
          : null;
      });
      stateModel.assets = stateModel.assets.map((a) => new PublicKey(a));
      stateModel.accountType = { [stateModel.accountType]: {} };
    }

    try {
      const [txSig] = await glamClient.state.create(
        stateModel,
        false,
        txOptions,
      );
      console.log("GLAM state created:", txSig);
      console.log("State PDA:", glamClient.statePda.toBase58());
      console.log("Vault PDA:", glamClient.vaultPda.toBase58());
      console.log("Mint PDA:", glamClient.mintPda.toBase58());

      cliConfig.glamState = glamClient.statePda;
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
    const statePda = cliConfig.glamState;
    const glamClient = new GlamClient({ statePda });
    try {
      const txSig = await glamClient.state.extend(bytes);
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
  .command("close")
  .argument("[state]", "GLAM state public key", validatePublicKey)
  .description("Close a GLAM product by its state pubkey")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (state: PublicKey | null, options) => {
    const statePda = state || cliConfig.glamState;
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

      console.log(`GLAM with state pubkey ${statePda} closed:`, txSig);
      cliConfig.glamState = null;
    } catch (e) {
      console.error(parseTxError(e));
      process.exit(1);
    }
  });

installSwapCommands(program, glamClient, cliConfig, txOptions);
installVaultCommands(program, glamClient, cliConfig, txOptions);

const delegate = program.command("delegate").description("Manage delegates");
installDelegateCommands(delegate, glamClient, cliConfig, txOptions);

const integration = program
  .command("integration")
  .description("Manage integrations");
installIntegrationCommands(integration, glamClient, cliConfig, txOptions);

const jup = program.command("jup").description("JUP staking");
installJupCommands(jup, glamClient, cliConfig, txOptions);

const klend = program.command("klend").description("Kamino lending");
installKLendCommands(klend, glamClient, cliConfig, txOptions);

const kvaults = program.command("kvaults").description("Kamino vaults");
installKVaultsCommands(kvaults, glamClient, cliConfig, txOptions);

const marinade = program.command("marinade").description("Marinade staking");
installMarinadeCommands(marinade, glamClient, cliConfig, txOptions);

const lst = program.command("lst").description("Liquid staking");
installLstCommands(lst, glamClient, cliConfig, txOptions);

const stake = program.command("stake").description("Native staking");
installStakeCommands(stake, glamClient, cliConfig, txOptions);

const meteora = program.command("meteora").description("Meteora DLMM");
installMeteoraCommands(meteora, glamClient, cliConfig, txOptions);

const drift = program.command("drift").description("Drift operations");
installDriftCommands(drift, glamClient, cliConfig, txOptions);

const driftVaults = program.command("drift-vaults").description("Drift vaults");
installDriftVaultsCommands(driftVaults, glamClient, cliConfig, txOptions);

const mint = program.command("mint").description("Mint operations");
installMintCommands(mint, glamClient, cliConfig, txOptions);

const invest = program
  .command("invest")
  .description("Tokenized vault operations");
installInvestCommands(invest, glamClient, cliConfig, txOptions);

const alt = program.command("alt").description("Manage address lookup tables");
installAltCommands(alt, glamClient, cliConfig, txOptions);

const validator = program
  .command("validator")
  .description("Validator operations");
installValidatorCommands(validator, glamClient, cliConfig, txOptions);

//
// Run the CLI in development mode as follows:
// npx nx run cli:dev -- --args="cmd [arg]"
//
// For example:
// npx nx run cli:dev -- --args="list -a"
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
