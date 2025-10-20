import {
  WSOL,
  TransferPolicy,
  fetchMintAndTokenProgram,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { BN } from "@coral-xyz/anchor";

export function installTransferCommands(program: Command, context: CliContext) {
  program
    .command("view-policy")
    .description("View token transfer policy")
    .action(async () => {
      const tokenTransferPolicy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extSplProgram.programId,
        0b01,
        TransferPolicy,
      );
      if (!tokenTransferPolicy) {
        console.error("Token transfer policy not found.");
        process.exit(1);
      }
      if (tokenTransferPolicy) {
        console.log("Token transfer allowlist:");
        tokenTransferPolicy.allowlist.forEach((pk, i) => {
          console.log(`[${i}] ${pk}`);
        });
      }
    });

  program
    .command("allowlist-destination")
    .argument(
      "<pubkey>",
      "Pubkey of the destination address to add to the allowlist",
      validatePublicKey,
    )
    .description("Add a destination address to the token transfer allowlist")
    .action(async (pubkey: PublicKey) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extSplProgram.programId,
          0b01,
          TransferPolicy,
        )) ?? new TransferPolicy([]);
      if (policy.allowlist.find((p) => p.equals(pubkey))) {
        console.error(
          `Destination address ${pubkey} is already in the allowlist.`,
        );
        process.exit(1);
      }

      policy.allowlist.push(pubkey);
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extSplProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(
          `Added destination ${pubkey.toBase58()} to allowlist. Transaction signature: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("remove-destination")
    .argument(
      "<pubkey>",
      "Pubkey of the destination address to remove",
      validatePublicKey,
    )
    .description(
      "Remove a destination address from the token transfer allowlist",
    )
    .action(async (pubkey: PublicKey) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extSplProgram.programId,
        0b01,
        TransferPolicy,
      );
      if (!policy) {
        console.error("Token transfer policy not found.");
        process.exit(1);
      }

      policy.allowlist = policy.allowlist.filter((p) => !p.equals(pubkey));
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extSplProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(
          `Removed destination ${pubkey} from allowlist. Transaction signature: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .argument("<amount>", "Amount to transfer (in token units)", parseFloat)
    .argument("<to>", "Destination address (pubkey)", validatePublicKey)
    .option(
      "-t, --token <mint>",
      "Mint address of SPL token to transfer (defaults to wSOL)",
      validatePublicKey,
      WSOL,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .description(
      "Transfer SPL token (defaults to wSOL) to the destination address",
    )
    .action(async (amount, destination: PublicKey, { token, yes }) => {
      const assetLabel = token.equals(WSOL) ? "wSOL" : token.toBase58();

      yes ||
        (await confirmOperation(
          `Confirm transfer of ${amount} ${assetLabel} to ${destination}?`,
        ));

      try {
        const { mint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          token,
        );
        const amountBN = new BN(amount * 10 ** mint.decimals);
        const txSig = await context.glamClient.vault.tokenTransfer(
          token,
          amountBN,
          destination,
          context.txOptions,
        );
        console.log(
          `Transferred ${amount} ${assetLabel} to ${destination}. Transaction signature: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
