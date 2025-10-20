import { AnchorError, BN } from "@coral-xyz/anchor";
import {
  GlamClient,
  nameToChars,
  PriorityLevel,
  StateAccountType,
  StateModel,
  TxOptions,
} from "@glamsystems/glam-sdk";
import {
  PublicKey,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";
import fs from "fs";
import inquirer from "inquirer";
import os from "os";
import path from "path";

export interface CliContext {
  cliConfig: CliConfig;
  glamClient: GlamClient;
  txOptions: TxOptions;
}

export class CliConfig {
  cluster: string;
  json_rpc_url: string;
  tx_rpc_url: string;
  keypair_path: string;
  glam_api?: string;
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
    this.glam_api = config.glam_api;
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

      if (cliConfig.glam_api) {
        process.env.GLAM_API = cliConfig.glam_api || "https://api.glam.systems";
      }

      process.env.ANCHOR_PROVIDER_URL = cliConfig.json_rpc_url;
      process.env.ANCHOR_WALLET = cliConfig.keypair_path;
      process.env.HELIUS_API_KEY = cliConfig.priority_fee?.helius_api_key;

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
  try {
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
  } catch (error) {
    // Handle Ctrl+C interruption gracefully
    if (
      error.name === "ExitPromptError" ||
      error.message?.includes("force closed")
    ) {
      console.log("\nOperation cancelled.");
      process.exit(0);
    }
    throw error;
  }
}

export function parseStateJson(json: any): Partial<StateModel> {
  if (!json.state) {
    throw new Error("Invalid JSON file: must contain 'state' property");
  }
  const requiredFields =
    json.state.accountType === "vault"
      ? [
          "accountType",
          "name",
          "enabled",
          "assets",
          "baseAssetMint",
          "baseAssetTokenProgram",
        ]
      : ["accountType"];
  requiredFields.forEach((field) => {
    if (json.state?.[field] === undefined) {
      throw new Error(`Missing required state field: ${field}`);
    }
  });

  const stateModel = {
    accountType: { [json.state.accountType]: {} },
    name: json.state.name ? nameToChars(json.state.name) : null,
    enabled: json.state.enabled !== false,
    assets: (json.state.assets || []).map(
      (asset: string) => new PublicKey(asset),
    ),
    baseAssetMint: json.state.baseAssetMint
      ? new PublicKey(json.state.baseAssetMint)
      : null,
    baseAssetTokenProgram: Number(json.state.baseAssetTokenProgram),
    portfolioManagerName: json.state.portfolioManagerName
      ? nameToChars(json.state.portfolioManagerName)
      : null,
    timelockDuration: Number(json.state.timelockDuration),
  };

  return stateModel;
}

export function parseMintJson(json: any, accountType: StateAccountType) {
  if (StateAccountType.equals(accountType, StateAccountType.VAULT)) {
    return null;
  }

  if (
    StateAccountType.equals(accountType, StateAccountType.TOKENIZED_VAULT) &&
    !json.mint
  ) {
    throw new Error(
      "Invalid JSON file: must contain 'mint' property for tokenized vault",
    );
  }
  const mintModel = {
    name: json.mint.name ? nameToChars(json.mint.name) : null,
    symbol: json.mint.symbol,
    uri: json.mint.uri,
    baseAssetMint: new PublicKey(json.mint.baseAssetMint),
    maxCap: json.mint.maxCap ? new BN(json.mint.maxCap) : null,
    minSubscription: json.mint.minSubscription
      ? new BN(json.mint.minSubscription)
      : null,
    minRedemption: json.mint.minRedemption
      ? new BN(json.mint.minRedemption)
      : null,
    lockupPeriod: Number(json.mint.lockupPeriod),
    permanentDelegate: json.mint.permanentDelegate
      ? new PublicKey(json.mint.permanentDelegate)
      : null,
    defaultAccountStateFrozen: json.mint.defaultAccountStateFrozen || false,
    feeStructure: json.mint.feeStructure
      ? {
          ...json.mint.feeStructure,
          performance: {
            ...json.mint.feeStructure.performance,
            hurdleType: {
              [json.mint.feeStructure.performance.hurdleType]: {},
            },
          },
          protocol: { baseFeeBps: 0, floorFeeBps: 0 },
        }
      : null,
    notifyAndSettle: json.mint.notifyAndSettle
      ? {
          ...json.mint.notifyAndSettle,
          model: { [json.mint.notifyAndSettle.model]: {} },
          subscribeNoticePeriodType: {
            [json.mint.notifyAndSettle.subscribeNoticePeriodType]: {},
          },
          subscribeNoticePeriod: new BN(
            json.mint.notifyAndSettle.subscribeNoticePeriod || 0,
          ),
          subscribeSettlementPeriod: new BN(
            json.mint.notifyAndSettle.subscribeSettlementPeriod || 0,
          ),
          subscribeCancellationWindow: new BN(
            json.mint.notifyAndSettle.subscribeCancellationWindow || 0,
          ),
          redeemNoticePeriodType: {
            [json.mint.notifyAndSettle.redeemNoticePeriodType]: {},
          },
          redeemNoticePeriod: new BN(
            json.mint.notifyAndSettle.redeemNoticePeriod || 0,
          ),
          redeemSettlementPeriod: new BN(
            json.mint.notifyAndSettle.redeemSettlementPeriod || 0,
          ),
          redeemCancellationWindow: new BN(
            json.mint.notifyAndSettle.redeemCancellationWindow || 0,
          ),
          timeUnit: { [json.mint.notifyAndSettle.timeUnit]: {} },
          padding: [0, 0, 0],
        }
      : null,
  };
  return mintModel;
}

export function validatePublicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    console.error("Not a valid pubkey:", value);
    process.exit(1);
  }
}

export function validateSubAccountId(subAccountId: string): number {
  const parsed = parseInt(subAccountId);
  if (isNaN(parsed) || parsed < 0) {
    console.error("Invalid sub-account-id. Must be a valid integer.");
    process.exit(1);
  }
  return parsed;
}
