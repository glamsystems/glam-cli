import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  printTable,
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
  fetchMintAndTokenProgram,
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
    .option("-j, --json", "Output in JSON format", false)
    .action(async ({ json }) => {
      const queue = await context.glamClient.fetchRequestQueue();
      const requests = queue?.data || [];

      if (requests.length === 0) {
        console.log("No pending requests in the queue.");
        return;
      }

      const stateModel = await context.glamClient.fetchStateModel();
      const timeUnit = stateModel.mintModel?.notifyAndSettle?.timeUnit;
      const isSlot = timeUnit && Object.keys(timeUnit)[0] === "slot";

      const baseAssetDecimals = stateModel.baseAssetDecimals;
      const { mint } = await fetchMintAndTokenProgram(
        context.glamClient.connection,
        context.glamClient.mintPda,
      );
      const shareDecimals = mint.decimals;

      const rows = (requests as PendingRequest[]).map((r) => {
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
        const status = fulfilledAt ? "fulfilled (claimable)" : "pending";

        return {
          user: r.user.toBase58(),
          type,
          incoming,
          outgoing,
          status,
          created: createdAt,
          timeUnit: isSlot ? "slot" : "timestamp",
        };
      });

      if (json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      printTable(
        [
          "User",
          "Type",
          "Incoming",
          "Outgoing",
          "Status",
          `Created (${isSlot ? "slot" : "timestamp"})`,
        ],
        rows.map((r) => [
          r.user,
          r.type,
          r.incoming.toString(),
          r.outgoing.toString(),
          r.status,
          isSlot ? `${r.created}` : new Date(r.created * 1000).toISOString(),
        ]),
      );
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
        () => context.glamClient.invest.claimForUser(pubkey, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm claiming for user ${pubkey.toBase58()}?`,
        },
        (txSig) => `Claimed for ${pubkey.toBase58()}: ${txSig}`,
      );
    });
}
