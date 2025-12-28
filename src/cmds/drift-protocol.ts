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
  executeTxWithErrorHandling,
  validateBooleanInput,
  validateDriftMarketType,
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
    .argument("<market_type>", "Market type", validateDriftMarketType)
    .argument("<market_index>", "Spot or perp market index", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a market to the allowlist")
    .action(async (marketType, marketIndex, { yes }) => {
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm adding ${marketType} market ${marketIndex} to allowlist`,
        },
        (txSig) =>
          `${marketType} market ${marketIndex} added to allowlist: ${txSig}`,
      );
    });

  drift
    .command("remove-market")
    .argument("<market_type>", "Market type", validateDriftMarketType)
    .argument("<market_index>", "Spot or perp market index", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a market from the allowlist")
    .action(async (marketType, marketIndex, { yes }) => {
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm removing ${marketType} market ${marketIndex} from allowlist`,
        },
        (txSig) =>
          `${marketType} market ${marketIndex} removed from allowlist: ${txSig}`,
      );
    });

  drift
    .command("allowlist-borrowable-asset")
    .argument("<token_mint>", "Token mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrowable asset to the allowlist")
    .action(async (tokenMint, { yes }) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b01,
          DriftProtocolPolicy,
        )) ?? new DriftProtocolPolicy([], [], []);

      policy.borrowAllowlist.push(tokenMint);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        { skip: yes, message: `Confirm adding borrowable asset ${tokenMint}` },
        (txSig) => `Borrowable asset ${tokenMint} added to allowlist: ${txSig}`,
      );
    });

  drift
    .command("remove-borrowable-asset")
    .argument("<token_mint>", "Token mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrowable asset from the allowlist")
    .action(async (tokenMint, { yes }) => {
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm removing borrowable asset ${tokenMint}`,
        },
        (txSig) =>
          `Borrowable asset ${tokenMint} removed from allowlist: ${txSig}`,
      );
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
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.initialize(subAccountId, context.txOptions),
        {
          skip: yes,
          message: `Initializing drift user (sub-account ${subAccountId})`,
        },
        (txSig) =>
          `Drift user (sub-account ${subAccountId}) initialized: ${txSig}`,
      );
    });

  drift
    .command("list-users")
    .description("List drift users (sub accounts)")
    .action(async () => {
      const driftUsers =
        await context.glamClient.drift.fetchAndParseDriftUsers();
      console.log(`${driftUsers.length} Drift users found`);
      driftUsers.map((u, i) => {
        console.log(`[${i}]: ${u.name} (Pool ID: ${u.poolId})`);
      });
    });

  drift
    .command("list-positions")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("List drift positions")
    .action(async ({ subAccountId }) => {
      const user =
        await context.glamClient.drift.fetchAndParseDriftUser(subAccountId);
      if (!user) {
        console.error(
          `Drift user not found for sub-account ID ${subAccountId}. Please specify a valid sub-account ID.`,
        );
        process.exit(1);
      }
      const spotMarkets =
        await context.glamClient.drift.fetchAndParseSpotMarkets(
          user.spotPositions.map((p) => p.marketIndex),
        );
      const perpMarkets =
        await context.glamClient.drift.fetchAndParsePerpMarkets(
          user.perpPositions.map((p) => p.marketIndex),
        );

      const total = [];
      for (const spotPosition of user.spotPositions) {
        const {
          name: spotMarketName,
          decimals,
          marketIndex,
          cumulativeDepositInterest,
          cumulativeBorrowInterest,
          lastOraclePrice,
        } = spotMarkets.find(
          (m) => m.marketIndex === spotPosition.marketIndex,
        )!;

        const { uiAmount } = spotPosition.calcBalance(
          decimals,
          cumulativeDepositInterest,
          cumulativeBorrowInterest,
        );
        const usdValue = (uiAmount * lastOraclePrice.toNumber()) / 1_000_000;
        total.push(usdValue);

        console.log(
          `${uiAmount} ${spotMarketName} (market index: ${marketIndex}): $${usdValue}`,
        );
      }

      for (const perpPosition of user.perpPositions) {
        const {
          name: perpMarketName,
          marketIndex,
          lastOraclePrice,
          cumulativeFundingRateLong,
          cumulativeFundingRateShort,
        } = perpMarkets.find(
          (m) => m.marketIndex === perpPosition.marketIndex,
        )!;

        const pos = perpPosition.baseAssetAmount.toNumber() / 1_000_000_000;
        const usdValue =
          perpPosition
            .getUsdValueScaled(
              lastOraclePrice,
              cumulativeFundingRateLong,
              cumulativeFundingRateShort,
            )
            .toNumber() / 1_000_000;
        total.push(usdValue);

        console.log(
          `${pos} ${perpMarketName} (market index: ${marketIndex}): $${usdValue}`,
        );
      }

      console.log(`Total: $${total.reduce((a, b) => a + b, 0)}`);
    });

  drift
    .command("withdraw")
    .argument("<market_index>", "Market index", parseInt)
    .argument("<amount>", "Amount", parseFloat)
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw from a drift spot market")
    .action(async (marketIndex, amount, { subAccountId, yes }) => {
      const marketConfigs = await context.glamClient.drift.fetchMarketConfigs();

      const spotMarket = marketConfigs.spotMarkets.find(
        (m) => m.marketIndex === marketIndex,
      );
      if (!spotMarket) {
        console.error(
          `Spot market config not found for market index ${marketIndex}`,
        );
        process.exit(1);
      }

      const { decimals, mint, name } = spotMarket;
      const amountBn = new BN(amount * 10 ** decimals);

      await executeTxWithErrorHandling(
        async () => {
          return context.glamClient.drift.withdraw(
            amountBn,
            marketIndex,
            subAccountId,
            context.txOptions,
          );
        },
        {
          skip: yes,
          message: `Confirm withdrawing ${amount} ${mint} to ${name} spot market`,
        },
        (txSig) => `Withdraw from drift: ${txSig}`,
      );
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
      const marketConfigs = await context.glamClient.drift.fetchMarketConfigs();
      const spotMarket = marketConfigs.spotMarkets.find(
        (m) => m.marketIndex === marketIndex,
      );
      if (!spotMarket) {
        console.error(
          `Spot market config not found for market index ${marketIndex}`,
        );
        process.exit(1);
      }

      const { mint, decimals, name } = spotMarket;
      const amountBn = new BN(amount * 10 ** decimals);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.deposit(
            amountBn,
            marketIndex,
            subAccountId,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm depositing ${amount} ${mint} to ${name} spot market`,
        },
        (txSig) => `Deposited to drift: ${txSig}`,
      );
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

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.drift.placeOrder(
              orderParams,
              subAccountId,
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm placing ${direction} order for ${amount} ${spotMarket.name} at ${priceLimit} USD?`,
          },
          (txSig) => `Spot order placed: ${txSig}`,
        );
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

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.drift.placeOrder(
              orderParams,
              subAccountId,
              context.txOptions,
            ),
          {
            skip: yes,
            message: `Confirm placing ${direction} order for ${amount} ${perpMarket.name} at ${priceLimit} USD?`,
          },
          (txSig) => `Perp order placed: ${txSig}`,
        );
      },
    );

  drift
    .command("list-orders")
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .description("List open orders")
    .action(async ({ subAccountId }) => {
      const driftUser =
        await context.glamClient.drift.fetchAndParseDriftUser(subAccountId);
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
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Cancel order")
    .action(async (orderIds, { subAccountId, yes }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.cancelOrdersByIds(
            orderIds.map((id: string) => Number(id)),
            subAccountId,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm cancelling orders ${orderIds.join(", ")}`,
        },
        (txSig) => `Orders cancelled: ${txSig}`,
      );
    });

  drift
    .command("margin")
    .argument("<enabled>", "Enable margin trading", validateBooleanInput)
    .option(
      "-s, --sub-account-id <sub_account_id>",
      "Sub account ID",
      validateSubAccountId,
      0,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Enable margin trading")
    .action(async (enabled, { subAccountId, yes }) => {
      const driftUser =
        await context.glamClient.drift.fetchAndParseDriftUser(subAccountId);
      if (!driftUser) {
        console.error(
          `Drift user not found for sub account ID ${subAccountId}`,
        );
        process.exit(1);
      }

      const { isMarginTradingEnabled } = driftUser;
      if (isMarginTradingEnabled === enabled) {
        console.log(
          `Margin trading already ${enabled ? "enabled" : "disabled"}`,
        );
        return;
      }

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.updateUserMarginTradingEnabled(
            enabled,
            subAccountId,
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm ${enabled ? "enabling" : "disabling"} margin trading`,
        },
        (txSig) =>
          `Margin trading ${enabled ? "enabled" : "disabled"}: ${txSig}`,
      );
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

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.settlePnl(
            parseInt(marketIndex),
            subAccountId,
            context.txOptions,
          ),
        { skip: true },
        (txSig) => `Settled PnL for perp market ${perpMarket.name}: ${txSig}`,
      );
    });

  drift
    .command("delete-user")
    .argument("<sub_account_id>", "Sub account ID", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Delete a drift user (sub account)")
    .action(async (subAccountId, options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.drift.deleteUser(subAccountId, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm deleting drift user (sub account) ${subAccountId}`,
        },
        (txSig) => `Deleted drift user: ${txSig}`,
      );
    });

  drift
    .command("update-user-pool-id")
    .argument("<sub_account_id>", "Sub account ID", parseInt)
    .argument("<pool_id>", "Isolated pool ID", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update a drift user's pool ID")
    .action(async (subAccountId, poolId, { yes }) => {
      await executeTxWithErrorHandling(
        async () => {
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
          return context.glamClient.sendAndConfirm(vTx);
        },
        {
          skip: yes,
          message: `Confirm updating drift user (sub account) ${subAccountId}'s pool ID to ${poolId}`,
        },
        (txSig) => `Updated drift user's pool ID: ${txSig}`,
      );
    });
}
