import { BN } from "@coral-xyz/anchor";
import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installJupCommands(
  jup: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  jup
    .command("stake <amount>")
    .description("Stake JUP tokens")
    .action(async (amount) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.jupiterVote.stakeJup(
          statePda,
          new BN(amount * 10 ** 6), // decimals 6
        );
        console.log("txSig", txSig);
        console.log(`Staked ${amount} JUP`);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  jup
    .command("unstake")
    .description("Unstake all JUP tokens")
    .action(async () => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.jupiterVote.unstakeJup(statePda);
        console.log("txSig", txSig);
        console.log("Unstaked all JUP tokens");
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  jup
    .command("withdraw")
    .description("Withdraw all unstaked JUP")
    .action(async () => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.jupiterVote.withdrawJup(statePda);
        console.log("txSig", txSig);
        console.log("Withdrawn all JUP");
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  jup
    .command("vote <proposal> <side>")
    .description("Vote on a proposal")
    .action(async (_proposal, side) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not set");
        process.exit(1);
      }

      let proposal;
      let governor;
      try {
        proposal = new PublicKey(_proposal);
        const proposalAccountInfo =
          await glamClient.provider.connection.getAccountInfo(proposal);
        governor = new PublicKey(proposalAccountInfo.data.subarray(8, 40)); // first 8 bytes are discriminator
        console.log("Proposal governor:", governor.toBase58());
      } catch (e) {
        console.error("Error: invalid proposal:", _proposal);
        process.exit(1);
      }

      try {
        const txId = await glamClient.jupiterVote.voteOnProposal(
          statePda,
          proposal,
          Number(side),
        );
        console.log(
          `Cast vote on proposal ${proposal.toBase58()} with side ${side}:`,
          txId,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
