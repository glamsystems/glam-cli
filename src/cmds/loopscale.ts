import { BN } from "@coral-xyz/anchor";
import {
  LOOPSCALE_PROGRAM_ID,
  LoopscalePolicy,
  fromUiAmount,
  type TokenListItem,
} from "@glamsystems/glam-sdk";
import { type AccountMeta, PublicKey, Transaction } from "@solana/web3.js";
import { type Command } from "commander";

import {
  type CliContext,
  executeTxWithErrorHandling,
  resolveTokenMint,
  validatePublicKey,
} from "../utils";

type Tuple5 = [number, number, number, number, number];

type BorrowOptions = {
  strategy?: PublicKey;
  principalMint?: string;
  nonce: string;
  collateralMint: string;
  collateralAmount: string;
  borrowAmount: string;
  assetIdentifier?: PublicKey;
  expectedApyBps?: string;
  expectedLqt?: string;
  weightMatrix: string;
  collateralIndex: string;
  duration?: string;
  quoteDurationType: string;
  quoteDuration: string;
  skipSolUnwrap?: boolean;
  borrowAssetIndexGuidance?: string;
  yes?: boolean;
};

type QuoteOptions = {
  principalMint: string;
  collateralMint: string;
  collateralAmount: string;
  borrowAmount?: string;
  quoteDurationType: string;
  quoteDuration: string;
  json?: boolean;
};

type StrategyInfo = {
  address: PublicKey;
  externalYieldSource: number;
  principalMint: PublicKey;
  marketInformation: PublicKey;
  data: Buffer;
};

type MaxQuote = {
  apy?: number | string;
  strategy?: string;
  collateralIdentifier?: string;
  ltv?: number | string;
  lqt?: number | string;
  amount?: number | string;
};

type BorrowMarketConfig = {
  assetIndexGuidance: Buffer;
  remainingAccounts: AccountMeta[];
};

type MarketAssetInfo = {
  assetIdentifier: PublicKey;
  quoteMint: PublicKey;
  oracleAccount: PublicKey;
};

const U64_MAX = new BN("18446744073709551615");
const U32_MAX = 0xffffffff;
const U8_MAX = 0xff;
const MAX_SAFE_INTEGER_BN = new BN(Number.MAX_SAFE_INTEGER.toString());
const LOOPSCALE_QUOTE_API_URL = "https://tars.loopscale.com/v1";

const STRATEGY_DISCRIMINATOR = Buffer.from([
  174, 110, 39, 119, 82, 106, 169, 102,
]);
// Packed Loopscale Strategy offsets include the 8-byte Anchor discriminator.
const STRATEGY_PRINCIPAL_MINT_OFFSET = 42;
const STRATEGY_EXTERNAL_YIELD_SOURCE_OFFSET = 107;
const STRATEGY_MARKET_INFORMATION_OFFSET = 268;
const STRATEGY_COLLATERAL_MAP_OFFSET = 300;
const STRATEGY_DURATION_COUNT = 5;
const MARKET_INFORMATION_DISCRIMINATOR = Buffer.from([
  194, 154, 190, 99, 64, 111, 37, 205,
]);
const MARKET_INFORMATION_PRINCIPAL_MINT_OFFSET = 72;
const MARKET_INFORMATION_ASSET_DATA_OFFSET = 104;
const MARKET_INFORMATION_ASSET_DATA_SIZE = 128;
const MARKET_INFORMATION_ASSET_DATA_COUNT = 200;
const PUBKEY_LENGTH = 32;
const U64_MAX_BIGINT = (1n << 64n) - 1n;
const DEFAULT_PUBKEY = PublicKey.default;

const LOOPSCALE_PROTOCOL = 0b01;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseU64(value: string, label: string): BN {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }

  const parsed = new BN(trimmed);
  if (parsed.gt(U64_MAX)) {
    fail(`${label} exceeds u64 max`);
  }
  return parsed;
}

function parseOptionalU64(
  value: string | undefined,
  label: string,
): BN | undefined {
  return value === undefined ? undefined : parseU64(value, label);
}

function parseUnsignedNumber(
  value: string,
  label: string,
  max: number,
): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    fail(`${label} exceeds ${max}`);
  }
  return parsed;
}

function parseIntegerLikeBN(value: number | string | undefined, label: string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`${label} must be a safe non-negative integer`);
    }
    return new BN(value.toString());
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return new BN(value.trim());
  }

  fail(`${label} must be a non-negative integer`);
}

function parseIntegerLikeNumber(
  value: number | string | undefined,
  label: string,
  max: number,
) {
  const parsed = parseIntegerLikeBN(value, label);
  if (parsed.gt(new BN(max.toString()))) {
    fail(`${label} exceeds ${max}`);
  }
  return parsed.toNumber();
}

function parseTuple5(value: string, label: string): Tuple5 {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 5) {
    fail(`${label} must be a comma-separated 5-tuple`);
  }

  return parts.map((part, index) =>
    parseUnsignedNumber(part, `${label}[${index}]`, U32_MAX),
  ) as Tuple5;
}

function parseHexBytes(value: string, label: string): Buffer {
  const trimmed = value.trim().replace(/^0x/i, "");
  if (trimmed.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(trimmed)) {
    fail(`${label} must be an even-length hex string`);
  }
  return Buffer.from(trimmed, "hex");
}

function parsePositiveUiAmount(
  value: string,
  decimals: number,
  label: string,
): BN {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    fail(`${label} must be a non-negative decimal amount`);
  }

  const fractionalPart = trimmed.split(".")[1] ?? "";
  if (fractionalPart.length > decimals) {
    fail(`${label} has more than ${decimals} decimal places`);
  }

  const parsed = fromUiAmount(trimmed, decimals);
  if (parsed.isZero()) {
    fail(`${label} must be greater than zero`);
  }
  return parsed;
}

function bnToSafeNumber(value: BN, label: string): number {
  if (value.gt(MAX_SAFE_INTEGER_BN)) {
    fail(`${label} exceeds JavaScript's safe integer range`);
  }
  return value.toNumber();
}

async function fetchStrategyInfo(
  context: CliContext,
  strategy: PublicKey,
): Promise<StrategyInfo> {
  const account = await context.glamClient.connection.getAccountInfo(strategy);
  if (!account) {
    fail(`Loopscale strategy account not found: ${strategy}`);
  }

  if (!account.owner.equals(LOOPSCALE_PROGRAM_ID)) {
    fail(
      `Loopscale strategy ${strategy} is owned by ${account.owner}, expected ${LOOPSCALE_PROGRAM_ID}`,
    );
  }

  if (
    account.data.length <
    STRATEGY_MARKET_INFORMATION_OFFSET + PUBKEY_LENGTH
  ) {
    fail(`Loopscale strategy account is too small: ${strategy}`);
  }

  if (!account.data.subarray(0, 8).equals(STRATEGY_DISCRIMINATOR)) {
    fail(`Account is not a Loopscale Strategy: ${strategy}`);
  }

  const externalYieldSource =
    account.data[STRATEGY_EXTERNAL_YIELD_SOURCE_OFFSET];
  if (externalYieldSource !== 0) {
    fail(
      `v1 only supports strategies with no external yield source; strategy ${strategy} has external_yield_source=${externalYieldSource}`,
    );
  }

  return {
    address: strategy,
    externalYieldSource,
    principalMint: new PublicKey(
      account.data.subarray(
        STRATEGY_PRINCIPAL_MINT_OFFSET,
        STRATEGY_PRINCIPAL_MINT_OFFSET + PUBKEY_LENGTH,
      ),
    ),
    marketInformation: new PublicKey(
      account.data.subarray(
        STRATEGY_MARKET_INFORMATION_OFFSET,
        STRATEGY_MARKET_INFORMATION_OFFSET + PUBKEY_LENGTH,
      ),
    ),
    data: Buffer.from(account.data),
  };
}

async function fetchMaxQuotes(params: {
  context: CliContext;
  principalMint: PublicKey;
  collateralMint: PublicKey;
  collateralAmount: BN;
  durationType: number;
  duration: number;
}): Promise<MaxQuote[]> {
  const {
    context,
    principalMint,
    collateralMint,
    collateralAmount,
    durationType,
    duration,
  } = params;
  const response = await fetch(`${LOOPSCALE_QUOTE_API_URL}/markets/quote/max`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-wallet": context.glamClient.signer.toBase58(),
    },
    body: JSON.stringify({
      durationType,
      duration,
      principalMint: principalMint.toBase58(),
      collateralFilter: [
        {
          amount: bnToSafeNumber(collateralAmount, "collateral-amount"),
          assetData: {
            Spl: {
              mint: collateralMint.toBase58(),
            },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    fail(
      `Loopscale quote API failed (${response.status}): ${await response.text()}`,
    );
  }

  const quotes = (await response.json()) as unknown;
  if (!Array.isArray(quotes)) {
    fail("Loopscale quote API returned an invalid response");
  }

  return quotes as MaxQuote[];
}

function selectBestQuote(quotes: MaxQuote[], borrowAmount?: BN): MaxQuote {
  const quote = quotes.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as MaxQuote;
    if (!candidate.strategy) {
      return false;
    }
    return (
      !borrowAmount ||
      (candidate.amount !== undefined &&
        parseIntegerLikeBN(candidate.amount, "quote amount").gte(borrowAmount))
    );
  }) as MaxQuote | undefined;

  if (!quote) {
    fail(
      borrowAmount
        ? "Loopscale quote API returned no strategy with enough liquidity"
        : "Loopscale quote API returned no usable strategy",
    );
  }

  return quote;
}

async function fetchBestQuote(params: {
  context: CliContext;
  principalMint: PublicKey;
  collateralMint: PublicKey;
  collateralAmount: BN;
  borrowAmount: BN;
  durationType: number;
  duration: number;
}): Promise<MaxQuote> {
  return selectBestQuote(
    await fetchMaxQuotes({
      context: params.context,
      principalMint: params.principalMint,
      collateralMint: params.collateralMint,
      collateralAmount: params.collateralAmount,
      durationType: params.durationType,
      duration: params.duration,
    }),
    params.borrowAmount,
  );
}

async function fetchMarketInformationData(
  context: CliContext,
  marketInformation: PublicKey,
): Promise<Buffer> {
  const account =
    await context.glamClient.connection.getAccountInfo(marketInformation);
  if (!account) {
    fail(
      `Loopscale market information account not found: ${marketInformation}`,
    );
  }

  if (!account.owner.equals(LOOPSCALE_PROGRAM_ID)) {
    fail(
      `Loopscale market information ${marketInformation} is owned by ${account.owner}, expected ${LOOPSCALE_PROGRAM_ID}`,
    );
  }

  if (
    account.data.length <
    MARKET_INFORMATION_ASSET_DATA_OFFSET +
      MARKET_INFORMATION_ASSET_DATA_SIZE * MARKET_INFORMATION_ASSET_DATA_COUNT
  ) {
    fail(
      `Loopscale market information account is too small: ${marketInformation}`,
    );
  }

  if (!account.data.subarray(0, 8).equals(MARKET_INFORMATION_DISCRIMINATOR)) {
    fail(`Account is not Loopscale MarketInformation: ${marketInformation}`);
  }

  return Buffer.from(account.data);
}

function findMarketAssetIndex(
  marketInformationData: Buffer,
  assetIdentifier: PublicKey,
  label: string,
): number {
  for (let i = 0; i < MARKET_INFORMATION_ASSET_DATA_COUNT; i++) {
    const offset =
      MARKET_INFORMATION_ASSET_DATA_OFFSET +
      i * MARKET_INFORMATION_ASSET_DATA_SIZE;
    const candidate = new PublicKey(
      marketInformationData.subarray(offset, offset + PUBKEY_LENGTH),
    );
    if (candidate.equals(assetIdentifier)) {
      return i;
    }
  }

  fail(
    `${label} ${assetIdentifier} is not listed in Loopscale market information`,
  );
}

function readMarketAssetInfo(
  marketInformationData: Buffer,
  assetIndex: number,
): MarketAssetInfo {
  if (
    assetIndex < 0 ||
    assetIndex >= MARKET_INFORMATION_ASSET_DATA_COUNT ||
    !Number.isInteger(assetIndex)
  ) {
    fail(`Invalid Loopscale market asset index: ${assetIndex}`);
  }

  const offset =
    MARKET_INFORMATION_ASSET_DATA_OFFSET +
    assetIndex * MARKET_INFORMATION_ASSET_DATA_SIZE;
  return {
    assetIdentifier: new PublicKey(
      marketInformationData.subarray(offset, offset + PUBKEY_LENGTH),
    ),
    quoteMint: new PublicKey(
      marketInformationData.subarray(
        offset + PUBKEY_LENGTH,
        offset + PUBKEY_LENGTH * 2,
      ),
    ),
    oracleAccount: new PublicKey(
      marketInformationData.subarray(
        offset + PUBKEY_LENGTH * 2,
        offset + PUBKEY_LENGTH * 3,
      ),
    ),
  };
}

function validateStrategyCollateralTerm(
  strategyInfo: StrategyInfo,
  collateralAssetIndex: number,
  duration: number,
) {
  if (duration >= STRATEGY_DURATION_COUNT) {
    fail(`duration must be less than ${STRATEGY_DURATION_COUNT}`);
  }

  const offset =
    STRATEGY_COLLATERAL_MAP_OFFSET +
    (collateralAssetIndex * STRATEGY_DURATION_COUNT + duration) * 8;
  if (strategyInfo.data.length < offset + 8) {
    fail("Loopscale strategy account is too small for collateral terms");
  }

  const term = strategyInfo.data.readBigUInt64LE(offset);
  if (term === U64_MAX_BIGINT) {
    fail(
      `Strategy ${strategyInfo.address} has no collateral term for market asset index ${collateralAssetIndex} and duration ${duration}`,
    );
  }
}

function appendOracleRemainingAccounts(params: {
  marketInformationData: Buffer;
  remainingAccounts: AccountMeta[];
  assetIndex: number;
  visitedQuoteIndexes?: Set<number>;
}) {
  const {
    marketInformationData,
    remainingAccounts,
    assetIndex,
    visitedQuoteIndexes = new Set<number>(),
  } = params;
  const assetInfo = readMarketAssetInfo(marketInformationData, assetIndex);

  if (!assetInfo.oracleAccount.equals(DEFAULT_PUBKEY)) {
    remainingAccounts.push({
      pubkey: assetInfo.oracleAccount,
      isSigner: false,
      isWritable: false,
    });
  }

  if (assetInfo.quoteMint.equals(DEFAULT_PUBKEY)) {
    return;
  }

  const quoteAssetIndex = findMarketAssetIndex(
    marketInformationData,
    assetInfo.quoteMint,
    "quote mint",
  );
  if (visitedQuoteIndexes.has(quoteAssetIndex)) {
    fail(
      `Loopscale market information has a quote mint cycle at index ${quoteAssetIndex}`,
    );
  }
  visitedQuoteIndexes.add(quoteAssetIndex);

  appendOracleRemainingAccounts({
    marketInformationData,
    remainingAccounts,
    assetIndex: quoteAssetIndex,
    visitedQuoteIndexes,
  });
}

async function deriveBorrowMarketConfig(params: {
  context: CliContext;
  strategyInfo: StrategyInfo;
  collateralAssetIdentifier: PublicKey;
  duration: number;
}): Promise<BorrowMarketConfig> {
  const { context, strategyInfo, collateralAssetIdentifier, duration } = params;
  const marketInformationData = await fetchMarketInformationData(
    context,
    strategyInfo.marketInformation,
  );
  const marketPrincipalMint = new PublicKey(
    marketInformationData.subarray(
      MARKET_INFORMATION_PRINCIPAL_MINT_OFFSET,
      MARKET_INFORMATION_PRINCIPAL_MINT_OFFSET + PUBKEY_LENGTH,
    ),
  );
  if (!marketPrincipalMint.equals(strategyInfo.principalMint)) {
    fail(
      `Market principal mint ${marketPrincipalMint} does not match strategy principal mint ${strategyInfo.principalMint}`,
    );
  }

  const collateralAssetIndex = findMarketAssetIndex(
    marketInformationData,
    collateralAssetIdentifier,
    "collateral asset identifier",
  );
  const principalAssetIndex = findMarketAssetIndex(
    marketInformationData,
    strategyInfo.principalMint,
    "principal mint",
  );
  validateStrategyCollateralTerm(strategyInfo, collateralAssetIndex, duration);

  const remainingAccounts: AccountMeta[] = [
    {
      pubkey: strategyInfo.marketInformation,
      isSigner: false,
      isWritable: true,
    },
  ];
  appendOracleRemainingAccounts({
    marketInformationData,
    remainingAccounts,
    assetIndex: principalAssetIndex,
  });
  appendOracleRemainingAccounts({
    marketInformationData,
    remainingAccounts,
    assetIndex: collateralAssetIndex,
  });

  return {
    assetIndexGuidance: Buffer.from([
      collateralAssetIndex,
      principalAssetIndex,
      collateralAssetIndex,
    ]),
    remainingAccounts,
  };
}

function inferDurationIndex(
  quoteDurationType: number,
  quoteDuration: number,
): number | undefined {
  if (quoteDurationType === 0) {
    if (quoteDuration === 1) return 0;
    if (quoteDuration === 7) return 1;
    if (quoteDuration >= 28 && quoteDuration <= 31) return 2;
    if (quoteDuration >= 89 && quoteDuration <= 92) return 3;
  }

  if (quoteDurationType === 1 && quoteDuration === 1) {
    return 1;
  }

  if (quoteDurationType === 2) {
    if (quoteDuration === 1) return 2;
    if (quoteDuration === 3) return 3;
  }

  if (quoteDurationType === 3 && quoteDuration === 5) {
    return 4;
  }

  return undefined;
}

export function installLoopscaleCommands(
  loopscale: Command,
  context: CliContext,
) {
  const policy = loopscale
    .command("policy")
    .description("Manage Loopscale policy");

  policy
    .command("view")
    .description("View Loopscale policy")
    .action(async () => {
      const loopscalePolicy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extLoopscaleProgram.programId,
        LOOPSCALE_PROTOCOL,
        LoopscalePolicy,
      );
      if (!loopscalePolicy) {
        console.log("No policy found");
        return;
      }

      console.log("Loopscale strategies allowlist:");
      for (let i = 0; i < loopscalePolicy.strategiesAllowlist.length; i++) {
        console.log(`[${i}] ${loopscalePolicy.strategiesAllowlist[i]}`);
      }
    });

  policy
    .command("allow")
    .argument("<strategy>", "Loopscale strategy public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a strategy to the allowlist")
    .action(async (strategy: PublicKey, options: { yes?: boolean }) => {
      const loopscalePolicy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extLoopscaleProgram.programId,
          LOOPSCALE_PROTOCOL,
          LoopscalePolicy,
        )) ?? new LoopscalePolicy([]);

      if (loopscalePolicy.strategiesAllowlist.find((s) => s.equals(strategy))) {
        console.error(
          `Loopscale strategy ${strategy} is already in the allowlist`,
        );
        process.exit(1);
      }

      loopscalePolicy.strategiesAllowlist.push(strategy);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extLoopscaleProgram.programId,
            LOOPSCALE_PROTOCOL,
            loopscalePolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding Loopscale strategy ${strategy} to allowlist`,
        },
        (txSig) =>
          `Loopscale strategy ${strategy} added to allowlist: ${txSig}`,
      );
    });

  policy
    .command("remove")
    .argument("<strategy>", "Loopscale strategy public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a strategy from the allowlist")
    .action(async (strategy: PublicKey, options: { yes?: boolean }) => {
      const loopscalePolicy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extLoopscaleProgram.programId,
        LOOPSCALE_PROTOCOL,
        LoopscalePolicy,
      );
      if (!loopscalePolicy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (
        !loopscalePolicy.strategiesAllowlist.find((s) => s.equals(strategy))
      ) {
        console.error("Strategy not in allowlist. Removal not needed.");
        process.exit(1);
      }

      loopscalePolicy.strategiesAllowlist =
        loopscalePolicy.strategiesAllowlist.filter((s) => !s.equals(strategy));
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extLoopscaleProgram.programId,
            LOOPSCALE_PROTOCOL,
            loopscalePolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing Loopscale strategy ${strategy} from allowlist`,
        },
        (txSig) =>
          `Loopscale strategy ${strategy} removed from allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("quote")
    .requiredOption(
      "--principal-mint <mintOrSymbol>",
      "Principal mint address or symbol",
    )
    .requiredOption(
      "--collateral-mint <mintOrSymbol>",
      "Collateral mint address or symbol",
    )
    .requiredOption("--collateral-amount <uiAmount>", "Collateral amount")
    .option(
      "--borrow-amount <uiAmount>",
      "Optional minimum principal amount to borrow",
    )
    .option(
      "--quote-duration-type <n>",
      "Loopscale quote duration type (0=days, 1=weeks, 2=months, 3=minutes, 4=years)",
      "0",
    )
    .requiredOption("--quote-duration <n>", "Loopscale quote duration units")
    .option("--json", "Print the raw selected quote as JSON", false)
    .description("Fetch the best Loopscale quote for a borrow")
    .action(async (options: QuoteOptions) => {
      const quoteDurationType = parseUnsignedNumber(
        options.quoteDurationType,
        "quote-duration-type",
        4,
      );
      const quoteDuration = parseUnsignedNumber(
        options.quoteDuration,
        "quote-duration",
        U32_MAX,
      );
      const principalToken = await resolveTokenMint(
        context.glamClient,
        options.principalMint,
      );
      const collateralToken = await resolveTokenMint(
        context.glamClient,
        options.collateralMint,
      );
      const principalMint = new PublicKey(principalToken.address);
      const collateralMint = new PublicKey(collateralToken.address);
      const collateralAmount = parsePositiveUiAmount(
        options.collateralAmount,
        collateralToken.decimals,
        "collateral-amount",
      );
      const borrowAmount = options.borrowAmount
        ? parsePositiveUiAmount(
            options.borrowAmount,
            principalToken.decimals,
            "borrow-amount",
          )
        : undefined;

      const quote = selectBestQuote(
        await fetchMaxQuotes({
          context,
          principalMint,
          collateralMint,
          collateralAmount,
          durationType: quoteDurationType,
          duration: quoteDuration,
        }),
        borrowAmount,
      );

      if (options.json) {
        console.log(JSON.stringify(quote, null, 2));
        return;
      }

      console.log(`Strategy: ${quote.strategy}`);
      console.log(`Collateral identifier: ${quote.collateralIdentifier}`);
      console.log(`Amount: ${quote.amount}`);
      console.log(`APY cBPS: ${quote.apy}`);
      console.log(`LTV cBPS: ${quote.ltv}`);
      console.log(`LQT cBPS: ${quote.lqt}`);
    });

  loopscale
    .command("borrow")
    .option("--strategy <pubkey>", "Loopscale strategy", validatePublicKey)
    .option(
      "--principal-mint <mintOrSymbol>",
      "Principal mint address or symbol; required when --strategy is omitted",
    )
    .requiredOption("--nonce <u64>", "Loan nonce")
    .requiredOption(
      "--collateral-mint <mintOrSymbol>",
      "Collateral mint address or symbol",
    )
    .requiredOption("--collateral-amount <uiAmount>", "Collateral amount")
    .requiredOption("--borrow-amount <uiAmount>", "Principal amount to borrow")
    .option(
      "--asset-identifier <pubkey>",
      "Collateral asset identifier; defaults to collateral mint",
      validatePublicKey,
    )
    .option(
      "--expected-apy-bps <bn>",
      "Expected APY guard; defaults to quote APY when auto-selecting a strategy, otherwise 1000",
    )
    .option(
      "--expected-lqt <n0,n1,n2,n3,n4>",
      "Expected loan quality thresholds; defaults to quote LQT when auto-selecting a strategy, otherwise 980000,0,0,0,0",
    )
    .option(
      "--weight-matrix <n0,n1,n2,n3,n4>",
      "Collateral weight matrix",
      "1000000,0,0,0,0",
    )
    .option("--collateral-index <u8>", "Collateral index", "0")
    .option(
      "--duration <u8>",
      "Loan duration index; defaults from quote duration when auto-selecting a strategy, otherwise 0",
    )
    .option(
      "--quote-duration-type <n>",
      "Loopscale quote duration type (0=days, 1=weeks, 2=months, 3=minutes, 4=years)",
      "0",
    )
    .option("--quote-duration <n>", "Loopscale quote duration units", "0")
    .option("--skip-sol-unwrap", "Skip SOL unwrap", false)
    .option(
      "--borrow-asset-index-guidance <hex>",
      "Override derived borrow asset index guidance as hex bytes",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Create a Loopscale loan, deposit collateral, update weights, and borrow principal",
    )
    .action(async (options: BorrowOptions) => {
      const nonce = parseU64(options.nonce, "nonce");
      let expectedApy = parseOptionalU64(
        options.expectedApyBps,
        "expected-apy-bps",
      );
      let expectedLqt = options.expectedLqt
        ? parseTuple5(options.expectedLqt, "expected-lqt")
        : undefined;
      const weightMatrix = parseTuple5(options.weightMatrix, "weight-matrix");
      const collateralIndex = parseUnsignedNumber(
        options.collateralIndex,
        "collateral-index",
        U8_MAX,
      );
      const quoteDurationType = parseUnsignedNumber(
        options.quoteDurationType,
        "quote-duration-type",
        4,
      );
      const quoteDuration = parseUnsignedNumber(
        options.quoteDuration,
        "quote-duration",
        U32_MAX,
      );
      const inferredDuration = inferDurationIndex(
        quoteDurationType,
        quoteDuration,
      );
      const duration =
        options.duration !== undefined
          ? parseUnsignedNumber(options.duration, "duration", U8_MAX)
          : options.strategy
            ? 0
            : (inferredDuration ??
              fail(
                "--duration is required because the quote duration does not map to a Loopscale duration index",
              ));
      let borrowAssetIndexGuidance = options.borrowAssetIndexGuidance
        ? parseHexBytes(
            options.borrowAssetIndexGuidance,
            "borrow-asset-index-guidance",
          )
        : undefined;

      const collateralToken = await resolveTokenMint(
        context.glamClient,
        options.collateralMint,
      );
      const collateralMint = new PublicKey(collateralToken.address);
      const assetIdentifier = options.assetIdentifier ?? collateralMint;
      const collateralAmount = parsePositiveUiAmount(
        options.collateralAmount,
        collateralToken.decimals,
        "collateral-amount",
      );

      let strategy = options.strategy;
      let strategyInfo: StrategyInfo | undefined;
      let principalToken: TokenListItem;

      if (strategy) {
        strategyInfo = await fetchStrategyInfo(context, strategy);
        principalToken = await resolveTokenMint(
          context.glamClient,
          strategyInfo.principalMint.toBase58(),
        );
        if (options.principalMint) {
          const requestedPrincipalToken = await resolveTokenMint(
            context.glamClient,
            options.principalMint,
          );
          const requestedPrincipalMint = new PublicKey(
            requestedPrincipalToken.address,
          );
          if (!requestedPrincipalMint.equals(strategyInfo.principalMint)) {
            fail(
              `--principal-mint ${requestedPrincipalMint} does not match strategy principal mint ${strategyInfo.principalMint}`,
            );
          }
        }
      } else {
        if (!options.principalMint) {
          fail("--principal-mint is required when --strategy is omitted");
        }
        principalToken = await resolveTokenMint(
          context.glamClient,
          options.principalMint,
        );
      }

      const borrowAmount = parsePositiveUiAmount(
        options.borrowAmount,
        principalToken.decimals,
        "borrow-amount",
      );

      if (!strategy) {
        const requestedPrincipalMint = new PublicKey(principalToken.address);
        const quote = await fetchBestQuote({
          context,
          principalMint: requestedPrincipalMint,
          collateralMint,
          collateralAmount,
          borrowAmount,
          durationType: quoteDurationType,
          duration: quoteDuration,
        });
        strategy = validatePublicKey(quote.strategy!);

        if (quote.collateralIdentifier) {
          const quotedCollateralIdentifier = validatePublicKey(
            quote.collateralIdentifier,
          );
          if (!quotedCollateralIdentifier.equals(assetIdentifier)) {
            fail(
              `Quote collateral identifier ${quotedCollateralIdentifier} does not match asset identifier ${assetIdentifier}`,
            );
          }
        }

        const quoteAmount = parseIntegerLikeBN(quote.amount, "quote amount");
        if (quoteAmount.lt(borrowAmount)) {
          fail(
            `Selected quote only supports ${quoteAmount.toString()} base units, below requested borrow amount ${borrowAmount.toString()}`,
          );
        }

        strategyInfo = await fetchStrategyInfo(context, strategy);
        if (!strategyInfo.principalMint.equals(requestedPrincipalMint)) {
          fail(
            `Selected strategy principal mint ${strategyInfo.principalMint} does not match requested principal mint ${requestedPrincipalMint}`,
          );
        }

        expectedApy ??= parseIntegerLikeBN(quote.apy, "quote apy");
        expectedLqt ??= [
          parseIntegerLikeNumber(quote.lqt, "quote lqt", U32_MAX),
          0,
          0,
          0,
          0,
        ];
        console.log(
          `Selected Loopscale strategy ${strategy} from quote API (apy=${expectedApy.toString()}, lqt=${expectedLqt[0]})`,
        );
      }

      expectedApy ??= parseU64("1000", "expected-apy-bps");
      expectedLqt ??= parseTuple5("980000,0,0,0,0", "expected-lqt");

      if (!strategy || !strategyInfo) {
        fail("Could not resolve a Loopscale strategy");
      }

      const borrowMarketConfig = await deriveBorrowMarketConfig({
        context,
        strategyInfo,
        collateralAssetIdentifier: assetIdentifier,
        duration,
      });
      borrowAssetIndexGuidance ??= borrowMarketConfig.assetIndexGuidance;

      const loan = context.glamClient.loopscale.getLoanPda(nonce);
      const expectedLoanValues = {
        expectedApy,
        expectedLqt,
      };

      const createLoanIx =
        await context.glamClient.loopscale.txBuilder.createLoanIx(
          { nonce },
          { loan },
        );
      const depositCollateralIx =
        await context.glamClient.loopscale.txBuilder.depositCollateralIx(
          {
            amount: collateralAmount,
            assetType: 0,
            assetIdentifier,
            assetIndexGuidance: Buffer.alloc(0),
          },
          {
            loan,
            depositMint: collateralMint,
          },
        );
      const updateWeightMatrixIx =
        await context.glamClient.loopscale.txBuilder.updateWeightMatrixIx(
          {
            collateralIndex,
            weightMatrix,
            expectedLoanValues,
            assetIndexGuidance: Buffer.alloc(0),
          },
          { loan },
        );
      const borrowPrincipalIx =
        await context.glamClient.loopscale.txBuilder.borrowPrincipalIx(
          {
            amount: borrowAmount,
            assetIndexGuidance: borrowAssetIndexGuidance,
            duration,
            expectedLoanValues,
            skipSolUnwrap: options.skipSolUnwrap ?? false,
          },
          {
            loan,
            strategy,
            marketInformation: strategyInfo.marketInformation,
            principalMint: strategyInfo.principalMint,
            remainingAccounts: borrowMarketConfig.remainingAccounts,
          },
        );
      const tx = new Transaction().add(
        createLoanIx,
        depositCollateralIx,
        updateWeightMatrixIx,
        borrowPrincipalIx,
      );

      const collateralLabel = `${options.collateralAmount} ${collateralToken.symbol}`;
      const principalLabel = `${options.borrowAmount} ${principalToken.symbol}`;
      await executeTxWithErrorHandling(
        async () => {
          const versionedTx = await context.glamClient.intoVersionedTransaction(
            tx,
            context.txOptions,
          );
          console.log(
            "Versioned tx:",
            Buffer.from(versionedTx.serialize()).toString("base64"),
          );
          return await context.glamClient.sendAndConfirm(versionedTx);
        },
        {
          skip: options.yes ?? false,
          message: [
            "Confirm Loopscale borrow",
            `nonce: ${nonce.toString()}`,
            `loan: ${loan}`,
            `strategy: ${strategy}`,
            `collateral: ${collateralLabel}`,
            `borrow: ${principalLabel}`,
          ].join("\n"),
        },
        (txSig) => `Loopscale loan ${loan} opened and funded: ${txSig}`,
      );
    });
}
