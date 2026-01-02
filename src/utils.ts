import { AnchorError, BN } from "@coral-xyz/anchor";
import {
  ClusterNetwork,
  GlamClient,
  nameToChars,
  PriorityLevel,
  StateAccountType,
  TxOptions,
} from "@glamsystems/glam-sdk";
import {
  PublicKey,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";
import { InitMintParams } from "anchor/src/client/mint";
import { InitStateParams } from "anchor/src/client/state";
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
  cluster: ClusterNetwork;
  json_rpc_url: string;
  tx_rpc_url: string;
  websocket_disabled: boolean;
  keypair_path: string;
  glam_api?: string;
  glam_staging?: boolean;
  priority_fee?: {
    micro_lamports?: number;
    level?: PriorityLevel;
    helius_api_key?: string;
  };
  glam_state?: string;
  jupiter_api_key?: string;

  private static instance: CliConfig | null = null;
  private configPath: string;

  constructor(config: Partial<CliConfig> = {}, configPath?: string) {
    this.cluster = ClusterNetwork.fromStr(config.cluster || "mainnet-beta");
    this.json_rpc_url = config.json_rpc_url || "";
    this.tx_rpc_url = config.tx_rpc_url || "";
    this.websocket_disabled = config.websocket_disabled || false;
    this.keypair_path = config.keypair_path || "";
    this.glam_api = config.glam_api;
    this.glam_staging = config.glam_staging;
    this.priority_fee = config.priority_fee;
    this.glam_state = config.glam_state;
    this.jupiter_api_key = config.jupiter_api_key;

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
    CliConfig.get(this.configPath);
  }

  static get(configPath?: string): CliConfig {
    if (
      !this.instance ||
      (configPath && this.instance.configPath !== configPath)
    ) {
      this.instance = CliConfig.load(configPath);
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

      if (cliConfig.tx_rpc_url) {
        process.env.TX_RPC = cliConfig.tx_rpc_url;
      }

      if (cliConfig.websocket_disabled) {
        process.env.WEBSOCKET_DISABLED = "1";
      }

      if (cliConfig.glam_api) {
        process.env.GLAM_API = cliConfig.glam_api || "https://api.glam.systems";
      }

      if (cliConfig.glam_staging) {
        process.env.GLAM_STAGING = "1";
      }

      if (cliConfig.jupiter_api_key) {
        process.env.JUPITER_API_KEY = cliConfig.jupiter_api_key;
      }

      process.env.ANCHOR_PROVIDER_URL = cliConfig.json_rpc_url;
      process.env.ANCHOR_WALLET = cliConfig.keypair_path;
      process.env.HELIUS_API_KEY = cliConfig.priority_fee?.helius_api_key;

      return cliConfig;
    } catch (err) {
      console.error(
        `Could not load glam cli config at ${configPath}:`,
        (err as any).message,
      );
      throw err;
    }
  }
}

const defaultConfigPath = () => {
  // By default config.json is under ~/.config/glam/
  // If running in docker, config.json is expected to be at /workspace/config.json
  const configHomeDefault = path.join(os.homedir(), ".config/glam/");
  const docker = process.env.DOCKER;
  // Treat "0", "false", "", undefined, null as false
  // Treat "1", "true", or any other truthy string as true
  const isDocker = !!(docker && docker !== "0" && docker !== "false");
  const configPath = path.join(
    isDocker ? "/workspace" : configHomeDefault,
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
  } catch (err) {
    // Handle Ctrl+C interruption gracefully
    if (
      (err as any).name === "ExitPromptError" ||
      (err as any).message?.includes("force closed")
    ) {
      console.log("\nOperation cancelled.");
      process.exit(0);
    }
    throw err;
  }
}

export function parseStateJson(json: any): InitStateParams {
  if (!json.state) {
    throw new Error("Invalid JSON file: must contain 'state' property");
  }
  const { state } = json;
  const requiredFields =
    state.accountType === "vault"
      ? ["accountType", "name", "baseAssetMint"]
      : ["accountType"];
  requiredFields.forEach((field) => {
    if (state?.[field] === undefined) {
      throw new Error(`Missing required state field: ${field}`);
    }
  });

  const params = {
    accountType: StateAccountType.from(state.accountType),
    name: nameToChars(state.name),
    enabled: state.enabled !== false,
    assets: state.assets?.map((asset: string) => new PublicKey(asset)) || null,
    baseAssetMint: new PublicKey(state.baseAssetMint),
    portfolioManagerName: state.portfolioManagerName
      ? nameToChars(state.portfolioManagerName)
      : null,
  };

  return params;
}

export function parseMintJson(
  json: any,
  accountType: StateAccountType,
): InitMintParams {
  if (accountType === StateAccountType.VAULT) {
    throw new Error(
      "Invalid JSON file: mint config is not supported for state account type `vault`",
    );
  }
  if (!json?.mint) {
    throw new Error(
      "Invalid JSON file: must contain 'mint' property for tokenized vault",
    );
  }

  const { mint } = json;

  const requiredFields = ["name", "symbol", "uri", "baseAssetMint"];
  requiredFields.forEach((field) => {
    if (mint?.[field] === undefined) {
      throw new Error(`Missing required mint field: ${field}`);
    }
  });

  const params = {
    accountType,
    name: nameToChars(mint.name),
    symbol: mint.symbol,
    uri: mint.uri,
    baseAssetMint: new PublicKey(mint.baseAssetMint),
    maxCap: mint.maxCap ? new BN(mint.maxCap) : null,
    minSubscription: mint.minSubscription ? new BN(mint.minSubscription) : null,
    minRedemption: mint.minRedemption ? new BN(mint.minRedemption) : null,
    lockupPeriod: mint.lockupPeriod ? Number(mint.lockupPeriod) : null,
    permanentDelegate: mint.permanentDelegate
      ? new PublicKey(mint.permanentDelegate)
      : null,
    defaultAccountStateFrozen: mint.defaultAccountStateFrozen || false,
    feeStructure: mint.feeStructure
      ? {
          ...mint.feeStructure,
          performance: {
            ...mint.feeStructure.performance,
            hurdleType: {
              [mint.feeStructure.performance.hurdleType]: {},
            },
          },
          protocol: { baseFeeBps: 0, floorFeeBps: 0 },
        }
      : null,
    notifyAndSettle: mint.notifyAndSettle
      ? {
          ...mint.notifyAndSettle,
          model: { [mint.notifyAndSettle.model]: {} },
          subscribeNoticePeriodType: {
            [mint.notifyAndSettle.subscribeNoticePeriodType]: {},
          },
          subscribeNoticePeriod: new BN(
            mint.notifyAndSettle.subscribeNoticePeriod || 0,
          ),
          subscribeSettlementPeriod: new BN(
            mint.notifyAndSettle.subscribeSettlementPeriod || 0,
          ),
          subscribeCancellationWindow: new BN(
            mint.notifyAndSettle.subscribeCancellationWindow || 0,
          ),
          redeemNoticePeriodType: {
            [mint.notifyAndSettle.redeemNoticePeriodType]: {},
          },
          redeemNoticePeriod: new BN(
            mint.notifyAndSettle.redeemNoticePeriod || 0,
          ),
          redeemSettlementPeriod: new BN(
            mint.notifyAndSettle.redeemSettlementPeriod || 0,
          ),
          redeemCancellationWindow: new BN(
            mint.notifyAndSettle.redeemCancellationWindow || 0,
          ),
          timeUnit: { [mint.notifyAndSettle.timeUnit]: {} },
          padding: [0, 0, 0],
        }
      : null,
  };
  return params;
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

export function validateFileExists(path: string) {
  if (!fs.existsSync(path)) {
    console.error(`File ${path} does not exist`);
    process.exit(1);
  }
  return path;
}

export function validateInvestorAction(action: string) {
  if (action !== "subscription" && action !== "redemption") {
    console.error(`Invalid action. Allowed values: subscription, redemption`);
    process.exit(1);
  }
  return action;
}

export function validateBooleanInput(input: string) {
  const normalized = input.toLowerCase().trim();
  const truthyValues = ["true", "1", "yes", "y", "on", "enable"];
  const falsyValues = ["false", "0", "no", "n", "off", "disable"];

  if (truthyValues.includes(normalized)) return true;
  if (falsyValues.includes(normalized)) return false;

  throw new Error(
    `Invalid boolean value: "${input}". Use: true/false, yes/no, 1/0, enable/disable`,
  );
}

export function validateDriftMarketType(input: string) {
  if (input !== "spot" && input !== "perp") {
    console.error("Invalid market type. Allowed values: spot, perp");
    process.exit(1);
  }
  return input;
}

/**
 * Execute a transaction with standardized error handling
 * @param txFn - Async function that returns a transaction signature
 * @param confirmOptions - Options for confirmation prompt
 * @param successMessage - Success message string or function that takes txSig and returns string
 */
export async function executeTxWithErrorHandling(
  txFn: () => Promise<string>,
  confirmOptions: {
    skip: boolean;
    message?: string;
  },
  successMessage: string | ((txSig: string) => string),
): Promise<void> {
  if (!confirmOptions.skip) {
    await confirmOperation(confirmOptions.message || "Confirm operation?");
  }

  try {
    const txSig = await txFn();
    const message =
      typeof successMessage === "function"
        ? successMessage(txSig)
        : `${successMessage} ${txSig}`;
    console.log(message);
  } catch (e) {
    console.error(parseTxError(e));
    process.exit(1);
  }
}
