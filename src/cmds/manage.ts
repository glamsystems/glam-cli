import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validateInvestorAction,
} from "../utils";
import { Transaction } from "@solana/web3.js";
import { findGlamLookupTables } from "@glamsystems/glam-sdk";

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
      const amountBN = new BN(amount * 10 ** baseAssetDecimals!);

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
      const amountBN = new BN(amount * 10 ** baseAssetDecimals!);

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
}
