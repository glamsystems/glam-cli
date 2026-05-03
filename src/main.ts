import {
  charsToString,
  getPriorityFeeEstimate,
  GlamClient,
} from "@glamsystems/glam-sdk";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  type VersionedTransaction,
} from "@solana/web3.js";
import { Command } from "commander";

import {
  CliConfig,
  resolveStagingFromStateOwner,
  type CliContext,
} from "./utils";
import { DEFAULT_DERIVATION_PATH, LedgerWallet } from "./ledger";
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
import { installBridgeCommands } from "./cmds/bridge";
import { installEpiCommands } from "./cmds/epi";
import { installTransferCommands } from "./cmds/transfer";
import { installTimelockCommands } from "./cmds/timelock";
import { installTokenAclCommands } from "./cmds/token-acl";
import { installLoopscaleCommands } from "./cmds/loopscale";

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
    printCliError(error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    printCliError(reason);
    process.exit(1);
  });
}

function printCliError(error: unknown) {
  if (error instanceof Error) {
    console.error(`${error.message}`);
    return;
  }

  console.error(`${String(error)}`);
}

async function initialize(
  configPath?: string,
  skipSimulation = false,
  staging?: boolean,
  wallet?: string,
  ledgerDerivationPath?: string,
) {
  const cliConfig = CliConfig.get(configPath, {
    glam_staging: staging,
    wallet,
    ledger_derivation_path: ledgerDerivationPath,
  });
  const { cluster, glam_state } = cliConfig;

  let useStaging = cliConfig.glam_staging;
  let statePda: PublicKey | undefined;

  if (glam_state && glam_state !== "") {
    statePda = new PublicKey(glam_state);
    const account = await new Connection(cliConfig.json_rpc_url, {
      commitment: "confirmed",
    }).getAccountInfo(statePda);
    if (!account) {
      throw new Error(`GLAM state account not found: ${statePda.toBase58()}`);
    }
    useStaging = resolveStagingFromStateOwner(account.owner, useStaging);
  }

  if (useStaging !== undefined) {
    process.env.GLAM_STAGING = useStaging ? "1" : "0";
  }

  let provider: AnchorProvider | undefined;
  if (cliConfig.useLedger()) {
    const ledgerWallet = new LedgerWallet(cliConfig.ledger_derivation_path);
    await ledgerWallet.connect();
    const connection = new Connection(cliConfig.json_rpc_url, {
      commitment: "confirmed",
    });
    provider = new AnchorProvider(connection, ledgerWallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }

  context.glamClient = new GlamClient({
    provider, // if undefined, GlamClient builds one from ANCHOR_WALLET env
    cluster,
    statePda,
    useStaging,
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

setupGracefulShutdown();

const program = new Command();
program
  .name("glam-cli")
  .description("CLI for interacting with the GLAM Protocol")
  .option("-C, --config <path>", "path to config file")
  .option("-S, --skip-simulation", "skip simulation", false)
  .option("--staging", "use staging environment")
  .option("--wallet <wallet>", "Keypair file path or USB path (usb://ledger)")
  .option(
    "--ledger-derivation-path <path>",
    `Ledger derivation path (default: ${DEFAULT_DERIVATION_PATH})`,
  )
  .hook("preSubcommand", async (thisCommand: Command) => {
    const { config, skipSimulation, staging, wallet, ledgerDerivationPath } =
      thisCommand.opts();

    await initialize(
      config,
      skipSimulation,
      staging,
      wallet,
      ledgerDerivationPath,
    );
    await idlCheck(context.glamClient);
  })
  .version("1.0.13");

program
  .command("env")
  .description("Display current environment setup")
  .action(async () => {
    const { cliConfig, glamClient } = context;
    console.log(
      "GLAM Protocol program:",
      glamClient.protocolProgram.programId.toBase58(),
    );
    console.log("Staging:", glamClient.staging);
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

const bridge = program.command("bridge").description("Bridge operations");
installBridgeCommands(bridge, context);

const epi = program
  .command("epi")
  .description("External position observation operations");
installEpiCommands(epi, context);

const tokenAcl = program
  .command("token-acl")
  .description("Token ACL (sRFC-37) operations");
installTokenAclCommands(tokenAcl, context);

const unauditedCommandHook = async (thisCommand: Command) => {
  const { bypassWarning } = thisCommand.opts();
  if (!bypassWarning) {
    console.error(
      "Unaudited integration. Use with caution. Use --bypass-warning to bypass this warning.",
    );
    process.exit(1);
  }
};

const loopscale = program
  .command("loopscale")
  .option("-b, --bypass-warning", "Bypass warning", false)
  .description("[Unaudited] Loopscale loans")
  .hook("preSubcommand", unauditedCommandHook);
installLoopscaleCommands(loopscale, context);

if (process.env.NODE_ENV === "development") {
  // Commands that use unaudited integrations are disallowed by default
  // Unleash them with --bypass-warning
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
const argv =
  process.env.NODE_ENV === "development"
    ? [
        process.argv[0], // Node.js binary path
        process.argv[1], // Script path
        ...process.argv[2].split(" "), // Split the concatenated arguments
      ]
    : process.argv;

program.parseAsync(argv).catch((error) => {
  printCliError(error);
  process.exit(1);
});
