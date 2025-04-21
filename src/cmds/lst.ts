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
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.staking.stakePoolDepositSol(
          statePda,
          new PublicKey(stakepool),
          //TODO: better decimals (even though all LSTs have 9 right now)
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL),
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
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.staking.unstake(
          statePda,
          new PublicKey(asset),
          //TODO: better decimals (even though all LSTs have 9 right now)
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL),
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
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        let stakeAccounts = await glamClient.staking.getStakeAccountsWithStates(
          glamClient.getVaultPda(statePda),
        );
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
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.staking.withdraw(
          statePda,
          accounts.map((addr: string) => new PublicKey(addr)),
        );
        console.log(`Withdrew from ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
