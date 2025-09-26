import { ASSETS_MAINNET } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliContext, confirmOperation, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installKaminoLendCommands(klend: Command, context: CliContext) {
  klend
    .command("init")
    .description("Initialize Kamino user")
    .action(async () => {
      try {
        const txSig = await context.glamClient.kaminoLending.initUserMetadata(
          context.txOptions,
        );
        console.log(`Initialized Kamino user:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  klend
    .command("list [market]")
    .description("List Kamino deposits and borrows")
    .action(async (market: string | null) => {
      const vault = context.glamClient.vaultPda;
      const lendingMarket = market ? new PublicKey(market) : null;

      const obligations =
        await context.glamClient.kaminoLending.findAndParseObligations(
          vault,
          lendingMarket,
        );

      console.log(
        "Obligations:",
        obligations.map((o) => o.address.toBase58()),
      );
    });

  klend
    .command("deposit <market> <asset> <amount>")
    .description("Deposit to Kamino Lending market")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (market, asset, amount, options) => {
      options?.yes ||
        (await confirmOperation(`Confirm deposit of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.kaminoLending.deposit(
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          context.txOptions,
        );
        console.log(`Deposit ${amount} ${asset} to Kamino from vault:`, txSig);
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
      options?.yes ||
        (await confirmOperation(`Confirm withdrawing ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.kaminoLending.withdraw(
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          context.txOptions,
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
      options?.yes ||
        (await confirmOperation(`Confirm borrow of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.kaminoLending.borrow(
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          context.txOptions,
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
      options?.yes ||
        (await confirmOperation(`Confirm repay of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.kaminoLending.repay(
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          context.txOptions,
        );
        console.log(`Repaid ${amount} ${asset} to Kamino:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
