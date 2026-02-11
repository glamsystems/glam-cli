import {
  WSOL,
  TransferPolicy,
  fetchMintAndTokenProgram,
  fromUiAmount,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";

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
      "Pubkey of the destination address",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a destination address to the token transfer allowlist")
    .action(async (pubkey: PublicKey, options) => {
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extSplProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm adding destination ${pubkey} to allowlist?`,
        },
        (txSig) => `Added destination ${pubkey} to allowlist: ${txSig}`,
      );
    });

  program
    .command("remove-destination")
    .argument(
      "<pubkey>",
      "Pubkey of the destination address",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Remove a destination address from the token transfer allowlist",
    )
    .action(async (pubkey: PublicKey, options) => {
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extSplProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm removing destination ${pubkey} from allowlist?`,
        },
        (txSig) => `Removed destination ${pubkey} from allowlist: ${txSig}`,
      );
    });

  program
    .argument("<amount>", "Amount to transfer", parseFloat)
    .argument("<to>", "Destination address (pubkey)", validatePublicKey)
    .option(
      "-t, --token <mint>",
      "Mint address of SPL token to transfer (defaults to wSOL)",
      validatePublicKey,
      WSOL,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Transfer SPL token (defaults to wSOL) to the destination address",
    )
    .action(async (amount, destination: PublicKey, { token, yes }) => {
      const assetLabel = token.equals(WSOL) ? "wSOL" : token.toBase58();
      const { mint } = await fetchMintAndTokenProgram(
        context.glamClient.connection,
        token,
      );
      const amountBN = fromUiAmount(amount, mint.decimals);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.vault.tokenTransfer(
            token,
            amountBN,
            destination,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm transfer of ${amount} ${assetLabel} to ${destination}?`,
        },
        (txSig) =>
          `Transferred ${amount} ${assetLabel} to ${destination}: ${txSig}`,
      );
    });
}
