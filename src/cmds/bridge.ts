import { BN } from "@coral-xyz/anchor";
import {
  evmAddressToPublicKey,
  fromUiAmount,
  isValidEvmAddress,
  LayerzeroOftPolicy,
  type LayerzeroOftRouteInput,
  RouteManagementMode,
  USDT,
} from "@glamsystems/glam-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Command } from "commander";

import {
  type CliContext,
  collectPublicKeys,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";

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

function parseOptionalHexOrBase64Bytes(
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

function parseFixedBytes(
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

function parseTransferId(value: string): PublicKey {
  try {
    return new PublicKey(value.trim());
  } catch {
    return new PublicKey(parseFixedBytes(value, "transferId", 32));
  }
}

function formatBytesHex(value: Buffer | Uint8Array | number[]) {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function parseManagementMode(value: string): RouteManagementMode {
  switch (value) {
    case "managed":
      return RouteManagementMode.ManagedOnly;
    case "either":
      return RouteManagementMode.Either;
    case "unmanaged":
      return RouteManagementMode.UnmanagedOnly;
    default:
      throw new Error(
        `Unsupported management mode: ${value}. Use unmanaged, managed, or either.`,
      );
  }
}

function formatManagementMode(value: RouteManagementMode | number) {
  switch (value) {
    case RouteManagementMode.UnmanagedOnly:
      return "unmanaged";
    case RouteManagementMode.ManagedOnly:
      return "managed";
    case RouteManagementMode.Either:
      return "either";
    default:
      return `unknown(${value})`;
  }
}

function serializeBridgeValue(value: unknown): unknown {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (BN.isBN(value)) {
    return (value as BN).toString();
  }

  if (Buffer.isBuffer(value)) {
    return formatBytesHex(value);
  }

  if (value instanceof Uint8Array) {
    return formatBytesHex(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeBridgeValue);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializeBridgeValue(entry),
      ]),
    );
  }

  return value;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(serializeBridgeValue(value), null, 2));
}

function toSortableNumber(value: unknown): number {
  if (BN.isBN(value)) {
    return (value as BN).toNumber();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return 0;
}

function buildRoute(
  sourceMint: string,
  destinationChain: number,
  destinationRecipient: string,
  providerProgram: string,
  managementMode: string,
  minAmount: number,
  maxAmount: number,
  decimals: number,
): LayerzeroOftRouteInput {
  if (maxAmount <= 0) {
    throw new Error("--max-amount must be greater than 0");
  }

  if (minAmount < 0) {
    throw new Error("--min-amount cannot be negative");
  }

  if (maxAmount < minAmount) {
    throw new Error(
      "--max-amount must be greater than or equal to --min-amount",
    );
  }

  return {
    sourceMint: new PublicKey(sourceMint),
    destinationChain,
    destinationRecipient: parseRecipientPublicKey(destinationRecipient),
    providerProgram: new PublicKey(providerProgram),
    managementMode: parseManagementMode(managementMode),
    minAmount: fromUiAmount(minAmount, decimals),
    maxAmount: fromUiAmount(maxAmount, decimals),
  };
}

function parseRecipientPublicKey(recipient: string): PublicKey {
  const normalized = recipient.trim();
  if (isValidEvmAddress(normalized)) {
    return evmAddressToPublicKey(normalized);
  }

  const hex = normalized.replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length === 20) {
      return evmAddressToPublicKey(`0x${hex}`);
    }
    if (bytes.length === 32) {
      return new PublicKey(bytes);
    }
  }

  return new PublicKey(normalized);
}

function printLayerzeroOftPolicy(policy: LayerzeroOftPolicy | null) {
  if (!policy || policy.routes.length === 0) {
    console.log("No LayerZero OFT routes configured.");
    return;
  }

  printJson(
    policy.routes.map((route) => ({
      ...route,
      managementMode: formatManagementMode(route.managementMode),
    })),
  );
}

type OftSendOptions = {
  nativeFeeLamports: BN;
  minAmount?: number;
  lzTokenFee?: BN;
  options?: string;
  composeMsg?: string;
  managed: boolean;
  lookupTable: PublicKey[];
  yes: boolean;
};

function installLayerzeroOftCommands(program: Command, context: CliContext) {
  program
    .command("view-policy")
    .description("View the LayerZero OFT route policy")
    .action(async () => {
      printLayerzeroOftPolicy(
        await context.glamClient.bridge.fetchLayerzeroOftPolicy(),
      );
    });

  program
    .command("allow-route")
    .argument("<source_mint>")
    .argument("<destination_chain>", "", parseInt)
    .argument("<destination_recipient>")
    .argument("<provider_program>")
    .requiredOption(
      "--max-amount <amount>",
      "Maximum source amount in UI units",
      parseFloat,
    )
    .option(
      "--management-mode <mode>",
      "unmanaged | managed | either",
      "unmanaged",
    )
    .option(
      "--min-amount <amount>",
      "Minimum source amount in UI units",
      parseFloat,
      0,
    )
    .option("--decimals <decimals>", "Source mint decimals", parseInt, 6)
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (
        sourceMint: string,
        destinationChain: number,
        destinationRecipient: string,
        providerProgram: string,
        {
          managementMode,
          minAmount,
          maxAmount,
          decimals,
          yes,
        }: {
          managementMode: string;
          minAmount: number;
          maxAmount: number;
          decimals: number;
          yes: boolean;
        },
      ) => {
        const route = buildRoute(
          sourceMint,
          destinationChain,
          destinationRecipient,
          providerProgram,
          managementMode,
          minAmount,
          maxAmount,
          decimals,
        );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.bridge.addLayerzeroOftRoute(
              route,
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm allowlisting LayerZero OFT route to ${destinationRecipient} on chain ${destinationChain}?`,
          },
          (txSig) => `LayerZero OFT route added: ${txSig}`,
        );
      },
    );

  program
    .command("update-route")
    .argument("<source_mint>")
    .argument("<destination_chain>", "", parseInt)
    .argument("<destination_recipient>")
    .argument("<provider_program>")
    .requiredOption(
      "--max-amount <amount>",
      "Maximum source amount in UI units",
      parseFloat,
    )
    .option(
      "--management-mode <mode>",
      "unmanaged | managed | either",
      "unmanaged",
    )
    .option(
      "--min-amount <amount>",
      "Minimum source amount in UI units",
      parseFloat,
      0,
    )
    .option("--decimals <decimals>", "Source mint decimals", parseInt, 6)
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (
        sourceMint: string,
        destinationChain: number,
        destinationRecipient: string,
        providerProgram: string,
        {
          managementMode,
          minAmount,
          maxAmount,
          decimals,
          yes,
        }: {
          managementMode: string;
          minAmount: number;
          maxAmount: number;
          decimals: number;
          yes: boolean;
        },
      ) => {
        const route = buildRoute(
          sourceMint,
          destinationChain,
          destinationRecipient,
          providerProgram,
          managementMode,
          minAmount,
          maxAmount,
          decimals,
        );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.bridge.updateLayerzeroOftRoute(
              route,
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm updating LayerZero OFT route to ${destinationRecipient} on chain ${destinationChain}?`,
          },
          (txSig) => `LayerZero OFT route updated: ${txSig}`,
        );
      },
    );

  program
    .command("remove-route")
    .argument("<source_mint>")
    .argument("<destination_chain>", "", parseInt)
    .argument("<destination_recipient>")
    .argument("<provider_program>")
    .option("-y, --yes", "Skip confirmation", false)
    .action(
      async (
        sourceMint: string,
        destinationChain: number,
        destinationRecipient: string,
        providerProgram: string,
        { yes }: { yes: boolean },
      ) => {
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.bridge.deleteLayerzeroOftRoute(
              {
                sourceMint: new PublicKey(sourceMint),
                destinationChain,
                destinationRecipient:
                  parseRecipientPublicKey(destinationRecipient),
                providerProgram: new PublicKey(providerProgram),
                managementMode: RouteManagementMode.UnmanagedOnly,
                minAmount: new BN(0),
                maxAmount: new BN(0),
              },
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm removing LayerZero OFT route to ${destinationRecipient} on chain ${destinationChain}?`,
          },
          (txSig) => `LayerZero OFT route removed: ${txSig}`,
        );
      },
    );

  program
    .command("derive-aux-account")
    .argument("<transfer_id>", "transfer id pubkey or 32-byte hex/base64")
    .argument("<source_mint>")
    .option(
      "--signer <pubkey>",
      "Optional signer override for the derived seed",
    )
    .description(
      "Derive the temporary auxiliary token account used during OFT sends",
    )
    .action(
      async (
        transferId: string,
        sourceMint: string,
        { signer }: { signer?: string },
      ) => {
        const parsedTransferId = parseTransferId(transferId);
        const auxiliary =
          await context.glamClient.bridge.deriveOftAuxiliaryTokenAccount(
            parsedTransferId,
            new PublicKey(sourceMint),
            signer ? new PublicKey(signer) : undefined,
          );
        printJson({
          transferId: parsedTransferId,
          seed: auxiliary.seed,
          address: auxiliary.address,
          tokenProgram: auxiliary.tokenProgram,
        });
      },
    );

  program
    .command("derive-nonce")
    .argument("<endpoint_program>")
    .argument("<sender>")
    .argument("<destination_chain>", "", parseInt)
    .argument("<destination_recipient>")
    .description("Derive the LayerZero nonce PDA for an OFT route")
    .action(
      async (
        endpointProgram: string,
        sender: string,
        destinationChain: number,
        destinationRecipient: string,
      ) => {
        const nonce = context.glamClient.bridge.getLayerzeroNoncePda(
          new PublicKey(endpointProgram),
          new PublicKey(sender),
          destinationChain,
          parseRecipientPublicKey(destinationRecipient),
        );
        console.log(nonce.toBase58());
      },
    );

  program
    .command("send-usdt")
    .argument("<amount>", "USDT amount in UI units", parseFloat)
    .argument("<destination_chain>", "", parseInt)
    .argument("<destination_recipient>")
    .requiredOption(
      "--native-fee-lamports <lamports>",
      "LayerZero native fee in lamports/base units",
      (value: string) => new BN(value),
    )
    .option(
      "--min-amount <amount>",
      "Minimum destination amount in UI units (defaults to amount)",
      parseFloat,
    )
    .option(
      "--lz-token-fee <amount>",
      "Optional LayerZero token fee in base units",
      (value: string) => new BN(value),
    )
    .option(
      "--options <hex_or_base64>",
      "Optional raw LayerZero options payload override",
    )
    .option(
      "--compose-msg <hex_or_base64>",
      "Optional raw LayerZero compose message payload; pass 'none' to encode compose_msg as None",
    )
    .option(
      "--managed",
      "Keep the inflight transfer managed until reconcile",
      false,
    )
    .option(
      "--lookup-table <pubkey>",
      "Optional extra address lookup table",
      collectPublicKeys,
      [],
    )
    .option("-y, --yes", "Skip confirmation", false)
    .description(
      "Bridge USDT through the checked-in direct LayerZero USDT0 OFT route",
    )
    .action(
      async (
        amount: number,
        destinationChain: number,
        destinationRecipient: string,
        {
          nativeFeeLamports,
          minAmount,
          lzTokenFee,
          options,
          composeMsg,
          managed,
          lookupTable,
          yes,
        }: OftSendOptions,
      ) => {
        const transferId = Keypair.generate().publicKey;

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.bridge.oft.send(
              {
                transferId,
                sourceMint: USDT,
                sourceAmount: fromUiAmount(amount, 6),
                destinationChain,
                destinationRecipient:
                  parseRecipientPublicKey(destinationRecipient),
                nativeFeeLamports,
                minAmountLd: minAmount ? fromUiAmount(minAmount, 6) : undefined,
                lzTokenFee,
                options: options
                  ? parseHexOrBase64Bytes(options, "options")
                  : undefined,
                composeMsg: parseOptionalHexOrBase64Bytes(
                  composeMsg,
                  "composeMsg",
                ),
                managed,
              },
              {
                ...context.txOptions,
                lookupTables:
                  lookupTable.length > 0
                    ? lookupTable
                    : context.txOptions.lookupTables,
              },
            ),
          {
            skip: yes,
            message: `Confirm LayerZero OFT send of ${amount} USDT to ${destinationRecipient} on chain ${destinationChain}?`,
          },
          (txSig) =>
            `LayerZero OFT transfer submitted: ${txSig}\nTransfer ID: ${transferId}`,
        );
      },
    );
}

export function installBridgeCommands(program: Command, context: CliContext) {
  program
    .command("registry")
    .description("View the bridge registry for the active vault")
    .action(async () => {
      const registryPda = context.glamClient.bridge.getRegistryPda();
      const registry = await context.glamClient.bridge.fetchRegistry();
      if (!registry) {
        console.log("Bridge registry not initialized.");
        return;
      }
      printJson({
        pubkey: registryPda,
        ...registry,
        transfers: registry.transfers.slice(
          0,
          toSortableNumber(registry.managedTransferCount),
        ),
      });
    });

  program
    .command("record")
    .argument("<transfer_id>", "transfer id pubkey", validatePublicKey)
    .description("View a single bridge transfer record")
    .action(async (transferId: PublicKey) => {
      const record =
        await context.glamClient.bridge.fetchTransferRecordNullable(transferId);

      if (!record) {
        console.error(
          `Bridge transfer record not found for transfer ${transferId}`,
        );
        process.exit(1);
      }

      printJson(record);
    });

  program
    .command("validate")
    .alias("validate-managed-transfer")
    .argument("<transfer_id>", "transfer id pubkey", validatePublicKey)
    .description("Validate a managed bridge transfer")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (transferId: PublicKey, { yes }: { yes: boolean }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.bridge.validateManagedTransfer(
            transferId,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm validating transfer ${transferId}?`,
        },
        (txSig) => `Transfer validated: ${txSig}`,
      );
    });

  program
    .command("settle")
    .argument("<transfer_id>", "transfer id pubkey or 32-byte hex/base64")
    .description("Settle a managed bridge transfer")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (transferId: string, { yes }: { yes: boolean }) => {
      const parsedTransferId = parseTransferId(transferId);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.bridge.settleManagedTransfer(
            parsedTransferId,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm settling transfer ${parsedTransferId}?`,
        },
        (txSig) => `Transfer settled: ${txSig}`,
      );
    });

  const oft = program.command("oft").description("LayerZero OFT");
  installLayerzeroOftCommands(oft, context);
}
