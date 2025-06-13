import { ASSETS_MAINNET, GlamClient, TxOptions } from "@glamsystems/glam-sdk";
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
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount) => {
      console.log(`Depositing ${amount} to Kamino vault ${vault}`);
      const txSig = await glamClient.kaminoVaults.deposit(
        vault,
        amount,
        txOptions,
      );
      console.log(`Transaction signature: ${txSig}`);
    });

  kvaults
    .command("withdraw")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument(
      "<amount>",
      "Burn Kamino vault tokens and withdraw deposit asset",
      parseFloat,
    )
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount) => {
      console.log(`Withdraw ${amount} from Kamino vault ${vault}`);
      const txSig = await glamClient.kaminoVaults.withdraw(
        vault,
        amount,
        txOptions,
      );
      console.log(`Transaction signature: ${txSig}`);
    });
}
