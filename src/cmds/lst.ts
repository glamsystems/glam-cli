import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import { fromUiAmount } from "@glamsystems/glam-sdk";

export function installLstCommands(lst: Command, context: CliContext) {
  lst
    .command("stake")
    .argument("<stakepool>", "Stake pool address", validatePublicKey)
    .argument("<amount>", "Amount to stake", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Stake SOL into a LST pool")
    .action(async (stakepool, amount, options) => {
      const amountBN = fromUiAmount(parseFloat(amount), 9);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.stakePool.depositSol(
            new PublicKey(stakepool),
            amountBN,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm staking ${amount} SOL into ${stakepool}`,
        },
        (txSig) => `Staked ${amount} SOL: ${txSig}`,
      );
    });
  lst
    .command("unstake")
    .argument("<asset>", "LST mint address", validatePublicKey)
    .argument("<amount>", "Amount to unstake", parseFloat)
    .option("-d, --deactivate", "Deactivate the stake account", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Unstake LST and receive SOL in a stake account")
    .action(async (asset, amount, options) => {
      const amountBN = fromUiAmount(amount, 9);

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
