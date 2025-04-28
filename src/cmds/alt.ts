import {
  fetchLookupTables,
  GlamClient,
  TxOptions,
} from "@glamsystems/glam-sdk";
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
      const statePda = cliConfig.glamState;
      try {
        const response = await fetch(
          `https://rest2.glam.systems/v0/lut/vault/create?state=${statePda.toBase58()}&payer=${glamClient.getSigner().toBase58()}`,
        );
        const data = await response.json();
        const table = data.tables[0];
        const b64Tx = data.tx[0];
        const vTxFromApi = VersionedTransaction.deserialize(
          new Uint8Array(Buffer.from(b64Tx, "base64")),
        );
        const instructions = vTxFromApi.message.compiledInstructions.map(
          (ix) => {
            return {
              programId:
                vTxFromApi.message.staticAccountKeys[ix.programIdIndex],
              keys: ix.accountKeyIndexes.map((idx) => ({
                pubkey: vTxFromApi.message.staticAccountKeys[idx],
                isSigner: vTxFromApi.message.isAccountSigner(idx),
                isWritable: vTxFromApi.message.isAccountWritable(idx),
              })),
              data: Buffer.from(ix.data),
            };
          },
        );
        const tx = new Transaction().add(...instructions);
        const vTx = await glamClient.intoVersionedTransaction(tx, txOptions);
        const txSig = await glamClient.sendAndConfirm(vTx);
        console.log(`Address lookup table ${table} created:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  alt
    .command("list")
    .description("List lookup table(s) created for the active GLAM")
    .action(async () => {
      const statePda = cliConfig.glamState;
      const lookupTables = await fetchLookupTables(
        glamClient.provider.connection,
        glamClient.getSigner(),
        statePda,
      );
      console.log(
        "Lookup tables:",
        lookupTables.map((t) => t.key.toBase58()),
      );
    });
}
