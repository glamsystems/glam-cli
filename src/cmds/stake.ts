import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { CliContext, parseTxError } from "../utils";

export function installStakeCommands(
  stake: Command,
  context: CliContext,
) {
  stake
    .command("list")
    .description("List all stake accounts")
    .action(async () => {
      try {
        let stakeAccounts =
          await context.glamClient.staking.getStakeAccountsWithStates();
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

  stake
    .command("deactivate")
    .argument(
      "<accounts...>",
      "Stake accounts to deactivate (space-separated pubkeys)",
    )
    .description("Deactivate stake accounts")
    .action(async (accounts: string[]) => {
      try {
        const txSig = await context.glamClient.staking.deactivate(
          accounts.map((a: string) => new PublicKey(a)),
          context.txOptions,
        );
        console.log(`Deactivated ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  stake
    .command("withdraw")
    .argument(
      "<accounts...>",
      "Stake accounts to withdraw from (space-separated pubkeys)",
    )
    .description("Withdraw from stake accounts")
    .action(async (accounts) => {
      try {
        const txSig = await context.glamClient.staking.withdraw(
          accounts.map((a: string) => new PublicKey(a)),
          context.txOptions,
        );
        console.log(`Withdrew from ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
