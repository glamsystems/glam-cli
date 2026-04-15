import { BN } from "@coral-xyz/anchor";
import {
  fetchMintAndTokenProgram,
  type StateModel,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import Decimal from "decimal.js";

import { type CliContext, executeTxWithErrorHandling } from "../utils";

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
  submitAllow: string[];
  validateAllow: string[];
  configureAllow: string[];
  tokenized?: boolean;
  disabled?: boolean;
  yes: boolean;
};

type ValidateOptions = {
  normalizedBaseAssetAmount?: string;
  yes: boolean;
};

type ParsedPosition = {
  positionId: number[];
  positionLabel: string;
};

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

function collectPublicKeys(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
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

  const mint = new PublicKey(options.mint);
  const { mint: mintAccount } = await fetchMintAndTokenProgram(
    context.glamClient.connection,
    mint,
  );

  return {
    decimals: mintAccount.decimals,
    label: mint.toBase58(),
    denomination: {
      denom: { mint: {} },
      mint,
    },
  };
}

async function fetchStateModel(context: CliContext): Promise<StateModel> {
  return await context.glamClient.fetchStateModel();
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
    .option("--mint <pubkey>", "mint address when --denom mint")
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
      const submitAllowlist = (options.submitAllow || []).map(
        (key) => new PublicKey(key),
      );
      const validateAllowlist = (options.validateAllow || []).map(
        (key) => new PublicKey(key),
      );
      const configureAllowlist = (options.configureAllow || []).map(
        (key) => new PublicKey(key),
      );

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
    .option("--mint <pubkey>", "mint address when --denom mint")
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
    .command("validate")
    .description(
      "Validate a pending observation for a tracked external position",
    )
    .argument(
      "<position>",
      "tracked external position pubkey, transfer record PDA, UTF-8 string id, or 32-byte encoded position id",
    )
    .option(
      "--normalized-base-asset-amount <amount>",
      "signed UI amount in the vault base asset; omit to submit None",
    )
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (position: string, options: ValidateOptions) => {
      const { positionId, positionLabel } = parsePosition(position);
      const stateModel = await fetchStateModel(context);
      const normalizedBaseAssetAmount =
        options.normalizedBaseAssetAmount === undefined
          ? null
          : parseSignedUiAmount(
              options.normalizedBaseAssetAmount,
              stateModel.baseAssetDecimals,
              "--normalized-base-asset-amount",
            );
      const normalizedAmountLabel =
        options.normalizedBaseAssetAmount === undefined
          ? "None"
          : `${options.normalizedBaseAssetAmount} ${stateModel.baseAssetMint.toBase58()}`;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.epi.validateExternalObservation(
            positionId,
            normalizedBaseAssetAmount,
            context.txOptions,
          ),
        {
          skip: options.yes,
          message: `Confirm validating observation for ${positionLabel} with normalized base asset amount ${normalizedAmountLabel}?`,
        },
        (txSig) => `Observation validated: ${txSig}`,
      );
    });
}
