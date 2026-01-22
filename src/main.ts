import {
  charsToString,
  getPriorityFeeEstimate,
  GlamClient,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { Command } from "commander";

import { CliConfig, CliContext } from "./utils";
import { VersionedTransaction } from "@solana/web3.js";
import { installDriftProtocolCommands } from "./cmds/drift-protocol";
import { installDriftVaultsCommands } from "./cmds/drift-vaults";
import { installLstCommands } from "./cmds/lst";
import { installMarinadeCommands } from "./cmds/marinade";
import { installKaminoLendCommands } from "./cmds/kamino-lend";
import { installKaminoVaultsCommands } from "./cmds/kamino-vaults";
import { installKaminoFarmsCommands } from "./cmds/kamino-farms";
import { installIntegrationCommands } from "./cmds/integration";
import { installDelegateCommands } from "./cmds/delegate";
import { installJupiterCommands } from "./cmds/jupiter";
import { installInvestCommands } from "./cmds/invest";
import { installAltCommands } from "./cmds/alt";
import { installStakeCommands } from "./cmds/stake";
import { installVaultCommands } from "./cmds/vault";
import { idlCheck } from "./idl";
import { installManageCommands } from "./cmds/manage";
import { installCctpCommands } from "./cmds/cctp";
import { installTransferCommands } from "./cmds/transfer";
import { installTimelockCommands } from "./cmds/timelock";

const context = {} as CliContext;

// Graceful shutdown handling
function setupGracefulShutdown() {
  process.on("SIGINT", () => {
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    console.error("\nUncaught Exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("\nUnhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  });
}

function initialize(configPath?: string, skipSimulation = false) {
  const cliConfig = CliConfig.get(configPath);
  const { cluster, glam_state } = cliConfig;

  context.glamClient = new GlamClient({
    cluster,
    statePda:
      glam_state && glam_state !== "" ? new PublicKey(glam_state) : undefined,
  });

  context.cliConfig = cliConfig;
  context.txOptions = {
    simulate: !skipSimulation,
    getPriorityFeeMicroLamports: async (tx: VersionedTransaction) => {
      if (
        context.cliConfig.cluster === "localnet" ||
        context.cliConfig.cluster === "devnet"
      ) {
        return 1_000_000;
      }

      const { micro_lamports, helius_api_key, level } =
        context.cliConfig.priority_fee || {};

      // If micro_lamports is provided, use it
      if (micro_lamports === 0 || micro_lamports) {
        return micro_lamports;
      }

      // If helius_api_key is not provided, return 0
      return helius_api_key
        ? await getPriorityFeeEstimate({
            heliusApiKey: helius_api_key,
            tx,
            priorityLevel: level,
          })
        : 0;
    },
  };
}

// Initialize with default config first so subcommands have valid values
// initialize();
setupGracefulShutdown();

const program = new Command();
program
  .name("glam-cli")
  .description("CLI for interacting with the GLAM Protocol")
  .option("-C, --config <path>", "path to config file")
  .option("-S, --skip-simulation", "skip simulation", false)
  .hook("preSubcommand", async (thisCommand: Command) => {
    const { config, skipSimulation } = thisCommand.opts();

    initialize(config, skipSimulation);
    await idlCheck(context.glamClient);
  })
  .version("1.0.8");

program
  .command("env")
  .description("Display current environment setup")
  .action(async () => {
    const { cliConfig, glamClient } = context;
    console.log(
      "GLAM Protocol program:",
      glamClient.protocolProgram.programId.toBase58(),
    );
    console.log("Staging:", cliConfig.glam_staging ? true : false);
    console.log("Wallet connected:", glamClient.signer.toBase58());
    console.log("RPC endpoint:", glamClient.connection.rpcEndpoint);
    console.log("Priority fee:", cliConfig.priority_fee);
    console.log(
      "Jupiter API key:",
      cliConfig.jupiter_api_key ? "configured" : "not configured",
    );

    if (cliConfig.glam_state) {
      console.log(`GLAM state: ${glamClient.statePda}`);
      console.log(`Vault PDA: ${glamClient.vaultPda}`);

      const stateAccount = await glamClient.fetchStateAccount();
      if (!stateAccount) {
        console.log("Invalid GLAM state account.");
      } else {
        console.log("Vault name:", charsToString(stateAccount.name));
      }
    } else {
      console.log("No active GLAM vault configured.");
    }
  });

const vault = program
  .command("vault")
  .description("Create, close, manage vault");
installVaultCommands(vault, context);

const transfer = program
  .command("transfer")
  .description("Transfer vault assets out");
installTransferCommands(transfer, context);

const delegate = program.command("delegate").description("Manage delegates");
installDelegateCommands(delegate, context);

const integration = program
  .command("integration")
  .description("Manage integrations");
installIntegrationCommands(integration, context);

const jupiter = program.command("jupiter").description("Jupiter protocols");
installJupiterCommands(jupiter, context);

const klend = program.command("kamino-lend").description("Kamino lending");
installKaminoLendCommands(klend, context);

const kvaults = program.command("kamino-vaults").description("Kamino vaults");
installKaminoVaultsCommands(kvaults, context);

const kfarms = program.command("kamino-farms").description("Kamino farms");
installKaminoFarmsCommands(kfarms, context);

const drift = program.command("drift-protocol").description("Drift protocol");
installDriftProtocolCommands(drift, context);

const driftVaults = program.command("drift-vaults").description("Drift vaults");
installDriftVaultsCommands(driftVaults, context);

const invest = program
  .command("invest")
  .description("Tokenized vault investor operations");
installInvestCommands(invest, context);

const manage = program
  .command("manage")
  .description("Tokenized vault manager operations");
installManageCommands(manage, context);

const alt = program.command("alt").description("Manage address lookup tables");
installAltCommands(alt, context);

const timelock = program.command("timelock").description("Timelock operations");
installTimelockCommands(timelock, context);

const cctp = program.command("cctp").description("CCTP operations");
installCctpCommands(cctp, context);

if (process.env.NODE_ENV === "development") {
  // Commands that use unaudited integrations are disallowed by default
  // Unleash them with --bypass-warning
  const unauditedCommandHook = async (thisCommand: Command) => {
    const { bypassWarning } = thisCommand.opts();
    if (!bypassWarning) {
      console.error(
        "Unaudited integration. Use with caution. Use --bypass-warning to bypass this warning.",
      );
      process.exit(1);
    }
  };
  const marinade = program
    .command("marinade")
    .option("-b, --bypass-warning", "Bypass warning", false)
    .description("[Unaudited] Marinade staking")
    .hook("preSubcommand", unauditedCommandHook);
  const lst = program
    .command("lst")
    .option("-b, --bypass-warning", "Bypass warning", false)
    .description("[Unaudited] Liquid staking")
    .hook("preSubcommand", unauditedCommandHook);
  const stake = program
    .command("stake")
    .option("-b, --bypass-warning", "Bypass warning", false)
    .description("[Unaudited] Native staking")
    .hook("preSubcommand", unauditedCommandHook);

  installMarinadeCommands(marinade, context);
  installLstCommands(lst, context);
  installStakeCommands(stake, context);
}

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
