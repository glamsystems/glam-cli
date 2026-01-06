import { Command } from "commander";
import { CliContext, executeTxWithErrorHandling } from "../utils";
import { BN } from "@coral-xyz/anchor";
import {
  CctpPolicy,
  fromUiAmount,
  publicKeyToEvmAddress,
} from "@glamsystems/glam-sdk";
import { evmAddressToPublicKey } from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";

export function installCctpCommands(program: Command, context: CliContext) {
  program
    .command("view-policy")
    .description("View CCTP policy")
    .action(async () => {
      const cctpPolicy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extCctpProgram.programId,
        0b01,
        CctpPolicy,
      );
      if (!cctpPolicy) {
        console.error("CCTP policy not found");
        process.exit(1);
      }
      console.log("CCTP allowed destinations:");
      for (const destination of cctpPolicy.allowedDestinations) {
        console.log(
          `\t${destination.domain}: ${publicKeyToEvmAddress(destination.address)}`,
        );
      }
    });

  program
    .command("allowlist-destination")
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "Destination address")
    .option("--base58", "Address is a base58 string")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a destination to the allowlist")
    .action(async (domain, destinationAddress, { base58, yes }) => {
      const recipientPubkey = base58
        ? new PublicKey(destinationAddress)
        : evmAddressToPublicKey(destinationAddress);

      const cctpPolicy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extCctpProgram.programId,
          0b01,
          CctpPolicy,
        )) ?? new CctpPolicy([]);
      if (
        cctpPolicy.allowedDestinations.find(
          (d) => d.domain === domain && d.address.equals(recipientPubkey),
        )
      ) {
        console.error(
          `Destination address ${destinationAddress} is already in the allowlist`,
        );
        process.exit(1);
      }

      cctpPolicy.allowedDestinations.push({ domain, address: recipientPubkey });
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extCctpProgram.programId,
            0b01,
            cctpPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm adding destination ${destinationAddress} (domain ${domain}) to allowlist`,
        },
        (txSig) =>
          `Destination ${destinationAddress} (domain ${domain}) added to allowlist: ${txSig}`,
      );
    });

  program
    .command("remove-destination")
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "Destination address")
    .option("--base58", "Address is a base58 string")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a destination from the allowlist")
    .action(async (domain, destinationAddress, { base58, yes }) => {
      const recipientPubkey = base58
        ? new PublicKey(destinationAddress)
        : evmAddressToPublicKey(destinationAddress);

      const cctpPolicy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extCctpProgram.programId,
        0b01,
        CctpPolicy,
      );
      if (!cctpPolicy) {
        console.error(`CCTP policy not found`);
        process.exit(1);
      }
      cctpPolicy.allowedDestinations = cctpPolicy.allowedDestinations.filter(
        (d) => !(d.domain === domain && d.address.equals(recipientPubkey)),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extCctpProgram.programId,
            0b01,
            cctpPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm removing destination ${destinationAddress} (domain ${domain}) from allowlist`,
        },
        (txSig) =>
          `Destination ${destinationAddress} (domain ${domain}) removed from allowlist: ${txSig}`,
      );
    });

  // https://developers.circle.com/cctp/cctp-supported-blockchains#cctp-v2-supported-domains
  program
    .command("bridge-usdc")
    .argument("<amount>", "USDC amount", parseFloat)
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "Recipient EVM address")
    .option("-d, --destination-caller <address>", "Destination caller address")
    .option(
      "-m, --max-fee-bps <maxFeeBps>",
      "Max fee in basis points (default 1)",
      (val) => {
        const parsed = parseInt(val);
        return isNaN(parsed) ? 1 : parsed;
      },
    )
    .option("-b, --base58", "Address is a base58 string")
    .option("-f, --fast", "Fast transfer (lower finality threshold)", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Bridge USDC to an EVM chain")
    .action(
      async (
        amount,
        domain,
        destinationAddress,
        { destinationCaller, maxFeeBps, base58, fast, yes },
      ) => {
        const recipientPubkey = base58
          ? new PublicKey(destinationAddress)
          : evmAddressToPublicKey(destinationAddress);
        const destinationCallerPubkey = destinationCaller
          ? base58
            ? new PublicKey(destinationCaller)
            : evmAddressToPublicKey(destinationCaller)
          : undefined;

        const cctpPolicy = await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extCctpProgram.programId,
          0b01,
          CctpPolicy,
        );
        if (
          cctpPolicy &&
          !cctpPolicy.allowedDestinations.find(
            (d) => d.domain === domain && d.address.equals(recipientPubkey),
          )
        ) {
          console.error(
            `Destination (${domain}, ${destinationAddress}) not in allowlist`,
          );
          process.exit(1);
        }

        // https://developers.circle.com/cctp/technical-guide#cctp-finality-thresholds
        const amountBN = fromUiAmount(amount, 6);
        const maxFee = amountBN.mul(new BN(maxFeeBps)).div(new BN(10000));
        const minFinalityThreshold = fast ? 1000 : 2000;

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.cctp.bridgeUsdc(
              amountBN,
              domain,
              recipientPubkey,
              {
                maxFee,
                minFinalityThreshold,
                destinationCaller: destinationCallerPubkey,
              },
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm bridging ${amount} USDC to ${destinationAddress} (domain ${domain})`,
          },
          (txSig) => `USDC burned: ${txSig}`,
        );
      },
    );

  program
    .command("receive")
    .argument("<source_domain>", "Source domain", parseInt)
    .option(
      "-t, --txHash <txHash>",
      "Transaction hash hex string (start with 0x)",
    )
    .option("-n, --nonce <nonce>", "Nonce hex string (start with 0x)")
    .description(
      "Receive USDC from an EVM chain. Either txHash or nonce is required.",
    )
    .action(async (sourceDomain, { txHash, nonce }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.cctp.receiveUsdc(
            sourceDomain,
            {
              txHash,
              nonce,
            },
            {
              ...context.txOptions,
              lookupTables: [
                new PublicKey("qj4EYgsGpnRdt9rvQW3wWZR8JVaKPg9rG9EB8DNgfz8"), // CCTP lookup table
              ],
            },
          ),
        { skip: true },
        (txSig) => `Received USDC: ${txSig}`,
      );
    });

  program
    .command("list")
    .option("-s, --since-slot <slot>", "Fetch events since this slot", parseInt)
    .option(
      "-b, --batch-size <size>",
      "Batch size of RPC requests. Higher values reduce latency but need higher RPC limits",
      parseInt,
    )
    .option("-c, --commitment <commitment>", "Commitment level", "confirmed")
    .description("List CCTP events of incoming and outgoing bridge transfers")
    .action(async ({ sinceSlot, commitment, batchSize }) => {
      const incomingEvents =
        await context.glamClient.cctp.getIncomingBridgeEvents({
          batchSize,
          commitment,
          minSlot: sinceSlot,
        });
      const outgoingEvents =
        await context.glamClient.cctp.getOutgoingBridgeEvents({
          batchSize,
          commitment,
          minSlot: sinceSlot,
        });
      console.log(
        JSON.stringify(
          {
            vaultState: context.glamClient.statePda,
            vaultPda: context.glamClient.vaultPda,
            incoming: incomingEvents,
            outgoing: outgoingEvents,
          },
          null,
          2,
        ),
      );
    });
}
