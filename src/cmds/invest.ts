import { BN } from "@coral-xyz/anchor";
import {
  fetchLookupTables,
  FundOpenfundsModel,
  GlamClient,
  MintOpenfundsModel,
  MSOL,
  PriceDenom,
  StateModel,
  TxOptions,
  USDC,
  WSOL,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, confirmOperation, parseTxError } from "../utils";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";

const stateModelForDemo = {
  mints: [
    {
      // Glam Token
      name: "Glam Tokenized Vault Demo SOL",
      symbol: "gtvdSOL",
      uri: "",
      asset: WSOL,
      imageUri: "",
      isRawOpenfunds: true,
      // Glam Policies
      allowlist: null,
      blocklist: null,
      lockUpPeriod: 0, // number or BN
      permanentDelegate: null, // PublicKey, new PublicKey(0) => mint
      defaultAccountStateFrozen: false, // bool
      // Openfunds Share Class
      rawOpenfunds: {
        isin: "XS1082172823",
        shareClassCurrency: "SOL",
        fullShareClassName: "Glam Fund SOL-mSOL",
        currencyOfMinimalSubscription: "SOL",
        investmentStatus: "open",
        minimalInitialSubscriptionCategory: "amount",
        minimalInitialSubscriptionInAmount: "1000",
        minimalInitialSubscriptionInShares: "0",
        shareClassExtension: "",
        shareClassDistributionPolicy: "accumulating",
        shareClassLaunchDate: new Date().toISOString().split("T")[0],
        shareClassLifecycle: "active",
        launchPrice: "100",
        launchPriceCurrency: "USD",
        launchPriceDate: new Date().toISOString().split("T")[0],
      } as Partial<MintOpenfundsModel>,
    },
  ],
  // Glam
  accountType: { vault: {} },
  enabled: true,
  assets: [WSOL, USDC, MSOL],
  // Openfunds (Fund)
  rawOpenfunds: {
    fundDomicileAlpha2: "XS",
    // legalFundNameIncludingUmbrella: "Glam Fund SOL-mSOL",
    fundLaunchDate: new Date().toISOString().split("T")[0],
    investmentObjective: "demo",
    fundCurrency: "SOL",
    openEndedOrClosedEndedFundStructure: "open-ended fund",
    fiscalYearEnd: "12-31",
    legalForm: "other",
  } as FundOpenfundsModel,
  // Openfunds Company (simplified)
  company: {
    fundGroupName: "Glam Systems",
    manCo: "Glam Management",
    domicileOfManCo: "CH",
    emailAddressOfManCo: "hello@glam.systems",
    fundWebsiteOfManCo: "https://glam.systems",
  },
  // Openfunds Manager (simplified)
  owner: {
    portfolioManagerName: "glam.sol",
  },
} as Partial<StateModel>;

const stateModel = {
  ...stateModelForDemo,
  accountType: { fund: {} },
  integrations: [
    { marinade: {} },
    { sanctumStakePool: {} },
    { nativeStaking: {} },
    { meteoraDlmm: {} },
    { drift: {} },
    { kaminoLending: {} },
  ],
  baseAsset: WSOL,
  maxCap: new BN(100_000_000_000), // 100 SOL max cap
  mints: [
    {
      ...stateModelForDemo.mints![0],
      lockUpPeriodInSeconds: 30,
      feeStructure: {
        vault: {
          subscriptionFeeBps: 10,
          redemptionFeeBps: 20,
        },
        manager: {
          subscriptionFeeBps: 10,
          redemptionFeeBps: 20,
        },
        management: {
          feeBps: 10,
        },
        performance: {
          feeBps: 2000,
          hurdleRateBps: 500,
          hurdleType: { hard: {} },
        },
        protocol: {
          baseFeeBps: 0, // will be overwritten by program
          flowFeeBps: 0, // will be overwritten by program
        },
      },
      feeParams: {
        yearInSeconds: 31536000,
        paHighWaterMark: new BN(0), // will be overwritten by program
        paLastNav: new BN(1_000_000_000), // will be overwritten by program
        paAum: new BN(0), // will be overwritten by program
        lastPerformanceFeeCrystallized: new BN(0),
        lastManagementFeeCrystallized: new BN(0),
        lastProtocolFeeCrystallized: new BN(0),
      },
      valuation: {
        model: { continuous: {} },
        noticePeriod: new BN(5),
        noticePeriodType: { soft: {} },
        permissionlessFulfillment: false,
        settlementPeriod: new BN(15),
        cancellationWindow: new BN(5),
        timeUnit: { second: {} },
      },
      minSubscription: new BN(10_000_000), // 0.01 SOL
      minRedemption: null, // no minimum redemption
    },
  ],
};

export function installInvestCommands(
  tokenized: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions,
) {
  tokenized
    .command("create")
    .description("Create a tokenized vault for testing purpose")
    .action(async () => {
      try {
        const [txSig, glamState] = await glamClient.state.create(
          stateModel,
          false,
          txOptions,
        );
        console.log("State PDA:", glamClient.statePda.toBase58());
        console.log("Vault PDA:", glamClient.vaultPda.toBase58());
        console.log("Mint PDA:", glamClient.mintPda.toBase58());
        console.log("GLAM state created:", txSig);

        cliConfig.glamState = glamState;
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("sub <amount>")
    .description("Subscribe to a tokenized vault")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-q, --queued", "Subscribe to a tokenized vault in queued mode")
    .action(async (amount, options) => {
      const amountBN = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);

      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];

      options?.yes ||
        (await confirmOperation(
          `Confirm ${options?.queued ? "queued" : "instant"} subscription with ${amount} SOL?`,
        ));

      try {
        const txSig = await glamClient.investor.subscribe(
          WSOL,
          amountBN,
          0,
          !!options?.queued,
          {
            ...txOptions,
            lookupTables,
            preInstructions: await glamClient.price.priceVaultIxs(
              PriceDenom.SOL,
            ),
          },
        );
        console.log(
          `${glamClient.getSigner().toBase58()} instant subscription:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("price")
    .description("Price vault assets")
    .action(async () => {
      const glamVault = glamClient.vaultPda;
      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];

      const ixs = await glamClient.price.priceVaultIxs(PriceDenom.SOL);
      const tx = new Transaction().add(...ixs);
      try {
        const vTx = await glamClient.intoVersionedTransaction(tx, {
          ...txOptions,
          lookupTables,
        });
        const txSig = await glamClient.sendAndConfirm(vTx);
        console.log("Priced vault assets:", txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  tokenized
    .command("fulfill")
    .description("Fulfill subscription and redemption")
    .action(async () => {
      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];

      try {
        const txSig = await glamClient.investor.fulfill(WSOL, 0, {
          ...txOptions,
          lookupTables,
          preInstructions: await glamClient.price.priceVaultIxs(PriceDenom.SOL),
          // simulate: true,
        });
        console.log(
          `${glamClient.getSigner().toBase58()} triggered fulfillment:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("claim-sub")
    .description("Claim subscription and receive share tokens")
    .action(async () => {
      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];

      try {
        const glamMint = glamClient.mintPda;
        const txSig = await glamClient.investor.claim(glamMint, 0, {
          ...txOptions,
          lookupTables,
          preInstructions: await glamClient.price.priceVaultIxs(PriceDenom.SOL),
        });
        console.log(
          `${glamClient.getSigner().toBase58()} claimed tokens:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("redeem <amount>")
    .description("Request to redeem share tokens")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (amount, options) => {
      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];
      const amountBN = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);

      options?.yes ||
        (await confirmOperation(
          `Confirm queued redemption of ${amount} shares?`,
        ));

      try {
        const txSig = await glamClient.investor.queuedRedeem(
          WSOL,
          amountBN,
          0,
          {
            ...txOptions,
            lookupTables,
            preInstructions: await glamClient.price.priceVaultIxs(
              PriceDenom.SOL,
            ),
          },
        );
        console.log(
          `${glamClient.getSigner().toBase58()} requested to redeem:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("claim-redeem")
    .description("Claim redemption to receive SOL")
    .action(async () => {
      const glamState = cliConfig.glamState;
      const lookupTables = [
        ...(await fetchLookupTables(
          glamClient.provider.connection,
          glamClient.getSigner(),
          glamClient.statePda,
        )),
      ];

      try {
        const txSig = await glamClient.investor.claim(WSOL, 0, {
          ...txOptions,
          lookupTables,
          preInstructions: await glamClient.price.priceVaultIxs(PriceDenom.SOL),
        });
        console.log(
          `${glamClient.getSigner().toBase58()} claimed tokens:`,
          txSig,
        );
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
