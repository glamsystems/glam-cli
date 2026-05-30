import {
  bfToDecimal,
  Fraction,
  KaminoLendingPolicy,
  PkMap,
  PkSet,
} from "@glamsystems/glam-sdk";
import { type Command } from "commander";
import {
  type CliContext,
  executeTxWithErrorHandling,
  parseNonNegativeInteger,
  parsePositiveUiAmount,
  printPubkeyList,
  resolveTokenMint,
  resolveTokenPublicKey,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";
import { Decimal } from "decimal.js";

export function installKaminoLendCommands(klend: Command, context: CliContext) {
  klend
    .command("view-policy")
    .description("View Kamino lending policy")
    .action(async () => {
      const policy = await context.glamClient.kaminoLending.fetchPolicy();
      if (!policy) {
        console.log("No policy found");
        process.exit(1);
      }
      printPubkeyList(
        "Kamino lending markets allowlist",
        policy.marketsAllowlist,
      );
      printPubkeyList(
        "Kamino lending borrowable tokens allowlist",
        policy.borrowAllowlist,
      );
    });

  klend
    .command("allowlist-market")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a market to the allowlist")
    .action(async (market, options) => {
      const policy =
        (await context.glamClient.kaminoLending.fetchPolicy()) ??
        new KaminoLendingPolicy([], []);
      if (policy.marketsAllowlist.find((m) => m.equals(market))) {
        console.error(`Kamino market ${market} is already in the allowlist`);
        process.exit(1);
      }

      policy.marketsAllowlist.push(market);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding market ${market}`,
        },
        (txSig) => `Kamino market ${market} added to allowlist: ${txSig}`,
      );
    });

  klend
    .command("remove-market")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a market from the allowlist")
    .action(async (market, options) => {
      const policy = await context.glamClient.kaminoLending.fetchPolicy();
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.marketsAllowlist.find((m) => m.equals(market))) {
        console.error("Market not in allowlist. Removal not needed.");
        process.exit(1);
      }

      policy.marketsAllowlist = policy.marketsAllowlist.filter(
        (m) => !m.equals(market),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing market ${market}`,
        },
        (txSig) => `Kamino market ${market} removed from allowlist: ${txSig}`,
      );
    });

  klend
    .command("allowlist-borrowable-token")
    .alias("allowlist-borrowable-asset")
    .argument("<token>", "Borrowable token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrowable token to the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy =
        (await context.glamClient.kaminoLending.fetchPolicy()) ??
        new KaminoLendingPolicy([], []);

      if (policy.borrowAllowlist.find((a) => a.equals(token))) {
        console.error(`Borrowable token ${token} is already in the allowlist`);
        process.exit(1);
      }

      policy.borrowAllowlist.push(token);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding borrowable token ${token}`,
        },
        (txSig) => `Borrowable token ${token} added to allowlist: ${txSig}`,
      );
    });

  klend
    .command("remove-borrowable-token")
    .alias("remove-borrowable-asset")
    .argument("<token>", "Borrowable token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrowable token from the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy = await context.glamClient.kaminoLending.fetchPolicy();
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.borrowAllowlist.find((a) => a.equals(token))) {
        console.error("Borrowable token not in allowlist. Removal not needed.");
        process.exit(1);
      }

      policy.borrowAllowlist = policy.borrowAllowlist.filter(
        (a) => !a.equals(token),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing borrowable token ${token}`,
        },
        (txSig) => `Borrowable token ${token} removed from allowlist: ${txSig}`,
      );
    });

  klend
    .command("init")
    .description("Initialize Kamino user")
    .action(async () => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.initUserMetadata(context.txOptions),
        { skip: true },
        (txSig) => `Initialized Kamino user: ${txSig}`,
      );
    });

  klend
    .command("list [market]")
    .description("List Kamino deposits and borrows")
    .action(async (market: string | null) => {
      const vault = context.glamClient.vaultPda;
      const lendingMarket = market ? new PublicKey(market) : undefined;

      const obligations =
        await context.glamClient.kaminoLending.findAndParseObligations(
          vault,
          lendingMarket,
        );

      const reservesSet = new PkSet();
      for (const { activeDeposits, activeBorrows } of obligations) {
        activeDeposits.forEach((d) => reservesSet.add(d.depositReserve));
        activeBorrows.forEach((b) => reservesSet.add(b.borrowReserve));
      }
      const reserves =
        await context.glamClient.kaminoLending.fetchAndParseReserves(
          Array.from(reservesSet),
        );
      const reservesMap = new PkMap<(typeof reserves)[0]>(
        reserves.map((r) => [r.getAddress(), r]),
      );

      for (const obligation of obligations) {
        const { activeDeposits, activeBorrows } = obligation;
        console.log(`Obligation: ${obligation.getAddress()}`);

        let i = 0;
        for (const { depositReserve, depositedAmount } of activeDeposits) {
          const reserve = reservesMap.get(depositReserve);
          if (!reserve) {
            console.error(`Reserve ${depositReserve} not found`);
            process.exit(1);
          }
          const { collateralExchangeRate, liquidity } = reserve;
          const supplyAmount = new Decimal(depositedAmount.toString()).div(
            collateralExchangeRate,
          );
          console.log(
            ` - deposit[${i++}]: ${supplyAmount.toString()} ${liquidity.mintPubkey}`,
          );
        }

        i = 0;
        for (const {
          borrowReserve,
          borrowedAmountSf,
          cumulativeBorrowRateBsf,
        } of activeBorrows) {
          const reserve = reservesMap.get(borrowReserve);
          if (!reserve) {
            console.error(`Reserve ${borrowReserve} not found`);
            process.exit(1);
          }
          const { cumulativeBorrowRate, liquidity } = reserve;
          const obligationCumulativeBorrowRate = bfToDecimal(
            cumulativeBorrowRateBsf,
          );
          const borrowAmount = new Fraction(borrowedAmountSf)
            .toDecimal()
            .mul(cumulativeBorrowRate)
            .div(obligationCumulativeBorrowRate);
          console.log(
            ` - borrow[${i++}]: ${borrowAmount.toString()} ${liquidity.mintPubkey}`,
          );
        }
      }
    });

  klend
    .command("deposit")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<token>", "Token mint or symbol")
    .argument("<amount>", "UI amount of token to deposit")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to Kamino Lending market")
    .action(
      async (market: PublicKey, token: string, amount: string, options) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );
        const tokenMint = new PublicKey(tokenInfo.address);

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.kaminoLending.deposit(
              market,
              tokenMint,
              amountBN,
              context.txOptions,
            ),
          {
            skip: options?.yes,
            message: `Confirm depositing ${amount} ${tokenInfo.symbol}?`,
          },
          (txSig) => `Deposited ${amount} ${tokenInfo.symbol}: ${txSig}`,
        );
      },
    );

  klend
    .command("withdraw")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<token>", "Token mint or symbol")
    .argument("<amount>", "UI amount of token to withdraw")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw asset from Kamino Lending market")
    .action(
      async (market: PublicKey, token: string, amount: string, options) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );
        const tokenMint = new PublicKey(tokenInfo.address);

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.kaminoLending.withdraw(
              market,
              tokenMint,
              amountBN,
              context.txOptions,
            ),
          {
            skip: options?.yes,
            message: `Confirm withdrawing ${amount} ${tokenInfo.symbol}`,
          },
          (txSig) => `Withdraw ${amount} ${tokenInfo.symbol}: ${txSig}`,
        );
      },
    );

  klend
    .command("borrow")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<token>", "Token mint or symbol")
    .argument("<amount>", "UI amount of token to borrow")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Borrow from Kamino Lending market")
    .action(
      async (market: PublicKey, token: string, amount: string, options) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );
        const tokenMint = new PublicKey(tokenInfo.address);

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.kaminoLending.borrow(
              market,
              tokenMint,
              amountBN,
              context.txOptions,
            ),
          {
            skip: options?.yes,
            message: `Confirm borrowing ${amount} ${tokenInfo.symbol}`,
          },
          (txSig) => `Borrowed ${amount} ${tokenInfo.symbol}: ${txSig}`,
        );
      },
    );

  klend
    .command("repay")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<token>", "Token mint or symbol")
    .argument("<amount>", "UI amount of token to repay")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Repay loan from Kamino Lending market")
    .action(
      async (market: PublicKey, token: string, amount: string, options) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );
        const tokenMint = new PublicKey(tokenInfo.address);

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.kaminoLending.repay(
              market,
              tokenMint,
              amountBN,
              context.txOptions,
            ),
          {
            skip: options?.yes,
            message: `Confirm repaying ${amount} ${tokenInfo.symbol}`,
          },
          (txSig) => `Repaid ${amount} ${tokenInfo.symbol}: ${txSig}`,
        );
      },
    );

  klend
    .command("request-elevation-group")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<elevation-group>", "Elevation group number", (value: string) =>
      parseNonNegativeInteger(value, "elevation-group"),
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Request elevation group for an obligation (staging only)")
    .action(async (market: PublicKey, elevationGroup: number, options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.requestElevationGroup(
            market,
            elevationGroup,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm requesting elevation group ${elevationGroup} for market ${market}`,
        },
        (txSig) =>
          `Requested elevation group ${elevationGroup} for market ${market}: ${txSig}`,
      );
    });
}
