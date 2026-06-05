import { BN } from "@coral-xyz/anchor";
import {
  HYPEREVM_NAV_ADAPTER_V2_EMITTER,
  U8_MAX,
  U16_MAX,
  U32_MAX,
  evmAddressToBytes20,
  parseWormholeSignedVaa,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import Decimal from "decimal.js";

import {
  type CliContext,
  collectPublicKeys,
  executeTxWithErrorHandling,
  resolveTokenMint,
} from "../utils";

type SubmitOptions = {
  denom: string;
  mint?: string;
  timestamp?: string;
  externalShares?: string;
  yes: boolean;
};

type UpsertPositionOptions = {
  denom: string;
  mint?: string;
  freshnessSecs?: string;
  submitAllow: PublicKey[];
  validateAllow: PublicKey[];
  configureAllow: PublicKey[];
  tokenized?: boolean;
  disabled?: boolean;
  yes: boolean;
};

type UpsertWormholePositionOptions = {
  freshnessSecs?: string;
  submitAllow: PublicKey[];
  validateAllow: PublicKey[];
  configureAllow: PublicKey[];
  disabled?: boolean;
  yes: boolean;
};

type UpsertWormholeConfigOptions = {
  emitterChain: string;
  emitterAddress: string;
  payloadVersion: string;
  payloadType: string;
  maxAgeSeconds: string;
  yes: boolean;
};

type UpsertHyperliquidConfigOptions = {
  hyperliquidAccount: string;
  accountMarginSummaryPrecompile: string;
  spotBalancePrecompile: string;
  perpDexIndex: string;
  usdcSpotToken: string;
  yes: boolean;
};

type SubmitWormholeOptions = {
  maxSignaturesPerPost: string;
  guardianSet?: string;
  wormholeCoreBridgeProgram?: string;
  wormholeVerifyVaaShimProgram?: string;
  yes: boolean;
};

type RemovePositionOptions = {
  yes: boolean;
};

type ValidateOptions = {
  yes: boolean;
};

type ParsedPosition = {
  positionId: number[];
  positionLabel: string;
};

const HYPEREVM_WORMHOLE_CHAIN_ID = 47;
const HYPERLIQUID_NAV_PAYLOAD_VERSION = 2;
const HYPERLIQUID_NAV_PAYLOAD_TYPE = 2;
const ACCOUNT_MARGIN_SUMMARY_PRECOMPILE =
  "0x000000000000000000000000000000000000080F";
const SPOT_BALANCE_PRECOMPILE =
  "0x0000000000000000000000000000000000000801";
const usdDenomination = {
  denom: { usd: {} },
  mint: PublicKey.default,
} as const;

function parseHexOrBase64Bytes(value: string, label: string): Buffer {
  const normalized = value.trim();
  const bytes = normalized.startsWith("0x")
    ? Buffer.from(normalized.slice(2), "hex")
    : /^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0
      ? Buffer.from(normalized, "hex")
      : Buffer.from(normalized, "base64");

  if (bytes.length === 0) {
    throw new Error(`${label} could not be parsed as hex or base64`);
  }

  return bytes;
}

function parseFixedBytes(value: string, length: number, label: string): number[] {
  const bytes = parseHexOrBase64Bytes(value, label);
  if (bytes.length !== length) {
    throw new Error(`${label} must be exactly ${length} bytes`);
  }
  return Array.from(bytes);
}

function parseBytes20(value: string, label: string): number[] {
  try {
    return evmAddressToBytes20(value);
  } catch {
    return parseFixedBytes(value, 20, label);
  }
}

function parseWormholeEmitterAddress(value: string): number[] {
  const bytes = parseHexOrBase64Bytes(value, "--emitter-address");
  if (bytes.length === 32) {
    return Array.from(bytes);
  }
  if (bytes.length === 20) {
    return [...new Array(12).fill(0), ...Array.from(bytes)];
  }

  throw new Error("--emitter-address must be either 20 or 32 bytes");
}

function validateHyperliquidSignedVaa(
  signedVaa: Buffer,
  positionId: number[],
) {
  const parsed = parseWormholeSignedVaa(signedVaa);
  if (parsed.vaaBody.length < 51 + 38) {
    throw new Error("signed VAA body is too short for a GLAM Wormhole payload");
  }

  const payload = parsed.vaaBody.subarray(51);
  const magic = payload.subarray(0, 4).toString("ascii");
  if (magic !== "GLAM") {
    throw new Error(`Unexpected Wormhole payload magic: ${magic}`);
  }

  const version = payload.readUInt8(4);
  const payloadType = payload.readUInt8(5);
  if (
    version !== HYPERLIQUID_NAV_PAYLOAD_VERSION ||
    payloadType !== HYPERLIQUID_NAV_PAYLOAD_TYPE
  ) {
    throw new Error(
      `Unsupported GLAM Wormhole payload version/type: ${version}/${payloadType}`,
    );
  }

  const payloadPositionId = payload.subarray(6, 38);
  const expectedPositionId = Buffer.from(positionId);
  if (!payloadPositionId.equals(expectedPositionId)) {
    throw new Error(
      `VAA position id ${payloadPositionId.toString("hex")} does not match CLI position ${expectedPositionId.toString("hex")}`,
    );
  }
}

function encodePositionIdString(value: string): number[] {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0) {
    throw new Error("position must not be empty");
  }
  if (bytes.length > 32) {
    throw new Error(
      "position must be a pubkey, exactly 32 decoded bytes, or a UTF-8 string up to 32 bytes",
    );
  }

  const encoded = Buffer.alloc(32);
  bytes.copy(encoded);
  return Array.from(encoded);
}

export function parsePositionId(value: string): number[] {
  const normalized = value.trim();

  try {
    return Array.from(new PublicKey(normalized).toBytes());
  } catch {
    try {
      const bytes = parseHexOrBase64Bytes(normalized, "position");
      if (bytes.length === 32) {
        return Array.from(bytes);
      }
    } catch {}

    return encodePositionIdString(normalized);
  }
}

function formatPositionLabel(value: string, positionId: number[]): string {
  const normalized = value.trim();

  try {
    new PublicKey(normalized);
    return formatPositionId(positionId);
  } catch {}

  try {
    const bytes = parseHexOrBase64Bytes(normalized, "position");
    if (bytes.length === 32) {
      return formatPositionId(positionId);
    }
  } catch {}

  return `${JSON.stringify(normalized)} (${formatPositionId(positionId)})`;
}

function parsePosition(value: string): ParsedPosition {
  const positionId = parsePositionId(value);
  return {
    positionId,
    positionLabel: formatPositionLabel(value, positionId),
  };
}

function formatPositionId(positionId: number[]): string {
  return new PublicKey(Uint8Array.from(positionId)).toBase58();
}

function parseSignedInteger(value: string, label: string): BN {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer`);
  }
  return new BN(normalized, 10);
}

function parseUnsignedInteger(value: string, label: string): BN {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return new BN(normalized, 10);
}

function parseUnsignedNumber(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(normalized);
}

function parseBoundedUnsignedNumber(
  value: string,
  label: string,
  max: number,
): number {
  const parsed = parseUnsignedNumber(value, label);
  if (parsed > max) {
    throw new Error(`${label} must be at most ${max}`);
  }
  return parsed;
}

function parseSignedUiAmount(
  value: string,
  decimals: number,
  label: string,
): BN {
  const scale = new Decimal(10).pow(decimals);
  const scaled = new Decimal(value).mul(scale);

  if (!scaled.isFinite()) {
    throw new Error(`${label} must be a finite number`);
  }

  if (!scaled.isInteger()) {
    throw new Error(
      `${label} has too many decimal places for ${decimals}-decimal precision`,
    );
  }

  return new BN(scaled.toFixed(0), 10);
}

async function resolveDenomination(
  context: CliContext,
  options: SubmitOptions,
): Promise<{
  decimals: number;
  label: string;
  denomination: {
    denom: { usd: Record<string, never> } | { mint: Record<string, never> };
    mint: PublicKey;
  };
}> {
  const denom = options.denom.toLowerCase();

  if (denom === "usd") {
    if (options.mint) {
      throw new Error("--mint is only valid with --denom mint");
    }

    return {
      decimals: 6,
      label: "USD",
      denomination: {
        denom: { usd: {} },
        mint: PublicKey.default,
      },
    };
  }

  if (denom !== "mint") {
    throw new Error(
      `Unsupported denomination: ${options.denom}. Use usd or mint.`,
    );
  }

  if (!options.mint) {
    throw new Error("--mint is required when --denom mint");
  }

  const token = await resolveTokenMint(context.glamClient, options.mint);
  const mint = new PublicKey(token.address);

  return {
    decimals: token.decimals,
    label: token.symbol,
    denomination: {
      denom: { mint: {} },
      mint,
    },
  };
}

export function installEpiCommands(program: Command, context: CliContext) {
  program
    .command("upsert-position")
    .description(
      "Create or update a tracked external position, including bridge transfer record PDAs",
    )
    .argument(
      "<position>",
      "tracked external position pubkey, transfer record PDA, UTF-8 string id, or 32-byte encoded position id",
    )
    .option("--denom <denom>", "observation denomination: usd or mint", "usd")
    .option("--mint <token>", "mint address or symbol when --denom mint")
    .option(
      "--freshness-secs <u32>",
      "freshness override in seconds, defaults to 0",
      "0",
    )
    .option(
      "--submit-allow <pubkey>",
      "repeatable submit allowlist entry",
      collectPublicKeys,
      [],
    )
    .option(
      "--validate-allow <pubkey>",
      "repeatable validate allowlist entry",
      collectPublicKeys,
      [],
    )
    .option(
      "--configure-allow <pubkey>",
      "repeatable configure allowlist entry",
      collectPublicKeys,
      [],
    )
    .option("--tokenized", "create as tokenized instead of valued", false)
    .option("--disabled", "upsert with enabled=false", false)
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (position: string, options: UpsertPositionOptions) => {
      const { positionId, positionLabel } = parsePosition(position);
      const { denomination, label } = await resolveDenomination(context, {
        denom: options.denom,
        mint: options.mint,
        yes: options.yes,
      });
      const freshnessOverrideSecs = parseUnsignedNumber(
        options.freshnessSecs || "0",
        "--freshness-secs",
      );
      const submitAllowlist = options.submitAllow || [];
      const validateAllowlist = options.validateAllow || [];
      const configureAllowlist = options.configureAllow || [];

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.epi.upsertExternalPosition(
            {
              positionId,
              positionType: options.tokenized
                ? { tokenized: {} }
                : { valued: {} },
              sourceType: { trusted: {} },
              denomination,
              enabled: !options.disabled,
              freshnessOverrideSecs,
              submitAllowlist,
              validateAllowlist,
              configureAllowlist,
            },
            context.txOptions,
          ),
        {
          skip: options.yes,
          message: `Confirm upserting EPI position ${positionLabel} with denomination ${label}?`,
        },
        (txSig) => `EPI position upserted: ${txSig}`,
      );
    });

  program
    .command("upsert-wormhole-position")
    .description(
      "Create or update a Wormhole-sourced USD valued external position",
    )
    .argument(
      "<position>",
      "tracked external position pubkey, UTF-8 string id, or 32-byte encoded position id",
    )
    .option(
      "--freshness-secs <u32>",
      "freshness override in seconds, defaults to 0",
      "0",
    )
    .option(
      "--submit-allow <pubkey>",
      "repeatable submit allowlist entry",
      collectPublicKeys,
      [],
    )
    .option(
      "--validate-allow <pubkey>",
      "repeatable validate allowlist entry",
      collectPublicKeys,
      [],
    )
    .option(
      "--configure-allow <pubkey>",
      "repeatable configure allowlist entry",
      collectPublicKeys,
      [],
    )
    .option("--disabled", "upsert with enabled=false", false)
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (position: string, options: UpsertWormholePositionOptions) => {
        const { positionId, positionLabel } = parsePosition(position);
        const freshnessOverrideSecs = parseUnsignedNumber(
          options.freshnessSecs || "0",
          "--freshness-secs",
        );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.epi.upsertExternalPosition(
              {
                positionId,
                positionType: { valued: {} },
                sourceType: { wormhole: {} },
                denomination: usdDenomination,
                enabled: !options.disabled,
                freshnessOverrideSecs,
                submitAllowlist: options.submitAllow || [],
                validateAllowlist: options.validateAllow || [],
                configureAllowlist: options.configureAllow || [],
              },
              context.txOptions,
            ),
          {
            skip: options.yes,
            message: `Confirm upserting Wormhole EPI position ${positionLabel} with denomination USD?`,
          },
          (txSig) => `Wormhole EPI position upserted: ${txSig}`,
        );
      },
    );

  program
    .command("upsert-wormhole-config")
    .description("Create or update the generic Wormhole observation config")
    .argument(
      "<position>",
      "tracked external position pubkey, UTF-8 string id, or 32-byte encoded position id",
    )
    .option(
      "--emitter-chain <u16>",
      "Wormhole emitter chain id",
      String(HYPEREVM_WORMHOLE_CHAIN_ID),
    )
    .option(
      "--emitter-address <bytes>",
      "Wormhole emitter address as 32 bytes, or EVM adapter address as 20 bytes",
      HYPEREVM_NAV_ADAPTER_V2_EMITTER,
    )
    .option(
      "--payload-version <u8>",
      "Wormhole payload version",
      String(HYPERLIQUID_NAV_PAYLOAD_VERSION),
    )
    .option(
      "--payload-type <u8>",
      "Wormhole payload type",
      String(HYPERLIQUID_NAV_PAYLOAD_TYPE),
    )
    .option("--max-age-seconds <u32>", "observation freshness window", "90")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (position: string, options: UpsertWormholeConfigOptions) => {
      const { positionId, positionLabel } = parsePosition(position);
      const emitterChain = parseBoundedUnsignedNumber(
        options.emitterChain,
        "--emitter-chain",
        U16_MAX,
      );
      const payloadVersion = parseBoundedUnsignedNumber(
        options.payloadVersion,
        "--payload-version",
        U8_MAX,
      );
      const payloadType = parseBoundedUnsignedNumber(
        options.payloadType,
        "--payload-type",
        U8_MAX,
      );
      const maxAgeSeconds = parseBoundedUnsignedNumber(
        options.maxAgeSeconds,
        "--max-age-seconds",
        U32_MAX,
      );

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.epi.upsertExternalPositionWormholeConfig(
            {
              positionId,
              emitterChain,
              emitterAddress: parseWormholeEmitterAddress(
                options.emitterAddress,
              ),
              payloadVersion,
              payloadType,
              maxAgeSeconds,
            },
            context.txOptions,
          ),
        {
          skip: options.yes,
          message: `Confirm upserting Wormhole config for ${positionLabel}?`,
        },
        (txSig) => `Wormhole config upserted: ${txSig}`,
      );
    });

  program
    .command("remove-position")
    .description("Remove a tracked external position from EPI")
    .argument(
      "<position>",
      "tracked external position pubkey, UTF-8 string id, or 32-byte encoded position id",
    )
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (position: string, options: RemovePositionOptions) => {
      const { positionId, positionLabel } = parsePosition(position);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.epi.removeExternalPosition(
            positionId,
            context.txOptions,
          ),
        {
          skip: options.yes,
          message: `Confirm removing EPI position ${positionLabel}?`,
        },
        (txSig) => `EPI position removed: ${txSig}`,
      );
    });

  program
    .command("upsert-hyperliquid-config")
    .description("Create or update the Hyperliquid Wormhole payload config")
    .argument(
      "<position>",
      "tracked external position pubkey, UTF-8 string id, or 32-byte encoded position id",
    )
    .requiredOption(
      "--hyperliquid-account <address>",
      "Hyperliquid account as a 20-byte EVM address",
    )
    .option(
      "--account-margin-summary-precompile <address>",
      "HyperEVM account margin summary precompile",
      ACCOUNT_MARGIN_SUMMARY_PRECOMPILE,
    )
    .option(
      "--spot-balance-precompile <address>",
      "HyperEVM spot balance precompile",
      SPOT_BALANCE_PRECOMPILE,
    )
    .option("--perp-dex-index <u32>", "Hyperliquid perp DEX index", "0")
    .option("--usdc-spot-token <u64>", "Hyperliquid USDC spot token", "0")
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (position: string, options: UpsertHyperliquidConfigOptions) => {
        const { positionId, positionLabel } = parsePosition(position);
        const perpDexIndex = parseBoundedUnsignedNumber(
          options.perpDexIndex,
          "--perp-dex-index",
          U32_MAX,
        );
        const usdcSpotToken = parseUnsignedInteger(
          options.usdcSpotToken,
          "--usdc-spot-token",
        );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.epi.upsertExternalPositionWormholeHyperliquidConfig(
              {
                positionId,
                hyperliquidAccount: parseBytes20(
                  options.hyperliquidAccount,
                  "--hyperliquid-account",
                ),
                accountMarginSummaryPrecompile: parseBytes20(
                  options.accountMarginSummaryPrecompile,
                  "--account-margin-summary-precompile",
                ),
                spotBalancePrecompile: parseBytes20(
                  options.spotBalancePrecompile,
                  "--spot-balance-precompile",
                ),
                perpDexIndex,
                usdcSpotToken,
              },
              context.txOptions,
            ),
          {
            skip: options.yes,
            message: `Confirm upserting Hyperliquid Wormhole config for ${positionLabel}?`,
          },
          (txSig) => `Hyperliquid Wormhole config upserted: ${txSig}`,
        );
      },
    );

  program
    .command("submit")
    .description(
      "Submit an observation for a tracked external position or transfer record PDA",
    )
    .argument(
      "<position>",
      "tracked external position pubkey, transfer record PDA, UTF-8 string id, or 32-byte encoded position id",
    )
    .argument(
      "<amount>",
      "signed UI amount in the specified observation denomination",
    )
    .option("--denom <denom>", "observation denomination: usd or mint", "usd")
    .option("--mint <token>", "mint address or symbol when --denom mint")
    .option(
      "--timestamp <unix-seconds>",
      "observation unix timestamp, defaults to now",
    )
    .option(
      "--external-shares <raw-u64>",
      "external shares for tokenized positions, defaults to 0",
      "0",
    )
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (position: string, amount: string, options: SubmitOptions) => {
        const { positionId, positionLabel } = parsePosition(position);
        const { denomination, decimals, label } = await resolveDenomination(
          context,
          options,
        );
        const observationTimestamp =
          options.timestamp !== undefined
            ? parseSignedInteger(options.timestamp, "--timestamp")
            : new BN(Math.floor(Date.now() / 1000));
        const externalShares = parseUnsignedInteger(
          options.externalShares || "0",
          "--external-shares",
        );
        const amountBn = parseSignedUiAmount(amount, decimals, "amount");

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.epi.submitExternalObservation(
              {
                positionId,
                amount: amountBn,
                denomination,
                observationTimestamp,
                externalShares,
              },
              context.txOptions,
            ),
          {
            skip: options.yes,
            message: `Confirm submitting observation for ${positionLabel}: ${amount} ${label}?`,
          },
          (txSig) => `Observation submitted: ${txSig}`,
        );
      },
    );

  program
    .command("submit-wormhole")
    .description("Submit a Wormhole Guardian-verified external observation")
    .argument(
      "<position>",
      "tracked external position pubkey, UTF-8 string id, or 32-byte encoded position id",
    )
    .argument("<signed-vaa>", "signed VAA as hex or base64")
    .option(
      "--max-signatures-per-post <count>",
      "maximum Guardian signatures per post-signatures transaction",
      "13",
    )
    .option(
      "--guardian-set <pubkey>",
      "override GuardianSet account; normally derived from the VAA",
    )
    .option(
      "--wormhole-core-bridge-program <pubkey>",
      "override Wormhole Core Bridge program for GuardianSet PDA derivation",
    )
    .option(
      "--wormhole-verify-vaa-shim-program <pubkey>",
      "override Wormhole Verification Shim program",
    )
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (
        position: string,
        signedVaa: string,
        options: SubmitWormholeOptions,
      ) => {
        const { positionId, positionLabel } = parsePosition(position);
        const maxSignaturesPerPost = parseUnsignedNumber(
          options.maxSignaturesPerPost || "13",
          "--max-signatures-per-post",
        );
        const signedVaaBytes = parseHexOrBase64Bytes(signedVaa, "signed-vaa");
        validateHyperliquidSignedVaa(signedVaaBytes, positionId);

        await executeTxWithErrorHandling(
          async () => {
            const result =
              await context.glamClient.epi.submitExternalObservationWormhole(
                {
                  positionId,
                  signedVaa: signedVaaBytes,
                  guardianSet: options.guardianSet
                    ? new PublicKey(options.guardianSet)
                    : undefined,
                  wormholeCoreBridgeProgram: options.wormholeCoreBridgeProgram
                    ? new PublicKey(options.wormholeCoreBridgeProgram)
                    : undefined,
                  wormholeVerifyVaaShimProgram:
                    options.wormholeVerifyVaaShimProgram
                      ? new PublicKey(options.wormholeVerifyVaaShimProgram)
                      : undefined,
                  maxSignaturesPerPost,
                },
                context.txOptions,
              );

            return [
              `Guardian signatures account: ${result.guardianSignatures.toBase58()} (closed in submit tx)`,
              ...result.postSignatureTxs.map(
                (txSig, index) => `Post signatures tx ${index + 1}: ${txSig}`,
              ),
              `Wormhole observation submitted: ${result.submitTx}`,
            ].join("\n");
          },
          {
            skip: options.yes,
            message: `Confirm submitting Wormhole observation for ${positionLabel}?`,
          },
          (message) => message,
        );
      },
    );

  program
    .command("validate")
    .description(
      "Validate a pending observation for a tracked external position",
    )
    .argument(
      "<position>",
      "tracked external position pubkey, transfer record PDA, UTF-8 string id, or 32-byte encoded position id",
    )
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (position: string, options: ValidateOptions) => {
      const { positionId, positionLabel } = parsePosition(position);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.epi.validateExternalObservation(
            positionId,
            context.txOptions,
          ),
        {
          skip: options.yes,
          message: `Confirm validating observation for ${positionLabel}?`,
        },
        (txSig) => `Observation validated: ${txSig}`,
      );
    });
}
