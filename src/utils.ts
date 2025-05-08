import { AnchorError, BN } from "@coral-xyz/anchor";
import {
  ManagerModel,
  MintModel,
  PriorityLevel,
  StateModel,
} from "@glamsystems/glam-sdk";
import {
  PublicKey,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";
import fs from "fs";
import inquirer from "inquirer";
import os from "os";
import path from "path";

export class CliConfig {
  cluster: string;
  json_rpc_url: string;
  tx_rpc_url: string;
  keypair_path: string;
  priority_fee?: {
    micro_lamports?: number;
    level?: PriorityLevel;
    helius_api_key?: string;
  };
  glam_state?: string;

  private static instance: CliConfig | null = null;
  private configPath: string;

  constructor(config: Partial<CliConfig> = {}, configPath?: string) {
    this.cluster = config.cluster || "";
    this.json_rpc_url = config.json_rpc_url || "";
    this.tx_rpc_url = config.tx_rpc_url || "";
    this.keypair_path = config.keypair_path || "";
    this.priority_fee = config.priority_fee;
    this.glam_state = config.glam_state;

    this.configPath = configPath || defaultConfigPath();
  }

  get glamState(): PublicKey {
    if (!this.glam_state) {
      throw new Error("GLAM state not set");
    }

    return new PublicKey(this.glam_state);
  }

  set glamState(state: PublicKey | null) {
    const config = fs.readFileSync(this.configPath, "utf8");
    const updated = { ...JSON.parse(config), glam_state: state?.toBase58() };
    fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2), "utf8");

    CliConfig.reset();
    CliConfig.get();
  }

  static get(): CliConfig {
    if (!this.instance) {
      this.instance = CliConfig.load();
    }
    return this.instance;
  }

  static reset() {
    this.instance = null;
  }

  static load(path?: string): CliConfig {
    const configPath = path || defaultConfigPath();
    try {
      const config = fs.readFileSync(configPath, "utf8");
      const parsedConfig = JSON.parse(config);
      const cliConfig = new CliConfig(parsedConfig, configPath);

      if (!cliConfig.json_rpc_url) {
        throw new Error("Missing json_rpc_url in config.json");
      }

      if (!cliConfig.keypair_path) {
        throw new Error("Missing keypair_path in config.json");
      }

      if (
        !["mainnet-beta", "devnet", "localnet"].includes(
          cliConfig.cluster.toLowerCase(),
        )
      ) {
        throw new Error(
          `Unsupported cluster: ${cliConfig.cluster}, must be mainnet-beta, devnet or localnet`,
        );
      }

      if (cliConfig.tx_rpc_url) {
        process.env.TX_RPC = cliConfig.tx_rpc_url;
      }

      process.env.ANCHOR_PROVIDER_URL = cliConfig.json_rpc_url;
      process.env.ANCHOR_WALLET = cliConfig.keypair_path;

      return cliConfig;
    } catch (err) {
      console.error(
        `Could not load glam cli config at ${configPath}:`,
        err.message,
      );
      throw err;
    }
  }
}

const defaultConfigPath = () => {
  // By default config.json is under ~/.config/glam/
  // If running in docker, config.json is expected to be at /workspace/config.json
  const configHomeDefault = path.join(os.homedir(), ".config/glam/");
  const configPath = path.join(
    process.env.DOCKER ? "/workspace" : configHomeDefault,
    "config.json",
  );
  return configPath;
};

export const parseTxError = (error: any) => {
  if (error instanceof TransactionExpiredBlockheightExceededError) {
    return "Transaction expired";
  }

  if (error instanceof AnchorError) {
    return error.error.errorMessage;
  }

  return error?.message || "Unknown error";
};

export async function confirmOperation(message: string) {
  const confirmation = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message,
      default: false,
    },
  ]);
  if (!confirmation.proceed) {
    console.log("Aborted.");
    process.exit(0);
  }
}

export function fundJsonToStateModel(json: any) {
  if (json.accountType !== "fund") {
    throw Error(
      "Account account not supported. This helper function only supports fund (aka tokenized vault) account type",
    );
  }
  const converted = {
    ...json,
    assets: json.assets.map((asset: string) => new PublicKey(asset)),
    accountType: { [json.accountType]: {} },
    timeUnit: { [json.timeUnit]: {} },
    owner: new ManagerModel({
      portfolioManagerName: json.owner.portfolioManagerName,
      kind: { wallet: {} },
    }),
    mints: json.mints.map(
      (mintData) =>
        new MintModel({
          ...mintData,
          maxCap: new BN(mintData.maxCap),
          minSubscription: new BN(mintData.minSubscription),
          minRedemption: new BN(mintData.minRedemption),
          feeStructure: {
            ...mintData.feeStructure,
            performance: {
              ...mintData.feeStructure.performance,
              hurdleType: {
                [mintData.feeStructure.performance.hurdleType]: {},
              },
            },
          },
          notifyAndSettle: {
            ...mintData.notifyAndSettle,
            model: { [mintData.notifyAndSettle.model]: {} },
            noticePeriod: new BN(mintData.notifyAndSettle.noticePeriod),
            settlementPeriod: new BN(mintData.notifyAndSettle.settlementPeriod),
            cancellationWindow: new BN(
              mintData.notifyAndSettle.cancellationWindow,
            ),
            noticePeriodType: {
              [mintData.notifyAndSettle.noticePeriodType]: {},
            },
          },
        }),
    ),
  };

  return new StateModel(converted);
}

export function validatePublicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch (e) {
    console.error("Not a valid pubkey:", value);
    process.exit(1);
  }
}
