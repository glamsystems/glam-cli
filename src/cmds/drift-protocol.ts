import { BN } from "@coral-xyz/anchor";
import {
  DriftProtocolPolicy,
  getOrderParams,
  MarketType,
  OrderType,
  PositionDirection,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
  validateSubAccountId,
} from "../utils";
import { Transaction } from "@solana/web3.js";

export function installDriftProtocolCommands(
  drift: Command,
  context: CliContext,
) {
  drift
    .command("view-policy")
    .description("View drift policy")
    .action(async () => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extDriftProgram.programId,
        0b01,
        DriftProtocolPolicy,
      );
      console.log(policy);
    });

  drift
    .command("allowlist-market")
    .argument("<market_type>", "Market type", (v) => {
      if (v !== "spot" && v !== "perp") {
        console.error("Invalid market type, must be 'spot' or 'perp'");
        process.exit(1);
      }
      return v;
    })
    .argument("<market_index>", "Spot or perp market index", parseInt)
    .description("Add a market to the allowlist")
    .action(async (marketType, marketIndex) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          DriftProtocolPolicy,
        )) ?? new DriftProtocolPolicy([], [], []);

      if (marketType === "spot") {
        policy.spotMarketsAllowlist.push(marketIndex);
      } else {
        policy.perpMarketsAllowlist.push(marketIndex);
      }
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(
          `${marketType} market ${marketIndex} added to allowlist:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("remove-market")
    .argument("<market_type>", "Market type", (v) => {
      if (v !== "spot" && v !== "perp") {
        console.error("Invalid market type, must be 'spot' or 'perp'");
        process.exit(1);
      }
      return v;
    })
    .argument("<market_index>", "Spot or perp market index", parseInt)
    .description("Remove a market from the allowlist")
    .action(async (marketType, marketIndex) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extDriftProgram.programId,
        0b01,
        DriftProtocolPolicy,
      );
      if (!policy) {
        console.error("Drift policy not found");
        process.exit(1);
      }

      if (marketType === "spot") {
        policy.spotMarketsAllowlist = policy.spotMarketsAllowlist.filter(
          (m) => m !== marketIndex,
        );
      } else {
        policy.perpMarketsAllowlist = policy.perpMarketsAllowlist.filter(
          (m) => m !== marketIndex,
        );
      }
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(
          `${marketType} market ${marketIndex} removed from allowlist:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("allowlist-borrowable-asset")
    .argument("<token_mint>", "Token mint public key", validatePublicKey)
    .description("Add a borrowable asset to the allowlist")
    .action(async (tokenMint) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          DriftProtocolPolicy,
        )) ?? new DriftProtocolPolicy([], [], []);

      policy.borrowAllowlist.push(tokenMint);

      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Borrowable asset ${tokenMint} added to allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("remove-borrowable-asset")
    .argument("<token_mint>", "Token mint public key", validatePublicKey)
    .description("Remove a borrowable asset from the allowlist")
    .action(async (tokenMint) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extDriftProgram.programId,
        0b01,
        DriftProtocolPolicy,
      );
      if (!policy) {
        console.error("Drift policy not found");
        process.exit(1);
      }

      policy.borrowAllowlist = policy.borrowAllowlist.filter(
        (m) => !m.equals(tokenMint),
      );
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(
          `Borrowable asset ${tokenMint} removed from allowlist:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("init-user")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .option("-p, --pool-id <pool_id>", "Isolated pool ID", parseInt, 0)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Initialize drift user")
    .action(async ({ subAccountId, poolId: _poolId, yes }) => {
      yes ||
        (await confirmOperation(
          `Initializing drift user (sub-account ${subAccountId})`,
        ));

      try {
        const txSig = await context.glamClient.drift.initialize(
          subAccountId,
          context.txOptions,
        );
        console.log(
          `Drift user (sub-account ${subAccountId}) initialized: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("users")
    .description("List drift users (sub accounts)")
    .action(async () => {
      const driftUsers = await context.glamClient.drift.fetchDriftUsers();
      console.log(`${driftUsers.length} Drift users found`);
      driftUsers.map((u, i) => {
        console.log(`[${i}]: ${u.name} (Pool ID: ${u.poolId})`);
      });
    });

  drift
    .command("positions")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("List drift positions")
    .action(async ({ subAccountId }) => {
      const user = await context.glamClient.drift.fetchDriftUser(subAccountId);
      if (!user) {
        console.error(
          `Drift user not found for sub-account ID ${subAccountId}. Please specify a valid sub-account ID.`,
        );
        process.exit(1);
      }
      for (const { marketIndex, uiAmount, marketName } of user.spotPositions) {
        console.log(`${uiAmount} ${marketName} (market index: ${marketIndex})`);
      }

      for (const { marketIndex, baseAssetAmount } of user.perpPositions) {
        console.log(
          `Base amount: ${baseAssetAmount} (market index: ${marketIndex})`,
        );
      }
    });

  drift
    .command("withdraw <market_index> <amount>")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("Withdraw from a drift spot market")
    .action(async (marketIndex, amount, { subAccountId }) => {
      try {
        const marketConfigs =
          await context.glamClient.drift.fetchMarketConfigs();

        const marketConfig = marketConfigs.spotMarkets.find(
          (m) => m.marketIndex === parseInt(marketIndex),
        );
        const amountBn = new BN(Number(amount) * 10 ** marketConfig.decimals);

        const txSig = await context.glamClient.drift.withdraw(
          amountBn,
          marketConfig.marketIndex,
          subAccountId,
          context.txOptions,
        );

        console.log(`Withdraw from drift: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("deposit")
    .argument("<market_index>", "Market index", parseInt)
    .argument("<amount>", "Amount", parseFloat)
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub-account ID",
      validateSubAccountId,
      0,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to drift")
    .action(async (marketIndex, amount, { subAccountId, yes }) => {
      if (isNaN(marketIndex) || marketIndex < 0) {
        console.error("Invalid market index");
        process.exit(1);
      }

      if (isNaN(amount) || amount < 0) {
        console.error("Invalid amount");
        process.exit(1);
      }

      try {
        const marketConfigs =
          await context.glamClient.drift.fetchMarketConfigs();
        const marketConfig = marketConfigs.spotMarkets.find(
          (m) => m.marketIndex === parseInt(marketIndex),
        );
        if (!marketConfig) {
          console.error(
            `Spot market config not found for market index ${marketIndex}`,
          );
          process.exit(1);
        }

        const { mint, decimals } = marketConfig;
        yes ||
          (await confirmOperation(
            `Confirm depositing ${amount} ${mint} to ${marketConfig.name} spot market?`,
          ));

        const amountBn = new BN(Number(amount) * 10 ** decimals);
        const txSig = await context.glamClient.drift.deposit(
          amountBn,
          marketIndex,
          subAccountId,
          context.txOptions,
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
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (
        direction,
        marketIndex,
        amount,
        priceLimit,
        { subAccountId, yes },
      ) => {
        if (!["long", "short"].includes(direction)) {
          console.error("Invalid direction. Must be 'long' or 'short'");
          process.exit(1);
        }

        const marketConfigs =
          await context.glamClient.drift.fetchMarketConfigs();
        const spotMarket = marketConfigs?.spotMarkets?.find(
          (m) => m.marketIndex === parseInt(marketIndex),
        );

        if (!spotMarket) {
          console.error(`Invalid market index: ${marketIndex}`);
          process.exit(1);
        }
        const baseAssetAmount = new BN(
          Number(amount) * 10 ** spotMarket.decimals,
        );
        const price = new BN(
          Number(priceLimit) * 10 ** marketConfigs.orderConstants.quoteScale,
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

        yes ||
          (await confirmOperation(
            `Confirm placing ${direction} order for ${amount} ${spotMarket.name} at ${priceLimit} USD?`,
          ));

        try {
          const txSig = await context.glamClient.drift.placeOrder(
            orderParams,
            subAccountId,
            context.txOptions,
          );
          console.log(`Spot order placed: ${txSig}`);
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  drift
    .command("perp <direction> <market_index> <amount> <price_limit>")
    .description("Place a limit perp order. Price limit is in USD.")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (
        direction,
        marketIndex,
        amount,
        priceLimit,
        { subAccountId, yes },
      ) => {
        if (!["long", "short"].includes(direction)) {
          console.error("Invalid direction. Must be 'long' or 'short'");
          process.exit(1);
        }

        const marketConfigs =
          await context.glamClient.drift.fetchMarketConfigs();
        const perpMarket = marketConfigs?.perpMarkets?.find(
          (m) => m.marketIndex === parseInt(marketIndex),
        );

        if (!perpMarket) {
          console.error(`Invalid market index: ${marketIndex}`);
          process.exit(1);
        }
        const baseAssetAmount = new BN(
          Number(amount) * 10 ** marketConfigs.orderConstants.perpBaseScale,
        );
        const price = new BN(
          Number(priceLimit) * 10 ** marketConfigs.orderConstants.quoteScale,
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

        yes ||
          (await confirmOperation(
            `Confirm placing ${direction} order for ${amount} ${perpMarket.name} at ${priceLimit} USD?`,
          ));

        try {
          const txSig = await context.glamClient.drift.placeOrder(
            orderParams,
            subAccountId,
            context.txOptions,
          );
          console.log(`Perp order placed: ${txSig}`);
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  drift
    .command("orders")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("List open orders")
    .action(async ({ subAccountId }) => {
      const driftUser =
        await context.glamClient.drift.fetchDriftUser(subAccountId);
      if (!driftUser) {
        console.error(
          `Drift user not found for sub account ID ${subAccountId}`,
        );
        process.exit(1);
      }

      const marketConfigs = await context.glamClient.drift.fetchMarketConfigs();

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
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("Cancel order")
    .action(async (orderIds, { subAccountId }) => {
      try {
        const txSig = await context.glamClient.drift.cancelOrdersByIds(
          orderIds.map((id: string) => Number(id)),
          subAccountId,
          context.txOptions,
        );
        console.log(`Orders cancelled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("margin <enabled>")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("Enable margin trading")
    .action(async (enabled, { subAccountId }) => {
      let shouldEnable = false;
      if (["true", "1", "yes", "y", "enabled"].includes(enabled)) {
        shouldEnable = true;
      }

      const driftUser =
        await context.glamClient.drift.fetchDriftUser(subAccountId);
      if (!driftUser) {
        console.error(
          `Drift user not found for sub account ID ${subAccountId}`,
        );
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
        const txSig =
          await context.glamClient.drift.updateUserMarginTradingEnabled(
            shouldEnable,
            subAccountId,
            context.txOptions,
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
    .command("settle <market_index>")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("Settle PnL for the specified perp market")
    .action(async (marketIndex, { subAccountId }) => {
      const marketConfigs = await context.glamClient.drift.fetchMarketConfigs();
      const perpMarket = marketConfigs.perpMarkets.find(
        (m) => m.marketIndex === parseInt(marketIndex),
      );

      if (!perpMarket) {
        console.error(`Invalid market index: ${marketIndex}`);
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.drift.settlePnl(
          parseInt(marketIndex),
          subAccountId,
          context.txOptions,
        );
        console.log(`Settled PnL for perp market ${perpMarket.name}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("delete-user")
    .argument("<sub_account_id>", "Sub account ID", parseInt)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Delete a drift user (sub account)")
    .action(async (subAccountId, options) => {
      options?.yes ||
        (await confirmOperation(
          `Confirm deleting drift user (sub account) ${subAccountId}?`,
        ));

      try {
        const txSig = await context.glamClient.drift.deleteUser(
          subAccountId,
          context.txOptions,
        );
        console.log(`Deleted drift user: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  drift
    .command("update-user-pool-id")
    .argument("<sub_account_id>", "Sub account ID", parseInt)
    .argument("<pool_id>", "Isolated pool ID", parseInt)
    .description("Update a drift user's pool ID")
    .action(async (subAccountId, poolId) => {
      try {
        const tx = new Transaction().add(
          await context.glamClient.drift.txBuilder.updateUserPoolIdIx(
            subAccountId,
            poolId,
          ),
        );
        const vTx = await context.glamClient.intoVersionedTransaction(
          tx,
          context.txOptions,
        );
        const txSig = await context.glamClient.sendAndConfirm(vTx);
        console.log(`Updated drift user's pool ID: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
