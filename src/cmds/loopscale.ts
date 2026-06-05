import { BN } from "@coral-xyz/anchor";
import {
  LoopscaleLoan,
  LoopscalePolicy,
  LoopscaleStrategy,
  buildLoopscaleApiCollateralTermUpdates,
  type LoopscaleMarketInformation,
  type LoopscaleMultiCollateralTermsUpdateParams,
  type LoopscaleApiUpdateStrategyParams,
  STRATEGY_DURATION_COUNT,
  U8_MAX,
  U32_MAX,
  U64_MAX_BN,
  bnToSafeNumber,
  fetchMintAndTokenProgram,
} from "@glamsystems/glam-sdk";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { type Command } from "commander";

import {
  type CliContext,
  executeTxWithErrorHandling,
  fail,
  printTable,
  parseNonNegativeUiAmount,
  parsePositiveBn,
  parsePositiveUiAmount,
  parseUnsignedNumber,
  printPubkeyList,
  resolveTokenMint,
  resolveTokenPublicKey,
  validatePublicKey,
} from "../utils";

type Tuple5 = [number, number, number, number, number];

function assertU64(value: BN, label?: string): BN {
  if (value.gt(U64_MAX_BN)) {
    fail(`${label ?? value} exceeds u64 max`);
  }
  return value;
}

function parseNonNegativeU64(value: string, label: string): BN {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    fail(`${label} must be a non-negative integer`);
  }
  return assertU64(new BN(trimmed), label);
}

function parseCbps(value: string, label?: string): BN {
  return new BN(parseUnsignedNumber(value, label, U32_MAX));
}

function parseTuple5(raw: string, label: string): Tuple5 {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 5 || parts.some((part) => part.length === 0)) {
    fail(
      `${label} must contain exactly five comma-separated unsigned integers`,
    );
  }
  return parts.map((part, index) =>
    parseUnsignedNumber(part, `${label}[${index}]`, U32_MAX),
  ) as Tuple5;
}

function tuple5IsZero(values: Tuple5): boolean {
  return values.every((value) => value === 0);
}

function listCollateralMints(loan: LoopscaleLoan): string {
  const mints = loan.activeCollateral
    .map((c) => c.assetMint.toBase58())
    .filter((m, i, arr) => arr.indexOf(m) === i);
  if (mints.length === 0) return "-";
  if (mints.length <= 3) return mints.join(", ");
  return `${mints.slice(0, 3).join(", ")} +${mints.length - 3} more`;
}

function listPrincipalMints(loan: LoopscaleLoan): string {
  const mints = loan.ledgers
    .map((l) => l.principalMint.toBase58())
    .filter((m, i, arr) => arr.indexOf(m) === i);
  if (mints.length === 0) return "-";
  if (mints.length <= 3) return mints.join(", ");
  return `${mints.slice(0, 3).join(", ")} +${mints.length - 3} more`;
}

function summarizeActivePrincipal(loan: LoopscaleLoan): string {
  return loan.ledgers
    .filter((ledger) => ledger.status !== 0)
    .map(
      (ledger) =>
        `${ledger.principalMint}:${ledger.principalDue}/${ledger.principalRepaid}`,
    )
    .join("; ");
}

function listStrategyCollateralTerms(strategy: LoopscaleStrategy): string {
  const terms: string[] = [];
  for (
    let collateralIndex = 0;
    collateralIndex < strategy.collateralMap.length;
    collateralIndex++
  ) {
    const durations = strategy.collateralMap[collateralIndex] ?? [];
    for (
      let durationIndex = 0;
      durationIndex < durations.length;
      durationIndex++
    ) {
      const apy = durations[durationIndex];
      if (!apy.eq(U64_MAX_BN)) {
        terms.push(`c${collateralIndex}:d${durationIndex}=${apy.toString()}`);
      }
    }
  }
  if (terms.length === 0) return "-";
  if (terms.length <= 4) return terms.join(", ");
  return `${terms.slice(0, 4).join(", ")} +${terms.length - 4} more`;
}

function strategyTermRows(
  strategy: LoopscaleStrategy,
  marketInfo?: LoopscaleMarketInformation,
): string[][] {
  const rows: string[][] = [];
  for (
    let collateralIndex = 0;
    collateralIndex < strategy.collateralMap.length;
    collateralIndex++
  ) {
    const durations = strategy.collateralMap[collateralIndex] ?? [];
    const assetData = marketInfo?.assetData[collateralIndex];
    for (
      let durationIndex = 0;
      durationIndex < durations.length;
      durationIndex++
    ) {
      const apy = durations[durationIndex];
      if (apy.eq(U64_MAX_BN)) {
        continue;
      }
      rows.push([
        String(collateralIndex),
        String(durationIndex),
        apy.toString(),
        assetData?.assetIdentifier?.toBase58() ?? "-",
        assetData?.quoteMint?.toBase58() ?? "-",
        assetData?.ltv === undefined ? "-" : String(assetData.ltv),
        assetData?.liquidationThreshold === undefined
          ? "-"
          : String(assetData.liquidationThreshold),
      ]);
    }
  }
  return rows;
}

/** Wallet-signs, MPC co-signs, and submits a Loopscale transaction. */
async function submitCosignedTx(
  context: CliContext,
  tx: Transaction,
  opts: {
    skip: boolean;
    message: string;
    success: (txSig: string) => string;
    additionalSigners?: Keypair[];
  },
): Promise<void> {
  await executeTxWithErrorHandling(
    async () => {
      const versionedTx = await context.glamClient.intoVersionedTransaction(
        tx,
        context.txOptions,
      );
      if (opts.additionalSigners?.length) {
        versionedTx.sign(opts.additionalSigners);
      }
      const cosignedTx = await context.glamClient.loopscale.cosignTransaction({
        tx: versionedTx,
        identifier: `glam-loopscale-${new Date().getTime()}`,
      });
      return await context.glamClient.sendAndConfirm(cosignedTx);
    },
    { skip: opts.skip, message: opts.message },
    opts.success,
  );
}

/** Wallet-signs, MPC co-signs, and submits multiple Loopscale transactions. */
async function submitCosignedTxs(
  context: CliContext,
  txs: { tx: Transaction; additionalSigners?: Keypair[] }[],
  opts: {
    skip: boolean;
    message: string;
    success: (txSigs: string[]) => string;
  },
): Promise<void> {
  await executeTxWithErrorHandling(
    async () => {
      const txSigs: string[] = [];
      for (let i = 0; i < txs.length; i++) {
        const { tx, additionalSigners } = txs[i];
        const versionedTx = await context.glamClient.intoVersionedTransaction(
          tx,
          context.txOptions,
        );
        if (additionalSigners?.length) {
          versionedTx.sign(additionalSigners);
        }
        const cosignedTx = await context.glamClient.loopscale.cosignTransaction(
          {
            tx: versionedTx,
            identifier: `glam-loopscale-${new Date().getTime()}-${i}`,
          },
        );
        txSigs.push(await context.glamClient.sendAndConfirm(cosignedTx));
      }
      return txSigs.join(", ");
    },
    { skip: opts.skip, message: opts.message },
    (txSigList) => opts.success(txSigList.split(", ").filter(Boolean)),
  );
}

async function parseCollateralTermUpdates(
  context: CliContext,
  marketInfo: LoopscaleMarketInformation,
  rawTerms: string[],
): Promise<LoopscaleMultiCollateralTermsUpdateParams[]> {
  const groups = new Map<
    string,
    { apy: BN; indices: { collateralIndex: number; durationIndex: number }[] }
  >();

  for (const rawTerm of rawTerms) {
    const parts = rawTerm.split(":").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      fail(
        "collateral-term must be <collateral-index|collateral-token>:<duration-index>:<apy-cbps>",
      );
    }

    const durationIndex = parseUnsignedNumber(
      parts[1],
      "duration-index",
      STRATEGY_DURATION_COUNT - 1,
    );
    const apy = parseNonNegativeU64(parts[2], "apy-cbps");

    let collateralIndex: number;
    if (/^\d+$/.test(parts[0])) {
      collateralIndex = parseUnsignedNumber(
        parts[0],
        "collateral-index",
        marketInfo.assetData.length - 1,
      );
    } else {
      const assetIdentifier = await resolveTokenPublicKey(
        context.glamClient,
        parts[0],
      );
      const resolvedIndex = marketInfo.findAssetIndex(assetIdentifier);
      if (resolvedIndex === null) {
        fail(
          `Collateral asset ${assetIdentifier} is not present in market ${marketInfo.getAddress()}`,
        );
      }
      collateralIndex = resolvedIndex;
    }

    const key = apy.toString();
    const group = groups.get(key) ?? { apy, indices: [] };
    group.indices.push({ collateralIndex, durationIndex });
    groups.set(key, group);
  }

  return [...groups.values()];
}

export function installLoopscaleCommands(
  loopscale: Command,
  context: CliContext,
) {
  loopscale
    .command("list-loans")
    .option("--json", "Print all loans as JSON", false)
    .description("List Loopscale loans associated with the current GLAM state")
    .action(async (options: { json?: boolean }) => {
      const loans = await context.glamClient.loopscale.fetchRegisteredLoans();
      if (loans.length === 0) {
        console.log("No Loopscale loans found");
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(loans, null, 2));
        return;
      }

      printTable(
        [
          "Loan",
          "Borrower",
          "Status",
          "Nonce",
          "Start Time",
          "Active Ledgers",
          "Collateral Mints",
          "Principal Mints",
          "Active Ledgers Summary",
        ],
        loans.map((loan) => [
          loan.getAddress().toBase58(),
          loan.borrower.toBase58(),
          String(loan.status),
          loan.nonce.toString(),
          loan.startTime.toString(),
          `${loan.activeLedgers.length}/${loan.ledgers.length}`,
          listCollateralMints(loan),
          listPrincipalMints(loan),
          summarizeActivePrincipal(loan),
        ]),
      );
    });

  loopscale
    .command("list-strategies")
    .option("--json", "Print all strategies as JSON", false)
    .description(
      "List Loopscale lender strategies associated with the current GLAM state",
    )
    .action(async (options: { json?: boolean }) => {
      const strategies =
        await context.glamClient.loopscale.fetchRegisteredStrategies();
      if (strategies.length === 0) {
        console.log("No Loopscale strategies found");
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(strategies, null, 2));
        return;
      }

      printTable(
        [
          "Strategy",
          "Lender",
          "Principal Mint",
          "Market",
          "Originations",
          "Token Balance",
          "Deployed",
          "Active Loans",
          "Terms",
        ],
        strategies.map((strategy) => [
          strategy.getAddress().toBase58(),
          strategy.lender.toBase58(),
          strategy.principalMint.toBase58(),
          strategy.marketInformation.toBase58(),
          strategy.originationsEnabled === 0 ? "disabled" : "enabled",
          strategy.tokenBalance.toString(),
          strategy.currentDeployedAmount.toString(),
          strategy.activeLoanCount.toString(),
          listStrategyCollateralTerms(strategy),
        ]),
      );
    });

  loopscale
    .command("view-strategy")
    .argument("<strategy>", "Loopscale strategy account", validatePublicKey)
    .option("--json", "Print decoded strategy as JSON", false)
    .description("View a Loopscale lender strategy")
    .action(async (strategy: PublicKey, options: { json?: boolean }) => {
      const strategyAccount =
        await context.glamClient.loopscale.fetchStrategy(strategy);
      if (options.json) {
        console.log(JSON.stringify(strategyAccount, null, 2));
        return;
      }

      let marketInfo: LoopscaleMarketInformation | undefined;
      try {
        marketInfo = await context.glamClient.loopscale.fetchMarketInformation(
          strategyAccount.marketInformation,
        );
      } catch {
        marketInfo = undefined;
      }

      console.log(`Strategy: ${strategyAccount.getAddress()}`);
      console.log(`Lender: ${strategyAccount.lender}`);
      console.log(`Principal mint: ${strategyAccount.principalMint}`);
      console.log(`Market: ${strategyAccount.marketInformation}`);
      console.log(
        `Originations: ${
          strategyAccount.originationsEnabled === 0 ? "disabled" : "enabled"
        }`,
      );
      console.log(
        `External yield source: ${strategyAccount.externalYieldSource}`,
      );
      console.log(`Liquidity buffer cBPS: ${strategyAccount.liquidityBuffer}`);
      console.log(`Interest fee cBPS: ${strategyAccount.interestFee}`);
      console.log(`Origination fee cBPS: ${strategyAccount.originationFee}`);
      console.log(`Principal fee cBPS: ${strategyAccount.principalFee}`);
      console.log(`Origination cap: ${strategyAccount.originationCap}`);
      console.log(`Token balance: ${strategyAccount.tokenBalance}`);
      console.log(
        `Current deployed amount: ${strategyAccount.currentDeployedAmount}`,
      );
      console.log(
        `External yield amount: ${strategyAccount.externalYieldAmount}`,
      );
      console.log(
        `Outstanding interest amount: ${strategyAccount.outstandingInterestAmount}`,
      );
      console.log(`Fee claimable: ${strategyAccount.feeClaimable}`);
      console.log(`Active loan count: ${strategyAccount.activeLoanCount}`);
      console.log("");

      const rows = strategyTermRows(strategyAccount, marketInfo);
      if (rows.length === 0) {
        console.log("Collateral terms: []");
        return;
      }
      console.log("Collateral terms:");
      printTable(
        [
          "Collateral Index",
          "Duration Index",
          "APY cBPS",
          "Asset Identifier",
          "Quote Mint",
          "LTV cBPS",
          "LQT cBPS",
        ],
        rows,
      );
    });

  loopscale
    .command("view-policy")
    .description("View Loopscale policy")
    .action(async () => {
      const policy = await context.glamClient.loopscale.fetchPolicy();
      if (!policy) {
        console.log("No policy found");
        process.exit(1);
      }
      printPubkeyList(
        "Loopscale deposit mints allowlist",
        policy.depositAllowlist,
      );
      printPubkeyList(
        "Loopscale borrow mints allowlist",
        policy.borrowAllowlist,
      );
      printPubkeyList("Loopscale markets allowlist", policy.marketsAllowlist);
    });

  loopscale
    .command("allowlist-deposit-token")
    .argument("<token>", "Deposit token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a deposit token to the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy =
        (await context.glamClient.loopscale.fetchPolicy()) ??
        new LoopscalePolicy();
      if (policy.depositAllowlist.find((m) => m.equals(token))) {
        fail(`Deposit token ${token} is already in the allowlist`);
      }

      policy.depositAllowlist.push(token);
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding deposit token ${token}`,
        },
        (txSig) => `Deposit token ${token} added to allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("remove-deposit-token")
    .argument("<token>", "Deposit token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a deposit token from the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy = await context.glamClient.loopscale.fetchPolicy();
      if (!policy) {
        fail("No policy found");
      }
      if (!policy.depositAllowlist.find((m) => m.equals(token))) {
        fail("Deposit token not in allowlist. Removal not needed.");
      }

      policy.depositAllowlist = policy.depositAllowlist.filter(
        (m) => !m.equals(token),
      );
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing deposit token ${token}`,
        },
        (txSig) => `Deposit token ${token} removed from allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("allowlist-borrow-token")
    .argument("<token>", "Borrow token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrow token to the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy =
        (await context.glamClient.loopscale.fetchPolicy()) ??
        new LoopscalePolicy();
      if (policy.borrowAllowlist.find((m) => m.equals(token))) {
        fail(`Borrow token ${token} is already in the allowlist`);
      }

      policy.borrowAllowlist.push(token);
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding borrow token ${token}`,
        },
        (txSig) => `Borrow token ${token} added to allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("remove-borrow-token")
    .argument("<token>", "Borrow token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrow token from the allowlist")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy = await context.glamClient.loopscale.fetchPolicy();
      if (!policy) {
        fail("No policy found");
      }
      if (!policy.borrowAllowlist.find((m) => m.equals(token))) {
        fail("Borrow token not in allowlist. Removal not needed.");
      }

      policy.borrowAllowlist = policy.borrowAllowlist.filter(
        (m) => !m.equals(token),
      );
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing borrow token ${token}`,
        },
        (txSig) => `Borrow token ${token} removed from allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("allowlist-market")
    .argument(
      "<market>",
      "Loopscale market information public key",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a market to the allowlist")
    .action(async (market: PublicKey, options) => {
      const policy =
        (await context.glamClient.loopscale.fetchPolicy()) ??
        new LoopscalePolicy();
      if (policy.marketsAllowlist.find((m) => m.equals(market))) {
        fail(`Loopscale market ${market} is already in the allowlist`);
      }

      policy.marketsAllowlist.push(market);
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding market ${market}`,
        },
        (txSig) => `Loopscale market ${market} added to allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("remove-market")
    .argument(
      "<market>",
      "Loopscale market information public key",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a market from the allowlist")
    .action(async (market: PublicKey, options) => {
      const policy = await context.glamClient.loopscale.fetchPolicy();
      if (!policy) {
        fail("No policy found");
      }
      if (!policy.marketsAllowlist.find((m) => m.equals(market))) {
        fail("Market not in allowlist. Removal not needed.");
      }

      policy.marketsAllowlist = policy.marketsAllowlist.filter(
        (m) => !m.equals(market),
      );
      await executeTxWithErrorHandling(
        () => context.glamClient.loopscale.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm removing market ${market}`,
        },
        (txSig) =>
          `Loopscale market ${market} removed from allowlist: ${txSig}`,
      );
    });

  loopscale
    .command("quote")
    .argument("<collateral-token>", "Collateral mint address or symbol")
    .argument("<collateral-amount>", "Collateral amount")
    .argument("<borrow-token>", "Principal mint address or symbol")
    .argument("<borrow-amount>", "Principal amount to borrow")
    .option(
      "--duration-type <n>",
      "Loopscale quote duration type (0=days, 1=weeks, 2=months, 3=minutes, 4=years)",
      "0",
    )
    .requiredOption("--duration <n>", "Loopscale quote duration units")
    .option(
      "--external-yield-source <u8>",
      "Only select quotes from strategies with this external yield source",
    )
    .option("--json", "Print the raw selected quote as JSON", false)
    .description("Fetch the best Loopscale quote for a borrow")
    .action(
      async (
        cToken: string,
        cAmount: string,
        bToken: string,
        bAmount: string,
        opts: {
          durationType: string;
          duration: string;
          externalYieldSource?: string;
          json?: boolean;
        },
      ) => {
        const quoteDurationType = parseUnsignedNumber(
          opts.durationType,
          "duration-type",
          4,
        );
        const quoteDuration = parseUnsignedNumber(
          opts.duration,
          "duration",
          U32_MAX,
        );
        const principalToken = await resolveTokenMint(
          context.glamClient,
          bToken,
        );
        const collateralToken = await resolveTokenMint(
          context.glamClient,
          cToken,
        );
        const principalMint = new PublicKey(principalToken.address);
        const collateralMint = new PublicKey(collateralToken.address);
        const collateralAmount = parsePositiveUiAmount(
          cAmount,
          collateralToken.decimals,
          "collateral-amount",
        );
        const borrowAmount = parsePositiveUiAmount(
          bAmount,
          principalToken.decimals,
          "borrow-amount",
        );

        const quote = await context.glamClient.loopscale.fetchBestQuote({
          principalMint,
          collateralMint,
          collateralAmount,
          durationType: quoteDurationType,
          duration: quoteDuration,
          borrowAmount,
          externalYieldSource:
            opts.externalYieldSource === undefined
              ? undefined
              : parseUnsignedNumber(
                  opts.externalYieldSource,
                  "external-yield-source",
                  U8_MAX,
                ),
        });

        if (opts.json) {
          console.log(JSON.stringify(quote, null, 2));
          return;
        }

        console.log(`Strategy: ${quote.strategy}`);
        console.log(`Collateral identifier: ${quote.collateralIdentifier}`);
        console.log(`Amount: ${quote.amount}`);
        console.log(`APY cBPS: ${quote.apy}`);
        console.log(`LTV cBPS: ${quote.ltv}`);
        console.log(`LQT cBPS: ${quote.lqt}`);
      },
    );

  loopscale
    .command("create-loan")
    .option("--nonce <u64>", "Loan nonce (defaults to the current timestamp)")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Create a new Loopscale loan account")
    .action(async (options: { nonce?: string; yes?: boolean }) => {
      const nonce = options.nonce
        ? parsePositiveBn(options.nonce, "nonce")
        : new BN(new Date().getTime().toString());
      const loan = context.glamClient.loopscale.getLoanPda(nonce);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.loopscale.createLoan(
            { nonce },
            { loan },
            context.txOptions,
          ),
        {
          skip: options.yes ?? false,
          message: [
            "Confirm Loopscale create-loan",
            `nonce: ${nonce.toString()}`,
            `loan: ${loan}`,
          ].join("\n"),
        },
        (txSig) =>
          `Loopscale loan ${loan} created (nonce ${nonce.toString()}): ${txSig}`,
      );
    });

  loopscale
    .command("close-loan")
    .requiredOption(
      "--loan <pubkey>",
      "Existing empty Loopscale loan account",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Close an empty Loopscale loan account")
    .action(async (options: { loan: PublicKey; yes?: boolean }) => {
      const loan = options.loan;
      const loanAccount =
        await context.glamClient.loopscale.fetchOwnedLoan(loan);

      if (loanAccount.activeCollateral.length > 0) {
        fail(
          `Loan ${loan} still has active collateral (${listCollateralMints(loanAccount)}); withdraw collateral before closing.`,
        );
      }
      if (loanAccount.activeLedgers.length > 0) {
        fail(
          `Loan ${loan} still has active principal (${summarizeActivePrincipal(loanAccount)}); repay principal before closing.`,
        );
      }

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.loopscale.closeLoan({ loan }, context.txOptions),
        {
          skip: options.yes ?? false,
          message: ["Confirm Loopscale close-loan", `loan: ${loan}`].join("\n"),
        },
        (txSig) => `Loopscale loan ${loan} closed: ${txSig}`,
      );
    });

  loopscale
    .command("create-strategy")
    .argument("<amount>", "Initial principal amount to deposit")
    .requiredOption(
      "--market <pubkey>",
      "Loopscale market information account",
      validatePublicKey,
    )
    .option(
      "--origination-cap <amount>",
      "Maximum principal amount that can be originated (defaults to amount)",
    )
    .option("--liquidity-buffer-cbps <n>", "Liquidity buffer in cBPS", "0")
    .option("--interest-fee-cbps <n>", "Interest fee in cBPS", "0")
    .option("--origination-fee-cbps <n>", "Origination fee in cBPS", "0")
    .option("--principal-fee-cbps <n>", "Principal fee in cBPS", "0")
    .option("--enable-originations", "Enable new originations", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Create and fund a Loopscale lender strategy")
    .action(
      async (
        amount: string,
        options: {
          market: PublicKey;
          originationCap?: string;
          liquidityBufferCbps: string;
          interestFeeCbps: string;
          originationFeeCbps: string;
          principalFeeCbps: string;
          enableOriginations: boolean;
          yes: boolean;
        },
      ) => {
        const {
          market,
          enableOriginations,
          originationFeeCbps,
          interestFeeCbps,
          principalFeeCbps,
          liquidityBufferCbps,
        } = options;
        const marketInfo =
          await context.glamClient.loopscale.fetchMarketInformation(market);
        const principalToken = await resolveTokenMint(
          context.glamClient,
          marketInfo.principalMint.toBase58(),
        );
        const principalMint = new PublicKey(principalToken.address);
        const depositAmount = assertU64(
          parsePositiveUiAmount(amount, principalToken.decimals),
        );
        const originationCap = options.originationCap
          ? assertU64(
              parseNonNegativeUiAmount(
                options.originationCap,
                principalToken.decimals,
              ),
            )
          : depositAmount;
        const liquidityBuffer = parseCbps(
          liquidityBufferCbps,
          "liquidity-buffer-cbps",
        );
        const interestFee = parseCbps(interestFeeCbps, "interest-fee-cbps");
        const originationFee = parseCbps(
          originationFeeCbps,
          "origination-fee-cbps",
        );
        const principalFee = parseCbps(principalFeeCbps, "principal-fee-cbps");

        const nonce = Keypair.generate();
        const strategy = context.glamClient.loopscale.getStrategyPda(
          nonce.publicKey,
        );
        const createStrategyIx =
          await context.glamClient.loopscale.txBuilder.createStrategyIx(
            {
              lender: context.glamClient.vaultPda,
              originationCap,
              liquidityBuffer,
              interestFee,
              originationFee,
              principalFee,
              originationsEnabled: enableOriginations,
              externalYieldSourceArgs: null,
            },
            {
              nonce: nonce.publicKey,
              strategy,
              marketInformation: options.market,
              principalMint,
            },
          );
        const depositStrategyIx =
          await context.glamClient.loopscale.txBuilder.depositStrategyIx(
            depositAmount,
            {
              strategy,
              principalMint,
              marketInformation: options.market,
            },
          );
        const tx = new Transaction().add(createStrategyIx, depositStrategyIx);

        const principalLabel = `${amount} ${principalToken.symbol}`;
        await submitCosignedTx(context, tx, {
          skip: options.yes ?? false,
          additionalSigners: [nonce],
          message: [
            "Confirm Loopscale create-strategy",
            `strategy: ${strategy}`,
            `nonce: ${nonce.publicKey}`,
            `lender: ${context.glamClient.vaultPda}`,
            `market: ${market}`,
            `principal: ${principalLabel}`,
            `origination cap: ${originationCap.toString()} base units`,
            `liquidity buffer: ${liquidityBuffer.toString()} cBPS`,
            `originations enabled: ${enableOriginations}`,
          ].join("\n"),
          success: (txSig) =>
            `Loopscale strategy ${strategy} created and funded with ${principalLabel}: ${txSig}`,
        });
      },
    );

  loopscale
    .command("update-strategy")
    .requiredOption(
      "--strategy <pubkey>",
      "Existing Loopscale strategy account",
      validatePublicKey,
    )
    .option(
      "--collateral-term <term>",
      "Set a collateral term as <collateral-index|collateral-token>:<duration-index>:<apy-cbps>",
      (value, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--enable-originations", "Enable new originations", false)
    .option("--disable-originations", "Disable new originations", false)
    .option(
      "--origination-cap <amount>",
      "Maximum principal amount to originate",
    )
    .option("--liquidity-buffer-cbps <n>", "Liquidity buffer in cBPS")
    .option("--interest-fee-cbps <n>", "Interest fee in cBPS")
    .option("--origination-fee-cbps <n>", "Origination fee in cBPS")
    .option("--principal-fee-cbps <n>", "Principal fee in cBPS")
    .option(
      "--deploy-idle-capital",
      "Enable Loopscale external yield source 1 so idle principal can be deployed",
      false,
    )
    .option(
      "--disable-idle-capital",
      "Disable Loopscale external yield source so an empty strategy can be closed",
      false,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Update a Loopscale lender strategy")
    .action(
      async (options: {
        strategy: PublicKey;
        collateralTerm: string[];
        enableOriginations: boolean;
        disableOriginations: boolean;
        originationCap?: string;
        liquidityBufferCbps?: string;
        interestFeeCbps?: string;
        originationFeeCbps?: string;
        principalFeeCbps?: string;
        deployIdleCapital: boolean;
        disableIdleCapital: boolean;
        yes?: boolean;
      }) => {
        if (options.enableOriginations && options.disableOriginations) {
          fail(
            "Use only one of --enable-originations or --disable-originations",
          );
        }
        if (options.deployIdleCapital && options.disableIdleCapital) {
          fail(
            "Use only one of --deploy-idle-capital or --disable-idle-capital",
          );
        }
        if (options.deployIdleCapital && options.disableOriginations) {
          fail(
            "--deploy-idle-capital cannot be combined with --disable-originations",
          );
        }

        const {
          strategy,
          collateralTerm,
          enableOriginations,
          disableOriginations,
          deployIdleCapital,
          disableIdleCapital,
        } = options;

        const { strategy: strategyAccount, marketInfo } =
          await context.glamClient.loopscale.fetchOwnedStrategyWithMarket(
            strategy,
          );
        const { mint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          marketInfo.principalMint,
        );

        const collateralTerms = await parseCollateralTermUpdates(
          context,
          marketInfo,
          collateralTerm,
        );
        const params: LoopscaleApiUpdateStrategyParams = {};
        const changeLines: string[] = [];

        if (enableOriginations || disableOriginations) {
          params.originationsEnabled = Boolean(enableOriginations);
          changeLines.push(
            `originations: ${enableOriginations ? "enabled" : "disabled"}`,
          );
        }
        if (options.originationCap !== undefined) {
          const originationCap = assertU64(
            parseNonNegativeUiAmount(options.originationCap, mint.decimals),
          );
          params.originationCap = bnToSafeNumber(originationCap);
          changeLines.push(
            `origination cap: ${originationCap.toString()} base units`,
          );
        }
        if (options.liquidityBufferCbps !== undefined) {
          const liquidityBuffer = parseCbps(options.liquidityBufferCbps);
          params.liquidityBuffer = bnToSafeNumber(liquidityBuffer);
          changeLines.push(
            `liquidity buffer: ${liquidityBuffer.toString()} cBPS`,
          );
        }
        if (options.interestFeeCbps !== undefined) {
          const interestFee = parseCbps(options.interestFeeCbps);
          params.interestFee = bnToSafeNumber(interestFee);
          changeLines.push(`interest fee: ${interestFee.toString()} cBPS`);
        }
        if (options.originationFeeCbps !== undefined) {
          const originationFee = parseCbps(options.originationFeeCbps);
          params.originationFee = bnToSafeNumber(originationFee);
          changeLines.push(
            `origination fee: ${originationFee.toString()} cBPS`,
          );
        }
        if (options.principalFeeCbps !== undefined) {
          const principalFee = parseCbps(options.principalFeeCbps);
          params.principalFee = bnToSafeNumber(principalFee);
          changeLines.push(`principal fee: ${principalFee.toString()} cBPS`);
        }
        if (deployIdleCapital) {
          if (strategyAccount.externalYieldSource === 1) {
            fail(`Strategy ${strategy} already has external yield source 1`);
          }
          if (strategyAccount.externalYieldSource !== 0) {
            fail(
              `Strategy ${strategy} has unsupported external yield source ${strategyAccount.externalYieldSource}`,
            );
          }

          params.externalYieldSource = {
            newExternalYieldSource: 1,
          };
          if (params.originationsEnabled !== true) {
            params.originationsEnabled = true;
            changeLines.push("originations: enabled");
          }
          changeLines.push("external yield source: 1");
        }
        if (disableIdleCapital) {
          if (strategyAccount.externalYieldSource === 0) {
            fail(`Strategy ${strategy} already has external yield source 0`);
          }
          if (!strategyAccount.externalYieldAmount.isZero()) {
            fail(
              `Strategy ${strategy} still has external yield amount ${strategyAccount.externalYieldAmount}; withdraw external yield before disabling idle capital.`,
            );
          }

          params.externalYieldSource = {
            newExternalYieldSource: 0,
          };
          changeLines.push("external yield source: 0");
        }

        if (collateralTerms.length > 0) {
          for (const term of collateralTerms) {
            changeLines.push(
              `collateral terms apy=${term.apy.toString()} cBPS indices=${term.indices
                .map(
                  ({ collateralIndex, durationIndex }) =>
                    `${collateralIndex}:${durationIndex}`,
                )
                .join(",")}`,
            );
          }
        }

        const hasParams = Object.keys(params).length > 0;
        const apiCollateralTerms = buildLoopscaleApiCollateralTermUpdates(
          strategyAccount,
          marketInfo,
          collateralTerms,
        );
        if (!hasParams && collateralTerms.length === 0) {
          fail("No strategy updates requested");
        }

        const apiTxs =
          await context.glamClient.loopscale.buildApiUpdateStrategyTxs({
            strategy,
            collateralTerms: apiCollateralTerms,
            updateParams: hasParams ? params : undefined,
          });
        for (const signer of apiTxs.flatMap(
          ({ additionalSigners }) => additionalSigners,
        )) {
          changeLines.push(`external setup signer: ${signer.publicKey}`);
        }

        await submitCosignedTxs(
          context,
          apiTxs.map(({ ixs, additionalSigners }) => ({
            tx: new Transaction().add(...ixs),
            additionalSigners,
          })),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale update-strategy",
              `strategy: ${strategy}`,
              `principal mint: ${strategyAccount.principalMint}`,
              ...changeLines,
            ].join("\n"),
            success: (txSigs) =>
              `Loopscale strategy ${strategy} updated: ${txSigs.join(", ")}`,
          },
        );
      },
    );

  loopscale
    .command("deposit-strategy")
    .argument("<strategy>", "Loopscale strategy account", validatePublicKey)
    .argument("<amount>", "Principal amount to deposit")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit principal liquidity into a Loopscale strategy")
    .action(
      async (
        strategy: PublicKey,
        amount: string,
        options: { yes?: boolean },
      ) => {
        const { strategy: strategyAccount, marketInfo } =
          await context.glamClient.loopscale.fetchOwnedStrategyWithMarket(
            strategy,
          );
        const { mint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          marketInfo.principalMint,
        );
        const depositAmount = assertU64(
          parsePositiveUiAmount(amount, mint.decimals),
        );

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.loopscale.depositStrategy(
              depositAmount,
              {
                strategy,
                principalMint: strategyAccount.principalMint,
                marketInformation: strategyAccount.marketInformation,
              },
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale deposit-strategy",
              `strategy: ${strategy}`,
              `principal mint: ${strategyAccount.principalMint}`,
              `amount: ${amount}`,
            ].join("\n"),
          },
          (txSig) =>
            `Deposited ${amount} into Loopscale strategy ${strategy}: ${txSig}`,
        );
      },
    );

  loopscale
    .command("withdraw-strategy")
    .argument("<strategy>", "Loopscale strategy account", validatePublicKey)
    .argument("[amount]", "Principal amount to withdraw, or 'all'")
    .option("--all", "Withdraw all available principal", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw undeployed principal from a Loopscale strategy")
    .action(
      async (
        strategy: PublicKey,
        amount: string | undefined,
        options: { all?: boolean; yes?: boolean },
      ) => {
        const strategyAccount =
          await context.glamClient.loopscale.fetchOwnedStrategy(strategy);
        const { mint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          strategyAccount.principalMint,
        );
        const withdrawAll = options.all || amount === "all";
        if (!withdrawAll && !amount) {
          fail("Provide an amount or use --all");
        }
        const withdrawAmount = withdrawAll
          ? new BN(0)
          : assertU64(parsePositiveUiAmount(amount!, mint.decimals));

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.loopscale.withdrawStrategy(
              withdrawAmount,
              withdrawAll,
              {
                strategy,
                principalMint: strategyAccount.principalMint,
                marketInformation: strategyAccount.marketInformation,
              },
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale withdraw-strategy",
              `strategy: ${strategy}`,
              `principal mint: ${strategyAccount.principalMint}`,
              withdrawAll ? "amount: all" : `amount: ${amount}`,
            ].join("\n"),
          },
          (txSig) =>
            `Withdrew ${withdrawAll ? "all available principal" : amount} from Loopscale strategy ${strategy}: ${txSig}`,
        );
      },
    );

  loopscale
    .command("close-strategy")
    .argument(
      "<strategy>",
      "Empty Loopscale strategy account",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Close an empty Loopscale strategy account")
    .action(async (strategy: PublicKey, options: { yes?: boolean }) => {
      const strategyAccount =
        await context.glamClient.loopscale.fetchOwnedStrategy(strategy);
      context.glamClient.loopscale.assertStrategyClosable(strategyAccount);

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.loopscale.closeStrategy(
            {
              strategy,
              principalMint: strategyAccount.principalMint,
            },
            context.txOptions,
          ),
        {
          skip: options.yes ?? false,
          message: [
            "Confirm Loopscale close-strategy",
            `strategy: ${strategy}`,
            `principal mint: ${strategyAccount.principalMint}`,
          ].join("\n"),
        },
        (txSig) => `Loopscale strategy ${strategy} closed: ${txSig}`,
      );
    });

  loopscale
    .command("deposit-collateral")
    .argument("<collateral-token>", "Collateral mint address or symbol")
    .argument("<amount>", "Collateral amount")
    .requiredOption(
      "--loan <pubkey>",
      "Existing Loopscale loan account",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description(
      "Deposit collateral into an existing Loopscale loan (does not update weights)",
    )
    .action(
      async (
        cToken: string,
        amount: string,
        options: { loan: PublicKey; yes?: boolean },
      ) => {
        const loan = options.loan;
        await context.glamClient.loopscale.fetchOwnedLoan(loan);

        const collateralToken = await resolveTokenMint(
          context.glamClient,
          cToken,
        );
        const collateralMint = new PublicKey(collateralToken.address);
        const collateralAmount = parsePositiveUiAmount(
          amount,
          collateralToken.decimals,
          "amount",
        );

        const collateralLabel = `${amount} ${collateralToken.symbol}`;
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.loopscale.depositCollateral(
              {
                amount: collateralAmount,
                assetType: 0,
                assetIdentifier: collateralMint,
                assetIndexGuidance: Buffer.alloc(0),
              },
              {
                loan,
                depositMint: collateralMint,
              },
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale deposit-collateral",
              `loan: ${loan}`,
              `collateral: ${collateralLabel}`,
            ].join("\n"),
          },
          (txSig) =>
            `Deposited ${collateralLabel} into loan ${loan}: ${txSig}. ` +
            `Note: collateral has no usable LTV until weights are updated ` +
            `(borrow-principal prepends the weight update automatically).`,
        );
      },
    );

  loopscale
    .command("borrow-principal")
    .argument("<borrow-token>", "Principal mint address or symbol")
    .argument("<borrow-amount>", "Principal amount to borrow")
    .requiredOption(
      "--loan <pubkey>",
      "Existing Loopscale loan account",
      validatePublicKey,
    )
    .option(
      "--collateral-token <mint>",
      "Collateral mint or symbol (required when the loan holds multiple collateral mints)",
    )
    .option(
      "--weight-matrix <n0,n1,n2,n3,n4>",
      "Collateral weight matrix to apply before the first borrow",
      "1000000,0,0,0,0",
    )
    .option(
      "--duration-type <n>",
      "Loopscale quote duration type for a first borrow (0=days, 1=weeks, 2=months, 3=minutes, 4=years)",
      "0",
    )
    .option(
      "--duration <n>",
      "Loopscale quote duration units for a first borrow",
    )
    .option(
      "--strategy <pubkey>",
      "Target Loopscale strategy for a first borrow instead of selecting from the quote API",
      validatePublicKey,
    )
    .option(
      "--strategy-duration-index <u8>",
      "Duration index to use with --strategy when multiple strategy terms match the collateral",
    )
    .option(
      "--external-yield-source <u8>",
      "Only select quote API strategies with this external yield source",
    )
    .option("--skip-sol-unwrap", "Skip SOL unwrap", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Borrow principal against an existing Loopscale loan")
    .action(
      async (
        bToken: string,
        bAmount: string,
        options: {
          loan: PublicKey;
          collateralToken?: string;
          weightMatrix: string;
          durationType: string;
          duration?: string;
          strategy?: PublicKey;
          strategyDurationIndex?: string;
          externalYieldSource?: string;
          skipSolUnwrap?: boolean;
          yes?: boolean;
        },
      ) => {
        const loan = options.loan;

        const loanAccount =
          await context.glamClient.loopscale.fetchOwnedLoan(loan);

        const activeCollateral = loanAccount.activeCollateral;
        if (activeCollateral.length === 0) {
          fail(`Loan ${loan} has no collateral deposited`);
        }

        let collateralMint: PublicKey;
        if (options.collateralToken) {
          collateralMint = await resolveTokenPublicKey(
            context.glamClient,
            options.collateralToken,
          );
          if (
            !activeCollateral.some((c) => c.assetMint.equals(collateralMint))
          ) {
            fail(`Collateral ${collateralMint} is not held by loan ${loan}`);
          }
        } else {
          const uniqueMints = [
            ...new Set(activeCollateral.map((c) => c.assetMint.toBase58())),
          ];
          if (uniqueMints.length > 1) {
            fail(
              `Loan ${loan} holds multiple collateral mints (${uniqueMints.join(", ")}); specify --collateral-token`,
            );
          }
          collateralMint = activeCollateral[0].assetMint;
        }

        // Slot of the chosen collateral within the loan's collateral array;
        // the loan stores per-slot lqt at the matching lqtMatrix row.
        const collateralSlot = loanAccount.collateral.findIndex((c) =>
          c.assetMint.equals(collateralMint),
        );
        const assetIdentifier =
          loanAccount.collateral[collateralSlot].assetIdentifier;

        const principalToken = await resolveTokenMint(
          context.glamClient,
          bToken,
        );
        const principalMint = new PublicKey(principalToken.address);
        const borrowAmount = parsePositiveUiAmount(
          bAmount,
          principalToken.decimals,
          "borrow-amount",
        );

        // Reuse the strategy and terms from an existing active ledger borrowing
        // the same principal, instead of quoting for a (possibly different)
        // strategy.
        const ledger = loanAccount.activeLedgers.find((l) =>
          l.principalMint.equals(principalMint),
        );
        if (
          ledger &&
          options.strategy &&
          !ledger.strategy.equals(options.strategy)
        ) {
          fail(
            `Loan ${loan} already has an active ${principalMint} ledger using strategy ${ledger.strategy}; cannot target ${options.strategy}`,
          );
        }
        const currentLqt = loanAccount.lqtMatrix[collateralSlot] as Tuple5;
        const weightMatrix = parseTuple5(options.weightMatrix, "weight-matrix");
        let shouldUpdateWeightMatrix = false;
        const {
          strategy,
          expectedLoanValues,
          assetIndexGuidance: borrowAssetIndexGuidance,
          durationIndex,
        } = ledger
          ? await (async () => {
              const expectedApy = ledger.apy;
              const expectedLqt = currentLqt;
              if (tuple5IsZero(expectedLqt)) {
                fail(
                  `Loan ${loan} has an active ledger but collateral index ${collateralSlot} has zero expected LQT; cannot safely reuse loan terms.`,
                );
              }
              console.log(
                `Reusing loan strategy ${ledger.strategy} (apy=${expectedApy.toString()}, lqt=[${expectedLqt.join(", ")}])`,
              );
              return await context.glamClient.loopscale.resolveBorrowTermsFromStrategy(
                {
                  strategy: ledger.strategy,
                  principalMint,
                  assetIdentifier,
                  expectedApy,
                  expectedLqt,
                },
              );
            })()
          : options.strategy
            ? await (async () => {
                shouldUpdateWeightMatrix = true;
                const targetStrategy = options.strategy!;
                const requestedDurationIndex =
                  options.strategyDurationIndex === undefined
                    ? undefined
                    : parseUnsignedNumber(
                        options.strategyDurationIndex,
                        "strategy-duration-index",
                        STRATEGY_DURATION_COUNT - 1,
                      );
                const terms =
                  await context.glamClient.loopscale.resolveBorrowTermsFromTargetStrategy(
                    {
                      strategy: targetStrategy,
                      principalMint,
                      assetIdentifier,
                      requestedDurationIndex,
                    },
                  );
                console.log(
                  `Using requested Loopscale strategy ${terms.strategy} (apy=${terms.expectedLoanValues.expectedApy.toString()}, lqt=[${terms.expectedLoanValues.expectedLqt.join(", ")}])`,
                );
                return terms;
              })()
            : await (async () => {
                shouldUpdateWeightMatrix = true;
                if (options.duration === undefined) {
                  fail("--duration is required for the first borrow");
                }
                const quoteTerms =
                  await context.glamClient.loopscale.resolveBorrowTermsFromQuote(
                    {
                      principalMint,
                      collateralMint,
                      assetIdentifier,
                      collateralAmount:
                        loanAccount.collateral[collateralSlot].amount,
                      borrowAmount,
                      durationType: parseUnsignedNumber(
                        options.durationType,
                        "duration-type",
                        4,
                      ),
                      duration: parseUnsignedNumber(
                        options.duration,
                        "duration",
                        U32_MAX,
                      ),
                      externalYieldSource:
                        options.externalYieldSource === undefined
                          ? undefined
                          : parseUnsignedNumber(
                              options.externalYieldSource,
                              "external-yield-source",
                              U8_MAX,
                            ),
                    },
                  );
                console.log(
                  `Selected Loopscale strategy ${quoteTerms.strategy} from quote API (apy=${quoteTerms.expectedLoanValues.expectedApy.toString()}, lqt=[${quoteTerms.expectedLoanValues.expectedLqt.join(", ")}])`,
                );
                return quoteTerms;
              })();

        let updateWeightMatrixIx: TransactionInstruction | null = null;
        if (shouldUpdateWeightMatrix) {
          updateWeightMatrixIx =
            await context.glamClient.loopscale.txBuilder.updateWeightMatrixIx(
              {
                collateralIndex: collateralSlot,
                weightMatrix,
                expectedLoanValues,
                assetIndexGuidance: Buffer.alloc(0),
              },
              { loan },
            );
        }
        const principalLabel = `${bAmount} ${principalToken.symbol}`;
        const confirmMessage = [
          "Confirm Loopscale borrow against existing loan",
          `loan: ${loan}`,
          `strategy: ${strategy}`,
          `collateral mint: ${collateralMint}`,
          ...(updateWeightMatrixIx
            ? [`weight matrix: [${weightMatrix.join(", ")}]`]
            : []),
          `expected apy: ${expectedLoanValues.expectedApy.toString()}`,
          `expected lqt: [${expectedLoanValues.expectedLqt.join(", ")}]`,
          `borrow: ${principalLabel}`,
        ].join("\n");
        const success = (txSig: string) =>
          `Borrowed ${principalLabel} against loan ${loan}: ${txSig}`;

        if (!updateWeightMatrixIx) {
          const strategyAccounts =
            await context.glamClient.loopscale.resolveLedgerStrategyAccounts(
              strategy,
            );
          await executeTxWithErrorHandling(
            () =>
              context.glamClient.loopscale.borrowPrincipal(
                {
                  amount: borrowAmount,
                  assetIndexGuidance: borrowAssetIndexGuidance,
                  duration: durationIndex,
                  expectedLoanValues,
                  skipSolUnwrap: options.skipSolUnwrap ?? false,
                },
                {
                  loan,
                  strategy,
                  marketInformation: strategyAccounts.marketInformation,
                  principalMint,
                },
                context.txOptions,
              ),
            {
              skip: options.yes ?? false,
              message: confirmMessage,
            },
            success,
          );
          return;
        }

        const borrowPrincipalIxs =
          await context.glamClient.loopscale.buildApiBorrowPrincipalIxs({
            loan,
            strategy,
            amount: borrowAmount,
            assetIndexGuidance: [...borrowAssetIndexGuidance],
            duration: durationIndex,
            expectedLoanValues,
            skipSolUnwrap: options.skipSolUnwrap ?? false,
          });
        const tx = new Transaction().add(updateWeightMatrixIx);
        tx.add(...borrowPrincipalIxs);

        await submitCosignedTx(context, tx, {
          skip: options.yes ?? false,
          message: confirmMessage,
          success,
        });
      },
    );

  loopscale
    .command("withdraw-collateral")
    .argument("<collateral-token>", "Collateral mint address or symbol")
    .argument("<amount>", "Collateral amount (ignored with --withdraw-all)")
    .requiredOption(
      "--loan <pubkey>",
      "Existing Loopscale loan account",
      validatePublicKey,
    )
    .option("--collateral-index <u8>", "Collateral index override")
    .option("--withdraw-all", "Withdraw the full collateral balance", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw collateral from an existing Loopscale loan")
    .action(
      async (
        cToken: string,
        amount: string,
        options: {
          loan: PublicKey;
          collateralIndex?: string;
          withdrawAll?: boolean;
          yes?: boolean;
        },
      ) => {
        const loan = options.loan;
        const loanAccount =
          await context.glamClient.loopscale.fetchOwnedLoan(loan);

        const collateralToken = await resolveTokenMint(
          context.glamClient,
          cToken,
        );
        const collateralMint = new PublicKey(collateralToken.address);

        // Slot of the chosen collateral within the loan's collateral array;
        // the loan stores per-slot lqt at the matching lqtMatrix row.
        const collateralSlot =
          options.collateralIndex !== undefined
            ? parseUnsignedNumber(
                options.collateralIndex,
                "collateral-index",
                U8_MAX,
              )
            : loanAccount.collateral.findIndex((c) =>
                c.assetMint.equals(collateralMint),
              );
        if (
          collateralSlot < 0 ||
          collateralSlot >= loanAccount.collateral.length ||
          !loanAccount.collateral[collateralSlot].assetMint.equals(
            collateralMint,
          )
        ) {
          fail(`Collateral ${collateralMint} is not held by loan ${loan}`);
        }

        const withdrawAll = options.withdrawAll ?? false;
        const collateral = loanAccount.collateral[collateralSlot];
        const withdrawAmount = withdrawAll
          ? collateral.amount
          : parsePositiveUiAmount(amount, collateralToken.decimals, "amount");
        if (withdrawAmount.gt(collateral.amount)) {
          fail(
            `Cannot withdraw ${withdrawAmount.toString()} base units; collateral slot ${collateralSlot} holds ${collateral.amount.toString()}`,
          );
        }

        // Source expected loan values from the loan's cached state: apy from the
        // matching active ledger (if any) and lqt from the collateral slot.
        const ledger = loanAccount.activeLedgers[0];
        const expectedApy = ledger ? ledger.apy : new BN(0);
        const expectedLqt = loanAccount.lqtMatrix[collateralSlot] as Tuple5;

        const collateralLabel = withdrawAll
          ? `all ${collateralToken.symbol}`
          : `${amount} ${collateralToken.symbol}`;
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.loopscale.withdrawCollateral(
              {
                amount: withdrawAmount,
                collateralIndex: collateralSlot,
                assetIndexGuidance: Buffer.alloc(0),
                expectedLoanValues: { expectedApy, expectedLqt },
                closeIfEligible: false,
                withdrawAll,
              },
              {
                loan,
                assetMint: collateralMint,
              },
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale withdraw-collateral",
              `loan: ${loan}`,
              `collateral: ${collateralLabel}`,
              `collateral index: ${collateralSlot}`,
            ].join("\n"),
          },
          (txSig) => `Withdrew ${collateralLabel} from loan ${loan}: ${txSig}`,
        );
      },
    );

  loopscale
    .command("repay-principal")
    .argument("<borrow-token>", "Principal mint address or symbol")
    .argument(
      "<amount>",
      "Principal amount to repay (ignored with --repay-all)",
    )
    .requiredOption(
      "--loan <pubkey>",
      "Existing Loopscale loan account",
      validatePublicKey,
    )
    .option("--ledger-index <u8>", "Ledger index override")
    .option("--repay-all", "Repay the full amount due on the ledger", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Repay principal on a Loopscale loan ledger")
    .action(
      async (
        bToken: string,
        amount: string,
        options: {
          loan: PublicKey;
          ledgerIndex?: string;
          repayAll?: boolean;
          yes?: boolean;
        },
      ) => {
        const loan = options.loan;
        const loanAccount =
          await context.glamClient.loopscale.fetchOwnedLoan(loan);

        const principalToken = await resolveTokenMint(
          context.glamClient,
          bToken,
        );
        const principalMint = new PublicKey(principalToken.address);

        // Resolve the target ledger: explicit index if given, otherwise the
        // single active ledger borrowing the requested principal.
        let ledgerIndex: number;
        if (options.ledgerIndex !== undefined) {
          ledgerIndex = parseUnsignedNumber(
            options.ledgerIndex,
            "ledger-index",
            U8_MAX,
          );
          const ledger = loanAccount.ledgers[ledgerIndex];
          if (!ledger || ledger.status === 0) {
            fail(`Loan ${loan} has no active ledger at index ${ledgerIndex}`);
          }
          if (!ledger.principalMint.equals(principalMint)) {
            fail(
              `Ledger ${ledgerIndex} borrows ${ledger.principalMint}, not ${principalMint}`,
            );
          }
        } else {
          const matches = loanAccount.ledgers
            .map((l, i) => ({ ledger: l, index: i }))
            .filter(
              ({ ledger }) =>
                ledger.status !== 0 &&
                ledger.principalMint.equals(principalMint),
            );
          if (matches.length === 0) {
            const principals = [
              ...new Set(
                loanAccount.activeLedgers.map((l) =>
                  l.principalMint.toBase58(),
                ),
              ),
            ];
            fail(
              `Loan ${loan} has no active ledger borrowing ${principalMint}.` +
                (principals.length
                  ? ` Active ledger principal mints: ${principals.join(", ")}`
                  : " The loan has no active borrow to repay."),
            );
          }
          if (matches.length > 1) {
            fail(
              `Loan ${loan} has multiple active ledgers borrowing ${principalMint} ` +
                `(indices ${matches.map((m) => m.index).join(", ")}); specify --ledger-index`,
            );
          }
          ledgerIndex = matches[0].index;
        }

        const targetLedger = loanAccount.ledgers[ledgerIndex];
        const repayAll = options.repayAll ?? false;
        // On a full repay, on-chain repays the full amount due; pass principalDue
        // as a ceiling. The borrower ATA must be funded above principalDue to
        // cover accrued interest.
        const repayAmount = repayAll
          ? targetLedger.principalDue
          : parsePositiveUiAmount(amount, principalToken.decimals, "amount");

        const {
          strategy,
          marketInformation,
          principalMint: strategyPrincipalMint,
        } = await context.glamClient.loopscale.resolveLedgerStrategyAccounts(
          targetLedger.strategy,
        );
        if (!strategyPrincipalMint.equals(principalMint)) {
          fail(
            `Ledger ${ledgerIndex} strategy principal mint ${strategyPrincipalMint} does not match ${principalMint}`,
          );
        }

        const principalLabel = repayAll
          ? `all ${principalToken.symbol}`
          : `${amount} ${principalToken.symbol}`;
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.loopscale.repayPrincipal(
              {
                amount: repayAmount,
                ledgerIndex,
                repayAll,
              },
              {
                loan,
                strategy,
                marketInformation,
                principalMint,
              },
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: [
              "Confirm Loopscale repay-principal",
              `loan: ${loan}`,
              `ledger index: ${ledgerIndex}`,
              `repay: ${principalLabel}`,
            ].join("\n"),
          },
          (txSig) =>
            `Repaid ${principalLabel} on loan ${loan} ledger ${ledgerIndex}: ${txSig}`,
        );
      },
    );
}
