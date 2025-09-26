import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { CliContext, parseTxError } from "../utils";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function installMarinadeCommands(
  marinade: Command,
  context: CliContext,
) {
  marinade
    .command("stake <amount>")
    .description("Stake <amount> SOL and get mSOL")
    .action(async (amount) => {
      try {
        const txSig = await context.glamClient.marinade.deposit(
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL),
          context.txOptions,
        );
        console.log(`Staked ${amount} SOL to Marinade:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  marinade
    .command("stake-native <amount>")
    .description("Stake <amount> SOL")
    .action(async (amount) => {
      try {
        const txSig = await context.glamClient.marinade.depositNative(
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL),
          context.txOptions,
        );
        console.log(`Staked ${amount} SOL to Marinade:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  marinade
    .command("withdraw-stake")
    .argument("<amount>", "mSOL amount", parseFloat)
    .option("-d, --deactivate", "Deactivate the stake account", false)
    .description("Withdraw <amount> mSOL into a stake account")
    .action(async (amount, options) => {
      const amountBN = new BN(amount * LAMPORTS_PER_SOL);
      try {
        const txSig = await context.glamClient.marinade.withdrawStakeAccount(
          amountBN,
          options.deactivate,
          context.txOptions,
        );
        console.log(`Withdraw ${amount} mSOL:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
