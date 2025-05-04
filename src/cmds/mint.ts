import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { GlamClient, MintModel, TxOptions } from "@glamsystems/glam-sdk";
import { CliConfig } from "../utils";
import { parseTxError } from "../utils";

export function installMintCommands(
  mint: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  mint
    .command("holders")
    .description("List all token holders")
    .action(async () => {
      try {
        const holders = await glamClient.mint.getHolders();
        console.log(
          "Owner                                      ",
          "\t",
          "Token Account                              ",
          "\t",
          "Amount",
          "\t",
          "Frozen",
        );
        holders.forEach((holder) => {
          console.log(
            holder.owner.toBase58(),
            "\t",
            holder.pubkey.toBase58(),
            "\t",
            holder.uiAmount,
            "\t",
            holder.frozen ? "Yes" : "No",
          );
        });
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("update")
    .description("Update mint policies")
    .option("-l, --lockup <seconds>", "Set lockup period in seconds")
    .option("-f, --frozen <boolean>", "Set default account state frozen")
    .action(async (options) => {
      const mintModel = {} as Partial<MintModel>;

      if (options.lockup) {
        mintModel.lockUpPeriodInSeconds = parseInt(options.lockup);
      }

      if (options.frozen !== undefined) {
        mintModel.defaultAccountStateFrozen = options.frozen === "true";
      }

      if (Object.keys(mintModel).length === 0) {
        console.error("No parameters specified to update");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.mint.update(mintModel, txOptions);
        console.log(`Updated mint policies:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("create-account <owner>")
    .description("Create a token account for a user")
    .option("-f, --frozen <boolean>", "Set account frozen state", "true")
    .action(async (owner, options) => {
      try {
        const ownerPubkey = new PublicKey(owner);
        const frozen = options.frozen === "true";
        const txSig = await glamClient.mint.createTokenAccount(
          ownerPubkey,
          frozen,
          txOptions,
        );
        console.log(`Created token account for ${owner}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("freeze <accounts...>")
    .description("Freeze token accounts (space-separated pubkeys)")
    .action(async (accounts) => {
      try {
        const accountPubkeys = accounts.map((acc) => new PublicKey(acc));
        const txSig = await glamClient.mint.setTokenAccountsStates(
          accountPubkeys,
          true,
          txOptions,
        );
        console.log(`Froze accounts ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("unfreeze <accounts...>")
    .description("Unfreeze token accounts (space-separated pubkeys)")
    .action(async (accounts) => {
      try {
        const accountPubkeys = accounts.map((acc) => new PublicKey(acc));
        const txSig = await glamClient.mint.setTokenAccountsStates(
          accountPubkeys,
          false,
          txOptions,
        );
        console.log(`Unfroze accounts ${accounts}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("issue <recipient> <amount>")
    .description("Mint tokens to a recipient")
    .option(
      "-u, --unfreeze",
      "Unfreeze recipient token account before minting",
      false,
    )
    .action(async (recipient, amount, options) => {
      try {
        const recipientPubkey = new PublicKey(recipient);
        const amountBN = new BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
        const txSig = await glamClient.mint.mint(
          recipientPubkey,
          amountBN,
          options.unfreeze,
          txOptions,
        );
        console.log(`Minted ${amount} tokens to ${recipient}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("burn <from> <amount>")
    .description("Burn tokens from an account")
    .option("-u, --unfreeze", "Unfreeze token account before burning", false)
    .action(async (from, amount, options) => {
      try {
        const fromPubkey = new PublicKey(from);
        const amountBN = new BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
        const txSig = await glamClient.mint.burn(
          amountBN,
          fromPubkey,
          options.unfreeze,
          txOptions,
        );
        console.log(`Burned ${amount} tokens from ${from}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  mint
    .command("transfer <from> <to> <amount>")
    .description("Force transfer tokens between accounts")
    .option("-u, --unfreeze", "Unfreeze accounts before transferring", false)
    .action(async (from, to, amount, options) => {
      try {
        const fromPubkey = new PublicKey(from);
        const toPubkey = new PublicKey(to);
        const amountBN = new BN(parseFloat(amount) * 1e9); // Assuming 9 decimals
        const txSig = await glamClient.mint.forceTransfer(
          amountBN,
          fromPubkey,
          toPubkey,
          options.unfreeze,
          txOptions,
        );
        console.log(
          `Transferred ${amount} tokens from ${from} to ${to}:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
