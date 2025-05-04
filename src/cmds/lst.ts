import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { CliConfig, parseTxError } from "../utils";

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
    .command("unstake <asset> <amount>")
    .description("Unstake <amount> worth of <asset> (mint address)")
    .action(async (asset, amount) => {
      try {
        const txSig = await glamClient.staking.unstake(
          new PublicKey(asset),
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL), // TODO: better decimals (even though all LSTs have 9 right now)
          txOptions,
        );
        console.log(`Unstaked ${amount} ${asset}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
  lst
    .command("list")
    .description("List all stake accounts")
    .action(async () => {
      try {
        let stakeAccounts =
          await glamClient.staking.getStakeAccountsWithStates();
        console.log(
          "Account                                     ",
          "\t",
          "Lamports",
          "\t",
          "State",
        );
        stakeAccounts.forEach((acc: any) => {
          console.log(
            acc.address.toBase58(),
            "\t",
            acc.lamports,
            "\t",
            acc.state,
          );
        });
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });
  lst
    .command("withdraw <accounts...>")
    .description("Withdraw staking accounts (space-separated pubkeys)")
    .action(async (accounts) => {
      try {
        const txSig = await glamClient.staking.withdraw(
          accounts.map((addr: string) => new PublicKey(addr)),
        );
        console.log(`Withdrew from ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
