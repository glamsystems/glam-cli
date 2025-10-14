import { BN } from "@coral-xyz/anchor";
import { GlamClient, RequestType } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import tokens from "../tokens-verified.json";

export function installInvestCommands(invest: Command, context: CliContext) {
  invest
    .command("subscribe")
    .argument("<amount>", "Amount to subscribe", parseFloat)
    .argument(
      "[state]",
      "State pubkey of the vault to subscribe to. Leave empty to use the active GLAM in CLI config.",
      validatePublicKey,
    )
    .description("Subscribe to a tokenized vault")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-q, --queued", "Subscribe to a tokenized vault in queued mode")
    .action(async (amount, state, options) => {
      let glamClient = context.glamClient;
      if (state) {
        glamClient = new GlamClient({ statePda: state });
      }

      const stateModel = await glamClient.fetchStateModel();
      const minSubscription = new BN(
        stateModel?.mintModel?.minSubscription || 0,
      );

      const { baseAssetMint, baseAssetDecimals } = stateModel;

      const metadata = tokens.find(
        (t) => t.address === baseAssetMint.toString(),
      );
      if (!metadata) {
        console.warn(`Base asset ${baseAssetMint} is unverified`);
      }
      const name = metadata?.name || baseAssetMint.toBase58();
      const symbol = metadata?.symbol || "Unknown token";

      const amountBN = new BN(amount * 10 ** baseAssetDecimals);
      if (amountBN.lt(minSubscription)) {
        console.error(
          `Amount must be at least ${minSubscription.toNumber() / 10 ** baseAssetDecimals} ${symbol}`,
        );
        process.exit(1);
      }

      options?.yes ||
        (await confirmOperation(
          `Confirm ${options?.queued ? "queued" : "instant"} subscription with ${amount} ${symbol} (${name})?`,
        ));

      const preInstructions = await glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      try {
        const txSig = await glamClient.invest.subscribe(
          amountBN,
          !!options?.queued,
          {
            ...context.txOptions,
            preInstructions: options?.queued ? [] : preInstructions, // queued subscription does not need pricing ixs
            lookupTables,
          },
        );
        console.log(
          `${glamClient.signer} ${options?.queued ? "queued" : "instant"} subscription:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  invest
    .command("claim-subscription")
    .description(
      "Claim subscription and receive share tokens. Only needed for queued subscriptions.",
    )
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs();
      const lookupTables = context.glamClient.price.lookupTables;

      try {
        const txSig = await context.glamClient.invest.claim({
          ...context.txOptions,
          preInstructions,
          lookupTables,
        });
        console.log(`${context.glamClient.signer} claimed shares:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  invest
    .command("redeem")
    .argument("<amount>", "Amount to redeem", parseFloat)
    .description("Request to redeem share tokens")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (amount, options) => {
      const { mint } = await context.glamClient.fetchMintAndTokenProgram(
        context.glamClient.mintPda,
      );
      const decimals = mint.decimals;
      const amountBN = new BN(amount * 10 ** decimals);

      const stateModel = await context.glamClient.fetchStateModel();
      const minRedemption = new BN(stateModel?.mintModel?.minRedemption || 0);

      if (amountBN.lt(minRedemption)) {
        console.error(
          `Amount must be at least ${minRedemption.toNumber() / 10 ** decimals} shares`,
        );
        process.exit(1);
      }

      options?.yes ||
        (await confirmOperation(
          `Confirm queued redemption of ${amount} shares?`,
        ));

      try {
        const txSig = await context.glamClient.invest.queuedRedeem(
          amountBN,
          context.txOptions,
        );
        console.log(`${context.glamClient.signer} requested to redeem:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  invest
    .command("claim-redemption")
    .description("Claim redemption to receive deposit asset")
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = context.glamClient.price.lookupTables;

      try {
        const txSig = await context.glamClient.invest.claim({
          ...context.txOptions,
          preInstructions,
          lookupTables,
        });
        console.log(`${context.glamClient.signer} claimed tokens:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  invest
    .command("cancel")
    .description(
      "Cancel a queued subscription or redemption that has not been fulfilled",
    )
    .action(async () => {
      try {
        const txSig = await context.glamClient.invest.cancel(context.txOptions);
        console.log(
          `${context.glamClient.signer} cancelled queued request:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
