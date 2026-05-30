import { BN } from "@coral-xyz/anchor";
import {
  fetchMintAndTokenProgram,
  getFTokenMintPda,
  JupiterEarnPolicy,
  PkSet,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { type Command } from "commander";

import {
  type CliContext,
  executeTxWithErrorHandling,
  printPubkeyList,
  parsePositiveUiAmount,
  resolveTokenMint,
  resolveTokenPublicKey,
} from "../utils";

export function installJupiterEarnCommands(
  earnProgram: Command,
  context: CliContext,
) {
  earnProgram
    .command("view-policy")
    .description("View Jupiter Lend earn policy")
    .action(async () => {
      const policy = await context.glamClient.jupiterEarn.fetchPolicy();
      if (!policy) {
        console.log("No policy found");
        process.exit(1);
      }
      printPubkeyList("Earn tokens allowlist", policy.mintsAllowlist);
    });

  earnProgram
    .command("allowlist-token")
    .alias("allowlist-mint")
    .argument("<token>", "Token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a token to the Jupiter Earn allowlist")
    .action(async (tokenInput: string, options: { yes?: boolean }) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy =
        (await context.glamClient.jupiterEarn.fetchPolicy()) ??
        new JupiterEarnPolicy([]);
      if (new PkSet(policy.mintsAllowlist).has(token)) {
        console.error(
          `Token ${token} is already in the Jupiter Earn allowlist`,
        );
        process.exit(1);
      }
      policy.mintsAllowlist.push(token);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterEarn.setPolicy(policy, context.txOptions),
        {
          skip: !!options?.yes,
          message: `Confirm adding token ${token} to Jupiter Earn allowlist`,
        },
        (txSig) => `Token ${token} added to Jupiter Earn allowlist: ${txSig}`,
      );
    });

  earnProgram
    .command("remove-token")
    .alias("remove-mint")
    .argument("<token>", "Token mint address or symbol")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove a token from the Jupiter Earn allowlist")
    .action(async (tokenInput: string, options: { yes?: boolean }) => {
      const token = await resolveTokenPublicKey(context.glamClient, tokenInput);
      const policy = await context.glamClient.jupiterEarn.fetchPolicy();
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      if (!policy.mintsAllowlist.find((m) => m.equals(token))) {
        console.error(
          "Token not in Jupiter Earn allowlist. Removal not needed.",
        );
        process.exit(1);
      }
      policy.mintsAllowlist = policy.mintsAllowlist.filter(
        (m) => !m.equals(token),
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterEarn.setPolicy(policy, context.txOptions),
        {
          skip: options?.yes ?? false,
          message: `Confirm removing token ${token} from Jupiter Earn allowlist`,
        },
        (txSig) =>
          `Token ${token} removed from Jupiter Earn allowlist: ${txSig}`,
      );
    });

  earnProgram
    .command("deposit")
    .argument("<amount>", "UI amount of underlying to deposit")
    .argument("<token>", "Token mint or symbol")
    .option(
      "--min-out <amount>",
      "Minimum fToken amount to receive (defaults to 0)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Deposit to Jupiter Earn")
    .action(
      async (
        amount: string,
        token: string,
        options: {
          minOut?: string;
          yes?: boolean;
        },
      ) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const mint = new PublicKey(tokenInfo.address);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );

        const { mint: fTokenMint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          getFTokenMintPda(mint),
        );
        const minAmountOut = options.minOut
          ? parsePositiveUiAmount(
              options.minOut,
              fTokenMint.decimals,
              "min-out",
            )
          : new BN(0);
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.jupiterEarn.deposit(
              mint,
              amountBN,
              minAmountOut,
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: `Confirm Jupiter Earn deposit ${amount} ${token}`,
          },
          (txSig) => `Jupiter Earn deposit of ${amount} ${token}: ${txSig}`,
        );
      },
    );

  earnProgram
    .command("withdraw")
    .argument("<amount>", "UI amount of underlying token to withdraw")
    .argument("<token>", "Token mint or symbol of token to withdraw")
    .option(
      "--max-shares <amount>",
      "Max fTokens to burn (UI units; defaults to u64::MAX)",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Withdraw from Jupiter Earn")
    .action(
      async (
        amount: string,
        token: string,
        options: {
          maxShares?: string;
          yes?: boolean;
        },
      ) => {
        const tokenInfo = await resolveTokenMint(context.glamClient, token);
        const mint = new PublicKey(tokenInfo.address);
        const amountBN = parsePositiveUiAmount(
          amount,
          tokenInfo.decimals,
          "amount",
        );

        const { mint: fTokenMint } = await fetchMintAndTokenProgram(
          context.glamClient.connection,
          getFTokenMintPda(mint),
        );
        const maxSharesBurn = options.maxShares
          ? parsePositiveUiAmount(
              options.maxShares,
              fTokenMint.decimals,
              "max-shares",
            )
          : undefined;
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.jupiterEarn.withdraw(
              mint,
              amountBN,
              maxSharesBurn,
              context.txOptions,
            ),
          {
            skip: options.yes ?? false,
            message: `Confirm Jupiter Earn withdraw ${amount} ${token}`,
          },
          (txSig) => `Jupiter Earn withdraw of ${amount} ${token}: ${txSig}`,
        );
      },
    );
}
