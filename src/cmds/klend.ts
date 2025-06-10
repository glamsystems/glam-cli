import { ASSETS_MAINNET, GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, confirmOperation, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installKlendCommands(
  klend: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  klend
    .command("init")
    .description("Initialize Kamino user")
    .action(async () => {
      try {
        const txSig =
          await glamClient.kaminoLending.initUserMetadata(txOptions);
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
      const vault = glamClient.vaultPda;
      const lendingMarket = market ? new PublicKey(market) : null;

      const obligations =
        await glamClient.kaminoLending.findAndParseObligations(
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
        const txSig = await glamClient.kaminoLending.deposit(
          market,
          asset,
          parseFloat(amount) * 10 ** decimals,
          txOptions,
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
        const txSig = await glamClient.kaminoLending.withdraw(
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
      options?.yes ||
        (await confirmOperation(`Confirm borrow of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.borrow(
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
      options?.yes ||
        (await confirmOperation(`Confirm repay of ${amount} ${asset}?`));

      const decimals = ASSETS_MAINNET.get(asset)?.decimals;
      if (!decimals) {
        console.error(`Asset ${asset} not supported`);
        process.exit(1);
      }

      try {
        const txSig = await glamClient.kaminoLending.repay(
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

  klend
    .command("harvest")
    .description("Harvest Kamino farms rewards")
    .action(async () => {
      try {
        const txSig = await glamClient.kaminoFarm.harvest(txOptions);
        console.log(`Harvested farm rewards:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
