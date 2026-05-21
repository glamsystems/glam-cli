import { BN } from "@coral-xyz/anchor";
import {
  ORCA_WHIRLPOOLS_PROGRAM_ID,
  WSOL,
  WhirlpoolsPolicy,
  fetchMintAndTokenProgram,
  type CollectOrcaRewardV2Accounts,
  type DecreaseOrcaLiquidityV2Params,
  type IncreaseOrcaLiquidityByTokenAmountsV2Params,
  type IncreaseOrcaLiquidityV2Params,
  type OrcaLiquidityV2Accounts,
  type OrcaPriceDeviationAccounts,
  type OrcaPositionAccounts,
  type OrcaUpdateFeesAndRewardsAccounts,
  type OrcaV2RemainingAccounts,
  type OpenOrcaPositionWithTokenExtensionsAccounts,
  type OpenOrcaPositionWithTokenExtensionsParams,
  type RepositionOrcaLiquidityV2Accounts,
  type RepositionOrcaLiquidityV2Params,
  PkSet,
} from "@glamsystems/glam-sdk";
import { type AccountMeta, Keypair, PublicKey } from "@solana/web3.js";
import { type Command } from "commander";
import fs from "fs";

import {
  type CliContext,
  collectPublicKeys,
  executeTxWithErrorHandling,
  printTable,
  validatePublicKey,
} from "../utils";

const ORCA_WHIRLPOOLS_PROTOCOL = 0b1;
const BPS_DENOMINATOR = 10_000;
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
const ORCA_MIN_TICK_INDEX = -443_636;
const ORCA_MAX_TICK_INDEX = 443_636;
const U8_MAX = 0xff;
const U64_MAX = new BN("18446744073709551615");
const U128_MAX = new BN("340282366920938463463374607431768211455");
const TICK_ARRAY_SIZE = 88;
const Q64 = 2n ** 64n;
const Q96 = 2n ** 96n;
const LOG_Q64 = Math.log(Number(Q64));
const LOG_ORCA_TICK_BASE = Math.log(1.0001);

const WHIRLPOOL_ACCOUNT_DISCM = Buffer.from([
  63, 149, 209, 12, 225, 128, 99, 9,
]);
const POSITION_ACCOUNT_DISCM = Buffer.from([
  170, 188, 143, 228, 122, 64, 247, 208,
]);
const WHIRLPOOL_MIN_LEN = 269 + 128 * 3;
const WHIRLPOOL_TICK_SPACING_OFFSET = 41;
const WHIRLPOOL_SQRT_PRICE_OFFSET = 65;
const WHIRLPOOL_TOKEN_MINT_A_OFFSET = 101;
const WHIRLPOOL_TOKEN_VAULT_A_OFFSET = 133;
const WHIRLPOOL_TOKEN_MINT_B_OFFSET = 181;
const WHIRLPOOL_TOKEN_VAULT_B_OFFSET = 213;
const WHIRLPOOL_REWARD_INFOS_OFFSET = 269;
const WHIRLPOOL_REWARD_INFO_SIZE = 128;
const WHIRLPOOL_REWARD_MINT_OFFSET = 0;
const WHIRLPOOL_REWARD_VAULT_OFFSET = 32;
const POSITION_MIN_LEN = 144;
const POSITION_WHIRLPOOL_OFFSET = 8;
const POSITION_MINT_OFFSET = 40;
const POSITION_LIQUIDITY_OFFSET = 72;
const POSITION_TICK_LOWER_INDEX_OFFSET = 88;
const POSITION_TICK_UPPER_INDEX_OFFSET = 92;

type WhirlpoolSnapshot = {
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tickSpacing: number;
  sqrtPrice: bigint;
};

type PositionSnapshot = {
  whirlpool: PublicKey;
  positionMint: PublicKey;
  liquidity: bigint;
  tickLowerIndex: number;
  tickUpperIndex: number;
};

type TxOptions = {
  yes?: boolean;
};

type ListedPosition = PositionSnapshot & {
  position: PublicKey;
};

type RemainingOptions = {
  remainingAccounts?: string;
  remainingAccountsInfo?: string;
};

type CommonTokenOptions = {
  tokenProgramA?: PublicKey;
  tokenProgramB?: PublicKey;
  memoProgram?: PublicKey;
};

type DerivedPositionOptions = RemainingOptions &
  CommonTokenOptions & {
    positionTokenAccount?: PublicKey;
    tokenOwnerAccountA?: PublicKey;
    tokenOwnerAccountB?: PublicKey;
    tickArrayLower?: PublicKey;
    tickArrayUpper?: PublicKey;
  };

function isSolDenominatedOracleSource(oracleSource: string): boolean {
  return oracleSource === "LstPoolState" || oracleSource === "MarinadeState";
}

function isUnsupportedPriceDeviationOracleSource(
  oracleSource: string,
): boolean {
  return oracleSource === "ChainlinkX" || oracleSource === "ChainlinkRWA";
}

function isKaminoReserveOracleSource(oracleSource: string): boolean {
  return oracleSource === "KaminoReserve";
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseInteger(
  value: string,
  label: string,
  min: number,
  max: number,
): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    fail(`${label} must be an integer`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(`${label} must be in range [${min}, ${max}]`);
  }
  return parsed;
}

function parseI32(value: string): number {
  return parseInteger(value, "value", I32_MIN, I32_MAX);
}

function parsePercent(value: string, label: string): number {
  const trimmed = value.trim();
  const pctText = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(pctText)) {
    fail(`${label} must be a percentage, e.g. -5% or +10%`);
  }

  const pct = Number(pctText);
  if (!Number.isFinite(pct)) {
    fail(`${label} must be a finite percentage`);
  }
  return pct;
}

function parseRangePct(value: string, label: string): number {
  const pct = parsePercent(value, label);
  if (pct <= -100) {
    fail(`${label} must be greater than -100%`);
  }
  return pct;
}

function parseLowerRangePct(value: string): number {
  return parseRangePct(value, "lower_range_pct");
}

function parseUpperRangePct(value: string): number {
  return parseRangePct(value, "upper_range_pct");
}

function parseReferencePrice(value: string): number {
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    fail("ref_price must be a positive number");
  }

  const price = Number(trimmed);
  if (!Number.isFinite(price) || price <= 0) {
    fail("ref_price must be greater than zero");
  }
  return price;
}

function validateRangePctOrder(lowerRangePct: number, upperRangePct: number) {
  if (upperRangePct <= lowerRangePct) {
    fail("upper_range_pct must be greater than lower_range_pct");
  }
}

function parseU8(value: string): number {
  return parseInteger(value, "value", 0, U8_MAX);
}

function parseMaxDeviationBps(value: string): number {
  return parseInteger(
    value,
    "max_deviation_bps",
    -BPS_DENOMINATOR,
    BPS_DENOMINATOR - 1,
  );
}

function parseBn(value: string, label: string, max: BN): BN {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }

  const parsed = new BN(trimmed);
  if (parsed.gt(max)) {
    fail(`${label} exceeds max value ${max.toString()}`);
  }
  return parsed;
}

function parseU64(value: string, label: string): BN {
  return parseBn(value, label, U64_MAX);
}

function parseU128(value: string, label: string): BN {
  return parseBn(value, label, U128_MAX);
}

function readKeypair(path: string): Keypair {
  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) {
      fail(`Keypair file ${path} must contain a JSON array`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch (error) {
    fail(`Failed to read keypair ${path}: ${(error as Error).message}`);
  }
}

function readPubkey(data: Buffer, offset: number, label: string): PublicKey {
  if (data.length < offset + 32) {
    fail(`${label} account data is too short`);
  }
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU128LE(data: Buffer, offset: number, label: string): bigint {
  if (data.length < offset + 16) {
    fail(`${label} account data is too short`);
  }

  let value = 0n;
  for (let i = 15; i >= 0; i--) {
    value = (value << 8n) + BigInt(data[offset + i]);
  }
  return value;
}

function assertDiscriminator(
  data: Buffer,
  discriminator: Buffer,
  label: string,
) {
  if (
    data.length < discriminator.length ||
    !data.subarray(0, 8).equals(discriminator)
  ) {
    fail(`Invalid ${label} account discriminator`);
  }
}

function hasDiscriminator(data: Buffer, discriminator: Buffer): boolean {
  return (
    data.length >= discriminator.length &&
    data.subarray(0, discriminator.length).equals(discriminator)
  );
}

function parsePositionSnapshot(data: Buffer): PositionSnapshot {
  assertDiscriminator(data, POSITION_ACCOUNT_DISCM, "Position");
  if (data.length < POSITION_MIN_LEN) {
    fail("Position account data is too short");
  }

  return {
    whirlpool: readPubkey(data, POSITION_WHIRLPOOL_OFFSET, "Position"),
    positionMint: readPubkey(data, POSITION_MINT_OFFSET, "Position"),
    liquidity: readU128LE(data, POSITION_LIQUIDITY_OFFSET, "Position"),
    tickLowerIndex: data.readInt32LE(POSITION_TICK_LOWER_INDEX_OFFSET),
    tickUpperIndex: data.readInt32LE(POSITION_TICK_UPPER_INDEX_OFFSET),
  };
}

async function fetchOwnedAccountData(
  context: CliContext,
  pubkey: PublicKey,
  minLen: number,
  discriminator: Buffer,
  label: string,
): Promise<Buffer> {
  const account = await context.glamClient.connection.getAccountInfo(pubkey);
  if (!account) {
    fail(`${label} account not found: ${pubkey}`);
  }
  if (!account.owner.equals(ORCA_WHIRLPOOLS_PROGRAM_ID)) {
    fail(
      `${label} account ${pubkey} is owned by ${account.owner}, expected ${ORCA_WHIRLPOOLS_PROGRAM_ID}`,
    );
  }
  if (account.data.length < minLen) {
    fail(`${label} account ${pubkey} data is too short`);
  }
  assertDiscriminator(account.data, discriminator, label);
  return account.data;
}

async function fetchWhirlpoolSnapshot(
  context: CliContext,
  whirlpool: PublicKey,
): Promise<WhirlpoolSnapshot> {
  const data = await fetchOwnedAccountData(
    context,
    whirlpool,
    WHIRLPOOL_MIN_LEN,
    WHIRLPOOL_ACCOUNT_DISCM,
    "Whirlpool",
  );

  return {
    tokenMintA: readPubkey(data, WHIRLPOOL_TOKEN_MINT_A_OFFSET, "Whirlpool"),
    tokenMintB: readPubkey(data, WHIRLPOOL_TOKEN_MINT_B_OFFSET, "Whirlpool"),
    tokenVaultA: readPubkey(data, WHIRLPOOL_TOKEN_VAULT_A_OFFSET, "Whirlpool"),
    tokenVaultB: readPubkey(data, WHIRLPOOL_TOKEN_VAULT_B_OFFSET, "Whirlpool"),
    tickSpacing: data.readUInt16LE(WHIRLPOOL_TICK_SPACING_OFFSET),
    sqrtPrice: readU128LE(data, WHIRLPOOL_SQRT_PRICE_OFFSET, "Whirlpool"),
  };
}

async function fetchPositionSnapshot(
  context: CliContext,
  position: PublicKey,
): Promise<PositionSnapshot> {
  const data = await fetchOwnedAccountData(
    context,
    position,
    POSITION_MIN_LEN,
    POSITION_ACCOUNT_DISCM,
    "Position",
  );

  return parsePositionSnapshot(data);
}

async function listOpenPositions(
  context: CliContext,
): Promise<ListedPosition[]> {
  const state = await context.glamClient.fetchStateAccount();
  const externalPositions = state.externalPositions ?? [];
  const positions: ListedPosition[] = [];
  const chunkSize = 100;

  for (let i = 0; i < externalPositions.length; i += chunkSize) {
    const chunk = externalPositions.slice(i, i + chunkSize);
    const accounts =
      await context.glamClient.connection.getMultipleAccountsInfo(chunk);

    accounts.forEach((account, index) => {
      if (
        !account ||
        !account.owner.equals(ORCA_WHIRLPOOLS_PROGRAM_ID) ||
        !hasDiscriminator(account.data, POSITION_ACCOUNT_DISCM)
      ) {
        return;
      }

      const snapshot = parsePositionSnapshot(account.data);
      positions.push({
        position: chunk[index],
        ...snapshot,
      });
    });
  }

  return positions;
}

async function fetchRewardInfo(
  context: CliContext,
  whirlpool: PublicKey,
  rewardIndex: number,
): Promise<{ rewardMint: PublicKey; rewardVault: PublicKey }> {
  if (rewardIndex < 0 || rewardIndex > 2) {
    fail("reward_index must be in range [0, 2]");
  }

  const data = await fetchOwnedAccountData(
    context,
    whirlpool,
    WHIRLPOOL_MIN_LEN,
    WHIRLPOOL_ACCOUNT_DISCM,
    "Whirlpool",
  );
  const offset =
    WHIRLPOOL_REWARD_INFOS_OFFSET + WHIRLPOOL_REWARD_INFO_SIZE * rewardIndex;
  return {
    rewardMint: readPubkey(
      data,
      offset + WHIRLPOOL_REWARD_MINT_OFFSET,
      "Whirlpool reward",
    ),
    rewardVault: readPubkey(
      data,
      offset + WHIRLPOOL_REWARD_VAULT_OFFSET,
      "Whirlpool reward",
    ),
  };
}

function getTickArrayStartIndex(
  tickIndex: number,
  tickSpacing: number,
): number {
  const span = tickSpacing * TICK_ARRAY_SIZE;
  return Math.floor(tickIndex / span) * span;
}

function minInitializableTick(tickSpacing: number): number {
  return Math.ceil(ORCA_MIN_TICK_INDEX / tickSpacing) * tickSpacing;
}

function maxInitializableTick(tickSpacing: number): number {
  return Math.floor(ORCA_MAX_TICK_INDEX / tickSpacing) * tickSpacing;
}

function alignTickDown(tickIndex: number, tickSpacing: number): number {
  return Math.floor(tickIndex / tickSpacing) * tickSpacing;
}

function alignTickUp(tickIndex: number, tickSpacing: number): number {
  return Math.ceil(tickIndex / tickSpacing) * tickSpacing;
}

function currentTickFromSqrtPrice(sqrtPrice: bigint): number {
  if (sqrtPrice <= 0n) {
    fail("Whirlpool sqrt_price must be greater than zero");
  }

  const sqrtPriceNumber = Number(sqrtPrice);
  if (!Number.isFinite(sqrtPriceNumber)) {
    fail(`Whirlpool sqrt_price is too large: ${sqrtPrice.toString()}`);
  }

  return (2 * (Math.log(sqrtPriceNumber) - LOG_Q64)) / LOG_ORCA_TICK_BASE;
}

async function tickFromUiReferencePrice(
  context: CliContext,
  whirlpool: WhirlpoolSnapshot,
  refPrice: number,
): Promise<number> {
  const [{ mint: mintA }, { mint: mintB }] = await Promise.all([
    fetchMintAndTokenProgram(
      context.glamClient.connection,
      whirlpool.tokenMintA,
    ),
    fetchMintAndTokenProgram(
      context.glamClient.connection,
      whirlpool.tokenMintB,
    ),
  ]);

  return (
    (Math.log(refPrice) + (mintB.decimals - mintA.decimals) * Math.log(10)) /
    LOG_ORCA_TICK_BASE
  );
}

function tickRangeFromPricePercentages(
  whirlpool: WhirlpoolSnapshot,
  lowerRangePct: number,
  upperRangePct: number,
  anchorTick = currentTickFromSqrtPrice(whirlpool.sqrtPrice),
): { tickLowerIndex: number; tickUpperIndex: number } {
  validateRangePctOrder(lowerRangePct, upperRangePct);

  const tickLowerTarget =
    anchorTick + Math.log1p(lowerRangePct / 100) / LOG_ORCA_TICK_BASE;
  const tickUpperTarget =
    anchorTick + Math.log1p(upperRangePct / 100) / LOG_ORCA_TICK_BASE;

  const minTick = minInitializableTick(whirlpool.tickSpacing);
  const maxTick = maxInitializableTick(whirlpool.tickSpacing);
  const tickLowerIndex = Math.max(
    minTick,
    alignTickDown(tickLowerTarget, whirlpool.tickSpacing),
  );
  const tickUpperIndex = Math.min(
    maxTick,
    alignTickUp(tickUpperTarget, whirlpool.tickSpacing),
  );

  if (tickLowerIndex >= tickUpperIndex) {
    fail(
      `Derived invalid tick range [${tickLowerIndex}, ${tickUpperIndex}); use a wider percentage range`,
    );
  }

  return { tickLowerIndex, tickUpperIndex };
}

function mulShift64(n0: bigint, n1: bigint): bigint {
  return (n0 * n1) / Q64;
}

function mulShift96(n0: bigint, n1: bigint): bigint {
  return (n0 * n1) / Q96;
}

function sqrtPriceFromTickIndex(tickIndex: number): bigint {
  if (tickIndex < ORCA_MIN_TICK_INDEX || tickIndex > ORCA_MAX_TICK_INDEX) {
    fail(
      `tick index must be in range [${ORCA_MIN_TICK_INDEX}, ${ORCA_MAX_TICK_INDEX}]`,
    );
  }

  return tickIndex >= 0
    ? sqrtPriceFromPositiveTick(tickIndex)
    : sqrtPriceFromNegativeTick(tickIndex);
}

function sqrtPriceFromPositiveTick(tick: number): bigint {
  let ratio =
    (tick & 1) !== 0
      ? 79232123823359799118286999567n
      : 79228162514264337593543950336n;

  if ((tick & 2) !== 0)
    ratio = mulShift96(ratio, 79236085330515764027303304731n);
  if ((tick & 4) !== 0)
    ratio = mulShift96(ratio, 79244008939048815603706035061n);
  if ((tick & 8) !== 0)
    ratio = mulShift96(ratio, 79259858533276714757314932305n);
  if ((tick & 16) !== 0)
    ratio = mulShift96(ratio, 79291567232598584799939703904n);
  if ((tick & 32) !== 0)
    ratio = mulShift96(ratio, 79355022692464371645785046466n);
  if ((tick & 64) !== 0)
    ratio = mulShift96(ratio, 79482085999252804386437311141n);
  if ((tick & 128) !== 0)
    ratio = mulShift96(ratio, 79736823300114093921829183326n);
  if ((tick & 256) !== 0)
    ratio = mulShift96(ratio, 80248749790819932309965073892n);
  if ((tick & 512) !== 0)
    ratio = mulShift96(ratio, 81282483887344747381513967011n);
  if ((tick & 1024) !== 0)
    ratio = mulShift96(ratio, 83390072131320151908154831281n);
  if ((tick & 2048) !== 0)
    ratio = mulShift96(ratio, 87770609709833776024991924138n);
  if ((tick & 4096) !== 0)
    ratio = mulShift96(ratio, 97234110755111693312479820773n);
  if ((tick & 8192) !== 0)
    ratio = mulShift96(ratio, 119332217159966728226237229890n);
  if ((tick & 16384) !== 0)
    ratio = mulShift96(ratio, 179736315981702064433883588727n);
  if ((tick & 32768) !== 0)
    ratio = mulShift96(ratio, 407748233172238350107850275304n);
  if ((tick & 65536) !== 0)
    ratio = mulShift96(ratio, 2098478828474011932436660412517n);
  if ((tick & 131072) !== 0)
    ratio = mulShift96(ratio, 55581415166113811149459800483533n);
  if ((tick & 262144) !== 0)
    ratio = mulShift96(ratio, 38992368544603139932233054999993551n);

  return ratio >> 32n;
}

function sqrtPriceFromNegativeTick(tick: number): bigint {
  const absTick = Math.abs(tick);
  let ratio =
    (absTick & 1) !== 0 ? 18445821805675392311n : 18446744073709551616n;

  if ((absTick & 2) !== 0) ratio = mulShift64(ratio, 18444899583751176498n);
  if ((absTick & 4) !== 0) ratio = mulShift64(ratio, 18443055278223354162n);
  if ((absTick & 8) !== 0) ratio = mulShift64(ratio, 18439367220385604838n);
  if ((absTick & 16) !== 0) ratio = mulShift64(ratio, 18431993317065449817n);
  if ((absTick & 32) !== 0) ratio = mulShift64(ratio, 18417254355718160513n);
  if ((absTick & 64) !== 0) ratio = mulShift64(ratio, 18387811781193591352n);
  if ((absTick & 128) !== 0) ratio = mulShift64(ratio, 18329067761203520168n);
  if ((absTick & 256) !== 0) ratio = mulShift64(ratio, 18212142134806087854n);
  if ((absTick & 512) !== 0) ratio = mulShift64(ratio, 17980523815641551639n);
  if ((absTick & 1024) !== 0) ratio = mulShift64(ratio, 17526086738831147013n);
  if ((absTick & 2048) !== 0) ratio = mulShift64(ratio, 16651378430235024244n);
  if ((absTick & 4096) !== 0) ratio = mulShift64(ratio, 15030750278693429944n);
  if ((absTick & 8192) !== 0) ratio = mulShift64(ratio, 12247334978882834399n);
  if ((absTick & 16384) !== 0) ratio = mulShift64(ratio, 8131365268884726200n);
  if ((absTick & 32768) !== 0) ratio = mulShift64(ratio, 3584323654723342297n);
  if ((absTick & 65536) !== 0) ratio = mulShift64(ratio, 696457651847595233n);
  if ((absTick & 131072) !== 0) ratio = mulShift64(ratio, 26294789957452057n);
  if ((absTick & 262144) !== 0) ratio = mulShift64(ratio, 37481735321082n);

  return ratio;
}

function deriveTickArray(
  context: CliContext,
  whirlpool: PublicKey,
  tickIndex: number,
  tickSpacing: number,
): PublicKey {
  return context.glamClient.orca.getTickArrayPda(
    whirlpool,
    getTickArrayStartIndex(tickIndex, tickSpacing),
  )[0];
}

async function tokenProgramsForWhirlpool(
  context: CliContext,
  whirlpool: WhirlpoolSnapshot,
  options: CommonTokenOptions,
): Promise<{ tokenProgramA: PublicKey; tokenProgramB: PublicKey }> {
  const tokenProgramA =
    options.tokenProgramA ??
    (
      await fetchMintAndTokenProgram(
        context.glamClient.connection,
        whirlpool.tokenMintA,
      )
    ).tokenProgram;
  const tokenProgramB =
    options.tokenProgramB ??
    (
      await fetchMintAndTokenProgram(
        context.glamClient.connection,
        whirlpool.tokenMintB,
      )
    ).tokenProgram;

  return { tokenProgramA, tokenProgramB };
}

async function derivePriceDeviationAccounts(
  context: CliContext,
  whirlpool: WhirlpoolSnapshot,
): Promise<OrcaPriceDeviationAccounts | undefined> {
  const policy = await fetchPolicy(context);
  if (!policy) {
    return undefined;
  }

  const [tokenAMeta, tokenBMeta] = await Promise.all([
    context.glamClient.getAssetMeta(whirlpool.tokenMintA),
    context.glamClient.getAssetMeta(whirlpool.tokenMintB),
  ]);
  if (
    isUnsupportedPriceDeviationOracleSource(tokenAMeta.oracleSource) ||
    isUnsupportedPriceDeviationOracleSource(tokenBMeta.oracleSource)
  ) {
    fail(
      "Orca max_deviation_bps does not support ChainlinkX or ChainlinkRWA oracles",
    );
  }

  const tokenAIsSolDenom = isSolDenominatedOracleSource(
    tokenAMeta.oracleSource,
  );
  const tokenBIsSolDenom = isSolDenominatedOracleSource(
    tokenBMeta.oracleSource,
  );
  const needsSolUsdOracle = tokenAIsSolDenom !== tokenBIsSolDenom;
  const solMeta = needsSolUsdOracle
    ? await context.glamClient.getAssetMeta(WSOL)
    : undefined;
  const oracleMetas = [tokenAMeta, tokenBMeta];
  if (solMeta) {
    oracleMetas.push(solMeta);
  }
  const kaminoReserves = Array.from(
    new PkSet(
      oracleMetas
        .filter((assetMeta) =>
          isKaminoReserveOracleSource(assetMeta.oracleSource),
        )
        .map((assetMeta) => assetMeta.oracle),
    ),
  );

  return {
    tokenMintAOracle: tokenAMeta.oracle,
    tokenMintBOracle: tokenBMeta.oracle,
    solUsdOracle: solMeta?.oracle,
    kaminoReserves: kaminoReserves.length ? kaminoReserves : undefined,
  };
}

async function deriveLiquidityAccounts(
  context: CliContext,
  position: PublicKey,
  options: DerivedPositionOptions,
): Promise<OrcaLiquidityV2Accounts> {
  const positionSnapshot = await fetchPositionSnapshot(context, position);
  const whirlpoolSnapshot = await fetchWhirlpoolSnapshot(
    context,
    positionSnapshot.whirlpool,
  );
  const { tokenProgramA, tokenProgramB } = await tokenProgramsForWhirlpool(
    context,
    whirlpoolSnapshot,
    options,
  );

  return {
    ...parseRemainingOptions(options),
    whirlpool: positionSnapshot.whirlpool,
    position,
    positionMint: positionSnapshot.positionMint,
    positionTokenAccount: options.positionTokenAccount,
    tokenMintA: whirlpoolSnapshot.tokenMintA,
    tokenMintB: whirlpoolSnapshot.tokenMintB,
    tokenOwnerAccountA: options.tokenOwnerAccountA,
    tokenOwnerAccountB: options.tokenOwnerAccountB,
    tokenVaultA: whirlpoolSnapshot.tokenVaultA,
    tokenVaultB: whirlpoolSnapshot.tokenVaultB,
    priceDeviationAccounts: await derivePriceDeviationAccounts(
      context,
      whirlpoolSnapshot,
    ),
    tickArrayLower:
      options.tickArrayLower ??
      deriveTickArray(
        context,
        positionSnapshot.whirlpool,
        positionSnapshot.tickLowerIndex,
        whirlpoolSnapshot.tickSpacing,
      ),
    tickArrayUpper:
      options.tickArrayUpper ??
      deriveTickArray(
        context,
        positionSnapshot.whirlpool,
        positionSnapshot.tickUpperIndex,
        whirlpoolSnapshot.tickSpacing,
      ),
    tokenProgramA,
    tokenProgramB,
    memoProgram: options.memoProgram,
  };
}

async function deriveUpdateFeesAndRewardsAccounts(
  context: CliContext,
  position: PublicKey,
  options: Pick<DerivedPositionOptions, "tickArrayLower" | "tickArrayUpper">,
): Promise<OrcaUpdateFeesAndRewardsAccounts> {
  const positionSnapshot = await fetchPositionSnapshot(context, position);
  const whirlpoolSnapshot = await fetchWhirlpoolSnapshot(
    context,
    positionSnapshot.whirlpool,
  );

  return {
    whirlpool: positionSnapshot.whirlpool,
    position,
    tickArrayLower:
      options.tickArrayLower ??
      deriveTickArray(
        context,
        positionSnapshot.whirlpool,
        positionSnapshot.tickLowerIndex,
        whirlpoolSnapshot.tickSpacing,
      ),
    tickArrayUpper:
      options.tickArrayUpper ??
      deriveTickArray(
        context,
        positionSnapshot.whirlpool,
        positionSnapshot.tickUpperIndex,
        whirlpoolSnapshot.tickSpacing,
      ),
  };
}

function loadJson(raw: string, label: string): unknown {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("@")
    ? fs.readFileSync(trimmed.slice(1), "utf8")
    : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    fail(`${label} must be valid JSON: ${(error as Error).message}`);
  }
}

function parseRemainingAccounts(raw: string): AccountMeta[] {
  const parsed = loadJson(raw, "remaining_accounts");
  if (!Array.isArray(parsed)) {
    fail("remaining_accounts must be a JSON array");
  }

  return parsed.map((entry, index) => {
    if (typeof entry === "string") {
      return {
        pubkey: validatePublicKey(entry),
        isSigner: false,
        isWritable: false,
      };
    }
    if (!entry || typeof entry !== "object") {
      fail(`remaining_accounts[${index}] must be a pubkey string or object`);
    }

    const meta = entry as {
      pubkey?: string;
      publicKey?: string;
      isSigner?: boolean;
      isWritable?: boolean;
    };
    const pubkey = meta.pubkey ?? meta.publicKey;
    if (!pubkey) {
      fail(`remaining_accounts[${index}] missing pubkey`);
    }

    return {
      pubkey: validatePublicKey(pubkey),
      isSigner: meta.isSigner ?? false,
      isWritable: meta.isWritable ?? false,
    };
  });
}

function parseRemainingOptions(
  options: RemainingOptions,
): OrcaV2RemainingAccounts {
  return {
    remainingAccounts: options.remainingAccounts
      ? parseRemainingAccounts(options.remainingAccounts)
      : undefined,
    remainingAccountsInfo: options.remainingAccountsInfo
      ? (loadJson(
          options.remainingAccountsInfo,
          "remaining_accounts_info",
        ) as never)
      : undefined,
  };
}

function addRemainingOptions(command: Command): Command {
  return command
    .option(
      "--remaining-accounts <json>",
      "JSON AccountMeta[] or @file, used with Orca v2 remaining account slices",
    )
    .option(
      "--remaining-accounts-info <json>",
      'JSON RemainingAccountsInfo or @file, e.g. {"slices":[...]}',
    );
}

function addCommonTokenOptions(command: Command): Command {
  return command
    .option(
      "--token-program-a <pubkey>",
      "Token program for token A",
      validatePublicKey,
    )
    .option(
      "--token-program-b <pubkey>",
      "Token program for token B",
      validatePublicKey,
    )
    .option(
      "--memo-program <pubkey>",
      "SPL Memo program override",
      validatePublicKey,
    );
}

function addLiquidityAccountOptions(command: Command): Command {
  return addRemainingOptions(addCommonTokenOptions(command))
    .option(
      "--position-token-account <pubkey>",
      "Vault-owned position token account",
      validatePublicKey,
    )
    .option(
      "--token-owner-account-a <pubkey>",
      "Vault token A account",
      validatePublicKey,
    )
    .option(
      "--token-owner-account-b <pubkey>",
      "Vault token B account",
      validatePublicKey,
    )
    .option(
      "--tick-array-lower <pubkey>",
      "Lower tick array override",
      validatePublicKey,
    )
    .option(
      "--tick-array-upper <pubkey>",
      "Upper tick array override",
      validatePublicKey,
    );
}

function printPolicy(policy: WhirlpoolsPolicy) {
  console.log(`Max deviation BPS: ${policy.maxDeviationBps}`);
  console.log("Whirlpools allowlist:");
  policy.whirlpoolsAllowlist.forEach((pk, i) => console.log(`[${i}] ${pk}`));
  console.log("Token mint allowlist:");
  policy.tokenMintsAllowlist.forEach((pk, i) => console.log(`[${i}] ${pk}`));
}

async function fetchPolicy(
  context: CliContext,
): Promise<WhirlpoolsPolicy | null> {
  return await context.glamClient.fetchProtocolPolicy(
    context.glamClient.extOrcaProgram.programId,
    ORCA_WHIRLPOOLS_PROTOCOL,
    WhirlpoolsPolicy,
  );
}

function defaultWhirlpoolsPolicy(): WhirlpoolsPolicy {
  return new WhirlpoolsPolicy([], [], 0);
}

async function setWhirlpoolsPolicy(
  context: CliContext,
  policy: WhirlpoolsPolicy,
  options: TxOptions,
  message: string,
  success: (txSig: string) => string,
) {
  await executeTxWithErrorHandling(
    () =>
      context.glamClient.orca.setWhirlpoolsPolicy(policy, context.txOptions),
    {
      skip: !!options.yes,
      message,
    },
    success,
  );
}

async function updatePolicy(
  context: CliContext,
  mutate: (policy: WhirlpoolsPolicy) => void,
  options: TxOptions,
  message: string,
  success: (txSig: string) => string,
) {
  const policy = (await fetchPolicy(context)) ?? defaultWhirlpoolsPolicy();
  mutate(policy);
  policy.whirlpoolsAllowlist = Array.from(
    new PkSet(policy.whirlpoolsAllowlist),
  );
  policy.tokenMintsAllowlist = Array.from(
    new PkSet(policy.tokenMintsAllowlist),
  );

  parseMaxDeviationBps(policy.maxDeviationBps.toString());

  await setWhirlpoolsPolicy(context, policy, options, message, success);
}

export function installOrcaCommands(orca: Command, context: CliContext) {
  orca.configureHelp({
    subcommandTerm: (cmd) => {
      const alias = cmd.alias();
      return `${cmd.name()}${alias ? `|${alias}` : ""}`;
    },
  });

  orca
    .command("view-policy")
    .description("View Orca Whirlpools policy")
    .action(async () => {
      const policy = await fetchPolicy(context);
      if (!policy) {
        console.log("No Orca Whirlpools policy found");
        return;
      }
      printPolicy(policy);
    });

  orca
    .command("set-policy")
    .option(
      "--whirlpools <pubkeys>",
      "Comma-separated Whirlpool allowlist",
      collectPublicKeys,
    )
    .option(
      "--token-mints <pubkeys>",
      "Comma-separated token mint allowlist",
      collectPublicKeys,
    )
    .option(
      "--max-deviation-bps <bps>",
      "Signed pool/oracle price deviation in basis points; negative requires a premium, 0 requires at least oracle",
      parseMaxDeviationBps,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Replace the full Orca Whirlpools policy")
    .action(
      async (
        options: TxOptions & {
          whirlpools?: PublicKey[];
          tokenMints?: PublicKey[];
          maxDeviationBps?: number;
        },
      ) => {
        const whirlpools = options.whirlpools ?? [];
        const tokenMints = options.tokenMints ?? [];

        for (const whirlpool of whirlpools) {
          const { tokenMintA, tokenMintB } = await fetchWhirlpoolSnapshot(
            context,
            whirlpool,
          );
          tokenMints.push(tokenMintA, tokenMintB);
        }

        const policy = new WhirlpoolsPolicy(
          whirlpools,
          Array.from(new PkSet(tokenMints)),
          options.maxDeviationBps ?? 0,
        );
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.orca.setWhirlpoolsPolicy(
              policy,
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: "Replace Orca Whirlpools policy?",
          },
          (txSig) => `Orca Whirlpools policy set: ${txSig}`,
        );
      },
    );

  orca
    .command("reset-policy")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Reset Orca Whirlpools policy to default")
    .action(async (options: TxOptions) => {
      await setWhirlpoolsPolicy(
        context,
        defaultWhirlpoolsPolicy(),
        options,
        "Reset Orca Whirlpools policy to default?",
        (txSig) => `Orca Whirlpools policy reset: ${txSig}`,
      );
    });

  orca
    .command("set-max-deviation-bps")
    .argument(
      "<bps>",
      "Signed pool/oracle price deviation; negative requires a premium, 0 requires at least oracle",
      parseMaxDeviationBps,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update Orca Whirlpools pool/oracle price deviation policy")
    .action(async (maxDeviationBps: number, options: TxOptions) => {
      await updatePolicy(
        context,
        (policy) => {
          policy.maxDeviationBps = maxDeviationBps;
        },
        options,
        `Set Orca max deviation to ${maxDeviationBps} bps?`,
        (txSig) => `Updated Orca max deviation policy: ${txSig}`,
      );
    });

  orca
    .command("setup-pool")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Allowlist a Whirlpool, allowlist its token mints, and add both mints to vault assets",
    )
    .action(async (whirlpool: PublicKey, options: TxOptions) => {
      const snapshot = await fetchWhirlpoolSnapshot(context, whirlpool);
      const state = await context.glamClient.fetchStateAccount();
      const assets = new PkSet([
        ...state.assets,
        snapshot.tokenMintA,
        snapshot.tokenMintB,
      ]);

      if (assets.size !== state.assets.length) {
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.state.update(
              { assets: Array.from(assets) },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Add Whirlpool mints ${snapshot.tokenMintA}, ${snapshot.tokenMintB} to vault assets?`,
          },
          (txSig) => `Vault assets updated for Orca pool: ${txSig}`,
        );
      }

      await updatePolicy(
        context,
        (policy) => {
          policy.whirlpoolsAllowlist.push(whirlpool);
          policy.tokenMintsAllowlist.push(
            snapshot.tokenMintA,
            snapshot.tokenMintB,
          );
        },
        options,
        `Allowlist Orca pool ${whirlpool} in policy?`,
        (txSig) => `Orca pool policy updated: ${txSig}`,
      );
    });

  orca
    .command("allowlist-whirlpool")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .option(
      "--no-token-mints",
      "Do not also allowlist the Whirlpool token mints",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a Whirlpool and its token mints to the policy allowlist")
    .action(
      async (
        whirlpool: PublicKey,
        options: TxOptions & { tokenMints?: boolean },
      ) => {
        const snapshot =
          options.tokenMints === false
            ? null
            : await fetchWhirlpoolSnapshot(context, whirlpool);
        await updatePolicy(
          context,
          (policy) => {
            policy.whirlpoolsAllowlist.push(whirlpool);
            if (snapshot) {
              policy.tokenMintsAllowlist.push(
                snapshot.tokenMintA,
                snapshot.tokenMintB,
              );
            }
          },
          options,
          `Allowlist Whirlpool ${whirlpool}?`,
          (txSig) => `Allowlisted Whirlpool ${whirlpool}: ${txSig}`,
        );
      },
    );

  orca
    .command("remove-whirlpool")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a Whirlpool from the policy allowlist")
    .action(async (whirlpool: PublicKey, options: TxOptions) => {
      await updatePolicy(
        context,
        (policy) => {
          policy.whirlpoolsAllowlist = policy.whirlpoolsAllowlist.filter(
            (pk) => !pk.equals(whirlpool),
          );
        },
        options,
        `Remove Whirlpool ${whirlpool} from allowlist?`,
        (txSig) => `Removed Whirlpool ${whirlpool}: ${txSig}`,
      );
    });

  orca
    .command("allowlist-token")
    .argument("<mint>", "Token mint", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a token mint to the policy allowlist")
    .action(async (mint: PublicKey, options: TxOptions) => {
      await updatePolicy(
        context,
        (policy) => policy.tokenMintsAllowlist.push(mint),
        options,
        `Allowlist token mint ${mint}?`,
        (txSig) => `Allowlisted token mint ${mint}: ${txSig}`,
      );
    });

  orca
    .command("remove-token")
    .argument("<mint>", "Token mint", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a token mint from the policy allowlist")
    .action(async (mint: PublicKey, options: TxOptions) => {
      await updatePolicy(
        context,
        (policy) => {
          policy.tokenMintsAllowlist = policy.tokenMintsAllowlist.filter(
            (pk) => !pk.equals(mint),
          );
        },
        options,
        `Remove token mint ${mint} from allowlist?`,
        (txSig) => `Removed token mint ${mint}: ${txSig}`,
      );
    });

  orca
    .command("list-positions")
    .alias("positions")
    .option("-j, --json", "Output in JSON format", false)
    .description("List open Orca positions held by the GLAM vault")
    .action(async (options: { json?: boolean }) => {
      const positions = await listOpenPositions(context);
      const rows = positions.map((position) => ({
        position: position.position.toBase58(),
        whirlpool: position.whirlpool.toBase58(),
        liquidity: position.liquidity.toString(),
        tickLowerIndex: position.tickLowerIndex,
        tickUpperIndex: position.tickUpperIndex,
      }));

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log("No open Orca positions found for the configured vault");
        return;
      }

      printTable(
        ["Position", "Whirlpool", "Liquidity", "Tick Lower", "Tick Upper"],
        rows.map((row) => [
          row.position,
          row.whirlpool,
          row.liquidity,
          row.tickLowerIndex.toString(),
          row.tickUpperIndex.toString(),
        ]),
      );
    });

  orca
    .command("position-pda")
    .argument("<position_mint>", "Position mint", validatePublicKey)
    .description("Derive an Orca position PDA")
    .action((positionMint: PublicKey) => {
      const [position, bump] =
        context.glamClient.orca.getPositionPda(positionMint);
      console.log(JSON.stringify({ position, bump }, null, 2));
    });

  orca
    .command("tick-array-pda")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .argument("<start_tick_index>", "Tick array start tick index", parseI32)
    .description("Derive an Orca tick-array PDA")
    .action((whirlpool: PublicKey, startTickIndex: number) => {
      const [tickArray, bump] = context.glamClient.orca.getTickArrayPda(
        whirlpool,
        startTickIndex,
      );
      console.log(JSON.stringify({ tickArray, bump }, null, 2));
    });

  orca
    .command("open-position")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .argument(
      "<lower_range_pct>",
      "Lower price range percentage; must be less than upper_range_pct",
      parseLowerRangePct,
    )
    .argument(
      "<upper_range_pct>",
      "Upper price range percentage; must be greater than lower_range_pct",
      parseUpperRangePct,
    )
    .argument(
      "[ref_price]",
      "Optional reference UI price anchor, token B per token A; defaults to current pool price",
      parseReferencePrice,
    )
    .option(
      "--ref-price <price>",
      "Reference UI price anchor, token B per token A; defaults to current pool price",
      parseReferencePrice,
    )
    .option(
      "--position-mint <pubkey>",
      "Position mint; omit to auto-generate",
      validatePublicKey,
    )
    .option("--position <pubkey>", "Position PDA override", validatePublicKey)
    .option(
      "--position-token-account <pubkey>",
      "Vault-owned position token account",
      validatePublicKey,
    )
    .option(
      "--position-mint-keypair <path>",
      "Optional keypair file for the new position mint signer",
    )
    .option(
      "--metadata-update-auth <pubkey>",
      "Metadata update authority override",
      validatePublicKey,
    )
    .option(
      "--without-token-metadata-extension",
      "Do not create Token-2022 metadata extension",
      false,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Open an Orca Token-2022 position for the vault")
    .action(
      async (
        whirlpool: PublicKey,
        lowerRangePct: number,
        upperRangePct: number,
        refPriceArg: number | undefined,
        options: TxOptions & {
          refPrice?: number;
          positionMint?: PublicKey;
          position?: PublicKey;
          positionTokenAccount?: PublicKey;
          positionMintKeypair?: string;
          metadataUpdateAuth?: PublicKey;
          withoutTokenMetadataExtension?: boolean;
        },
      ) => {
        validateRangePctOrder(lowerRangePct, upperRangePct);
        if (refPriceArg !== undefined && options.refPrice !== undefined) {
          fail("Use either positional ref_price or --ref-price, not both");
        }
        const refPrice = options.refPrice ?? refPriceArg;

        const whirlpoolSnapshot = await fetchWhirlpoolSnapshot(
          context,
          whirlpool,
        );
        const anchorTick =
          refPrice === undefined
            ? undefined
            : await tickFromUiReferencePrice(
                context,
                whirlpoolSnapshot,
                refPrice,
              );
        const { tickLowerIndex, tickUpperIndex } =
          tickRangeFromPricePercentages(
            whirlpoolSnapshot,
            lowerRangePct,
            upperRangePct,
            anchorTick,
          );
        const params: OpenOrcaPositionWithTokenExtensionsParams = {
          tickLowerIndex,
          tickUpperIndex,
          withTokenMetadataExtension: !options.withoutTokenMetadataExtension,
        };
        const providedPositionMintKeypair = options.positionMintKeypair
          ? readKeypair(options.positionMintKeypair)
          : undefined;
        if (options.positionMint && !providedPositionMintKeypair) {
          fail(
            "Provide --position-mint-keypair for --position-mint, or omit --position-mint to auto-generate",
          );
        }
        const positionMintKeypair =
          providedPositionMintKeypair ?? Keypair.generate();
        const positionMint =
          options.positionMint ?? positionMintKeypair.publicKey;
        const accounts: OpenOrcaPositionWithTokenExtensionsAccounts = {
          whirlpool,
          positionMint,
          position: options.position,
          positionTokenAccount: options.positionTokenAccount,
          metadataUpdateAuth: options.metadataUpdateAuth,
        };
        if (
          providedPositionMintKeypair &&
          !positionMintKeypair.publicKey.equals(positionMint)
        ) {
          fail(
            `Position mint keypair pubkey ${positionMintKeypair.publicKey} does not match ${positionMint}`,
          );
        }
        const position =
          options.position ??
          context.glamClient.orca.getPositionPda(positionMint)[0];

        await executeTxWithErrorHandling(
          async () => {
            const tx =
              await context.glamClient.orca.txBuilder.openPositionWithTokenExtensionsTx(
                params,
                accounts,
                context.txOptions,
              );
            return await context.glamClient.sendAndConfirm(tx, [
              positionMintKeypair,
            ]);
          },
          {
            skip: !!options.yes,
            message: `Open Orca position for ${whirlpool} with ticks [${tickLowerIndex}, ${tickUpperIndex}) from ${lowerRangePct}%/${upperRangePct}% price range anchored at ${refPrice === undefined ? "current pool price" : `ref price ${refPrice}`}?`,
          },
          (txSig) =>
            `Opened Orca position ${position} with mint ${positionMint} and ticks [${tickLowerIndex}, ${tickUpperIndex}): ${txSig}`,
        );
      },
    );

  orca
    .command("initialize-tick-array")
    .argument("<whirlpool>", "Whirlpool account", validatePublicKey)
    .argument("<start_tick_index>", "Tick array start tick index", parseI32)
    .option(
      "--tick-array <pubkey>",
      "Tick array PDA override",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Initialize an Orca tick array through the vault")
    .action(
      async (
        whirlpool: PublicKey,
        startTickIndex: number,
        options: TxOptions & { tickArray?: PublicKey },
      ) => {
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.orca.initializeTickArray(
              { startTickIndex },
              { whirlpool, tickArray: options.tickArray },
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Initialize tick array ${startTickIndex} for ${whirlpool}?`,
          },
          (txSig) => `Initialized Orca tick array: ${txSig}`,
        );
      },
    );

  addLiquidityAccountOptions(
    orca
      .command("increase-liquidity-v2")
      .argument("<position>", "Orca position account", validatePublicKey)
      .argument("<liquidity_amount>", "Liquidity amount")
      .argument("<token_max_a>", "Max token A amount")
      .argument("<token_max_b>", "Max token B amount")
      .option("-y, --yes", "Skip confirmation prompt", false)
      .description("Increase liquidity in an Orca position"),
  ).action(
    async (
      position: PublicKey,
      liquidityAmount: string,
      tokenMaxA: string,
      tokenMaxB: string,
      options: TxOptions & DerivedPositionOptions,
    ) => {
      const params: IncreaseOrcaLiquidityV2Params = {
        liquidityAmount: parseU128(liquidityAmount, "liquidity_amount"),
        tokenMaxA: parseU64(tokenMaxA, "token_max_a"),
        tokenMaxB: parseU64(tokenMaxB, "token_max_b"),
        ...parseRemainingOptions(options),
      };
      await executeTxWithErrorHandling(
        async () =>
          context.glamClient.orca.increaseLiquidityV2(
            params,
            await deriveLiquidityAccounts(context, position, options),
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Increase Orca liquidity for position ${position}?`,
        },
        (txSig) => `Increased Orca liquidity: ${txSig}`,
      );
    },
  );

  addLiquidityAccountOptions(
    orca
      .command("increase-liquidity-by-token-amounts-v2")
      .argument("<position>", "Orca position account", validatePublicKey)
      .argument("<token_max_a>", "Max token A amount")
      .argument("<token_max_b>", "Max token B amount")
      .option("-y, --yes", "Skip confirmation prompt", false)
      .description("Increase Orca liquidity by token amounts"),
  ).action(
    async (
      position: PublicKey,
      tokenMaxA: string,
      tokenMaxB: string,
      options: TxOptions & DerivedPositionOptions,
    ) => {
      const positionSnapshot = await fetchPositionSnapshot(context, position);
      const minSqrtPrice = sqrtPriceFromTickIndex(
        positionSnapshot.tickLowerIndex,
      );
      const maxSqrtPrice = sqrtPriceFromTickIndex(
        positionSnapshot.tickUpperIndex,
      );
      const params: IncreaseOrcaLiquidityByTokenAmountsV2Params = {
        method: {
          byTokenAmounts: {
            tokenMaxA: parseU64(tokenMaxA, "token_max_a"),
            tokenMaxB: parseU64(tokenMaxB, "token_max_b"),
            minSqrtPrice: new BN(minSqrtPrice.toString()),
            maxSqrtPrice: new BN(maxSqrtPrice.toString()),
          },
        },
        ...parseRemainingOptions(options),
      };
      await executeTxWithErrorHandling(
        async () =>
          context.glamClient.orca.increaseLiquidityByTokenAmountsV2(
            params,
            await deriveLiquidityAccounts(context, position, options),
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Increase Orca liquidity by token amounts for position ${position} using ticks [${positionSnapshot.tickLowerIndex}, ${positionSnapshot.tickUpperIndex})?`,
        },
        (txSig) => `Increased Orca liquidity by token amounts: ${txSig}`,
      );
    },
  );

  addLiquidityAccountOptions(
    orca
      .command("decrease-liquidity-v2")
      .argument("<position>", "Orca position account", validatePublicKey)
      .argument("<liquidity_amount>", "Liquidity amount")
      .argument("<token_min_a>", "Minimum token A amount")
      .argument("<token_min_b>", "Minimum token B amount")
      .option("-y, --yes", "Skip confirmation prompt", false)
      .description("Decrease liquidity in an Orca position"),
  ).action(
    async (
      position: PublicKey,
      liquidityAmount: string,
      tokenMinA: string,
      tokenMinB: string,
      options: TxOptions & DerivedPositionOptions,
    ) => {
      const params: DecreaseOrcaLiquidityV2Params = {
        liquidityAmount: parseU128(liquidityAmount, "liquidity_amount"),
        tokenMinA: parseU64(tokenMinA, "token_min_a"),
        tokenMinB: parseU64(tokenMinB, "token_min_b"),
        ...parseRemainingOptions(options),
      };
      await executeTxWithErrorHandling(
        async () =>
          context.glamClient.orca.decreaseLiquidityV2(
            params,
            await deriveLiquidityAccounts(context, position, options),
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Decrease Orca liquidity for position ${position}?`,
        },
        (txSig) => `Decreased Orca liquidity: ${txSig}`,
      );
    },
  );

  addRemainingOptions(
    addCommonTokenOptions(
      orca
        .command("reposition-liquidity-v2")
        .argument("<position>", "Orca position account", validatePublicKey)
        .argument("<new_tick_lower_index>", "New lower tick index", parseI32)
        .argument("<new_tick_upper_index>", "New upper tick index", parseI32)
        .argument("<new_liquidity_amount>", "New liquidity amount")
        .argument("<existing_range_token_min_a>", "Existing range min token A")
        .argument("<existing_range_token_min_b>", "Existing range min token B")
        .argument("<new_range_token_max_a>", "New range max token A")
        .argument("<new_range_token_max_b>", "New range max token B")
        .option(
          "--position-token-account <pubkey>",
          "Vault-owned position token account",
          validatePublicKey,
        )
        .option(
          "--token-owner-account-a <pubkey>",
          "Vault token A account",
          validatePublicKey,
        )
        .option(
          "--token-owner-account-b <pubkey>",
          "Vault token B account",
          validatePublicKey,
        )
        .option(
          "--existing-tick-array-lower <pubkey>",
          "Existing lower tick array override",
          validatePublicKey,
        )
        .option(
          "--existing-tick-array-upper <pubkey>",
          "Existing upper tick array override",
          validatePublicKey,
        )
        .option(
          "--new-tick-array-lower <pubkey>",
          "New lower tick array override",
          validatePublicKey,
        )
        .option(
          "--new-tick-array-upper <pubkey>",
          "New upper tick array override",
          validatePublicKey,
        )
        .option("-y, --yes", "Skip confirmation prompt", false)
        .description("Reposition an Orca liquidity position"),
    ),
  ).action(
    async (
      position: PublicKey,
      newTickLowerIndex: number,
      newTickUpperIndex: number,
      newLiquidityAmount: string,
      existingRangeTokenMinA: string,
      existingRangeTokenMinB: string,
      newRangeTokenMaxA: string,
      newRangeTokenMaxB: string,
      options: TxOptions &
        RemainingOptions &
        CommonTokenOptions & {
          positionTokenAccount?: PublicKey;
          tokenOwnerAccountA?: PublicKey;
          tokenOwnerAccountB?: PublicKey;
          existingTickArrayLower?: PublicKey;
          existingTickArrayUpper?: PublicKey;
          newTickArrayLower?: PublicKey;
          newTickArrayUpper?: PublicKey;
        },
    ) => {
      const positionSnapshot = await fetchPositionSnapshot(context, position);
      const whirlpoolSnapshot = await fetchWhirlpoolSnapshot(
        context,
        positionSnapshot.whirlpool,
      );
      const { tokenProgramA, tokenProgramB } = await tokenProgramsForWhirlpool(
        context,
        whirlpoolSnapshot,
        options,
      );
      const params: RepositionOrcaLiquidityV2Params = {
        newTickLowerIndex,
        newTickUpperIndex,
        method: {
          byLiquidity: {
            newLiquidityAmount: parseU128(
              newLiquidityAmount,
              "new_liquidity_amount",
            ),
            existingRangeTokenMinA: parseU64(
              existingRangeTokenMinA,
              "existing_range_token_min_a",
            ),
            existingRangeTokenMinB: parseU64(
              existingRangeTokenMinB,
              "existing_range_token_min_b",
            ),
            newRangeTokenMaxA: parseU64(
              newRangeTokenMaxA,
              "new_range_token_max_a",
            ),
            newRangeTokenMaxB: parseU64(
              newRangeTokenMaxB,
              "new_range_token_max_b",
            ),
          },
        },
        ...parseRemainingOptions(options),
      };
      const accounts: RepositionOrcaLiquidityV2Accounts = {
        ...parseRemainingOptions(options),
        whirlpool: positionSnapshot.whirlpool,
        position,
        positionMint: positionSnapshot.positionMint,
        positionTokenAccount: options.positionTokenAccount,
        tokenMintA: whirlpoolSnapshot.tokenMintA,
        tokenMintB: whirlpoolSnapshot.tokenMintB,
        tokenOwnerAccountA: options.tokenOwnerAccountA,
        tokenOwnerAccountB: options.tokenOwnerAccountB,
        tokenVaultA: whirlpoolSnapshot.tokenVaultA,
        tokenVaultB: whirlpoolSnapshot.tokenVaultB,
        priceDeviationAccounts: await derivePriceDeviationAccounts(
          context,
          whirlpoolSnapshot,
        ),
        existingTickArrayLower:
          options.existingTickArrayLower ??
          deriveTickArray(
            context,
            positionSnapshot.whirlpool,
            positionSnapshot.tickLowerIndex,
            whirlpoolSnapshot.tickSpacing,
          ),
        existingTickArrayUpper:
          options.existingTickArrayUpper ??
          deriveTickArray(
            context,
            positionSnapshot.whirlpool,
            positionSnapshot.tickUpperIndex,
            whirlpoolSnapshot.tickSpacing,
          ),
        newTickArrayLower:
          options.newTickArrayLower ??
          deriveTickArray(
            context,
            positionSnapshot.whirlpool,
            newTickLowerIndex,
            whirlpoolSnapshot.tickSpacing,
          ),
        newTickArrayUpper:
          options.newTickArrayUpper ??
          deriveTickArray(
            context,
            positionSnapshot.whirlpool,
            newTickUpperIndex,
            whirlpoolSnapshot.tickSpacing,
          ),
        tokenProgramA,
        tokenProgramB,
        memoProgram: options.memoProgram,
      };

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.orca.repositionLiquidityV2(
            params,
            accounts,
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Reposition Orca liquidity for position ${position}?`,
        },
        (txSig) => `Repositioned Orca liquidity: ${txSig}`,
      );
    },
  );

  orca
    .command("update-fees-and-rewards")
    .argument("<position>", "Position account", validatePublicKey)
    .option(
      "--tick-array-lower <pubkey>",
      "Lower tick array override",
      validatePublicKey,
    )
    .option(
      "--tick-array-upper <pubkey>",
      "Upper tick array override",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update fees and rewards on an Orca position")
    .action(
      async (
        position: PublicKey,
        options: TxOptions & {
          tickArrayLower?: PublicKey;
          tickArrayUpper?: PublicKey;
        },
      ) => {
        const accounts = await deriveUpdateFeesAndRewardsAccounts(
          context,
          position,
          options,
        );
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.orca.updateFeesAndRewards(
              accounts,
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Update Orca fees and rewards for position ${position}?`,
          },
          (txSig) => `Updated Orca fees and rewards: ${txSig}`,
        );
      },
    );

  addRemainingOptions(
    addCommonTokenOptions(
      orca
        .command("collect-fees-v2")
        .argument("<position>", "Orca position account", validatePublicKey)
        .option(
          "--position-token-account <pubkey>",
          "Vault-owned position token account",
          validatePublicKey,
        )
        .option(
          "--token-owner-account-a <pubkey>",
          "Vault token A account",
          validatePublicKey,
        )
        .option(
          "--token-owner-account-b <pubkey>",
          "Vault token B account",
          validatePublicKey,
        )
        .option("-y, --yes", "Skip confirmation prompt", false)
        .description("Collect fees from an Orca position"),
    ),
  ).action(
    async (
      position: PublicKey,
      options: TxOptions & DerivedPositionOptions,
    ) => {
      await executeTxWithErrorHandling(
        async () =>
          context.glamClient.orca.collectFeesV2(
            await deriveLiquidityAccounts(context, position, options),
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Collect Orca fees for position ${position}?`,
        },
        (txSig) => `Collected Orca fees: ${txSig}`,
      );
    },
  );

  addRemainingOptions(
    orca
      .command("collect-reward-v2")
      .argument("<position>", "Orca position account", validatePublicKey)
      .argument("<reward_index>", "Reward index", parseU8)
      .option(
        "--position-token-account <pubkey>",
        "Vault-owned position token account",
        validatePublicKey,
      )
      .option(
        "--reward-owner-account <pubkey>",
        "Vault reward token account",
        validatePublicKey,
      )
      .option(
        "--reward-token-program <pubkey>",
        "Reward token program",
        validatePublicKey,
      )
      .option(
        "--memo-program <pubkey>",
        "SPL Memo program override",
        validatePublicKey,
      )
      .option("-y, --yes", "Skip confirmation prompt", false)
      .description("Collect a reward from an Orca position"),
  ).action(
    async (
      position: PublicKey,
      rewardIndex: number,
      options: TxOptions &
        RemainingOptions & {
          positionTokenAccount?: PublicKey;
          rewardOwnerAccount?: PublicKey;
          rewardTokenProgram?: PublicKey;
          memoProgram?: PublicKey;
        },
    ) => {
      const positionSnapshot = await fetchPositionSnapshot(context, position);
      const { rewardMint, rewardVault } = await fetchRewardInfo(
        context,
        positionSnapshot.whirlpool,
        rewardIndex,
      );
      if (rewardMint.equals(PublicKey.default)) {
        fail(`Whirlpool reward ${rewardIndex} is not initialized`);
      }
      const rewardTokenProgram =
        options.rewardTokenProgram ??
        (
          await fetchMintAndTokenProgram(
            context.glamClient.connection,
            rewardMint,
          )
        ).tokenProgram;
      const accounts: CollectOrcaRewardV2Accounts = {
        ...parseRemainingOptions(options),
        whirlpool: positionSnapshot.whirlpool,
        position,
        positionMint: positionSnapshot.positionMint,
        positionTokenAccount: options.positionTokenAccount,
        rewardMint,
        rewardVault,
        rewardOwnerAccount: options.rewardOwnerAccount,
        rewardTokenProgram,
        memoProgram: options.memoProgram,
      };
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.orca.collectRewardV2(
            rewardIndex,
            accounts,
            context.txOptions,
          ),
        {
          skip: !!options.yes,
          message: `Collect Orca reward ${rewardIndex} for position ${position}?`,
        },
        (txSig) => `Collected Orca reward: ${txSig}`,
      );
    },
  );

  orca
    .command("close-position")
    .argument("<position>", "Position account", validatePublicKey)
    .option(
      "--position-token-account <pubkey>",
      "Vault-owned position token account",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Close a zero-liquidity Orca position")
    .action(
      async (
        position: PublicKey,
        options: TxOptions & { positionTokenAccount?: PublicKey },
      ) => {
        const positionSnapshot = await fetchPositionSnapshot(context, position);
        const accounts: OrcaPositionAccounts = {
          whirlpool: positionSnapshot.whirlpool,
          position,
          positionMint: positionSnapshot.positionMint,
          positionTokenAccount: options.positionTokenAccount,
        };
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.orca.closePositionWithTokenExtensions(
              accounts,
              context.txOptions,
            ),
          {
            skip: !!options.yes,
            message: `Close Orca position ${position}?`,
          },
          (txSig) => `Closed Orca position: ${txSig}`,
        );
      },
    );
}
