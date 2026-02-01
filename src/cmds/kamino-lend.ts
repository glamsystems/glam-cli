import {
  bfToDecimal,
  Fraction,
  getAssetMeta,
  KaminoLendingPolicy,
  PkMap,
  PkSet,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";
import { Decimal } from "decimal.js";

export function installKaminoLendCommands(klend: Command, context: CliContext) {
  klend
    .command("view-policy")
    .description("View Kamino lending policy")
    .action(async () => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extKaminoProgram.programId,
        0b01,
        KaminoLendingPolicy,
      );
      if (!policy) {
        console.log("No policy found");
        return;
      }
      console.log("Kamino lending markets allowlist:");
      for (let i = 0; i < policy.marketsAllowlist.length; i++) {
        console.log(`[${i}] ${policy.marketsAllowlist[i]}`);
      }
      console.log("Kamino lending borrowable assets allowlist:");
      for (let i = 0; i < policy.borrowAllowlist.length; i++) {
        console.log(`[${i}] ${policy.borrowAllowlist[i]}`);
      }
    });

  klend
    .command("allowlist-market")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a market to the allowlist")
    .action(async (market, options) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          KaminoLendingPolicy,
        )) ?? new KaminoLendingPolicy([], []);
      if (policy.marketsAllowlist.find((m) => m.equals(market))) {
        console.error(`Kamino market ${market} is already in the allowlist`);
        process.exit(1);
      }

      policy.marketsAllowlist.push(market);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extKaminoProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
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
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extKaminoProgram.programId,
        0b01,
        KaminoLendingPolicy,
      );
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
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extKaminoProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm removing market ${market}`,
        },
        (txSig) => `Kamino market ${market} removed from allowlist: ${txSig}`,
      );
    });

  klend
    .command("allowlist-borrowable-asset")
    .argument("<asset>", "Borrowable asset public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrowable asset to the allowlist")
    .action(async (asset, options) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          KaminoLendingPolicy,
        )) ?? new KaminoLendingPolicy([], []);

      if (policy.borrowAllowlist.find((a) => a.equals(asset))) {
        console.error(`Borrowable asset ${asset} is already in the allowlist`);
        process.exit(1);
      }

      policy.borrowAllowlist.push(asset);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extKaminoProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm adding borrowable asset ${asset}`,
        },
        (txSig) => `Borrowable asset ${asset} added to allowlist: ${txSig}`,
      );
    });

  klend
    .command("remove-borrowable-asset")
    .argument("<asset>", "Borrowable asset public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrowable asset from the allowlist")
    .action(async (asset, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extKaminoProgram.programId,
        0b01,
        KaminoLendingPolicy,
      );
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.borrowAllowlist.find((a) => a.equals(asset))) {
        console.error("Borrowable asset not in allowlist. Removal not needed.");
        process.exit(1);
      }

      policy.borrowAllowlist = policy.borrowAllowlist.filter(
        (a) => !a.equals(asset),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extKaminoProgram.programId,
            0b01,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm removing borrowable asset ${asset}`,
        },
        (txSig) => `Borrowable asset ${asset} removed from allowlist: ${txSig}`,
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
    .argument("<asset>", "Asset public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to Kamino Lending market")
    .action(async (market, asset, amount, options) => {
      const { decimals } = getAssetMeta(asset);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.deposit(
            market,
            asset,
            amount * 10 ** decimals,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm depositing ${amount} ${asset}?`,
        },
        (txSig) => `Deposited ${amount} ${asset}: ${txSig}`,
      );
    });

  klend
    .command("withdraw")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<asset>", "Asset public key", validatePublicKey)
    .argument("<amount>", "Amount to withdraw", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw asset from Kamino Lending market")
    .action(async (market, asset, amount, options) => {
      const { decimals } = getAssetMeta(asset);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.withdraw(
            market,
            asset,
            amount * 10 ** decimals,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm withdrawing ${amount} ${asset}`,
        },
        (txSig) => `Withdraw ${amount} ${asset}: ${txSig}`,
      );
    });

  klend
    .command("borrow")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<asset>", "Asset public key", validatePublicKey)
    .argument("<amount>", "Amount to repay", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Borrow from Kamino Lending market")
    .action(async (market, asset, amount, options) => {
      const { decimals } = getAssetMeta(asset);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.borrow(
            market,
            asset,
            amount * 10 ** decimals,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm borrowing ${amount} ${asset}`,
        },
        (txSig) => `Borrowed ${amount} ${asset}: ${txSig}`,
      );
    });

  klend
    .command("repay")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .argument("<asset>", "Asset public key", validatePublicKey)
    .argument("<amount>", "Amount to repay", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Repay loan from Kamino Lending market")
    .action(async (market, asset, amount, options) => {
      const { decimals } = getAssetMeta(asset);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoLending.repay(
            market,
            asset,
            amount * 10 ** decimals,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm repaying ${amount} ${asset}`,
        },
        (txSig) => `Repaid ${amount} ${asset}: ${txSig}`,
      );
    });
}
