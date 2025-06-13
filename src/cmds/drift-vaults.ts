import { BN } from "@coral-xyz/anchor";
import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, confirmOperation, validatePublicKey } from "../utils";
import tokens from "../tokens-verified.json";

export function installDriftVaultsCommands(
  driftVaults: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  driftVaults
    .command("list-depositors")
    .description("List vault depositors")
    .action(async () => {
      const parsedVaultDepositors =
        await glamClient.driftVaults.findAndParseVaultDepositors();
      parsedVaultDepositors.map(({ address, driftVault, shares }, i) => {
        console.log(
          `[${i}] Depositor: ${address}, vault: ${driftVault}, shares: ${shares}`,
        );
      });
    });

  driftVaults
    .command("init-depositor")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Initialize vault depositor")
    .action(async (vault) => {
      try {
        const txSig = await glamClient.driftVaults.initializeVaultDepositor(
          vault,
          txOptions,
        );
        console.log(`Vault depositor initialized: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  driftVaults
    .command("deposit")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a drift vault")
    .action(async (vault, amount, options) => {
      // Get decimals of deposit asset
      const { spotMarketIndex } =
        await glamClient.driftVaults.parseDriftVault(vault);
      const { mint, decimals } =
        await glamClient.drift.fetchAndParseSpotMarket(spotMarketIndex);
      const amountBN = new BN(amount * 10 ** decimals);

      const tokenInfo = tokens.find((t) => t.address === mint.toBase58());
      if (!tokenInfo) {
        console.error(`Unverified token not allowed: ${mint}`);
        process.exit(1);
      }

      options?.yes ||
        (await confirmOperation(
          `Confirm depositing ${amount} ${tokenInfo.symbol} (${tokenInfo.name}) to drift vault ${vault}?`,
        ));

      try {
        const txSig = await glamClient.driftVaults.deposit(
          vault,
          amountBN,
          txOptions,
        );
        console.log(`Deposit to drift vault ${vault}: ${txSig}`);
      } catch (e) {
        console.error(e);
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
      options?.yes ||
        (await confirmOperation(
          `Confirm requesting to withdraw ${amount} vault shares from ${vault}?`,
        ));

      const amountBN = new BN(amount * 10 ** 6);
      try {
        const txSig = await glamClient.driftVaults.requestWithdraw(
          vault,
          amountBN,
          txOptions,
        );
        console.log(`Request to withdraw from drift vault ${vault}: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  driftVaults
    .command("cancel-withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Cancel the pending withdraw request")
    .action(async (vault) => {
      try {
        const txSig = await glamClient.driftVaults.cancelWithdrawRequest(
          vault,
          txOptions,
        );
        console.log(`Withdraw request cancelled: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  driftVaults
    .command("withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Claim withdrawal")
    .action(async (vault) => {
      try {
        const txSig = await glamClient.driftVaults.withdraw(vault, txOptions);
        console.log(`Confirmed withdrawal from drift vault ${vault}: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });
}
