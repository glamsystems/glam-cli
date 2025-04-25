import { BN } from "@coral-xyz/anchor";
import {
  getOrderParams,
  GlamClient,
  MarketType,
  OrderType,
  PositionDirection,
  PriceDenom,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, confirmOperation, parseTxError } from "../utils";

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
        const txSig = await glamClient.drift.priceDrift(
          cliConfig.glamState,
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
    .command("positions")
    .description("List drift positions")
    .action(async () => {
      try {
        const { spotPositions } = await glamClient.drift.fetchDriftUser(
          cliConfig.glamState,
        );
        for (const { marketIndex, uiAmount, marketName } of spotPositions) {
          console.log(
            `${uiAmount} ${marketName} (market index: ${marketIndex})`,
          );
        }

        // TODO: print perp positions
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

        const marketConfig = marketConfigs.spotMarkets.find(
          (m) => m.marketIndex === parseInt(market_index),
        );
        const amountBn = new BN(Number(amount) * 10 ** marketConfig.decimals);

        const txSig = await glamClient.drift.withdraw(
          cliConfig.glamState,
          amountBn,
          marketConfig.marketIndex,
          0,
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

        const marketConfig = marketConfigs.spotMarkets.find(
          (m) => m.marketIndex === parseInt(market_index),
        );
        const amountBn = new BN(Number(amount) * 10 ** marketConfig.decimals);

        const txSig = await glamClient.drift.deposit(
          cliConfig.glamState,
          amountBn,
          marketConfig.marketIndex,
          0,
          txOptions,
        );

        console.log(`Deposited to drift: ${txSig}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    });

  drift
    .command("spot <direction> <market_index> <amount> <price_limit>")
    .description("Place a limit spot order. Price limit is in USD.")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (direction, market_index, amount, price_limit, options) => {
      if (!["long", "short"].includes(direction)) {
        console.error("Invalid direction. Must be 'long' or 'short'");
        process.exit(1);
      }

      const marketConfigs = await glamClient.drift.fetchMarketConfigs();
      const spotMarket = marketConfigs?.spotMarkets?.find(
        (m) => m.marketIndex === parseInt(market_index),
      );

      if (!spotMarket) {
        console.error(`Invalid market index: ${market_index}`);
        process.exit(1);
      }
      const baseAssetAmount = new BN(
        Number(amount) * 10 ** spotMarket.decimals,
      );
      const price = new BN(
        Number(price_limit) * 10 ** marketConfigs.orderConstants.quoteScale,
      );

      const orderParams = getOrderParams({
        orderType: OrderType.LIMIT,
        marketType: MarketType.SPOT,
        direction:
          direction === "long"
            ? PositionDirection.LONG
            : PositionDirection.SHORT,
        marketIndex: spotMarket.marketIndex,
        baseAssetAmount,
        price,
      });

      options?.yes ||
        (await confirmOperation(
          `Confirm placing ${direction} order for ${amount} ${spotMarket.name} at ${price_limit} USD?`,
        ));

      try {
        const txSig = await glamClient.drift.placeOrder(
          cliConfig.glamState,
          orderParams,
          0,
          txOptions,
        );
        console.log(`Spot order placed: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("perp <direction> <market_index> <amount> <price_limit>")
    .description("Place a limit perp order. Price limit is in USD.")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (direction, market_index, amount, price_limit, options) => {
      if (!["long", "short"].includes(direction)) {
        console.error("Invalid direction. Must be 'long' or 'short'");
        process.exit(1);
      }

      const marketConfigs = await glamClient.drift.fetchMarketConfigs();
      const perpMarket = marketConfigs?.perpMarkets?.find(
        (m) => m.marketIndex === parseInt(market_index),
      );

      if (!perpMarket) {
        console.error(`Invalid market index: ${market_index}`);
        process.exit(1);
      }
      const baseAssetAmount = new BN(
        Number(amount) * 10 ** marketConfigs.orderConstants.perpBaseScale,
      );
      const price = new BN(
        Number(price_limit) * 10 ** marketConfigs.orderConstants.quoteScale,
      );

      const orderParams = getOrderParams({
        orderType: OrderType.LIMIT,
        marketType: MarketType.PERP,
        direction:
          direction === "long"
            ? PositionDirection.LONG
            : PositionDirection.SHORT,
        marketIndex: perpMarket.marketIndex,
        baseAssetAmount,
        price,
      });

      options?.yes ||
        (await confirmOperation(
          `Confirm placing ${direction} order for ${amount} ${perpMarket.name} at ${price_limit} USD?`,
        ));

      try {
        const txSig = await glamClient.drift.placeOrder(
          cliConfig.glamState,
          orderParams,
          0,
          txOptions,
        );
        console.log(`Perp order placed: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("orders")
    .description("List open orders")
    .action(async () => {
      const driftUser = await glamClient.drift.fetchDriftUser(
        cliConfig.glamState,
      );
      if (!driftUser) {
        console.error("Drift user not found");
        process.exit(1);
      }

      const marketConfigs = await glamClient.drift.fetchMarketConfigs();

      const { orders } = driftUser;
      for (const {
        orderId,
        marketIndex,
        direction,
        baseAssetAmount,
        price,
        orderType,
        marketType,
      } of orders) {
        const orderTypeStr = Object.entries(orderType)[0][0];
        const directionStr = Object.entries(direction)[0][0];
        if (marketType === MarketType.SPOT) {
          const marketConfig = marketConfigs.spotMarkets.find(
            (m) => m.marketIndex === marketIndex,
          );
          const amount =
            baseAssetAmount.toNumber() / 10 ** marketConfig.decimals;
          const priceStr =
            price.toNumber() / 10 ** marketConfigs.orderConstants.quoteScale;
          const marketName = marketConfig.name;

          console.log(
            `Order ID ${orderId}: ${orderTypeStr} ${directionStr} order for ${amount} ${marketName} at $${priceStr}`,
          );
        } else {
          const marketConfig = marketConfigs.perpMarkets.find(
            (m) => m.marketIndex === marketIndex,
          );
          const amount =
            baseAssetAmount.toNumber() /
            10 ** marketConfigs.orderConstants.perpBaseScale;
          const priceStr =
            price.toNumber() / 10 ** marketConfigs.orderConstants.quoteScale;
          const marketName = marketConfig.name;

          console.log(
            `Order ID ${orderId}: ${orderTypeStr} ${directionStr} order for ${amount} ${marketName} at $${priceStr}`,
          );
        }
      }
    });

  drift
    .command("cancel")
    .argument(
      "<order_ids...>",
      "A space-separated list of order IDs. Use `drift orders` to list open orders.",
    )
    .description("Cancel order")
    .action(async (order_ids) => {
      try {
        const txSig = await glamClient.drift.cancelOrdersByIds(
          cliConfig.glamState,
          order_ids.map((id) => Number(id)),
          0,
          txOptions,
        );
        console.log(`Order cancelled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("margin <enabled>")
    .description("Enable margin trading")
    .action(async (enabled) => {
      let shouldEnable = false;
      if (["true", "1", "yes", "y", "enabled"].includes(enabled)) {
        shouldEnable = true;
      }

      const driftUser = await glamClient.drift.fetchDriftUser(
        cliConfig.glamState,
      );
      if (!driftUser) {
        console.error("Drift user not found");
        process.exit(1);
      }

      const { isMarginTradingEnabled } = driftUser;
      if (isMarginTradingEnabled === shouldEnable) {
        console.log(
          `Margin trading already ${shouldEnable ? "enabled" : "disabled"}`,
        );
        return;
      }

      try {
        const txSig = await glamClient.drift.updateUserMarginTradingEnabled(
          cliConfig.glamState,
          shouldEnable,
          0,
          txOptions,
        );
        console.log(
          `Margin trading ${shouldEnable ? "enabled" : "disabled"}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
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
