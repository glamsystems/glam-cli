import { BN } from "@coral-xyz/anchor";
import { GlamClient, fetchMintAndTokenProgram } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
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
    .option("-y, --yes", "Skip confirmation prompt", false)
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

      const preInstructions = await glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      await executeTxWithErrorHandling(
        () =>
          glamClient.invest.subscribe(amountBN, !!options?.queued, {
            ...context.txOptions,
            preInstructions: options?.queued ? [] : preInstructions, // queued subscription does not need pricing ixs
            lookupTables,
          }),
        {
          skip: options?.yes,
          message: `Confirm ${options?.queued ? "queued" : "instant"} subscription with ${amount} ${symbol} (${name})?`,
        },
        (txSig) =>
          `${glamClient.signer} ${options?.queued ? "queued" : "instant"} subscription: ${txSig}`,
      );
    });

  invest
    .command("claim-subscription")
    .description(
      "Claim subscription and receive share tokens. Only needed for queued subscriptions.",
    )
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs();
      const lookupTables = context.glamClient.price.lookupTables;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.claim({
            ...context.txOptions,
            preInstructions,
            lookupTables,
          }),
        { skip: true },
        (txSig) => `${context.glamClient.signer} claimed shares: ${txSig}`,
      );
    });

  invest
    .command("redeem")
    .argument("<amount>", "Amount to redeem", parseFloat)
    .description("Request to redeem share tokens")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .action(async (amount, options) => {
      const { mint } = await fetchMintAndTokenProgram(
        context.glamClient.connection,
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

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.queuedRedeem(amountBN, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm queued redemption of ${amount} shares`,
        },
        (txSig) => `${context.glamClient.signer} requested to redeem: ${txSig}`,
      );
    });

  invest
    .command("claim-redemption")
    .description("Claim redemption to receive deposit asset")
    .action(async () => {
      const preInstructions = await context.glamClient.price.priceVaultIxs(); // this loads lookup tables
      const lookupTables = context.glamClient.price.lookupTables;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.invest.claim({
            ...context.txOptions,
            preInstructions,
            lookupTables,
          }),
        { skip: true },
        (txSig) => `${context.glamClient.signer} claimed tokens: ${txSig}`,
      );
    });

  invest
    .command("cancel")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Cancel a queued subscription or redemption that has not been fulfilled",
    )
    .action(async (options) => {
      await executeTxWithErrorHandling(
        () => context.glamClient.invest.cancel(context.txOptions),
        {
          skip: options?.yes,
          message: "Confirm canceling queued subscription or redemption?",
        },
        (txSig) =>
          `${context.glamClient.signer} cancelled queued request: ${txSig}`,
      );
    });
}
