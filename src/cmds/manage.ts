import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validateInvestorAction,
  validatePublicKey,
} from "../utils";
import { Transaction } from "@solana/web3.js";
import {
  findGlamLookupTables,
  fromUiAmount,
  toUiAmount,
  RequestType,
  PendingRequest,
} from "@glamsystems/glam-sdk";

export function installManageCommands(manage: Command, context: CliContext) {
  manage
    .command("price")
    .description("Price vault assets")
    .action(async () => {
      const ixs = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables

      const glamLookupTables = await findGlamLookupTables(
        context.glamClient.statePda,
        context.glamClient.vaultPda,
        context.glamClient.connection,
      );

      const lookupTables = [
        ...context.glamClient.price.lookupTables,
        ...glamLookupTables.map((t) => t.key),
      ];

      const tx = new Transaction().add(...ixs);

      await executeTxWithErrorHandling(
        async () => {
          const vTx = await context.glamClient.intoVersionedTransaction(tx, {
            ...context.txOptions,
            lookupTables,
          });
          return context.glamClient.sendAndConfirm(vTx);
        },
        { skip: true },
        (txSig) => `Vault priced: ${txSig}`,
      );
    });

  manage
    .command("fulfill")
    .description("Fulfill queued subscriptions and redemptions")
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = context.glamClient.price.lookupTables;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.fulfill(null, {
            ...context.txOptions,
            preInstructions,
            lookupTables,
            simulate: true,
          }),
        { skip: true },
        (txSig) => `Fulfillment triggered: ${txSig}`,
      );
    });

  manage
    .command("claim-fees")
    .description("Claim fees collected by tokenized vault")
    .action(async () => {
      await executeTxWithErrorHandling(
        () => context.glamClient.fees.claimFees(),
        { skip: true },
        (txSig) => `Fees claimed: ${txSig}`,
      );
    });

  manage
    .command("update-min-subscription")
    .argument("<amount>", "Minimum subscription amount", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update the minimum subscription amount")
    .action(async (amount, options) => {
      const { baseAssetDecimals } = await context.glamClient.fetchStateModel();
      const amountBN = fromUiAmount(amount, baseAssetDecimals!);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.mint.update(
            { minSubscription: amountBN },
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm updating minimum subscription amount to ${amount}`,
        },
        (txSig) => `Updated minimum subscription amount to ${amount}: ${txSig}`,
      );
    });

  manage
    .command("update-min-redemption")
    .argument("<amount>", "Minimum redemption amount", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update the minimum redemption amount")
    .action(async (amount, options) => {
      const { baseAssetDecimals } = await context.glamClient.fetchStateModel();
      const amountBN = fromUiAmount(amount, baseAssetDecimals!);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.mint.update(
            { minRedemption: amountBN },
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm updating minimum redemption amount to ${amount}`,
        },
        (txSig) => `Updated minimum redemption amount to ${amount}: ${txSig}`,
      );
    });

  manage
    .command("pause")
    .argument("<action>", "Action to pause", validateInvestorAction)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Pause subscription or redemption")
    .action(async (action, options) => {
      await executeTxWithErrorHandling(
        () =>
          action === "subscription"
            ? context.glamClient.mint.pauseSubscription(context.txOptions)
            : context.glamClient.mint.pauseRedemption(context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm pausing ${action}`,
        },
        (txSig) => `Paused ${action}: ${txSig}`,
      );
    });

  manage
    .command("unpause")
    .argument("<action>", "Action to pause", validateInvestorAction)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Unpause subscription or redemption")
    .action(async (action, options) => {
      await executeTxWithErrorHandling(
        () =>
          action === "subscription"
            ? context.glamClient.mint.unpauseSubscription(context.txOptions)
            : context.glamClient.mint.unpauseRedemption(context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm unpausing ${action}`,
        },
        (txSig) => `Unpaused ${action}: ${txSig}`,
      );
    });

  manage
    .command("list-requests")
    .description("List pending user requests in the queue")
    .action(async () => {
      const queue = await context.glamClient.fetchRequestQueue();
      const requests = queue?.data || [];

      if (requests.length === 0) {
        console.log("No pending requests in the queue.");
        return;
      }

      const { baseAssetDecimals } =
        await context.glamClient.fetchStateModel();
      const { mint } = await (
        await import("@glamsystems/glam-sdk")
      ).fetchMintAndTokenProgram(
        context.glamClient.connection,
        context.glamClient.mintPda,
      );
      const shareDecimals = mint.decimals;

      console.log(`Found ${requests.length} request(s):\n`);
      for (const r of requests as PendingRequest[]) {
        const type = Object.keys(r.requestType)[0];
        const isSub = RequestType.equals(
          r.requestType as RequestType,
          RequestType.SUBSCRIPTION,
        );
        const incoming = toUiAmount(
          new BN(r.incoming.toString()),
          isSub ? baseAssetDecimals! : shareDecimals,
        );
        const outgoing = toUiAmount(
          new BN(r.outgoing.toString()),
          isSub ? shareDecimals : baseAssetDecimals!,
        );
        const createdAt = new BN(r.createdAt.toString()).toNumber();
        const fulfilledAt = new BN(r.fulfilledAt.toString()).toNumber();
        const createdDate = createdAt
          ? new Date(createdAt * 1000).toISOString()
          : "N/A";
        const status = fulfilledAt ? "fulfilled (claimable)" : "pending";

        console.log(`  User:      ${r.user.toBase58()}`);
        console.log(`  Type:      ${type}`);
        console.log(`  Incoming:  ${incoming}`);
        console.log(`  Outgoing:  ${outgoing}`);
        console.log(`  Status:    ${status}`);
        console.log(`  Created:   ${createdDate}`);
        console.log();
      }
    });

  manage
    .command("cancel-for-user")
    .argument("<pubkey>", "Public key of the user", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Cancel a queued request on behalf of a user")
    .action(async (pubkey, options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.cancelForUser(pubkey, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm canceling queued request for user ${pubkey.toBase58()}?`,
        },
        (txSig) => `Cancelled request for ${pubkey.toBase58()}: ${txSig}`,
      );
    });

  manage
    .command("claim-for-user")
    .argument("<pubkey>", "Public key of the user", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Claim a fulfilled request on behalf of a user")
    .action(async (pubkey, options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.claimForUser(pubkey, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm claiming for user ${pubkey.toBase58()}?`,
        },
        (txSig) => `Claimed for ${pubkey.toBase58()}: ${txSig}`,
      );
    });
}
