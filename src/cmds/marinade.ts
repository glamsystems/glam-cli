import { Command } from "commander";
import { CliContext, executeTxWithErrorHandling } from "../utils";
import { fromUiAmount } from "@glamsystems/glam-sdk";

export function installMarinadeCommands(
  marinade: Command,
  context: CliContext,
) {
  marinade
    .command("stake")
    .argument("<amount>", "amount of SOL to stake", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Stake SOL and get mSOL")
    .action(async (amount, options) => {
      const amountBN = fromUiAmount(parseFloat(amount), 9);
      await executeTxWithErrorHandling(
        () => context.glamClient.marinade.deposit(amountBN, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm staking ${amount} SOL to Marinade stake pool`,
        },
        (txSig) => `Staked ${amount} SOL: ${txSig}`,
      );
    });

  marinade
    .command("stake-native")
    .argument("<amount>", "amount of SOL to stake", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Stake SOL to Marinade Native")
    .action(async (amount, options) => {
      const amountBN = fromUiAmount(parseFloat(amount), 9);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.marinade.depositNative(
            amountBN,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm staking ${amount} SOL to Marinade Native`,
        },
        (txSig) => `Staked ${amount} SOL to Marinade Native: ${txSig}`,
      );
    });

  marinade
    .command("withdraw-stake")
    .argument("<amount>", "mSOL amount", parseFloat)
    .option("-d, --deactivate", "Deactivate the stake account", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw <amount> mSOL into a stake account")
    .action(async (amount, options) => {
      const amountBN = fromUiAmount(amount, 9);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.marinade.withdrawStakeAccount(
            amountBN,
            options.deactivate,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm withdrawing ${amount} mSOL into a stake account`,
        },
        (txSig) => `Withdraw ${amount} mSOL: ${txSig}`,
      );
    });
}
