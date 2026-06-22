import { BN } from "@coral-xyz/anchor";
import { MarginfiPolicy } from "@glamsystems/glam-sdk";
import { type Command } from "commander";

import {
  type CliContext,
  executeTxWithErrorHandling,
  printPubkeyList,
  resolveTokenPublicKey,
} from "../utils";
import {
  parseNonNegativeInteger,
  parsePositiveBn,
  validatePublicKey,
} from "../parsing";

export function installMarginfiCommands(
  marginfi: Command,
  context: CliContext,
) {
  const pk = (value: string) => validatePublicKey(value);

  marginfi
    .command("view-policy")
    .description("View Marginfi policy")
    .action(async () => {
      const policy = await context.glamClient.marginfi.fetchPolicy();
      if (!policy) {
        console.log("No policy found");
        process.exit(1);
      }
      printPubkeyList("Marginfi groups allowlist", policy.groupsAllowlist);
      printPubkeyList("Marginfi banks allowlist", policy.banksAllowlist);
      printPubkeyList(
        "Marginfi borrowable tokens allowlist",
        policy.borrowAllowlist,
      );
    });

  marginfi
    .command("allowlist-group")
    .argument("<group>", "Marginfi group", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a Marginfi group to the policy allowlist")
    .action(async (group, options) => {
      const policy =
        (await context.glamClient.marginfi.fetchPolicy()) ??
        new MarginfiPolicy([], [], []);
      if (!policy.groupsAllowlist.find((g) => g.equals(group))) {
        policy.groupsAllowlist.push(group);
      }
      await executeTxWithErrorHandling(
        () => context.glamClient.marginfi.setPolicy(policy, context.txOptions),
        { skip: options?.yes, message: `Confirm adding group ${group}` },
        (txSig) => `Marginfi group ${group} allowlisted: ${txSig}`,
      );
    });

  marginfi
    .command("allowlist-bank")
    .argument("<bank>", "Marginfi bank", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a Marginfi bank to the policy allowlist")
    .action(async (bank, options) => {
      const policy =
        (await context.glamClient.marginfi.fetchPolicy()) ??
        new MarginfiPolicy([], [], []);
      if (!policy.banksAllowlist.find((b) => b.equals(bank))) {
        policy.banksAllowlist.push(bank);
      }
      await executeTxWithErrorHandling(
        () => context.glamClient.marginfi.setPolicy(policy, context.txOptions),
        { skip: options?.yes, message: `Confirm adding bank ${bank}` },
        (txSig) => `Marginfi bank ${bank} allowlisted: ${txSig}`,
      );
    });

  marginfi
    .command("allowlist-borrowable-token")
    .alias("allowlist-borrowable-asset")
    .argument("<token>", "Borrowable token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a borrowable token to the Marginfi policy")
    .action(async (tokenInput: string, options) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy =
        (await context.glamClient.marginfi.fetchPolicy()) ??
        new MarginfiPolicy([], [], []);
      if (!policy.borrowAllowlist.find((t) => t.equals(token))) {
        policy.borrowAllowlist.push(token);
      }
      await executeTxWithErrorHandling(
        () => context.glamClient.marginfi.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes,
          message: `Confirm adding borrowable token ${token}`,
        },
        (txSig) => `Marginfi borrowable token ${token} allowlisted: ${txSig}`,
      );
    });

  marginfi
    .command("init-pda")
    .argument("<group>", "Marginfi group", validatePublicKey)
    .argument(
      "<account-index-or-marginfi-account>",
      "Marginfi account index, or explicit Marginfi account PDA for legacy form",
    )
    .argument("[account-index]", "Marginfi account index for legacy form")
    .option("--third-party-id <id>", "Optional third party id", (value) =>
      parseNonNegativeInteger(value, "third-party-id"),
    )
    .description(
      "Initialize a Marginfi account PDA with the GLAM vault as authority",
    )
    .action(
      async (
        group,
        accountIndexOrMarginfiAccount,
        accountIndexArg,
        options,
      ) => {
        const accountIndex =
          accountIndexArg === undefined
            ? parseNonNegativeInteger(
                accountIndexOrMarginfiAccount,
                "account-index",
              )
            : parseNonNegativeInteger(accountIndexArg, "account-index");
        const marginfiAccount =
          accountIndexArg === undefined
            ? context.glamClient.marginfi.getAccountPda(
                group,
                accountIndex,
                options.thirdPartyId ?? null,
              )
            : validatePublicKey(accountIndexOrMarginfiAccount);

        await executeTxWithErrorHandling(
          () =>
            context.glamClient.marginfi.initializeAccountPda(
              group,
              marginfiAccount,
              accountIndex,
              options.thirdPartyId ?? null,
              context.txOptions,
            ),
          { skip: true },
          (txSig) =>
            `Initialized Marginfi account PDA ${marginfiAccount}: ${txSig}`,
        );
      },
    );

  marginfi
    .command("close-account")
    .argument("<marginfi-account>", "Marginfi account", validatePublicKey)
    .description("Close an empty Marginfi account owned by the GLAM vault")
    .action(async (marginfiAccount) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.marginfi.closeAccount(
            marginfiAccount,
            context.txOptions,
          ),
        { skip: true },
        (txSig) => `Closed Marginfi account ${marginfiAccount}: ${txSig}`,
      );
    });

  marginfi
    .command("borrow")
    .argument("<bank>", "Borrow bank", validatePublicKey)
    .argument("<marginfi-account>", "Marginfi account", validatePublicKey)
    .argument("<amount>", "Native token amount to borrow", parsePositiveBn)
    .option("--group <pubkey>", "Override derived Marginfi group", pk)
    .option(
      "--destination-token-account <pubkey>",
      "Override derived vault token account to receive borrowed funds",
      pk,
    )
    .option(
      "--bank-liquidity-vault-authority <pubkey>",
      "Override derived bank liquidity vault authority",
      pk,
    )
    .option(
      "--liquidity-vault <pubkey>",
      "Override derived bank liquidity vault",
      pk,
    )
    .description("Borrow from a Marginfi bank")
    .action(async (bank, marginfiAccount, amount: BN, options) => {
      await executeTxWithErrorHandling(
        async () => {
          const accounts =
            await context.glamClient.marginfi.resolveBorrowAccounts(
              bank,
              marginfiAccount,
            );
          return await context.glamClient.marginfi.borrow(
            {
              ...accounts,
              group: options.group ?? accounts.group,
              destinationTokenAccount:
                options.destinationTokenAccount ??
                accounts.destinationTokenAccount,
              bankLiquidityVaultAuthority:
                options.bankLiquidityVaultAuthority ??
                accounts.bankLiquidityVaultAuthority,
              liquidityVault: options.liquidityVault ?? accounts.liquidityVault,
            },
            amount,
            context.txOptions,
          );
        },
        { skip: true },
        (txSig) => `Borrowed from Marginfi: ${txSig}`,
      );
    });

  marginfi
    .command("repay")
    .argument("<bank>", "Repay bank", validatePublicKey)
    .argument("<marginfi-account>", "Marginfi account", validatePublicKey)
    .argument("<amount>", "Native token amount to repay", parsePositiveBn)
    .option("--all", "Repay all", false)
    .description("Repay a Marginfi borrow")
    .action(async (bank, marginfiAccount, amount: BN, options) => {
      await executeTxWithErrorHandling(
        async () => {
          const accounts =
            await context.glamClient.marginfi.resolveRepayAccounts(
              bank,
              marginfiAccount,
            );
          return await context.glamClient.marginfi.repay(
            accounts,
            amount,
            options.all ? true : null,
            context.txOptions,
          );
        },
        { skip: true },
        (txSig) => `Repaid Marginfi borrow: ${txSig}`,
      );
    });

  marginfi
    .command("kamino-deposit")
    .argument("<bank>", "Marginfi Kamino bank", validatePublicKey)
    .argument("<marginfi-account>", "Marginfi account", validatePublicKey)
    .argument("<amount>", "Native token amount to deposit", parsePositiveBn)
    .description("Deposit Kamino-backed collateral into Marginfi")
    .action(async (bank, marginfiAccount, amount: BN) => {
      await executeTxWithErrorHandling(
        async () => {
          const accounts =
            await context.glamClient.marginfi.resolveKaminoCollateralAccounts(
              bank,
              marginfiAccount,
            );
          return await context.glamClient.marginfi.kaminoDeposit(
            accounts,
            amount,
            context.txOptions,
          );
        },
        { skip: true },
        (txSig) => `Deposited Kamino-backed collateral into Marginfi: ${txSig}`,
      );
    });

  marginfi
    .command("kamino-withdraw")
    .argument("<bank>", "Marginfi Kamino bank", validatePublicKey)
    .argument("<marginfi-account>", "Marginfi account", validatePublicKey)
    .argument("<amount>", "Native token amount to withdraw", parsePositiveBn)
    .option("--all", "Withdraw all", false)
    .description("Withdraw Kamino-backed collateral from Marginfi")
    .action(async (bank, marginfiAccount, amount: BN, options) => {
      await executeTxWithErrorHandling(
        async () => {
          const accounts =
            await context.glamClient.marginfi.resolveKaminoCollateralAccounts(
              bank,
              marginfiAccount,
            );
          return await context.glamClient.marginfi.kaminoWithdraw(
            accounts,
            amount,
            options.all ? true : null,
            context.txOptions,
          );
        },
        { skip: true },
        (txSig) => `Withdrew Kamino-backed collateral from Marginfi: ${txSig}`,
      );
    });
}
