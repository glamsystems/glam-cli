import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";

export function installKaminoVaultsCommands(
  kvaults: Command,
  context: CliContext,
) {
  kvaults
    .command("deposit")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount, options) => {
      const vaultState =
        await context.glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { tokenMint, tokenMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm depositing ${amount} ${tokenMint} to Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** tokenMintDecimals);
        const txSig = await context.glamClient.kaminoVaults.deposit(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(`Deposit successful: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kvaults
    .command("withdraw")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument(
      "<amount>",
      "Burn Kamino vault tokens and withdraw deposit asset",
      parseFloat,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount, options) => {
      const vaultState =
        await context.glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { sharesMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm withdrawing ${amount} shares from Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** sharesMintDecimals);
        const txSig = await context.glamClient.kaminoVaults.withdraw(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(`Withdraw successful: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
