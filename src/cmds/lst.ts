import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { CliConfig, parseTxError, validatePublicKey } from "../utils";

export function installLstCommands(
  lst: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  lst
    .command("stake <stakepool> <amount>")
    .description("Stake <amount> SOL into <stakepool>")
    .action(async (stakepool, amount) => {
      try {
        const txSig = await glamClient.staking.stakePoolDepositSol(
          new PublicKey(stakepool),
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL), // TODO: better decimals (even though all LSTs have 9 right now)
          txOptions,
        );
        console.log("txSig", txSig);
        console.log(`Staked ${amount} SOL into ${stakepool}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
  lst
    .command("unstake")
    .argument("<asset>", "LST mint address", validatePublicKey)
    .argument("<amount>", "Amount to unstake", parseFloat)
    .option("-d, --deactivate", "Deactivate the stake account", false)
    .description("Unstake <amount> worth of <asset> (mint address)")
    .action(async (asset, amount, options) => {
      const amountBN = new BN(amount * LAMPORTS_PER_SOL);

      try {
        const txSig = await glamClient.staking.unstake(
          asset,
          amountBN,
          options.deactivate,
          txOptions,
        );
        console.log(`Unstaked ${amount} ${asset}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
