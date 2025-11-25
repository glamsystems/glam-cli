import {
  ASSETS_MAINNET,
  bfToDecimal,
  Fraction,
  KaminoLendingPolicy,
  PkMap,
  PkSet,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
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
    .description("Add a market to the allowlist")
    .action(async (market) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Kamino market ${market} added to allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  klend
    .command("remove-market")
    .argument("<market>", "Kamino lending market public key", validatePublicKey)
    .description("Remove a market from the allowlist")
    .action(async (market) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Kamino market ${market} removed from allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  klend
    .command("allowlist-borrowable-asset")
    .argument("<asset>", "Borrowable asset public key", validatePublicKey)
    .description("Add a borrowable asset to the allowlist")
    .action(async (asset) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Borrowable asset ${asset} added to allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  klend
    .command("remove-borrowable-asset")
    .argument("<asset>", "Borrowable asset public key", validatePublicKey)
    .description("Remove a borrowable asset from the allowlist")
    .action(async (asset) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b01,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Borrowable asset ${asset} removed from allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

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
          const { collateralExchangeRate, liquidity } =
            reservesMap.get(depositReserve);
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
          const { cumulativeBorrowRate, liquidity } =
            reservesMap.get(borrowReserve);
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
