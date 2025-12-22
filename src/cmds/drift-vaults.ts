import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import tokens from "../tokens-verified.json";
import { DriftVaultsPolicy } from "@glamsystems/glam-sdk";

export function installDriftVaultsCommands(
  driftVaults: Command,
  context: CliContext,
) {
  driftVaults
    .command("view-policy")
    .description("View Drift vaults policy")
    .action(async () => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extDriftProgram.programId,
        0b10,
        DriftVaultsPolicy,
      );
      if (!policy) {
        console.log("No policy found");
        return;
      }
      console.log("Drift vaults allowlist:");
      for (let i = 0; i < policy.vaultsAllowlist.length; i++) {
        console.log(`[${i}] ${policy.vaultsAllowlist[i]}`);
      }
    });

  driftVaults
    .command("allowlist-vault")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a Drift vault to the allowlist")
    .action(async (vault, options) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extDriftProgram.programId,
          0b10,
          DriftVaultsPolicy,
        )) ?? new DriftVaultsPolicy([]);
      if (policy.vaultsAllowlist.find((v) => v.equals(vault))) {
        console.error(`Drift vault ${vault} is already in the allowlist`);
        process.exit(1);
      }

      policy.vaultsAllowlist.push(vault);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b10,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm adding drift vault ${vault} to allowlist`,
        },
        (txSig) => `Drift vault ${vault} added to allowlist: ${txSig}`,
      );
    });

  driftVaults
    .command("remove-vault")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a Drift vault from the allowlist")
    .action(async (vault, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extDriftProgram.programId,
        0b10,
        DriftVaultsPolicy,
      );
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.vaultsAllowlist.find((v) => v.equals(vault))) {
        console.error("Vault not in allowlist. Removal not needed.");
        process.exit(1);
      }

      policy.vaultsAllowlist = policy.vaultsAllowlist.filter(
        (v) => !v.equals(vault),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.extDriftProgram.programId,
            0b10,
            policy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm removing drift vault ${vault} from allowlist`,
        },
        (txSig) => `Drift vault ${vault} removed from allowlist: ${txSig}`,
      );
    });

  driftVaults
    .command("list-depositors")
    .description("List Drift vault depositors owned by the GLAM vault")
    .action(async () => {
      const parsedVaultDepositors =
        await context.glamClient.driftVaults.findAndParseVaultDepositors();

      const parsedDriftVaults =
        await context.glamClient.driftVaults.parseDriftVaults(
          parsedVaultDepositors.map(({ driftVault }) => driftVault),
        );

      const spotMarkets =
        await context.glamClient.drift.fetchAndParseSpotMarkets(
          parsedDriftVaults.map(({ spotMarketIndex }) => spotMarketIndex),
        );
      const spotMarketMap = new Map(
        spotMarkets.map((spotMarket) => [spotMarket.marketIndex, spotMarket]),
      );

      parsedVaultDepositors.map(({ address, driftVault, shares }, i) => {
        const { pubkey, spotMarketIndex, name } = parsedDriftVaults[i];

        if (!driftVault.equals(pubkey)) {
          throw new Error(
            `Depositor vault ${driftVault} does not match parsed drift vault ${pubkey}`,
          );
        }

        const { mint, decimals } = spotMarketMap.get(spotMarketIndex)!;
        const tokenInfo = tokens.find((t) => t.address === mint.toBase58());
        const depositAsset = tokenInfo?.symbol || mint.toBase58();

        console.log(
          `[${i}] Depositor: ${address}, vault: ${name}, shares: ${shares / 10 ** decimals}, deposit asset: ${depositAsset}`,
        );
      });
    });

  driftVaults
    .command("deposit")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to a drift vault")
    .action(async (vault, amount, options) => {
      const { spotMarketIndex } =
        await context.glamClient.driftVaults.parseDriftVault(vault);
      const { mint, decimals } =
        await context.glamClient.drift.fetchAndParseSpotMarket(spotMarketIndex);
      const amountBN = new BN(amount * 10 ** decimals);

      const tokenInfo = tokens.find((t) => t.address === mint.toBase58());
      if (!tokenInfo) {
        console.error(`Unverified token not allowed: ${mint}`);
        process.exit(1);
      }

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.driftVaults.deposit(
            vault,
            amountBN,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm depositing ${amount} ${tokenInfo.symbol} (${mint}) to drift vault ${vault}?`,
        },
        (txSig) => `Deposit to drift vault ${vault}: ${txSig}`,
      );
    });

  driftVaults
    .command("request-withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .argument("<amount>", "Amount of vault shares to withdraw", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Request to withdraw from a drift vault")
    .action(async (vault, amount, options) => {
      const { spotMarketIndex, name } =
        await context.glamClient.driftVaults.parseDriftVault(vault);

      const { decimals } =
        await context.glamClient.drift.fetchAndParseSpotMarket(spotMarketIndex);

      const amountBN = new BN(amount * 10 ** decimals);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.driftVaults.requestWithdraw(
            vault,
            amountBN,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm requesting to withdraw ${amount} vault shares from ${name} (${vault})?`,
        },
        (txSig) =>
          `Withdrawal request submitted for drift vault ${name} (${vault}): ${txSig}`,
      );
    });

  driftVaults
    .command("cancel-withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Cancel the pending withdraw request")
    .action(async (vault, options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.driftVaults.cancelWithdrawRequest(
            vault,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm canceling withdrawal request from drift vault ${vault}?`,
        },
        (txSig) => `Withdrawal request cancelled: ${txSig}`,
      );
    });

  driftVaults
    .command("withdraw")
    .argument("<vault>", "Drift vault public key", validatePublicKey)
    .description("Claim withdrawal")
    .action(async (vault) => {
      await executeTxWithErrorHandling(
        () => context.glamClient.driftVaults.withdraw(vault, context.txOptions),
        { skip: true },
        (txSig) => `Confirmed withdrawal from drift vault ${vault}: ${txSig}`,
      );
    });
}
