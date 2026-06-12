import { type Command } from "commander";
import { type PublicKey } from "@solana/web3.js";
import {
  type CliContext,
  executeTxWithErrorHandling,
  resolveTokenPublicKey,
} from "../utils";
import { parsePositiveUiAmount, validatePublicKey } from "../parsing";

export function installLstCommands(lst: Command, context: CliContext) {
  lst
    .command("stake")
    .argument("<stake-pool>", "Stake pool address", validatePublicKey)
    .argument("<amount>", "UI amount of SOL to stake")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Stake SOL into a LST pool")
    .action(async (stakePool: PublicKey, amount: string, options) => {
      const amountBN = parsePositiveUiAmount(amount, 9, "amount");

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.stakePool.depositSol(
            stakePool,
            amountBN,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm staking ${amount} SOL into ${stakePool}`,
        },
        (txSig) => `Staked ${amount} SOL: ${txSig}`,
      );
    });
  lst
    .command("unstake")
    .argument("<token>", "LST mint address or symbol")
    .argument("<amount>", "UI amount of LST to unstake")
    .option("-d, --deactivate", "Deactivate the stake account", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Unstake LST and receive SOL in a stake account")
    .action(async (token: string, amount: string, options) => {
      const asset = await resolveTokenPublicKey(context.glamClient, token);
      const amountBN = parsePositiveUiAmount(amount, 9, "amount");

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.stakePool.unstake(
            asset,
            amountBN,
            options.deactivate,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm unstaking ${amount} ${asset}`,
        },
        (txSig) => `Unstaked ${amount} ${asset}: ${txSig}`,
      );
    });
}
