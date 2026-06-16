import { PublicKey } from "@solana/web3.js";
import { type Command } from "commander";
import {
  type CliContext,
  executeTxWithErrorHandling,
  resolveTokenMint,
  validateInteger,
  validatePublicKey,
} from "../utils";
import {
  DEFAULT_NEUTRAL_WITHDRAWAL_MAX_DEVIATION_BPS,
  fromUiAmount,
} from "@glamsystems/glam-sdk";

export function installNeutralCommands(neutral: Command, context: CliContext) {
  neutral
    .command("view-policy")
    .description("View NT bundle policy")
    .action(async () => {
      const policy = await context.glamClient.neutral.fetchPolicy();
      if (!policy) {
        console.log("No policy found");
        return;
      }

      console.log("NT bundles allowlist:");
      for (let i = 0; i < policy.bundlesAllowlist.length; i++) {
        console.log(`[${i}] ${policy.bundlesAllowlist[i]}`);
      }
    });

  neutral
    .command("allowlist-bundle")
    .argument("<bundle>", "NT bundle public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a NT bundle to the allowlist")
    .action(async (bundle: PublicKey, options: { yes?: boolean }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.neutral.allowlistBundle(bundle, context.txOptions),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding NT bundle ${bundle} to allowlist`,
        },
        (txSig) => `NT bundle ${bundle} added to allowlist: ${txSig}`,
      );
    });

  neutral
    .command("init-depositor")
    .argument("<bundle>", "NT bundle public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Initialize a NT user bundle account")
    .action(async (bundle: PublicKey, options: { yes?: boolean }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.neutral.initializeBundleDepositor(
            bundle,
            context.txOptions,
          ),
        {
          skip: options?.yes ?? false,
          message: `Confirm initializing depositor for NT bundle ${bundle}`,
        },
        (txSig) => `NT bundle depositor initialized: ${txSig}`,
      );
    });

  neutral
    .command("deposit")
    .alias("request-deposit")
    .argument("<bundle>", "NT bundle public key", validatePublicKey)
    .argument(
      "<amount>",
      "UI amount of the bundle asset to deposit",
      parseFloat,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Request a NT bundle deposit from the GLAM vault")
    .action(
      async (bundle: PublicKey, amount: number, options: { yes?: boolean }) => {
        const { assetAddress, assetDecimals } =
          await context.glamClient.neutral.fetchBundle(bundle);
        const mint = await resolveTokenMint(
          context.glamClient,
          assetAddress.toBase58(),
        );
        if (mint.decimals !== assetDecimals) {
          throw new Error(
            `Mint decimals ${mint.decimals} does not match bundle asset decimals ${assetDecimals}`,
          );
        }

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.neutral.requestDeposit(
              bundle,
              fromUiAmount(amount, mint.decimals),
              context.txOptions,
            ),
          {
            skip: options?.yes ?? false,
            message: `Confirm depositing ${amount} ${mint.symbol} to NT bundle ${bundle}`,
          },
          (txSig) => `NT bundle deposit requested: ${txSig}`,
        );
      },
    );

  neutral
    .command("withdraw")
    .alias("request-withdrawal")
    .argument("<bundle>", "NT bundle public key", validatePublicKey)
    .argument(
      "<shares-amount>",
      "Raw NT bundle shares amount to withdraw",
      validateInteger,
    )
    .option(
      "-m, --max-deviation <bps>",
      "Maximum deviation from estimated value (in basis points)",
      (value) => validateInteger(value, true),
      DEFAULT_NEUTRAL_WITHDRAWAL_MAX_DEVIATION_BPS,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Request a NT bundle withdrawal from the GLAM vault")
    .action(
      async (
        bundle: PublicKey,
        sharesAmount: number,
        options: {
          maxDeviation: number;
          yes?: boolean;
        },
      ) => {
        const estimate =
          await context.glamClient.neutral.estimateWithdrawalValue(
            bundle,
            sharesAmount,
            options.maxDeviation,
          );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.neutral.requestWithdrawal(
              bundle,
              sharesAmount,
              estimate.minEstimatedValue,
              context.txOptions,
            ),
          {
            skip: options?.yes ?? false,
            message: `Confirm requesting withdrawal of ${sharesAmount} shares from bundle ${bundle} with minimum estimated value ${estimate.minEstimatedValue}`,
          },
          (txSig) => `NT bundle withdrawal requested: ${txSig}`,
        );
      },
    );
}
