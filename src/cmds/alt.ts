import { GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

export function installAltCommands(
  alt: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  alt
    .command("create")
    .description("Create address lookup table (ALT) for the active GLAM")
    .action(async () => {
      try {
        const response = await fetch(
          `https://api.glam.systems/v0/lut/vault/create?state=${glamClient.statePda}&payer=${glamClient.getSigner()}`,
        );
        const data = await response.json();
        const table = data.tables[0];
        const b64Txs = data.tx as string[];
        const vTxs = b64Txs.map((b64Tx) =>
          VersionedTransaction.deserialize(
            new Uint8Array(Buffer.from(b64Tx, "base64")),
          ),
        );
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
          const tx = await glamClient.intoVersionedTransaction(
            new Transaction().add(...instructions),
            txOptions,
          );
          const txSig = await glamClient.sendAndConfirm(tx);
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
      const lookupTableAccountss = await glamClient.findLookupTables();

      console.log(
        "Lookup tables:",
        lookupTableAccountss.map((t) => t.key.toBase58()),
      );
    });
}
