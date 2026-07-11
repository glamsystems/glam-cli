import { BN } from "@coral-xyz/anchor";
import type {
  CapabilityAccess,
  ExchangeMarketSnapshot,
  ExchangeSnapshotView,
  TraderStateMarketLimitOrderRow,
  TraderStatePositionSnapshot,
  TraderStateSnapshotResponse,
  TraderStateSubaccountSnapshot,
} from "@ellipsis-labs/rise";
import {
  PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL,
  PHOENIX_ORDER_PACKET_KIND_LIMIT,
  PHOENIX_ORDER_PACKET_KIND_POST_ONLY,
  PHOENIX_DEFAULT_MAX_POSITIONS,
  PHOENIX_DEFAULT_TRADER_RENT_SOL,
  PHOENIX_MAX_POSITIONS,
  PHOENIX_MIN_MAX_POSITIONS,
  PhoenixOnboardingError,
  type PhoenixBaseLots,
  type PhoenixOnboardTraderResult,
  type PhoenixOrderFlags,
  type PhoenixOrderIds,
  type PhoenixOrderPacket,
  type PhoenixQuoteLots,
  type PhoenixSelfTradeBehavior,
  type PhoenixSide,
  type PhoenixTicks,
  type PhoenixTraderOnboardingStatus,
  PhoenixPolicy,
  U64_MAX_BIGINT,
  fetchMintAndTokenProgram,
  formatLamportsAsSol,
  getPhoenixTraderAccountSize,
  phoenixHttpNotFoundToNull,
} from "@glamsystems/glam-sdk";
import {
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  getAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { type Command } from "commander";

import {
  type CliContext,
  confirmOperation,
  executeTxWithErrorHandling,
  parseTxError,
  printTable,
} from "../utils";
import { fail } from "../errors";
import {
  collectArrayValues,
  parseArrayInput,
  parseInteger,
  parseNonNegativeUiAmount,
  parseOptionalU64,
  parseU8,
  parseU32,
  parseU64,
  parseU128,
} from "../parsing";
type TraderOptions = {
  traderPdaIndex: string;
  subaccountIndex: string;
};

type TxOptions = {
  yes?: boolean;
};

type OrderOptions = TraderOptions &
  TxOptions & {
    priceTicks?: boolean;
    baseLots?: boolean;
    clientOrderId?: string;
    selfTradeBehavior?: string;
    matchLimit?: string;
    lastValidSlot?: string;
    reduceOnly?: boolean;
    cancelExisting?: boolean;
  };

type MarketOrderOptions = OrderOptions & {
  priceLimit?: string;
  priceLimitTicks?: boolean;
  quoteLots?: string;
  minBaseUnits?: string;
  minBaseLots?: string;
  minQuoteLots?: string;
};

type VaultTokenBalance = {
  ata: PublicKey;
  amount: BN;
  decimals: number;
};

const MICRO_USD = 1_000_000n;

const ORDER_SIDE_BID = 0;
const ORDER_SIDE_ASK = 1;
const ORDER_FLAG_NONE = 0;
const ORDER_FLAG_REDUCE_ONLY = 128;

function addTraderOptions(command: Command): Command {
  return command
    .option("--trader-pda-index <index>", "Phoenix trader PDA index", "0")
    .option("--subaccount-index <index>", "Phoenix subaccount index", "0");
}

function addOrderOptions(command: Command): Command {
  return addTraderOptions(command)
    .option(
      "--price-ticks",
      "Treat price arguments as raw Phoenix ticks",
      false,
    )
    .option(
      "--base-lots",
      "Treat base amount arguments as raw Phoenix base lots",
      false,
    )
    .option("--client-order-id <id>", "Client order id", "0")
    .option(
      "--self-trade-behavior <behavior>",
      "abort, cancel-provide, decrement-take, or raw integer",
    )
    .option("--match-limit <limit>", "Raw Phoenix match limit")
    .option("--last-valid-slot <slot>", "Raw last valid slot")
    .option("--reduce-only", "Submit a reduce-only order", false)
    .option(
      "--cancel-existing",
      "Cancel existing matching client order id",
      false,
    )
    .option("-y, --yes", "Skip confirmation prompt", false);
}

function bigintToBN(value: bigint, label: string, max = U64_MAX_BIGINT): BN {
  if (value > max) {
    fail(`${label} exceeds ${max.toString()}`);
  }
  return new BN(value.toString());
}

function formatUiAmount(amount: BN, decimals: number): string {
  const scale = new BN(10).pow(new BN(decimals));
  const whole = amount.div(scale).toString();
  const fraction = amount.mod(scale).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function parseDecimal(
  value: string,
  label: string,
): { numerator: bigint; scale: bigint } {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    fail(`${label} must be a non-negative decimal`);
  }

  const [integerPart, fractionalPart = ""] = trimmed.split(".");
  const numerator = BigInt(`${integerPart || "0"}${fractionalPart}` || "0");
  const scale = 10n ** BigInt(fractionalPart.length);
  if (numerator === 0n) {
    fail(`${label} must be greater than zero`);
  }
  return { numerator, scale };
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function priceUsdToTicks(
  market: ExchangeMarketSnapshot,
  value: string,
  label: string,
): BN {
  const { numerator, scale } = parseDecimal(value, label);
  const priceMicros = (numerator * MICRO_USD) / scale;
  const tickSize = BigInt(market.tickSize);
  const decimals = market.baseLotsDecimals;
  const ticks =
    decimals >= 0
      ? priceMicros / (tickSize * pow10(decimals))
      : (priceMicros * pow10(Math.abs(decimals))) / tickSize;

  if (ticks === 0n) {
    fail(`${label} rounds down to zero ticks for ${market.symbol}`);
  }
  return bigintToBN(ticks, label);
}

function parseAllowedOrderTypes(value: string): number[] {
  const parts = parseArrayInput(value).map((part) =>
    part.toLowerCase().replace(/_/g, "-"),
  );
  if (
    parts.length === 1 &&
    ["none", "empty", "disable", "disabled", "-"].includes(parts[0])
  ) {
    return [];
  }

  const aliases = new Map<string, number>([
    ["post-only", PHOENIX_ORDER_PACKET_KIND_POST_ONLY],
    ["postonly", PHOENIX_ORDER_PACKET_KIND_POST_ONLY],
    ["post_only", PHOENIX_ORDER_PACKET_KIND_POST_ONLY],
    ["0", PHOENIX_ORDER_PACKET_KIND_POST_ONLY],
    ["limit", PHOENIX_ORDER_PACKET_KIND_LIMIT],
    ["1", PHOENIX_ORDER_PACKET_KIND_LIMIT],
    ["ioc", PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL],
    ["immediate-or-cancel", PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL],
    ["immediate_or_cancel", PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL],
    ["market", PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL],
    ["2", PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL],
  ]);

  const parsed = parts.map((part) => {
    const orderType = aliases.get(part);
    if (orderType === undefined) {
      fail(`Invalid Phoenix order type: ${part}`);
    }
    return orderType;
  });
  return [...new Set(parsed)];
}

function orderTypesToString(orderTypes: number[]): string {
  const names: Record<number, string> = {
    [PHOENIX_ORDER_PACKET_KIND_POST_ONLY]: "post-only",
    [PHOENIX_ORDER_PACKET_KIND_LIMIT]: "limit",
    [PHOENIX_ORDER_PACKET_KIND_IMMEDIATE_OR_CANCEL]: "immediate-or-cancel",
  };
  return (
    orderTypes
      .map((orderType) => names[orderType] ?? `${orderType}`)
      .join(", ") || "-"
  );
}

function baseUnitsToBaseLots(
  market: ExchangeMarketSnapshot,
  value: string,
  label: string,
): BN {
  const { numerator, scale } = parseDecimal(value, label);
  const decimals = market.baseLotsDecimals;
  const lots =
    decimals >= 0
      ? (numerator * pow10(decimals)) / scale
      : numerator / (scale * pow10(Math.abs(decimals)));

  if (lots === 0n) {
    fail(`${label} rounds down to zero base lots for ${market.symbol}`);
  }
  return bigintToBN(lots, label);
}

function parseSide(value: string): number {
  switch (value.trim().toLowerCase()) {
    case "0":
    case "bid":
    case "buy":
    case "long":
      return ORDER_SIDE_BID;
    case "1":
    case "ask":
    case "sell":
    case "short":
      return ORDER_SIDE_ASK;
    default:
      fail("side must be bid/buy/long or ask/sell/short");
  }
}

function parseSelfTradeBehavior(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  switch (value.trim().toLowerCase().replace(/_/g, "-")) {
    case "0":
    case "abort":
      return 0;
    case "1":
    case "cancel-provide":
      return 1;
    case "2":
    case "decrement-take":
      return 2;
    default:
      fail(
        "self-trade behavior must be abort, cancel-provide, decrement-take, 0, 1, or 2",
      );
  }
}

function sideKind(side: number): PhoenixSide {
  switch (side) {
    case ORDER_SIDE_BID:
      return { bid: {} };
    case ORDER_SIDE_ASK:
      return { ask: {} };
    default:
      fail("side must be bid/buy/long or ask/sell/short");
  }
}

function selfTradeBehaviorKind(behavior: number): PhoenixSelfTradeBehavior {
  switch (behavior) {
    case 0:
      return { abort: {} };
    case 1:
      return { cancelProvide: {} };
    case 2:
      return { decrementTake: {} };
    default:
      fail(
        "self-trade behavior must be abort, cancel-provide, decrement-take, 0, 1, or 2",
      );
  }
}

function ticks(inner: BN): PhoenixTicks {
  return { inner };
}

function optionalTicks(inner: BN | null): PhoenixTicks | null {
  return inner === null ? null : ticks(inner);
}

function baseLots(inner: BN): PhoenixBaseLots {
  return { inner };
}

function quoteLots(inner: BN): PhoenixQuoteLots {
  return { inner };
}

function optionalQuoteLots(inner: BN | null): PhoenixQuoteLots | null {
  return inner === null ? null : quoteLots(inner);
}

function orderFlags(flags: number): PhoenixOrderFlags {
  return { flags };
}

function u128LeBytes(value: BN): number[] {
  return value.toArray("le", 16);
}

function formatCapabilityAccess(access: CapabilityAccess | undefined): string {
  if (!access) {
    return "-";
  }
  const modes: string[] = [];
  if (access.immediate) {
    modes.push("immediate");
  }
  if (access.viaColdActivation) {
    modes.push("cold");
  }
  return modes.length === 0 ? "disabled" : modes.join(", ");
}

function printPhoenixOnboardingPlan(
  status: PhoenixTraderOnboardingStatus,
): void {
  console.log(`Trader PDA: ${status.traderPda.toBase58()}`);
  console.log(
    `Registration: ${
      status.registrationRequired
        ? "will run"
        : "skipped (trader already exists)"
    }`,
  );
  console.log(
    `Delegated activation: ${
      status.delegatedActivationRequired
        ? "will run"
        : "skipped (already active)"
    }`,
  );
}

async function getPhoenixTraderRentSol(
  context: CliContext,
  maxPositions: number,
): Promise<string> {
  const rentLamports =
    await context.glamClient.connection.getMinimumBalanceForRentExemption(
      getPhoenixTraderAccountSize(maxPositions),
    );
  return formatLamportsAsSol(rentLamports);
}

function printPhoenixRegistrationFundingNotice(
  rentSol: string,
  maxPositions: number,
): void {
  console.log(
    `The configured signer will fund ${rentSol} SOL of trader-account rent for ${maxPositions} positions plus transaction fees.`,
  );
  console.log("Phoenix no longer sponsors this rent.");
  console.log(
    "The rent is expected to return to the original funder once account closing is supported.",
  );
  console.log("Account closing is not currently available.");
}

function phoenixOnboardingConfirmationMessage(
  status: PhoenixTraderOnboardingStatus,
  rentSol?: string,
  maxPositions?: number,
): string {
  if (status.registrationRequired) {
    if (rentSol === undefined || maxPositions === undefined) {
      throw new Error(
        "Phoenix trader rent is required to confirm trader registration",
      );
    }
    return [
      `Onboard Phoenix trader ${status.traderPda.toBase58()}?`,
      `The configured signer will fund ${rentSol} SOL of trader-account rent for ${maxPositions} positions plus transaction fees.`,
      "Phoenix no longer sponsors this rent.",
      "The rent is expected to return to the original funder once account closing is supported.",
      "Account closing is not currently available.",
    ].join(" ");
  }
  return `Activate delegated Phoenix capabilities for ${status.traderPda.toBase58()}? The configured signer will pay the activation transaction fee.`;
}

function printPhoenixOnboardingResult(
  result: PhoenixOnboardTraderResult,
): void {
  console.log(
    `Registration: ${result.registrationPerformed ? "performed" : "skipped"}`,
  );
  if (result.registrationSignature) {
    console.log(`Registration signature: ${result.registrationSignature}`);
  }
  console.log(
    `Delegated activation: ${
      result.delegatedActivationPerformed ? "performed" : "skipped"
    }`,
  );
  if (result.activationSignature) {
    console.log(`Activation signature: ${result.activationSignature}`);
  }
  console.log(
    `Onboarding verified: ${
      result.finalStatus.delegatedCapabilitiesActive ? "yes" : "no"
    } (Phoenix API capability view; trader account owner verified by RPC)`,
  );

  const capabilities = result.finalStatus.capabilities;
  printTable(
    ["Capability", "Access"],
    [
      [
        "Place limit order",
        formatCapabilityAccess(capabilities?.placeLimitOrder),
      ],
      [
        "Place market order",
        formatCapabilityAccess(capabilities?.placeMarketOrder),
      ],
      [
        "Risk-increasing trade",
        formatCapabilityAccess(capabilities?.riskIncreasingTrade),
      ],
      [
        "Risk-reducing trade",
        formatCapabilityAccess(capabilities?.riskReducingTrade),
      ],
      [
        "Deposit collateral",
        formatCapabilityAccess(capabilities?.depositCollateral),
      ],
      [
        "Withdraw collateral",
        formatCapabilityAccess(capabilities?.withdrawCollateral),
      ],
    ],
  );
}

function normalizeMarketSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/-PERP$/, "");
}

function formatOrderFlags(order: TraderStateMarketLimitOrderRow): string {
  const flags: string[] = [];
  if (order.reduceOnly) {
    flags.push("reduce-only");
  }
  if (order.isConditionalOrder) {
    flags.push("conditional");
  }
  if (order.isStopLoss) {
    flags.push("stop-loss");
  }
  if (order.isStopLossDirection) {
    flags.push("stop-dir");
  }
  return flags.length === 0 ? "-" : flags.join(", ");
}

function formatCancelOrderId(order: TraderStateMarketLimitOrderRow): string {
  // Rise encodes a null node-pointer hint as zero for cancel-by-id.
  return `0:${order.priceTicks}:${order.orderSequenceNumber}`;
}

function uniquePublicKeys(publicKeys: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  const result: PublicKey[] = [];
  for (const publicKey of publicKeys) {
    const key = publicKey.toBase58();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(publicKey);
    }
  }
  return result;
}

function resolveMarket(
  snapshot: ExchangeSnapshotView,
  input: string,
): ExchangeMarketSnapshot {
  let inputKey: PublicKey | null = null;
  try {
    inputKey = new PublicKey(input);
  } catch {
    inputKey = null;
  }

  const normalized = normalizeMarketSymbol(input);
  const market = snapshot.markets.find((candidate) => {
    if (inputKey && candidate.marketPubkey === inputKey.toBase58()) {
      return true;
    }
    return normalizeMarketSymbol(candidate.symbol) === normalized;
  });

  if (!market) {
    fail(`Phoenix market not found: ${input}`);
  }
  return market;
}

function traderArgs(options: TraderOptions): {
  traderPdaIndex: number;
  subaccountIndex: number;
} {
  return {
    traderPdaIndex: parseU8(options.traderPdaIndex, "trader PDA index"),
    subaccountIndex: parseU8(options.subaccountIndex, "subaccount index"),
  };
}

async function fetchConfiguredTraderState(
  context: CliContext,
  options: TraderOptions,
): Promise<{
  trader: PublicKey;
  traderState: TraderStateSnapshotResponse | null;
  subaccount: TraderStateSubaccountSnapshot | null;
}> {
  const rise = context.glamClient.phoenix.rise;
  const { traderPdaIndex, subaccountIndex } = traderArgs(options);
  const trader = await context.glamClient.phoenix.getTraderPda(
    traderPdaIndex,
    subaccountIndex,
  );
  const traderState = await phoenixHttpNotFoundToNull(() =>
    rise.api
      .traders()
      .getTraderStateSnapshot(context.glamClient.vaultPda.toBase58(), {
        traderPdaIndex,
      }),
  );
  if (
    traderState &&
    (traderState.authority !== context.glamClient.vaultPda.toBase58() ||
      traderState.traderPdaIndex !== traderPdaIndex)
  ) {
    fail(
      "Phoenix trader-state response does not match the requested GLAM vault",
    );
  }
  const subaccount =
    traderState?.snapshot.subaccounts.find(
      (candidate) => candidate.subaccountIndex === subaccountIndex,
    ) ?? null;

  return { trader, traderState, subaccount };
}

function openOrderRows(
  subaccount: TraderStateSubaccountSnapshot,
  marketFilter?: ExchangeMarketSnapshot,
): string[][] {
  const rows: string[][] = [];
  for (const marketOrders of subaccount.orders) {
    const symbol = marketOrders.symbol;
    if (
      marketFilter &&
      normalizeMarketSymbol(symbol) !==
        normalizeMarketSymbol(marketFilter.symbol)
    ) {
      continue;
    }

    for (const order of marketOrders.orders) {
      rows.push([
        symbol,
        order.side,
        order.conditionalKind
          ? `${order.orderType}/${order.conditionalKind}`
          : order.orderType,
        order.priceUsd,
        order.priceTicks,
        order.sizeRemainingUnits ?? "-",
        order.sizeRemainingLots,
        order.initialSizeLots,
        formatOrderFlags(order),
        order.status,
        order.orderSequenceNumber,
        formatCancelOrderId(order),
      ]);
    }
  }
  return rows;
}

function positionRows(
  subaccount: TraderStateSubaccountSnapshot,
  marketFilter?: ExchangeMarketSnapshot,
): string[][] {
  return subaccount.positions
    .filter((position: TraderStatePositionSnapshot) => {
      if (!marketFilter) {
        return true;
      }
      return (
        normalizeMarketSymbol(position.symbol) ===
        normalizeMarketSymbol(marketFilter.symbol)
      );
    })
    .map((position: TraderStatePositionSnapshot) => [
      position.symbol,
      position.basePositionUnits ?? "-",
      position.basePositionLots,
      position.entryPriceUsd ?? "-",
      position.entryPriceTicks,
      position.virtualQuotePositionLots,
      position.unsettledFundingQuoteLots,
      position.accumulatedFundingQuoteLots,
      position.positionSequenceNumber,
    ]);
}

async function fetchVaultTokenBalance(
  context: CliContext,
  mint: PublicKey,
): Promise<VaultTokenBalance> {
  const { mint: mintAccount, tokenProgram } = await fetchMintAndTokenProgram(
    context.glamClient.connection,
    mint,
  );
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID)) {
    fail(
      `Phoenix/Ember collateral mint must use the legacy SPL Token program: ${mint}`,
    );
  }

  const ata = context.glamClient.getVaultAta(mint, TOKEN_PROGRAM_ID);
  try {
    const account = await getAccount(
      context.glamClient.connection,
      ata,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
    return {
      ata,
      amount: new BN(account.amount.toString()),
      decimals: mintAccount.decimals,
    };
  } catch (error) {
    if (
      error instanceof TokenAccountNotFoundError ||
      error instanceof TokenInvalidAccountOwnerError
    ) {
      return { ata, amount: new BN(0), decimals: mintAccount.decimals };
    }
    throw error;
  }
}

function printPhoenixPolicy(policy: PhoenixPolicy | null) {
  if (!policy) {
    console.log("No Phoenix policy found");
    return;
  }

  printTable(
    ["Field", "Value"],
    [
      [
        "markets",
        policy.marketsAllowlist.map((market) => market.toBase58()).join(", ") ||
          "-",
      ],
      ["allowedOrderTypes", orderTypesToString(policy.allowedOrderTypes)],
      ["maxPriceDeviationBps", `${policy.maxPriceDeviationBps}`],
      ["requireReduceOnlyOrders", `${policy.requireReduceOnlyOrders}`],
      ["maxReferencePriceAgeSecs", `${policy.maxReferencePriceAgeSecs}`],
    ],
  );
}

export function installPhoenixCommands(phoenix: Command, context: CliContext) {
  addTraderOptions(
    phoenix
      .command("info")
      .argument("[market]", "Phoenix market symbol or public key"),
  )
    .description("Show Phoenix exchange, market, and GLAM trader account info")
    .action(async (marketInput: string | undefined, options: TraderOptions) => {
      const rise = context.glamClient.phoenix.rise;
      const snapshot = await rise.api.exchange().getSnapshot();
      const { traderPdaIndex, subaccountIndex } = traderArgs(options);
      const trader = await context.glamClient.phoenix.getTraderPda(
        traderPdaIndex,
        subaccountIndex,
      );
      const canonicalMint = new PublicKey(snapshot.exchange.canonicalMint);
      const usdcMint = new PublicKey(snapshot.exchange.usdcMint);
      const [canonicalBalance, usdcBalance, traderView] = await Promise.all([
        fetchVaultTokenBalance(context, canonicalMint),
        fetchVaultTokenBalance(context, usdcMint),
        phoenixHttpNotFoundToNull(() =>
          rise.api.traders().getTrader(trader.toBase58()),
        ),
      ]);

      printTable(
        ["Field", "Value"],
        [
          ["snapshotSlot", `${snapshot.slot}`],
          [
            "extPhoenixProgram",
            context.glamClient.phoenix.programId.toBase58(),
          ],
          ["staging", `${context.glamClient.staging}`],
          ["phoenixProgram", snapshot.exchange.programId],
          ["exchangeActive", `${snapshot.exchange.active}`],
          ["exchangeGated", `${snapshot.exchange.gated}`],
          ["riskAuthority", snapshot.exchange.currentAuthorities.riskAuthority],
          ["glamState", context.glamClient.statePda.toBase58()],
          ["glamVault", context.glamClient.vaultPda.toBase58()],
          ["traderAccount", trader.toBase58()],
          ["traderPdaIndex", `${traderPdaIndex}`],
          ["subaccountIndex", `${subaccountIndex}`],
          ["canonicalMint", canonicalMint.toBase58()],
          ["usdcMint", usdcMint.toBase58()],
          [
            "canonicalVaultAta",
            context.glamClient.getVaultAta(canonicalMint).toBase58(),
          ],
          [
            "canonicalVaultBalance",
            `${formatUiAmount(
              canonicalBalance.amount,
              canonicalBalance.decimals,
            )} (${canonicalBalance.amount.toString()} raw)`,
          ],
          ["usdcVaultAta", context.glamClient.getVaultAta(usdcMint).toBase58()],
          [
            "usdcVaultBalance",
            `${formatUiAmount(
              usdcBalance.amount,
              usdcBalance.decimals,
            )} (${usdcBalance.amount.toString()} raw)`,
          ],
          ["globalVault", snapshot.exchange.globalVault],
          ["perpAssetMap", snapshot.exchange.perpAssetMap],
          [
            "globalTraderIndexLen",
            `${snapshot.exchange.globalTraderIndex.length}`,
          ],
          [
            "activeTraderBufferLen",
            `${snapshot.exchange.activeTraderBuffer.length}`,
          ],
          ["withdrawQueue", snapshot.exchange.withdrawQueue],
        ],
      );

      console.log("");
      if (traderView) {
        printTable(
          ["Trader Field", "Value"],
          [
            ["state", traderView.state],
            ["flags", `${traderView.flags}`],
            ["collateralBalance", traderView.collateralBalance.ui],
            ["portfolioValue", traderView.portfolioValue.ui],
            [
              "placeLimitOrder",
              formatCapabilityAccess(traderView.capabilities.placeLimitOrder),
            ],
            [
              "placeMarketOrder",
              formatCapabilityAccess(traderView.capabilities.placeMarketOrder),
            ],
            [
              "riskIncreasingTrade",
              formatCapabilityAccess(
                traderView.capabilities.riskIncreasingTrade,
              ),
            ],
            [
              "riskReducingTrade",
              formatCapabilityAccess(traderView.capabilities.riskReducingTrade),
            ],
            [
              "depositCollateral",
              formatCapabilityAccess(traderView.capabilities.depositCollateral),
            ],
            [
              "withdrawCollateral",
              formatCapabilityAccess(
                traderView.capabilities.withdrawCollateral,
              ),
            ],
          ],
        );
      } else {
        printTable(["Trader Field", "Value"], [["apiView", "not found"]]);
      }

      if (marketInput) {
        const market = resolveMarket(snapshot, marketInput);
        const marketPubkey = new PublicKey(market.marketPubkey);
        const splineCollection =
          await context.glamClient.phoenix.getSplineCollectionPda(marketPubkey);
        console.log("");
        printTable(
          ["Market Field", "Value"],
          [
            ["symbol", market.symbol],
            ["status", market.marketStatus],
            ["marketPubkey", marketPubkey.toBase58()],
            ["splineCollection", splineCollection.toBase58()],
            ["tickSize", `${market.tickSize}`],
            ["baseLotsDecimals", `${market.baseLotsDecimals}`],
            ["makerFee", `${market.makerFee}`],
            ["takerFee", `${market.takerFee}`],
            ["isolatedOnly", `${market.isolatedOnly}`],
          ],
        );
      } else {
        console.log("");
        printTable(
          ["Symbol", "Status", "Market", "Tick Size", "Base Lots Decimals"],
          snapshot.markets.map((market) => [
            market.symbol,
            market.marketStatus,
            market.marketPubkey,
            `${market.tickSize}`,
            `${market.baseLotsDecimals}`,
          ]),
        );
      }
    });

  addTraderOptions(
    phoenix
      .command("open-orders")
      .alias("orders")
      .argument("[market]", "Phoenix market symbol or public key"),
  )
    .description("Print Phoenix open orders for the configured GLAM vault")
    .action(async (marketInput: string | undefined, options: TraderOptions) => {
      const rise = context.glamClient.phoenix.rise;
      const [snapshot, { trader, traderState, subaccount }] = await Promise.all(
        [
          rise.api.exchange().getSnapshot(),
          fetchConfiguredTraderState(context, options),
        ],
      );
      const market = marketInput
        ? resolveMarket(snapshot, marketInput)
        : undefined;

      if (!traderState) {
        console.log(`Phoenix trader ${trader.toBase58()} not found`);
        return;
      }
      if (!subaccount) {
        console.log(`Phoenix subaccount ${trader.toBase58()} not found`);
        return;
      }

      const rows = openOrderRows(subaccount, market);
      console.log(`Trader: ${trader.toBase58()}`);
      if (rows.length === 0) {
        console.log(
          `No open Phoenix orders${market ? ` for ${market.symbol}` : ""}.`,
        );
        return;
      }

      printTable(
        [
          "Symbol",
          "Side",
          "Type",
          "Price USD",
          "Price Ticks",
          "Remaining Units",
          "Remaining Lots",
          "Initial Lots",
          "Flags",
          "Status",
          "Seq",
          "Cancel ID",
        ],
        rows,
      );
    });

  addTraderOptions(
    phoenix
      .command("positions")
      .argument("[market]", "Phoenix market symbol or public key"),
  )
    .description("Print Phoenix positions for the configured GLAM vault")
    .action(async (marketInput: string | undefined, options: TraderOptions) => {
      const rise = context.glamClient.phoenix.rise;
      const [snapshot, { trader, traderState, subaccount }] = await Promise.all(
        [
          rise.api.exchange().getSnapshot(),
          fetchConfiguredTraderState(context, options),
        ],
      );
      const market = marketInput
        ? resolveMarket(snapshot, marketInput)
        : undefined;

      if (!traderState) {
        console.log(`Phoenix trader ${trader.toBase58()} not found`);
        return;
      }
      if (!subaccount) {
        console.log(`Phoenix subaccount ${trader.toBase58()} not found`);
        return;
      }

      const rows = positionRows(subaccount, market);
      const capabilities =
        subaccount.capabilities ?? traderState.snapshot.capabilities;
      console.log(`Trader: ${trader.toBase58()}`);
      console.log(
        `Collateral: ${subaccount.collateral} | State: ${capabilities.state}`,
      );
      if (rows.length === 0) {
        console.log(
          `No Phoenix positions${market ? ` for ${market.symbol}` : ""}.`,
        );
        return;
      }

      printTable(
        [
          "Symbol",
          "Base Units",
          "Base Lots",
          "Entry USD",
          "Entry Ticks",
          "Virtual Quote Lots",
          "Unsettled Funding Lots",
          "Accumulated Funding Lots",
          "Position Seq",
        ],
        rows,
      );
    });

  addTraderOptions(phoenix.command("trader-address"))
    .description(
      "Derive the Phoenix trader account for the configured GLAM vault",
    )
    .action(async (options: TraderOptions) => {
      const { traderPdaIndex, subaccountIndex } = traderArgs(options);
      console.log(
        (
          await context.glamClient.phoenix.getTraderPda(
            traderPdaIndex,
            subaccountIndex,
          )
        ).toBase58(),
      );
    });

  phoenix
    .command("view-policy")
    .description("View Phoenix integration policy")
    .action(async () => {
      const phoenixPolicy = await context.glamClient.phoenix.fetchPolicy();
      if (!phoenixPolicy) {
        console.log("No Phoenix policy found");
        process.exit(1);
      }
      console.log("Phoenix policy:");
      printPhoenixPolicy(phoenixPolicy);
    });

  phoenix
    .command("allowlist-market")
    .argument("<market>", "Phoenix market symbol or public key")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a Phoenix market to the allowlist")
    .action(async (marketInput: string, options: TxOptions) => {
      const snapshot = await context.glamClient.phoenix.rise.api
        .exchange()
        .getSnapshot();
      const market = resolveMarket(snapshot, marketInput);
      const marketPubkey = new PublicKey(market.marketPubkey);

      const policy =
        (await context.glamClient.phoenix.fetchPolicy()) ??
        new PhoenixPolicy([], [], false, 0, 0);

      if (
        policy.marketsAllowlist.find((allowed) => allowed.equals(marketPubkey))
      ) {
        fail(`Phoenix market ${market.symbol} is already in the allowlist`);
      }

      policy.marketsAllowlist = uniquePublicKeys([
        ...policy.marketsAllowlist,
        marketPubkey,
      ]);
      if (policy.marketsAllowlist.length > 32) {
        fail("Phoenix policy cannot allowlist more than 32 markets");
      }

      await executeTxWithErrorHandling(
        () => context.glamClient.phoenix.setPolicy(policy, context.txOptions),
        {
          skip: !!options.yes,
          message: `Allowlist Phoenix market ${market.symbol} (${marketPubkey})?`,
        },
        (txSig) => `Allowlisted Phoenix market ${market.symbol}: ${txSig}`,
      );
    });

  phoenix
    .command("set-order-types")
    .argument(
      "<types>",
      "Comma- or space-separated order types: post-only, limit, ioc, or none",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Set allowed Phoenix order types while preserving other policy fields",
    )
    .action(async (types: string, options: TxOptions) => {
      const allowedOrderTypes = parseAllowedOrderTypes(types);
      const policy =
        (await context.glamClient.phoenix.fetchPolicy()) ??
        new PhoenixPolicy([], [], false, 0, 0);

      policy.allowedOrderTypes = allowedOrderTypes;

      await executeTxWithErrorHandling(
        () => context.glamClient.phoenix.setPolicy(policy, context.txOptions),
        {
          skip: !!options.yes,
          message: `Set Phoenix allowed order types to ${orderTypesToString(
            allowedOrderTypes,
          )}?`,
        },
        (txSig) => `Set Phoenix allowed order types: ${txSig}`,
      );
    });

  phoenix
    .command("onboard")
    .description(
      "Register and verify delegated capabilities for the default 0/0 Phoenix trader",
    )
    .option(
      "--max-positions <count>",
      `New-trader max positions (${PHOENIX_MIN_MAX_POSITIONS}-${PHOENIX_MAX_POSITIONS}); existing traders are not resized`,
      `${PHOENIX_DEFAULT_MAX_POSITIONS}`,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .addHelpText(
      "after",
      [
        "",
        "Registration uses GLAM's wrapper; delegated activation is a separate verified phase.",
        `The active vault PDA is the trader authority. When registration is required, the configured signer funds account rent plus fees; rent is ${PHOENIX_DEFAULT_TRADER_RENT_SOL} SOL at the default ${PHOENIX_DEFAULT_MAX_POSITIONS} positions and smaller accounts cost less. Phoenix no longer sponsors that rent.`,
        "Rent is expected to return to the original funder once account closing is supported; closing is not currently available.",
        "The retired sponsored invite/referral activation endpoints are not used.",
      ].join("\n"),
    )
    .action(async (options: { maxPositions: string; yes?: boolean }) => {
      const maxPositions = parseInteger(
        options.maxPositions,
        "max positions",
        PHOENIX_MIN_MAX_POSITIONS,
        PHOENIX_MAX_POSITIONS,
      );

      try {
        const status =
          await context.glamClient.phoenix.getTraderOnboardingStatus();
        printPhoenixOnboardingPlan(status);
        const rentSol = status.registrationRequired
          ? await getPhoenixTraderRentSol(context, maxPositions)
          : undefined;
        if (status.registrationRequired && options.yes) {
          if (rentSol === undefined) {
            throw new Error(
              "Phoenix trader rent is required to display trader registration funding",
            );
          }
          printPhoenixRegistrationFundingNotice(rentSol, maxPositions);
        }
        if (status.delegatedActivationRequired && !options.yes) {
          await confirmOperation(
            phoenixOnboardingConfirmationMessage(status, rentSol, maxPositions),
          );
        }

        const result = await context.glamClient.phoenix.onboardTrader({
          maxPositions,
          txOptions: context.txOptions,
        });
        printPhoenixOnboardingResult(result);
      } catch (error) {
        if (error instanceof PhoenixOnboardingError) {
          console.error(`[${error.phase}] ${error.message}`);
          if (error.registrationSignature) {
            console.error(
              `Registration signature: ${error.registrationSignature}`,
            );
          }
          if (error.activationSignature) {
            console.error(
              `Locally signed activation signature (may have been submitted): ${error.activationSignature}`,
            );
          }
        } else {
          console.error(parseTxError(error));
        }
        process.exit(1);
      }
    });

  addTraderOptions(
    phoenix
      .command("register-trader")
      .option(
        "--max-positions <count>",
        `Phoenix max positions (${PHOENIX_MIN_MAX_POSITIONS}-${PHOENIX_MAX_POSITIONS})`,
        `${PHOENIX_DEFAULT_MAX_POSITIONS}`,
      )
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description(
      "Register the Phoenix trader account only; delegated activation is still required",
    )
    .action(
      async (
        options: TraderOptions & { maxPositions: string; yes?: boolean },
      ) => {
        const { traderPdaIndex, subaccountIndex } = traderArgs(options);
        const traderAccount = await context.glamClient.phoenix.getTraderPda(
          traderPdaIndex,
          subaccountIndex,
        );
        const params = {
          maxPositions: new BN(
            parseInteger(
              options.maxPositions,
              "max positions",
              PHOENIX_MIN_MAX_POSITIONS,
              PHOENIX_MAX_POSITIONS,
            ),
          ),
          traderPdaIndex,
          traderSubaccountIndex: subaccountIndex,
        };

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.phoenix.registerTrader(
              params,
              { traderAccount },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Register Phoenix trader ${traderAccount}?`,
          },
          (txSig) => `Registered Phoenix trader ${traderAccount}: ${txSig}`,
        );
      },
    );

  addTraderOptions(
    phoenix
      .command("update-trader-state")
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description("Update Phoenix trader state")
    .action(async (options: TraderOptions & TxOptions) => {
      const snapshot = await context.glamClient.phoenix.rise.api
        .exchange()
        .getSnapshot();
      const remainingAccounts =
        await context.glamClient.phoenix.getUpdateTraderStateRemainingAccounts(
          snapshot,
          traderArgs(options),
        );

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.phoenix.updateTraderState(
            { remainingAccounts },
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: "Update Phoenix trader state?",
        },
        (txSig) => `Updated Phoenix trader state: ${txSig}`,
      );
    });

  addTraderOptions(
    phoenix
      .command("deposit")
      .argument("<amount>", "UI amount of USDC to deposit")
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description(
      "Convert USDC through Ember and deposit collateral into Phoenix",
    )
    .action(async (amount: string, options: TraderOptions & TxOptions) => {
      const amountBN = parseNonNegativeUiAmount(amount, 6, "amount");

      await executeTxWithErrorHandling(
        () => context.glamClient.phoenix.deposit(amountBN, context.txOptions),
        {
          skip: !!options.yes,
          message: `Deposit ${amount} USDC into Phoenix trader?`,
        },
        (txSig) => `Deposited ${amount} USDC into Phoenix: ${txSig}`,
      );
    });

  addTraderOptions(
    phoenix
      .command("withdraw")
      .argument("<amount>", "UI amount of Phoenix collateral to withdraw")
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description("Withdraw Phoenix collateral to USDC")
    .action(async (amount: string, options: TraderOptions & TxOptions) => {
      const snapshot = await context.glamClient.phoenix.rise.api
        .exchange()
        .getSnapshot();
      const canonicalMint = new PublicKey(snapshot.exchange.canonicalMint);
      const { mint: canonicalMintAccount, tokenProgram } =
        await fetchMintAndTokenProgram(
          context.glamClient.connection,
          canonicalMint,
        );
      if (!tokenProgram.equals(TOKEN_PROGRAM_ID)) {
        fail(
          `Phoenix/Ember collateral mint must use the legacy SPL Token program: ${canonicalMint}`,
        );
      }

      const amountBN = parseNonNegativeUiAmount(
        amount,
        canonicalMintAccount.decimals,
      );
      await executeTxWithErrorHandling(
        () => context.glamClient.phoenix.withdraw(amountBN, context.txOptions),
        {
          skip: !!options.yes,
          message: `Withdraw ${amount} Phoenix collateral from Phoenix trader?`,
        },
        (txSig) => `Withdrew Phoenix collateral to USDC: ${txSig}`,
      );
    });

  addOrderOptions(
    phoenix
      .command("place-limit")
      .argument("<market>", "Phoenix market symbol or public key")
      .argument("<side>", "bid/buy/long or ask/sell/short")
      .argument("<price>", "UI USD price, or raw ticks with --price-ticks")
      .argument(
        "<base-units>",
        "UI base units, or raw base lots with --base-lots",
      ),
  )
    .description("Place a Phoenix limit order")
    .action(
      async (
        marketInput: string,
        side: string,
        price: string,
        baseUnits: string,
        options: OrderOptions,
      ) => {
        const snapshot = await context.glamClient.phoenix.rise.api
          .exchange()
          .getSnapshot();
        const market = resolveMarket(snapshot, marketInput);
        const priceInTicks = options.priceTicks
          ? parseU64(price, "price")
          : priceUsdToTicks(market, price, "price");
        const packet: PhoenixOrderPacket = {
          kind: {
            limit: {
              side: sideKind(parseSide(side)),
              priceInTicks: ticks(priceInTicks),
              numBaseLots: baseLots(
                options.baseLots
                  ? parseU64(baseUnits, "base lots")
                  : baseUnitsToBaseLots(market, baseUnits, "base units"),
              ),
              selfTradeBehavior: selfTradeBehaviorKind(
                parseSelfTradeBehavior(options.selfTradeBehavior, 1),
              ),
              matchLimit: parseOptionalU64(options.matchLimit, "match limit"),
              clientOrderId: u128LeBytes(
                parseU128(options.clientOrderId, "client order id"),
              ),
              lastValidSlot: parseOptionalU64(
                options.lastValidSlot,
                "last valid slot",
              ),
              orderFlags: orderFlags(
                options.reduceOnly ? ORDER_FLAG_REDUCE_ONLY : ORDER_FLAG_NONE,
              ),
              cancelExisting: !!options.cancelExisting,
            },
          },
        };

        const remainingAccounts =
          await context.glamClient.phoenix.getMarketRemainingAccounts(
            snapshot,
            market.marketPubkey,
            traderArgs(options),
          );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.phoenix.placeLimitOrder(
              packet,
              { remainingAccounts },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Place ${market.symbol} limit order?`,
          },
          (txSig) => `Placed Phoenix limit order: ${txSig}`,
        );
      },
    );

  addOrderOptions(
    phoenix
      .command("place-market")
      .argument("<market>", "Phoenix market symbol or public key")
      .argument("<side>", "bid/buy/long or ask/sell/short")
      .argument(
        "<base-units>",
        "UI base units, or raw base lots with --base-lots",
      )
      .option(
        "--price-limit <price>",
        "Optional UI USD price limit, or raw ticks with --price-limit-ticks",
      )
      .option(
        "--price-limit-ticks",
        "Treat --price-limit as raw Phoenix ticks",
        false,
      )
      .option("--quote-lots <lots>", "Optional raw quote lots")
      .option("--min-base-units <amount>", "Minimum UI base units to fill")
      .option("--min-base-lots <lots>", "Minimum raw base lots to fill")
      .option("--min-quote-lots <lots>", "Minimum raw quote lots to fill", "1"),
  )
    .description("Place a Phoenix immediate-or-cancel market order")
    .action(
      async (
        marketInput: string,
        side: string,
        baseUnits: string,
        options: MarketOrderOptions,
      ) => {
        const snapshot = await context.glamClient.phoenix.rise.api
          .exchange()
          .getSnapshot();
        const market = resolveMarket(snapshot, marketInput);
        const numBaseLots = options.baseLots
          ? parseU64(baseUnits, "base lots")
          : baseUnitsToBaseLots(market, baseUnits, "base units");
        const priceLimitTicks = options.priceLimit
          ? options.priceLimitTicks
            ? parseU64(options.priceLimit, "price limit")
            : priceUsdToTicks(market, options.priceLimit, "price limit")
          : null;
        const minBaseLotsToFill = options.minBaseLots
          ? parseU64(options.minBaseLots, "minimum base lots")
          : options.minBaseUnits
            ? baseUnitsToBaseLots(
                market,
                options.minBaseUnits,
                "minimum base units",
              )
            : numBaseLots;
        const packet: PhoenixOrderPacket = {
          kind: {
            immediateOrCancel: {
              side: sideKind(parseSide(side)),
              priceInTicks: optionalTicks(priceLimitTicks),
              numBaseLots: baseLots(numBaseLots),
              numQuoteLots: optionalQuoteLots(
                options.quoteLots
                  ? parseU64(options.quoteLots, "quote lots")
                  : null,
              ),
              minBaseLotsToFill: baseLots(minBaseLotsToFill),
              minQuoteLotsToFill: quoteLots(
                parseU64(options.minQuoteLots ?? "1", "minimum quote lots"),
              ),
              selfTradeBehavior: selfTradeBehaviorKind(
                parseSelfTradeBehavior(options.selfTradeBehavior, 0),
              ),
              matchLimit: parseOptionalU64(options.matchLimit, "match limit"),
              clientOrderId: u128LeBytes(
                parseU128(options.clientOrderId, "client order id"),
              ),
              lastValidSlot: parseOptionalU64(
                options.lastValidSlot,
                "last valid slot",
              ),
              orderFlags: orderFlags(
                options.reduceOnly ? ORDER_FLAG_REDUCE_ONLY : ORDER_FLAG_NONE,
              ),
              cancelExisting: !!options.cancelExisting,
            },
          },
        };

        const remainingAccounts =
          await context.glamClient.phoenix.getMarketRemainingAccounts(
            snapshot,
            market.marketPubkey,
            traderArgs(options),
          );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.phoenix.placeMarketOrder(
              packet,
              { remainingAccounts },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Place ${market.symbol} market order?`,
          },
          (txSig) => `Placed Phoenix market order: ${txSig}`,
        );
      },
    );

  addTraderOptions(
    phoenix
      .command("cancel-all")
      .argument("<market>", "Phoenix market symbol or public key")
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description("Cancel all Phoenix orders on a market")
    .action(async (marketInput: string, options: TraderOptions & TxOptions) => {
      const snapshot = await context.glamClient.phoenix.rise.api
        .exchange()
        .getSnapshot();
      const market = resolveMarket(snapshot, marketInput);
      const remainingAccounts =
        await context.glamClient.phoenix.getMarketRemainingAccounts(
          snapshot,
          market.marketPubkey,
          traderArgs(options),
        );

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.phoenix.cancelAll(
            { remainingAccounts },
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Cancel all ${market.symbol} Phoenix orders?`,
        },
        (txSig) => `Cancelled Phoenix orders: ${txSig}`,
      );
    });

  addTraderOptions(
    phoenix
      .command("cancel-by-id")
      .argument("<market>", "Phoenix market symbol or public key")
      .requiredOption(
        "--order <node:price-ticks:sequence>",
        "Cancel id; repeat or pass comma-/space-separated values for multiple orders",
        collectArrayValues,
        [],
      )
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description("Cancel Phoenix orders by raw FIFO id")
    .action(
      async (
        marketInput: string,
        options: TraderOptions & TxOptions & { order: string[] },
      ) => {
        const snapshot = await context.glamClient.phoenix.rise.api
          .exchange()
          .getSnapshot();
        const market = resolveMarket(snapshot, marketInput);
        const orderIds: PhoenixOrderIds = {
          orderIds: options.order.map((value) => {
            const parts = value.split(":").map((part) => part.trim());
            if (parts.length !== 3) {
              fail(
                "--order must use node-pointer:price-ticks:order-sequence-number",
              );
            }
            return {
              nodePointer: { value: parseU32(parts[0], "node pointer") },
              orderId: {
                priceInTicks: ticks(parseU64(parts[1], "order price ticks")),
                orderSequenceNumber: parseU64(
                  parts[2],
                  "order sequence number",
                ),
              },
            };
          }),
        };

        const remainingAccounts =
          await context.glamClient.phoenix.getMarketRemainingAccounts(
            snapshot,
            market.marketPubkey,
            traderArgs(options),
          );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.phoenix.cancelOrdersById(
              orderIds,
              { remainingAccounts },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Cancel ${orderIds.orderIds.length} ${market.symbol} Phoenix order(s)?`,
          },
          (txSig) => `Cancelled Phoenix order(s): ${txSig}`,
        );
      },
    );

  addTraderOptions(
    phoenix
      .command("cancel-up-to")
      .argument("<market>", "Phoenix market symbol or public key")
      .argument("<side>", "bid/buy/long or ask/sell/short")
      .option("--num-orders <count>", "Number of orders to cancel")
      .option("--tick-limit <ticks>", "Raw Phoenix tick limit")
      .option("-y, --yes", "Skip confirmation prompt", false),
  )
    .description(
      "Cancel Phoenix orders on one side up to optional count/tick limits",
    )
    .action(
      async (
        marketInput: string,
        side: string,
        options: TraderOptions &
          TxOptions & { numOrders?: string; tickLimit?: string },
      ) => {
        const snapshot = await context.glamClient.phoenix.rise.api
          .exchange()
          .getSnapshot();
        const market = resolveMarket(snapshot, marketInput);
        const args = {
          side: sideKind(parseSide(side)),
          numOrdersToCancel: parseOptionalU64(
            options.numOrders,
            "number of orders",
          ),
          tickLimit: parseOptionalU64(options.tickLimit, "tick limit"),
        };
        const remainingAccounts =
          await context.glamClient.phoenix.getMarketRemainingAccounts(
            snapshot,
            market.marketPubkey,
            traderArgs(options),
          );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.phoenix.cancelUpTo(
              args,
              { remainingAccounts },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Cancel ${market.symbol} Phoenix orders up to limits?`,
          },
          (txSig) => `Cancelled Phoenix orders up to limits: ${txSig}`,
        );
      },
    );
}
