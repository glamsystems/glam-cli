import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { CliContext, confirmOperation, parseTxError } from "../utils";
import { PublicKey, Transaction } from "@solana/web3.js";
export function installManageCommands(manage: Command, context: CliContext) {
  manage
    .command("price")
    .description("Price vault assets")
    .action(async () => {
      const ixs = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = context.glamClient.price.lookupTables;

      const tx = new Transaction().add(...ixs);

      try {
        const vTx = await context.glamClient.intoVersionedTransaction(tx, {
          ...context.txOptions,
          lookupTables,
        });
        const txSig = await context.glamClient.sendAndConfirm(vTx);
        console.log("Priced vault assets:", txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  manage
    .command("fulfill")
    .description("Fulfill queued subscriptions and redemptions")
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = context.glamClient.price.lookupTables;

      try {
        const txSig = await context.glamClient.invest.fulfill(null, {
          ...context.txOptions,
          preInstructions,
          lookupTables,
          simulate: true,
        });
        console.log(
          `${context.glamClient.signer} triggered fulfillment:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("claim-fees")
    .description("Claim fees collected by tokenized vault")
    .action(async () => {
      try {
        const txSig = await context.glamClient.fees.claimFees();
        console.log(`${context.glamClient.signer} claimed fees:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("update-min-subscription")
    .argument("<amount>", "Minimum subscription amount", parseFloat)
    .description("Update the minimum subscription amount")
    .action(async (amount) => {
      const stateModel = await context.glamClient.fetchStateModel();
      const amountBN = new BN(amount * 10 ** stateModel.baseAssetDecimals!);
      try {
        const txSig = await context.glamClient.mint.update(
          { minSubscription: amountBN },
          context.txOptions,
        );
        console.log(`Updated minimum subscription amount to ${amount}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("update-min-redemption")
    .argument("<amount>", "Minimum redemption amount", parseFloat)
    .description("Update the minimum redemption amount")
    .action(async (amount) => {
      const stateModel = await context.glamClient.fetchStateModel();
      const amountBN = new BN(amount * 10 ** stateModel.baseAssetDecimals!);
      try {
        const txSig = await context.glamClient.mint.update(
          { minRedemption: amountBN },
          context.txOptions,
        );
        console.log(`Updated minimum redemption amount to ${amount}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("pause")
    .argument("<action>", "Action to pause", (action) => {
      if (action !== "subscription" && action !== "redemption") {
        console.error(`<action> must be "subscription" or "redemption"`);
        process.exit(1);
      }
      return action;
    })
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Pause subscription or redemption")
    .action(async (action, options) => {
      options?.yes || (await confirmOperation(`Confirm pausing ${action}?`));

      const promise =
        action === "subscription"
          ? context.glamClient.mint.pauseSubscription(context.txOptions)
          : context.glamClient.mint.pauseRedemption(context.txOptions);

      try {
        const txSig = await promise;
        console.log(`Paused ${action}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("unpause")
    .argument("<action>", "Action to pause", (action) => {
      if (action !== "subscription" && action !== "redemption") {
        console.error(`<action> must be "subscription" or "redemption"`);
        process.exit(1);
      }
      return action;
    })
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Unpause subscription or redemption")
    .action(async (action, options) => {
      options?.yes || (await confirmOperation(`Confirm unpausing ${action}?`));

      const promise =
        action === "subscription"
          ? context.glamClient.mint.unpauseSubscription(context.txOptions)
          : context.glamClient.mint.unpauseRedemption(context.txOptions);

      try {
        const txSig = await promise;
        console.log(`Unpaused ${action}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
