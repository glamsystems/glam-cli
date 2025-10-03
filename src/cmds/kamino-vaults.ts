import { BN } from "@coral-xyz/anchor";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { KaminoVaultsPolicy } from "@glamsystems/glam-sdk";

export function installKaminoVaultsCommands(
  kvaults: Command,
  context: CliContext,
) {
  kvaults
    .command("view-policy")
    .description("View Kamino vaults policy")
    .action(async () => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extKaminoProgram.programId,
        0b10,
        KaminoVaultsPolicy,
      );
      if (!policy) {
        console.log("No policy found");
        return;
      }
      console.log("Kamino vaults allowlist:");
      for (let i = 0; i < policy.vaultsAllowlist.length; i++) {
        console.log(`[${i}] ${policy.vaultsAllowlist[i]}`);
      }
    });

  kvaults
    .command("allowlist-vault")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .description("Add a vault to the allowlist")
    .action(async (vault) => {
      const policy =
        (await context.glamClient.fetchProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b10,
          KaminoVaultsPolicy,
        )) ?? new KaminoVaultsPolicy([]);
      if (policy.vaultsAllowlist.find((v) => v.equals(vault))) {
        console.error(`Kamino vault ${vault} is already in the allowlist`);
        process.exit(1);
      }

      policy.vaultsAllowlist.push(vault);
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b10,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Kamino vault ${vault} added to allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kvaults
    .command("remove-vault")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .description("Remove a vault from the allowlist")
    .action(async (vault) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.extKaminoProgram.programId,
        0b10,
        KaminoVaultsPolicy,
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extKaminoProgram.programId,
          0b10,
          policy.encode(),
          context.txOptions,
        );
        console.log(`Kamino vault ${vault} removed from allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kvaults
    .command("deposit")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument("<amount>", "Amount to deposit", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount, options) => {
      const vaultState =
        await context.glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { tokenMint, tokenMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm depositing ${amount} ${tokenMint} to Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** tokenMintDecimals);
        const txSig = await context.glamClient.kaminoVaults.deposit(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(`Deposit successful: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kvaults
    .command("withdraw")
    .argument("<vault>", "Kamino vault public key", validatePublicKey)
    .argument(
      "<amount>",
      "Burn Kamino vault tokens and withdraw deposit asset",
      parseFloat,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Deposit to a Kamino vault")
    .action(async (vault, amount, options) => {
      const vaultState =
        await context.glamClient.kaminoVaults.fetchAndParseVaultState(vault);
      const { sharesMintDecimals } = vaultState;

      options?.yes ||
        (await confirmOperation(
          `Confirm withdrawing ${amount} shares from Kamino vault ${vault}?`,
        ));

      try {
        const amountBN = new BN(amount * 10 ** sharesMintDecimals);
        const txSig = await context.glamClient.kaminoVaults.withdraw(
          vault,
          amountBN,
          context.txOptions,
        );
        console.log(`Withdraw successful: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
