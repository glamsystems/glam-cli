import { Command } from "commander";
import { CliContext, confirmOperation, parseTxError } from "../utils";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

export function installAltCommands(alt: Command, context: CliContext) {
  alt
    .command("create")
    .description("Create address lookup table (ALT) for the active GLAM")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      if (!process.env.GLAM_API) {
        console.error("GLAM_API is not defined in the environment");
        process.exit(1);
      }
      try {
        const response = await fetch(
          `${process.env.GLAM_API}/v0/lut/vault/create?state=${context.glamClient.statePda}&payer=${context.glamClient.signer}`,
        );
        const data = await response.json();
        const table = data.tables[0];
        const b64Txs = data.tx as string[];
        const vTxs = b64Txs.map((b64Tx) =>
          VersionedTransaction.deserialize(
            new Uint8Array(Buffer.from(b64Tx, "base64")),
          ),
        );
        options?.yes ||
          (await confirmOperation(
            `Confirm creating address lookup table ${table}?`,
          ));
        const txSigs = [];
        for (const vTx of vTxs) {
          const instructions = vTx.message.compiledInstructions.map((ix) => {
            return {
              programId: vTx.message.staticAccountKeys[ix.programIdIndex],
              keys: ix.accountKeyIndexes.map((idx) => ({
                pubkey: vTx.message.staticAccountKeys[idx],
                isSigner: vTx.message.isAccountSigner(idx),
                isWritable: vTx.message.isAccountWritable(idx),
              })),
              data: Buffer.from(ix.data),
            };
          });
          const tx = await context.glamClient.intoVersionedTransaction(
            new Transaction().add(...instructions),
            context.txOptions,
          );
          const txSig = await context.glamClient.sendAndConfirm(tx);
          txSigs.push(txSig);
        }
        console.log(`Address lookup table ${table} created:`, txSigs);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  alt
    .command("list")
    .description("List lookup table(s) created for the active GLAM")
    .action(async () => {
      const lookupTableAccountss = await context.glamClient.findLookupTables();

      console.log("Lookup tables:");
      lookupTableAccountss.map((t, i) => console.log(`[${i}] ${t.key}`));
    });
}
