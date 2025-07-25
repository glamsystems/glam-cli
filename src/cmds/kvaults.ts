import { ASSETS_MAINNET, GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliConfig,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installKVaultsCommands(
  kvaults: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  kvaults
    .command("deposit")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount, options) => {
      const vaultState =
        await glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { tokenMint, tokenMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm depositing ${amount} ${tokenMint} to Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** tokenMintDecimals);
        const txSig = await glamClient.kaminoVaults.deposit(
          vault,
          amountBN,
          txOptions,
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
        await glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { sharesMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm withdrawing ${amount} shares from Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** sharesMintDecimals);
        const txSig = await glamClient.kaminoVaults.withdraw(
          vault,
          amountBN,
          txOptions,
        );
        console.log(`Withdraw successful: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
