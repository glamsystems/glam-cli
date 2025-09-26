import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import tokens from "../tokens-verified.json";

export function installDriftVaultsCommands(
  driftVaults: Command,
  context: CliContext,
) {
  driftVaults
    .command("list-depositors")
    .description("List Drift vault depositors owned by the GLAM vault")
    .action(async () => {
      const parsedVaultDepositors =
        await context.glamClient.driftVaults.findAndParseVaultDepositors();

      const parsedDriftVaults =
        await context.glamClient.driftVaults.parseDriftVaults(
          parsedVaultDepositors.map(({ driftVault }) => driftVault),
        );

      const spotMarkets =
        await context.glamClient.drift.fetchAndParseSpotMarkets(
          parsedDriftVaults.map(({ spotMarketIndex }) => spotMarketIndex),
        );
      const spotMarketMap = new Map(
        spotMarkets.map((spotMarket) => [spotMarket.marketIndex, spotMarket]),
      );

      parsedVaultDepositors.map(({ address, driftVault, shares }, i) => {
        const { pubkey, spotMarketIndex, nameStr } = parsedDriftVaults[i];

        if (!driftVault.equals(pubkey)) {
          throw new Error(
            `Depositor vault ${driftVault} does not match parsed drift vault ${pubkey}`,
          );
        }

        const { mint, decimals } = spotMarketMap.get(spotMarketIndex)!;
        const tokenInfo = tokens.find((t) => t.address === mint.toBase58());
        const depositAsset = tokenInfo?.symbol || mint.toBase58();

        console.log(
          `[${i}] Depositor: ${address}, vault: ${nameStr}, shares: ${shares / 10 ** decimals}, deposit asset: ${depositAsset}`,
        );
      });
    });

  driftVaults
    .command("deposit")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a drift vault")
    .action(async (vault, amount, options) => {
      const { spotMarketIndex } =
        await context.glamClient.driftVaults.parseDriftVault(vault);
      const { mint, decimals } =
        await context.glamClient.drift.fetchAndParseSpotMarket(spotMarketIndex);
      const amountBN = new BN(amount * 10 ** decimals);

      const tokenInfo = tokens.find((t) => t.address === mint.toBase58());
      if (!tokenInfo) {
        console.error(`Unverified token not allowed: ${mint}`);
        process.exit(1);
      }

      options?.yes ||
        (await confirmOperation(
          `Confirm depositing ${amount} ${tokenInfo.symbol} (${mint}) to drift vault ${vault}?`,
        ));

      try {
        const txSig = await context.glamClient.driftVaults.deposit(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(`Deposit to drift vault ${vault}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  driftVaults
    .command("request-withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .argument("<amount>", "Amount of vault shares to withdraw", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Request to withdraw from a drift vault")
    .action(async (vault, amount, options) => {
      const { spotMarketIndex, nameStr } =
        await context.glamClient.driftVaults.parseDriftVault(vault);
      options?.yes ||
        (await confirmOperation(
          `Confirm requesting to withdraw ${amount} vault shares from ${nameStr} (${vault})?`,
        ));

      const { decimals } =
        await context.glamClient.drift.fetchAndParseSpotMarket(spotMarketIndex);

      const amountBN = new BN(amount * 10 ** decimals);
      try {
        const txSig = await context.glamClient.driftVaults.requestWithdraw(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(
          `Withdrawal request submitted for drift vault ${nameStr} (${vault}): ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  driftVaults
    .command("cancel-withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Cancel the pending withdraw request")
    .action(async (vault) => {
      try {
        const txSig =
          await context.glamClient.driftVaults.cancelWithdrawRequest(
            vault,
            context.txOptions,
          );
        console.log(`Withdrawal request cancelled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  driftVaults
    .command("withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Claim withdrawal")
    .action(async (vault) => {
      try {
        const txSig = await context.glamClient.driftVaults.withdraw(
          vault,
          context.txOptions,
        );
        console.log(`Confirmed withdrawal from drift vault ${vault}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
