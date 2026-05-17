import { BN } from "@coral-xyz/anchor";
import {
  JUPITER_BORROW_PROTOCOL,
  JUPITER_EARN_PROTOCOL,
  JupiterBorrowPolicy,
  JupiterEarnPolicy,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { type Command } from "commander";

import {
  type CliContext,
  executeTxWithErrorHandling,
  printPubkeyList,
  printTable,
  parsePositiveUiAmount,
  resolveTokenMint,
  validatePublicKey,
} from "../utils";

async function fetchEarnPolicy(
  context: CliContext,
): Promise<JupiterEarnPolicy | null> {
  return context.glamClient.fetchProtocolPolicy(
    context.glamClient.extJupiterProgram.programId,
    JUPITER_EARN_PROTOCOL,
    JupiterEarnPolicy,
  );
}

async function fetchBorrowPolicy(
  context: CliContext,
): Promise<JupiterBorrowPolicy | null> {
  return context.glamClient.fetchProtocolPolicy(
    context.glamClient.extJupiterProgram.programId,
    JUPITER_BORROW_PROTOCOL,
    JupiterBorrowPolicy,
  );
}

async function setEarnPolicy(context: CliContext, policy: JupiterEarnPolicy) {
  return context.glamClient.access.setProtocolPolicy(
    context.glamClient.extJupiterProgram.programId,
    JUPITER_EARN_PROTOCOL,
    policy.encode(),
    context.txOptions,
  );
}

async function setBorrowPolicy(
  context: CliContext,
  policy: JupiterBorrowPolicy,
) {
  return context.glamClient.access.setProtocolPolicy(
    context.glamClient.extJupiterProgram.programId,
    JUPITER_BORROW_PROTOCOL,
    policy.encode(),
    context.txOptions,
  );
}

export function installJupiterLendCommands(
  earnProgram: Command,
  borrowProgram: Command,
  context: CliContext,
) {
  earnProgram
    .command("view-policy")
    .description("View Jupiter Lend earn policy")
    .action(async () => {
      const policy = await fetchEarnPolicy(context);
      if (!policy) {
        console.log("No policy found");
        return;
      }
      printPubkeyList("Earn mints allowlist", policy.mintsAllowlist);
    });

  earnProgram
    .command("allow-mint")
    .argument("<mint>", "Mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a mint to the earn allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy =
        (await fetchEarnPolicy(context)) ?? new JupiterEarnPolicy([]);
      if (policy.mintsAllowlist.find((m) => m.equals(mint))) {
        console.error(`Mint ${mint} is already in the earn allowlist`);
        process.exit(1);
      }
      policy.mintsAllowlist.push(mint);
      await executeTxWithErrorHandling(
        () => setEarnPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding mint ${mint} to Jupiter Lend earn allowlist`,
        },
        (txSig) => `Mint ${mint} added to earn allowlist: ${txSig}`,
      );
    });

  earnProgram
    .command("remove-mint")
    .argument("<mint>", "Mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a mint from the earn allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy = await fetchEarnPolicy(context);
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.mintsAllowlist.find((m) => m.equals(mint))) {
        console.error("Mint not in earn allowlist. Removal not needed.");
        process.exit(1);
      }
      policy.mintsAllowlist = policy.mintsAllowlist.filter(
        (m) => !m.equals(mint),
      );
      await executeTxWithErrorHandling(
        () => setEarnPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing mint ${mint} from Jupiter Lend earn allowlist`,
        },
        (txSig) => `Mint ${mint} removed from earn allowlist: ${txSig}`,
      );
    });

  earnProgram
    .command("deposit")
    .argument("<amount>", "UI amount of underlying to deposit")
    .requiredOption(
      "--mint <mintOrSymbol>",
      "Underlying mint address or symbol",
    )
    .option(
      "--min-out <uiAmount>",
      "Minimum fToken amount to receive (UI units; defaults to 0)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to Jupiter Earn")
    .action(
      async (
        amount: string,
        options: { mint: string; minOut?: string; yes?: boolean },
      ) => {
        const token = await resolveTokenMint(context.glamClient, options.mint);
        const mint = new PublicKey(token.address);
        const assets = parsePositiveUiAmount(
          amount,
          token.decimals,
          "amount",
        );
        const minAmountOut = options.minOut
          ? parsePositiveUiAmount(
              options.minOut,
              token.decimals,
              "min-out",
            )
          : new BN(0);
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.jupiterEarn.deposit(
              mint,
              assets,
              minAmountOut,
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: `Confirm Jupiter Earn deposit ${amount} ${token.symbol}`,
          },
          (txSig) =>
            `Jupiter Earn deposit of ${amount} ${token.symbol}: ${txSig}`,
        );
      },
    );

  earnProgram
    .command("withdraw")
    .argument("<amount>", "UI amount of underlying to withdraw")
    .requiredOption(
      "--mint <mintOrSymbol>",
      "Underlying mint address or symbol",
    )
    .option(
      "--max-shares <uiAmount>",
      "Max fTokens to burn (UI units; defaults to u64::MAX)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw from Jupiter Earn")
    .action(
      async (
        amount: string,
        options: { mint: string; maxShares?: string; yes?: boolean },
      ) => {
        const token = await resolveTokenMint(context.glamClient, options.mint);
        const mint = new PublicKey(token.address);
        const underlyingAmount = parsePositiveUiAmount(
          amount,
          token.decimals,
          "amount",
        );
        const maxSharesBurn = options.maxShares
          ? parsePositiveUiAmount(
              options.maxShares,
              token.decimals,
              "max-shares",
            )
          : undefined;
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.jupiterEarn.withdraw(
              mint,
              underlyingAmount,
              maxSharesBurn,
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: `Confirm Jupiter Earn withdraw ${amount} ${token.symbol}`,
          },
          (txSig) =>
            `Jupiter Earn withdraw of ${amount} ${token.symbol}: ${txSig}`,
        );
      },
    );

  borrowProgram
    .command("view-policy")
    .description("View Jupiter Lend borrow policy")
    .action(async () => {
      const policy = await fetchBorrowPolicy(context);
      if (!policy) {
        console.log("No policy found");
        return;
      }
      printPubkeyList("Borrow vaults allowlist", policy.vaultsAllowlist);
      printPubkeyList(
        "Collateral mints allowlist",
        policy.collateralMintsAllowlist,
      );
      printPubkeyList("Borrow mints allowlist", policy.borrowMintsAllowlist);
    });

  borrowProgram
    .command("list-vaults")
    .description("List all Jupiter Lend borrow vaults")
    .action(async () => {
      const vaults = await context.glamClient.jupiterBorrow.listVaults();
      if (vaults.length === 0) {
        console.log("No Jupiter Lend borrow vaults found");
        return;
      }
      printTable(
        ["Vault ID", "Vault State", "Collateral Mint", "Debt Mint"],
        vaults.map((v) => [
          v.vaultId.toString(),
          v.vaultState.toBase58(),
          v.supplyToken.toBase58(),
          v.borrowToken.toBase58(),
        ]),
      );
    });

  borrowProgram
    .command("list-positions")
    .option(
      "--vault-id <u16>",
      "Only list positions for this Jupiter vault_id",
      parseInt,
    )
    .description("List Jupiter Lend borrow positions held by the GLAM vault")
    .action(async (options: { vaultId?: number }) => {
      const positions = await context.glamClient.jupiterBorrow.listPositions(
        options.vaultId,
      );
      if (positions.length === 0) {
        const suffix =
          options.vaultId === undefined ? "" : ` for vault ${options.vaultId}`;
        console.log(`No Jupiter Lend borrow positions found${suffix}`);
        return;
      }
      printTable(
        [
          "Vault ID",
          "Position",
          "Mode",
          "Tick",
          "Tick ID",
        ],
        positions.map((p) => [
          p.vaultId.toString(),
          p.pubkey.toBase58(),
          p.isSupplyOnlyPosition ? "Supply-only" : "Borrow",
          p.tick.toString(),
          p.tickId.toString(),
        ]),
      );
    });

  borrowProgram
    .command("allow-vault")
    .argument(
      "<vault>",
      "Jupiter Lend borrow vault public key",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrow vault to the allowlist")
    .action(async (vault: PublicKey, options: { yes?: boolean }) => {
      const policy =
        (await fetchBorrowPolicy(context)) ??
        new JupiterBorrowPolicy([], [], []);
      if (policy.vaultsAllowlist.find((v) => v.equals(vault))) {
        console.error(`Vault ${vault} is already in the borrow allowlist`);
        process.exit(1);
      }
      policy.vaultsAllowlist.push(vault);
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding vault ${vault} to Jupiter Lend borrow allowlist`,
        },
        (txSig) => `Vault ${vault} added to borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("remove-vault")
    .argument(
      "<vault>",
      "Jupiter Lend borrow vault public key",
      validatePublicKey,
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrow vault from the allowlist")
    .action(async (vault: PublicKey, options: { yes?: boolean }) => {
      const policy = await fetchBorrowPolicy(context);
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.vaultsAllowlist.find((v) => v.equals(vault))) {
        console.error("Vault not in borrow allowlist. Removal not needed.");
        process.exit(1);
      }
      policy.vaultsAllowlist = policy.vaultsAllowlist.filter(
        (v) => !v.equals(vault),
      );
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing vault ${vault} from Jupiter Lend borrow allowlist`,
        },
        (txSig) => `Vault ${vault} removed from borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("allow-collateral")
    .argument("<mint>", "Collateral mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a collateral mint to the borrow allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy =
        (await fetchBorrowPolicy(context)) ??
        new JupiterBorrowPolicy([], [], []);
      if (policy.collateralMintsAllowlist.find((m) => m.equals(mint))) {
        console.error(
          `Collateral mint ${mint} is already in the borrow allowlist`,
        );
        process.exit(1);
      }
      policy.collateralMintsAllowlist.push(mint);
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding collateral mint ${mint} to Jupiter Lend borrow allowlist`,
        },
        (txSig) =>
          `Collateral mint ${mint} added to borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("remove-collateral")
    .argument("<mint>", "Collateral mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a collateral mint from the borrow allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy = await fetchBorrowPolicy(context);
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.collateralMintsAllowlist.find((m) => m.equals(mint))) {
        console.error(
          "Collateral mint not in borrow allowlist. Removal not needed.",
        );
        process.exit(1);
      }
      policy.collateralMintsAllowlist = policy.collateralMintsAllowlist.filter(
        (m) => !m.equals(mint),
      );
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing collateral mint ${mint} from Jupiter Lend borrow allowlist`,
        },
        (txSig) =>
          `Collateral mint ${mint} removed from borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("allow-borrow-mint")
    .argument("<mint>", "Borrowable debt mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrowable debt mint to the allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy =
        (await fetchBorrowPolicy(context)) ??
        new JupiterBorrowPolicy([], [], []);
      if (policy.borrowMintsAllowlist.find((m) => m.equals(mint))) {
        console.error(`Borrow mint ${mint} is already in the borrow allowlist`);
        process.exit(1);
      }
      policy.borrowMintsAllowlist.push(mint);
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm adding borrow mint ${mint} to Jupiter Lend borrow allowlist`,
        },
        (txSig) => `Borrow mint ${mint} added to borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("remove-borrow-mint")
    .argument("<mint>", "Borrowable debt mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a borrowable debt mint from the allowlist")
    .action(async (mint: PublicKey, options: { yes?: boolean }) => {
      const policy = await fetchBorrowPolicy(context);
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.borrowMintsAllowlist.find((m) => m.equals(mint))) {
        console.error(
          "Borrow mint not in borrow allowlist. Removal not needed.",
        );
        process.exit(1);
      }
      policy.borrowMintsAllowlist = policy.borrowMintsAllowlist.filter(
        (m) => !m.equals(mint),
      );
      await executeTxWithErrorHandling(
        () => setBorrowPolicy(context, policy),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing borrow mint ${mint} from Jupiter Lend borrow allowlist`,
        },
        (txSig) =>
          `Borrow mint ${mint} removed from borrow allowlist: ${txSig}`,
      );
    });

  borrowProgram
    .command("init-position")
    .requiredOption("--vault-id <u16>", "Jupiter Vaults vault_id", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Initialize a Jupiter Lend borrow position")
    .action(async (options: { vaultId: number; yes?: boolean }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterBorrow.initPosition(
            options.vaultId,
            context.txOptions,
          ),
        {
          skip: options.yes ?? false,
          message: `Confirm Jupiter Lend borrow init-position for vault ${options.vaultId}`,
        },
        (txSig) =>
          `Jupiter Lend borrow position initialized for vault ${options.vaultId}: ${txSig}`,
      );
    });

  type OperateAction = "deposit" | "withdraw" | "borrow" | "repay";

  async function runOperate(
    action: OperateAction,
    amount: string,
    position: PublicKey,
    yes = false,
  ) {
    const positionInfo =
      await context.glamClient.jupiterBorrow.getPosition(position);
    const vault = await context.glamClient.jupiterBorrow.getVault(
      positionInfo.vaultId,
    );
    const isCollateralSide = action === "deposit" || action === "withdraw";
    const tokenMint = isCollateralSide ? vault.supplyToken : vault.borrowToken;
    const token = await resolveTokenMint(
      context.glamClient,
      tokenMint.toBase58(),
    );
    const amountBN = parsePositiveUiAmount(amount, token.decimals, "amount");

    const sdk = context.glamClient.jupiterBorrow;
    const send = () => {
      switch (action) {
        case "deposit":
          return sdk.deposit(position, amountBN, context.txOptions);
        case "withdraw":
          return sdk.withdraw(position, amountBN, context.txOptions);
        case "borrow":
          return sdk.borrow(position, amountBN, context.txOptions);
        case "repay":
          return sdk.repay(position, amountBN, context.txOptions);
      }
    };

    await executeTxWithErrorHandling(
      send,
      {
        skip: yes,
        message: [
          `Confirm Jupiter Lend borrow ${action}`,
          `position: ${position}`,
          `vault_id: ${vault.vaultId}`,
          `amount: ${amount} ${token.symbol}`,
        ].join("\n"),
      },
      (txSig) =>
        `Jupiter Lend borrow ${action} ${amount} ${token.symbol}: ${txSig}`,
    );
  }

  borrowProgram
    .command("deposit")
    .argument("<amount>", "UI amount of collateral to deposit")
    .requiredOption("--position <pubkey>", "Position PDA", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit collateral into a Jupiter Lend borrow position")
    .action(
      async (amount: string, options: { position: PublicKey; yes?: boolean }) =>
        runOperate("deposit", amount, options.position, options.yes ?? false),
    );

  borrowProgram
    .command("withdraw")
    .argument("<amount>", "UI amount of collateral to withdraw")
    .requiredOption("--position <pubkey>", "Position PDA", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw collateral from a Jupiter Lend borrow position")
    .action(
      async (amount: string, options: { position: PublicKey; yes?: boolean }) =>
        runOperate("withdraw", amount, options.position, options.yes ?? false),
    );

  borrowProgram
    .command("borrow")
    .argument("<amount>", "UI amount of debt to borrow")
    .requiredOption("--position <pubkey>", "Position PDA", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Borrow debt against a Jupiter Lend borrow position")
    .action(
      async (amount: string, options: { position: PublicKey; yes?: boolean }) =>
        runOperate("borrow", amount, options.position, options.yes ?? false),
    );

  borrowProgram
    .command("repay")
    .argument("<amount>", "UI amount of debt to repay")
    .requiredOption("--position <pubkey>", "Position PDA", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Repay debt on a Jupiter Lend borrow position")
    .action(
      async (amount: string, options: { position: PublicKey; yes?: boolean }) =>
        runOperate("repay", amount, options.position, options.yes ?? false),
    );
}
