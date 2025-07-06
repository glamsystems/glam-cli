import { GlamClient, TxOptions, VoteAuthorize } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliConfig,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export function installValidatorCommands(
  program: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  program
    .command("authorize")
    .argument("<vote>", "Vote account pubkey", validatePublicKey)
    .argument("<new-authority>", "New authority pubkey", validatePublicKey)
    .argument("<role>", "Role to authorize: voter or withdrawer", (role) => {
      if (role !== "voter" && role !== "withdrawer") {
        throw new Error("Role must be 'voter' or 'withdrawer'");
      }
      return role;
    })
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Authorize a new authority for the vote account")
    .action(async (vote, clock, newAuthority, role, options) => {
      options?.yes ||
        (await confirmOperation(
          `Authorize ${role} for vote account ${vote} to ${newAuthority}?`,
        ));
      try {
        const txSig = await glamClient.validator.voteAuthorize(
          new PublicKey(vote),
          new PublicKey(newAuthority),
          // @ts-ignore
          role === "voter" ? VoteAuthorize.Voter : VoteAuthorize.Withdrawer,
          txOptions,
        );
        console.log(`Vote authority updated:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("update-identity")
    .argument("<vote>", "Vote account pubkey", validatePublicKey)
    .argument("<new-identity>", "Validator identity pubkey", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Update the validator identity for the vote account")
    .action(async (vote, newIdentity, options) => {
      options?.yes ||
        (await confirmOperation(
          `Update validator identity for vote account ${vote} to ${newIdentity}?`,
        ));
      try {
        const txSig = await glamClient.validator.voteUpdateValidatorIdentity(
          new PublicKey(vote),
          Keypair.fromSecretKey(newIdentity), //TODO: input from file?
          txOptions,
        );
        console.log(`Validator identity updated:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("update-commission")
    .argument("<vote>", "Vote account pubkey", validatePublicKey)
    .argument("<commission>", "New commission (0-100)", (c) => {
      const n = Number(c);
      if (isNaN(n) || n < 0 || n > 100) throw new Error("Invalid commission");
      return n;
    })
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Update the commission for the vote account")
    .action(async (vote, commission, options) => {
      options?.yes ||
        (await confirmOperation(
          `Update commission for vote account ${vote} to ${commission}?`,
        ));
      try {
        const txSig = await glamClient.validator.voteUpdateCommission(
          new PublicKey(vote),
          commission,
          txOptions,
        );
        console.log(`Vote commission updated:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("withdraw")
    .argument("<vote>", "Vote account pubkey", validatePublicKey)
    .argument("<recipient>", "Recipient pubkey", validatePublicKey)
    .argument("<lamports>", "Amount to withdraw (lamports)", (l) => {
      const n = Number(l);
      if (isNaN(n) || n <= 0) throw new Error("Invalid lamports");
      return n;
    })
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Withdraw lamports from the vote account to a recipient")
    .action(async (vote, recipient, lamports, options) => {
      options?.yes ||
        (await confirmOperation(
          `Withdraw ${lamports} lamports from vote account ${vote} to ${recipient}?`,
        ));
      try {
        const txSig = await glamClient.validator.voteWithdraw(
          new PublicKey(vote),
          new PublicKey(recipient),
          new BN(lamports),
          txOptions,
        );
        console.log(`Vote withdrawal complete:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
