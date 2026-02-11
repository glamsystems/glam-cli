import { AnchorError, BN } from "@coral-xyz/anchor";
import {
  ClusterNetwork,
  GlamClient,
  stringToChars,
  PriorityLevel,
  StateAccountType,
  TxOptions,
  getProgramAndBitflagByProtocolName,
  getProtocolsAndPermissions,
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

/**
 * Parses a JSON object containing state initialization parameters.
 *
 * `json.state` must contain the following properties:
 * - `accountType`: The type of the state account.
 * - `name`: The name of the state account.
 * - `baseAssetMint`: The base asset mint of the vault.
 */
export function parseStateJson(json: any): InitStateParams {
  if (!json.state) {
    throw new Error("Invalid JSON file: must contain 'state' property");
  }
  const { state } = json;
  ["accountType", "name", "baseAssetMint"].forEach((field) => {
    if (state?.[field] === undefined) {
      throw new Error(
        `Account type ${state.accountType} missing required state field: ${field}`,
      );
    }
  });

  return {
    accountType: StateAccountType.from(state.accountType),
    name: stringToChars(state.name),
    baseAssetMint: new PublicKey(state.baseAssetMint),
    enabled: state.enabled !== false,
    assets: state.assets?.map((asset: string) => new PublicKey(asset)) || null,
    portfolioManagerName: state.portfolioManagerName
      ? stringToChars(state.portfolioManagerName)
      : null,
  };
}

/**
 * Parses a JSON object containing mint initialization parameters.
 *
 * `json.mint` must contain the following properties:
 * - `name`: The name of the mint.
 * - `symbol`: The symbol of the mint.
 * - `uri`: The URI of the mint.
 */
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
  ["name", "symbol", "uri"].forEach((field) => {
    if (mint?.[field] === undefined) {
      throw new Error(
        `Account type ${accountType} missing required mint field: ${field}`,
      );
    }
  });
  const baseAssetMint = json?.state?.baseAssetMint;
  if (!baseAssetMint) {
    throw new Error(
      "Invalid JSON file: missing required state field `baseAssetMint`",
    );
  }

  return {
    accountType,
    name: stringToChars(mint.name),
    symbol: mint.symbol,
    uri: mint.uri,
    baseAssetMint: new PublicKey(baseAssetMint),
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

/**
 * Print a formatted table with auto-sized columns.
 * Each row is an array of strings; the first row is treated as the header.
 */
export function printTable(headers: string[], rows: string[][]) {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length)),
  );

  const formatRow = (items: string[]) =>
    items.map((item, i) => item.padEnd(colWidths[i])).join("  ");

  console.log(formatRow(headers));
  console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((row) => console.log(formatRow(row)));
}

export function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Resolve a single protocol name with fuzzy matching:
 * 1. Exact match
 * 2. Case-insensitive match
 * 3. Levenshtein suggestion (distance <= 3)
 *
 * Returns the canonical protocol name or exits with an error.
 */
export function resolveProtocolName(name: string): string {
  const lookup = getProgramAndBitflagByProtocolName();
  const validNames = Object.keys(lookup);

  // 1. Exact match
  if (lookup[name]) {
    return name;
  }

  // 2. Case-insensitive match
  const ciIndex = new Map<string, string>();
  for (const valid of validNames) {
    ciIndex.set(valid.toLowerCase(), valid);
  }
  const ciMatch = ciIndex.get(name.toLowerCase());
  if (ciMatch) {
    console.log(`Note: using '${ciMatch}' for '${name}'`);
    return ciMatch;
  }

  // 3. Levenshtein suggestion
  let bestName = "";
  let bestDist = Infinity;
  const nameLower = name.toLowerCase();
  for (const valid of validNames) {
    const dist = levenshtein(nameLower, valid.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestName = valid;
    }
  }
  const suggestion =
    bestDist <= 3 ? `  Did you mean '${bestName}' instead of '${name}'?` : "";

  console.error(`Unknown protocol name: ${name}`);
  if (suggestion) console.error(suggestion);
  console.error(`Valid protocol names: ${validNames.join(", ")}`);
  process.exit(1);
}

/**
 * Resolve permission names for a given (already-resolved) protocol with fuzzy matching.
 * Returns an array of canonical permission names or exits with an error.
 */
export function resolvePermissionNames(
  protocolName: string,
  inputNames: string[],
): string[] {
  const protocolConfig = getProgramAndBitflagByProtocolName()[protocolName];
  if (!protocolConfig) {
    console.error(`Unknown protocol name: ${protocolName}`);
    process.exit(1);
  }

  const [programIdStr, bitflagStr] = protocolConfig;
  const protocolPermissions =
    getProtocolsAndPermissions()[programIdStr]?.[bitflagStr];
  if (!protocolPermissions) {
    console.error(
      `Protocol mapping not found for protocol name ${protocolName}`,
    );
    process.exit(1);
  }

  const validNames = Object.values(protocolPermissions.permissions);
  const ciIndex = new Map<string, string>();
  for (const valid of validNames) {
    ciIndex.set(valid.toLowerCase(), valid);
  }

  const resolved: string[] = [];
  const unknown: string[] = [];
  const suggestions: string[] = [];

  for (const name of inputNames) {
    // 1. Exact match
    if (validNames.includes(name)) {
      resolved.push(name);
      continue;
    }

    // 2. Case-insensitive match
    const ciMatch = ciIndex.get(name.toLowerCase());
    if (ciMatch) {
      console.log(`Note: using '${ciMatch}' for '${name}'`);
      resolved.push(ciMatch);
      continue;
    }

    // 3. Levenshtein suggestion
    let bestName = "";
    let bestDist = Infinity;
    const nameLower = name.toLowerCase();
    for (const valid of validNames) {
      const dist = levenshtein(nameLower, valid.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        bestName = valid;
      }
    }
    if (bestDist <= 3) {
      suggestions.push(`  Did you mean '${bestName}' instead of '${name}'?`);
    }
    unknown.push(name);
  }

  if (unknown.length) {
    console.error(
      `Unknown permission name(s) for ${protocolName}: ${unknown.join(", ")}`,
    );
    for (const s of suggestions) {
      console.error(s);
    }
    console.error(
      `Valid permissions for ${protocolName}: ${validNames.join(", ")}`,
    );
    process.exit(1);
  }

  return resolved;
}
