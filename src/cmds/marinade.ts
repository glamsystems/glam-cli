import { BN } from "@coral-xyz/anchor";
import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

export function installMarinadeCommands(
  marinade: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  marinade
    .command("stake <amount>")
    .description("Stake <amount> SOL and get mSOL")
    .action(async (amount, options) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;
      if (!statePda) {
        console.error("GLAM state not found in config file");
      }
      try {
        const txSig = await glamClient.marinade.deposit(
          statePda,
          new BN(parseFloat(amount) * LAMPORTS_PER_SOL),
          txOptions,
        );
        console.log(`Staked ${amount} SOL to Marinade:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
  marinade
    .command("list")
    .description("List all Marinade tickets")
    .action(async () => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        let stakeAccounts = await glamClient.marinade.getTickets(statePda);
        console.log(
          "Ticket                                      ",
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
  marinade
    .command("claim <tickets...>")
    .description("Claim Marinade tickets (space-separated)")
    .action(async (tickets) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.marinade.claim(
          statePda,
          tickets.map((addr: string) => new PublicKey(addr)),
        );
        console.log(`Claimed ${tickets}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
