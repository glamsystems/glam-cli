import { BN } from "@coral-xyz/anchor";
import {
  fromUiAmount,
  U8_MAX,
  U16_MAX,
  U32_MAX,
  U64_MAX_BN,
  U128_MAX_BN,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";

import { fail } from "./errors";

export type ArrayInput = string | readonly string[] | null | undefined;

function labelOrValue(value: unknown, label?: string): string {
  return label ?? String(value);
}

export function parseArrayInput(input: ArrayInput): string[] {
  const rawValues: readonly string[] =
    input === null || input === undefined
      ? []
      : Array.isArray(input)
        ? input
        : [input];

  return rawValues.flatMap((value) =>
    value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

export function parseRequiredArrayInput(
  input: ArrayInput,
  label: string,
): string[] {
  const parts = parseArrayInput(input);
  if (parts.length === 0) {
    fail(`${label} must contain at least one value`);
  }
  return parts;
}

export function collectArrayValues(
  value: string,
  previous: string[] = [],
): string[] {
  return [...previous, ...parseArrayInput(value)];
}

export function parseInteger(
  value: string,
  label: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
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

export function parseUnsignedNumber(
  value: string | undefined,
  label = "value",
  max: number = Number.MAX_SAFE_INTEGER,
  defaultValue?: string | number,
): number {
  const raw = value === undefined ? defaultValue : value;
  const trimmed = raw === undefined ? "" : `${raw}`.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    fail(`${label} exceeds ${max}`);
  }
  return parsed;
}

export function parseU8(
  value: string | undefined,
  label = "value",
  defaultValue: string | number = 0,
): number {
  return parseUnsignedNumber(value, label, U8_MAX, defaultValue);
}

export function parseU16(
  value: string | undefined,
  label = "value",
  defaultValue: string | number = 0,
): number {
  return parseUnsignedNumber(value, label, U16_MAX, defaultValue);
}

export function parseU32(
  value: string | undefined,
  label = "value",
  defaultValue: string | number = 0,
): number {
  return parseUnsignedNumber(value, label, U32_MAX, defaultValue);
}

export function parseUnsignedBn(value: string, label: string, max?: BN): BN {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }

  const parsed = new BN(trimmed);
  if (max && parsed.gt(max)) {
    fail(`${label} exceeds max value ${max.toString()}`);
  }
  return parsed;
}

export function parseU64(value: string, label: string): BN {
  return parseUnsignedBn(value, label, U64_MAX_BN);
}

export function parseOptionalU64(
  value: string | undefined,
  label: string,
): BN | null {
  return value === undefined ? null : parseU64(value, label);
}

export function parseU128(
  value: string | undefined,
  label: string,
  defaultValue = "0",
): BN {
  return parseUnsignedBn(value ?? defaultValue, label, U128_MAX_BN);
}

export function parseNonNegativeU64(value: string, label: string): BN {
  return parseU64(value, label);
}

export function parseBps(value: string, label = "value"): number {
  return parseU16(value, label);
}

export function parseCbps(value: string, label = "value"): BN {
  return new BN(parseU32(value, label));
}

/** Parse a comma- or space-separated list of duration indexes into a deduped u8[]. */
export function parseDurationIndexes(raw: ArrayInput, label: string): number[] {
  const parts = parseArrayInput(raw);
  if (parts.length === 0) {
    fail(`${label} must contain at least one duration index`);
  }

  const seen = new Set<number>();
  const result: number[] = [];
  for (const part of parts) {
    const index = parseU8(part, label);
    if (!seen.has(index)) {
      seen.add(index);
      result.push(index);
    }
  }
  return result;
}

export function parsePositiveUiAmount(
  value: string,
  decimals: number,
  label?: string,
): BN {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    fail(`${labelOrValue(value, label)} must be a positive decimal amount`);
  }

  const fractional = trimmed.split(".")[1] ?? "";
  if (fractional.length > decimals) {
    fail(
      `${labelOrValue(value, label)} has more than ${decimals} decimal places`,
    );
  }

  const parsed = fromUiAmount(trimmed, decimals);
  if (parsed.isZero()) {
    fail(`${labelOrValue(value, label)} must be greater than zero`);
  }
  return parsed;
}

export function parseNonNegativeUiAmount(
  value: string,
  decimals: number,
  label?: string,
): BN {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    fail(`${labelOrValue(value, label)} must be a non-negative decimal amount`);
  }

  const fractional = trimmed.split(".")[1] ?? "";
  if (fractional.length > decimals) {
    fail(
      `${labelOrValue(value, label)} has more than ${decimals} decimal places`,
    );
  }

  return fromUiAmount(trimmed, decimals);
}

export function parsePositiveInteger(value: string, label?: string): number {
  const parsed = parseUnsignedNumber(value, labelOrValue(value, label));
  if (parsed <= 0) {
    fail(`${labelOrValue(value, label)} must be a positive integer`);
  }
  return parsed;
}

export function parseNonNegativeInteger(value: string, label?: string): number {
  return parseUnsignedNumber(value, labelOrValue(value, label));
}

export function parsePositiveBn(value: string, label?: string): BN {
  const parsed = parseUnsignedBn(value, labelOrValue(value, label));
  if (parsed.isZero()) {
    fail(`${labelOrValue(value, label)} must be a positive big integer`);
  }
  return parsed;
}

export function validatePublicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    console.error("Not a valid pubkey:", value);
    process.exit(1);
  }
}

export function collectPublicKeys(
  value: string,
  previous: PublicKey[] = [],
): PublicKey[] {
  return [...previous, ...parseArrayInput(value).map(validatePublicKey)];
}

export function validateFileExists(path: string): string {
  if (!fs.existsSync(path)) {
    console.error(`File ${path} does not exist`);
    process.exit(1);
  }
  return path;
}

export function validateInvestorAction(
  action: string,
): "subscription" | "redemption" {
  if (action !== "subscription" && action !== "redemption") {
    console.error(`Invalid action. Allowed values: subscription, redemption`);
    process.exit(1);
  }
  return action;
}

export function validateBooleanInput(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  const truthyValues = ["true", "1", "yes", "y", "on", "enable"];
  const falsyValues = ["false", "0", "no", "n", "off", "disable"];

  if (truthyValues.includes(normalized)) return true;
  if (falsyValues.includes(normalized)) return false;

  throw new Error(
    `Invalid boolean value: "${input}". Use: true/false, yes/no, 1/0, enable/disable`,
  );
}

export function parseHexOrBase64Bytes(value: string, label: string): Buffer {
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

export function parseOptionalHexOrBase64Bytes(
  value: string | undefined,
  label: string,
): Buffer | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.toLowerCase() === "none") {
    return null;
  }

  return parseHexOrBase64Bytes(value, label);
}

export function parseFixedBytes(
  value: string,
  label: string,
  expectedLength: number,
): Buffer {
  const bytes = parseHexOrBase64Bytes(value, label);
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must decode to exactly ${expectedLength} bytes`);
  }
  return bytes;
}
