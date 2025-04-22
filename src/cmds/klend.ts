import {
  ASSETS_MAINNET,
  fetchKaminoObligations,
  GlamClient,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, confirmOperation, parseTxError } from "../utils";
import { PublicKey, Transaction } from "@solana/web3.js";

export function installKlendCommands(
  klend: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  klend
    .command("init")
    .description("Initialize Kamino Lending account")
    .action(async () => {
      const glamState = cliConfig.glamState;
      try {
        const txSig = await glamClient.kaminoLending.initUserMetadata(
          glamState,
          null,
          txOptions,
        );
        console.log(`Initialized Kamino Lending:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  klend
    .command("list [market]")
    .description("List Kamino deposits and borrows")
    .action(async (market: string | null) => {
      const glamState = cliConfig.glamState;
      const vault = glamClient.getVaultPda(glamState);
      const lendingMarket = market ? new PublicKey(market) : null;

      const obligations = await fetchKaminoObligations(
        glamClient.provider.connection,
        vault,
        lendingMarket,
      );

      console.log(
        "Obligations:",
        obligations.map((o) => o.toBase58()),
      );
    });

  klend
    .command("price <market>")
    .description("Price Kamino obligations for the specified market")
    .action(async (market) => {
      const glamState = cliConfig.glamState;
      const vault = glamClient.getVaultPda(glamState);
      const obligation = glamClient.kaminoLending.getObligationPda(
        vault,
        new PublicKey(market),
      );

      const tx = new Transaction();
      const refreshIxs = await glamClient.kaminoLending.getRefreshIxs(
        obligation,
        false,
      );
      tx.add(...refreshIxs);
      try {
        const vTx = await glamClient.intoVersionedTransaction(tx, txOptions);
        const txSig = await glamClient.sendAndConfirm(vTx);
        console.log(`Refreshed Kamino obligation:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }

      const obligations = await fetchKaminoObligations(
        glamClient.provider.connection,
        vault,
      );
      console.log(
        "Obligations:",
        obligations.map((o) => o.toBase58()),
      );
    });

  klend
    .command("deposit <market> <asset> <amount>")
    .description("Deposit to Kamino Lending market")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (market, asset, amount, options) => {
      const statePda = cliConfig.glam_state;

      options?.yes ||
        (await confirmOperation(`Confirm deposit of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.deposit(
          statePda,
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          txOptions,
        );
        console.log(`Deposit ${amount} SOL to Kamino from vault:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  klend
    .command("withdraw <market> <asset> <amount>")
    .description("Withdraw asset from Kamino Lending market")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (market, asset, amount, options) => {
      const statePda = cliConfig.glamState;

      options?.yes ||
        (await confirmOperation(`Confirm repay of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.withdraw(
          statePda,
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          txOptions,
        );
        console.log(`Withdraw ${amount} ${asset} from Kamino:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  klend
    .command("borrow <market> <asset> <amount>")
    .description("Borrow from Kamino Lending market")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (market, asset, amount, options) => {
      const statePda = cliConfig.glamState;

      options?.yes ||
        (await confirmOperation(`Confirm borrow of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.borrow(
          statePda,
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          txOptions,
        );
        console.log(`Borrowed ${amount} ${asset} from Kamino:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  klend
    .command("repay <market> <asset> <amount>")
    .description("Repay loan from Kamino Lending market")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (market, asset, amount, options) => {
      const statePda = cliConfig.glamState;

      options?.yes ||
        (await confirmOperation(`Confirm repay of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.repay(
          statePda,
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          txOptions,
        );
        console.log(`Repaid ${amount} ${asset} to Kamino:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
