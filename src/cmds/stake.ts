import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import { getStakeAccountsWithStates } from "@glamsystems/glam-sdk";

export function installStakeCommands(stake: Command, context: CliContext) {
  stake
    .command("list")
    .description("List all stake accounts")
    .action(async () => {
      try {
        const stakeAccounts = await getStakeAccountsWithStates(
          context.glamClient.connection,
          context.glamClient.vaultPda,
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

  stake
    .command("deactivate")
    .argument(
      "<accounts...>",
      "Stake accounts to deactivate (space-separated pubkeys)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deactivate stake accounts")
    .action(async (accounts: string[], options) => {
      const accountsArray = accounts.map(validatePublicKey);
      const accountList = accountsArray.map((a) => a.toBase58()).join(", ");

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.stake.deactivate(accountsArray, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm deactivating ${accountsArray.length} stake account(s):\n  ${accountList}`,
        },
        (txSig) =>
          `Deactivated ${accountsArray.length} stake account(s): ${txSig}`,
      );
    });

  stake
    .command("withdraw")
    .argument(
      "<accounts...>",
      "Stake accounts to withdraw from (space-separated pubkeys)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw from stake accounts")
    .action(async (accounts: string[], options) => {
      // Parse all account strings to PublicKeys
      const accountsArray = accounts.map(validatePublicKey);
      const accountList = accountsArray.map((a) => a.toBase58()).join(", ");

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.stake.withdraw(accountsArray, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm withdrawing from ${accountsArray.length} stake account(s):\n  ${accountList}`,
        },
        (txSig) => `Withdrawal completed: ${txSig}`,
      );
    });
}
