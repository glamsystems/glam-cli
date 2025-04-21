import { BN } from "@coral-xyz/anchor";
import { GlamClient, PriceDenom, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";

export function installDriftCommands(
  drift: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  drift
    .command("price")
    .description("Price drift")
    .action(async () => {
      try {
        const marketConfigs = await glamClient.drift.fetchMarketConfigs();
        const txSig = await glamClient.drift.priceDrift(
          cliConfig.glamState,
          marketConfigs,
          PriceDenom.USD,
          txOptions,
        );
        console.log(`Pricing tx: ${txSig}`);
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.error(e);
        } else {
          console.error(parseTxError(e));
        }
        process.exit(1);
      }
    });

  drift
    .command("init")
    .description("Initialize drift user")
    .action(async () => {
      try {
        const txSig = await glamClient.drift.initialize(
          cliConfig.glamState,
          0,
          txOptions,
        );
        console.log(`Initialize drift user: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("list")
    .description("List drift positions")
    .action(async () => {
      try {
        const { spotPositions, perpPositions } =
          await glamClient.drift.getPositions(cliConfig.glamState, 0);

        console.log("Spot positions:", spotPositions);
        console.log("Perp positions:", perpPositions);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  drift
    .command("withdraw <market_index> <amount>")
    .description("Withdraw from drift")
    .action(async (market_index, amount) => {
      try {
        const marketConfigs = await glamClient.drift.fetchMarketConfigs();

        const marketConfig = marketConfigs.spot.find(
          (m) => m.marketIndex === parseInt(market_index),
        );
        const amountBn = new BN(Number(amount) * 10 ** marketConfig.decimals);

        const txSig = await glamClient.drift.withdraw(
          cliConfig.glamState,
          amountBn,
          marketConfig.marketIndex,
          0,
          marketConfigs,
          txOptions,
        );

        console.log(`Withdraw from drift: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  drift
    .command("deposit <market_index> <amount>")
    .description("Deposit to drift")
    .action(async (market_index, amount) => {
      try {
        const marketConfigs = await glamClient.drift.fetchMarketConfigs();

        const marketConfig = marketConfigs.spot.find(
          (m) => m.marketIndex === parseInt(market_index),
        );
        const amountBn = new BN(Number(amount) * 10 ** marketConfig.decimals);

        const txSig = await glamClient.drift.deposit(
          cliConfig.glamState,
          amountBn,
          marketConfig.marketIndex,
          0,
          marketConfigs,
          txOptions,
        );

        console.log(`Deposited to drift: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  drift
    .command("delete")
    .description("Delete a drift user")
    .action(async () => {
      try {
        const txSig = await glamClient.drift.deleteUser(
          cliConfig.glamState,
          0,
          txOptions,
        );
        console.log(`Deleted drift user: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
