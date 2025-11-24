import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  fetchCreateLookupTableTx,
  findGlamLookupTables,
  getExtendLookupTableTx,
} from "@glamsystems/glam-sdk";

function buildLegacyTxFromBase64(b64Tx: string) {
  const vTx = VersionedTransaction.deserialize(
    new Uint8Array(Buffer.from(b64Tx, "base64")),
  );
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
  return new Transaction().add(...instructions);
}

export function installAltCommands(alt: Command, context: CliContext) {
  alt
    .command("create")
    .description(
      "Create address lookup table (ALT) for the connected GLAM vault",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      if (!process.env.GLAM_API) {
        console.error("GLAM_API is not defined in the environment");
        process.exit(1);
      }

      const result = await fetchCreateLookupTableTx(
        context.glamClient.statePda,
        context.glamClient.signer,
      );
      if (!result) {
        console.error("Failed to get lookup table transaction");
        process.exit(1);
      }
      const { tables, tx: b64Txs } = result;

      const table = tables[0];
      options?.yes ||
        (await confirmOperation(
          `Confirm creating address lookup table ${table}?`,
        ));

      // It might need multiple txs to set up tables[0]
      // Build and send txs
      try {
        const txSigs = [];
        for (const b64Tx of b64Txs) {
          const vTx = await context.glamClient.intoVersionedTransaction(
            buildLegacyTxFromBase64(b64Tx),
            context.txOptions,
          );
          const txSig = await context.glamClient.sendAndConfirm(vTx);
          txSigs.push(txSig);
        }

        console.log(`Address lookup table ${table} created:`, txSigs);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  alt
    .command("extend")
    .argument("<table>", "Address lookup table to extend", validatePublicKey)
    .description("Extend an address lookup table")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (tableToExtend: PublicKey, options) => {
      if (!process.env.GLAM_API) {
        console.error("GLAM_API is not defined in the environment");
        process.exit(1);
      }

      const result = await getExtendLookupTableTx(
        context.glamClient.statePda,
        context.glamClient.signer,
      );
      if (!result) {
        console.error("Failed to get lookup table transaction");
        process.exit(1);
      }
      const { tables, tx: b64Txs } = result;

      const table = tables[0];
      if (!new PublicKey(table).equals(tableToExtend)) {
        throw new Error(
          `Address lookup table ${table} from api.glam.systems does not match`,
        );
      }
      options?.yes ||
        (await confirmOperation(
          `Confirm extending address lookup table ${table}?`,
        ));

      // Build and send txs
      try {
        const txSigs = [];
        for (const b64Tx of b64Txs) {
          const vTx = await context.glamClient.intoVersionedTransaction(
            buildLegacyTxFromBase64(b64Tx),
            context.txOptions,
          );
          const txSig = await context.glamClient.sendAndConfirm(vTx);
          txSigs.push(txSig);
        }

        console.log(`Address lookup table ${table} extended:`, txSigs);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  alt
    .command("list")
    .description(
      "List address lookup table(s) created for the connected GLAM vault",
    )
    .action(async () => {
      if (!context.glamClient.isVaultConnected) {
        console.error("GlamClient is not connected to a vault");
        process.exit(1);
      }

      const { statePda, vaultPda, connection } = context.glamClient;
      const lookupTableAccountss = await findGlamLookupTables(
        statePda,
        vaultPda,
        connection,
      );

      console.log("GLAM address lookup tables:");
      lookupTableAccountss.map((t, i) => console.log(`[${i}] ${t.key}`));
    });
}
