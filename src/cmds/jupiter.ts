import {
  JupiterApiClient,
  JupiterSwapPolicy,
  QuoteParams,
  TokenListItem,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";

async function findToken(
  jupApi: JupiterApiClient,
  value: string,
): Promise<TokenListItem> {
  const tokenList = await jupApi.fetchTokensList();
  const tokenInfo = tokenList.find(
    (t) =>
      t.address === value || t.symbol.toLowerCase() === value.toLowerCase(),
  );
  if (!tokenInfo) {
    console.error(`Unverified token: ${value}`);
    process.exit(1);
  }
  return tokenInfo;
}

export function installJupiterCommands(program: Command, context: CliContext) {
  program
    .command("view-policy")
    .description("View Jupiter swap policy")
    .action(async () => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      if (!policy) {
        console.log("No policy found");
        return;
      }
      console.log(`Max slippage BPS: ${policy.maxSlippageBps}`);
      if (policy.swapAllowlist) {
        console.log("Swap allowlist:");
        for (let i = 0; i < policy.swapAllowlist.length; i++) {
          console.log(`[${i}] ${policy.swapAllowlist[i]}`);
        }
      } else {
        console.log("Swap allowlist: None (all tokens allowed)");
      }
    });

  program
    .command("set-max-slippage")
    .argument("<slippage_bps>", "Maximum slippage in basis points", parseInt)
    .option("-y, --yes", "Skip confirmation", false)
    .description("Set the maximum allowed slippage for swaps")
    .action(async (slippageBps, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      const currentAllowlist = policy?.swapAllowlist || null;

      const newPolicy = new JupiterSwapPolicy(slippageBps, currentAllowlist);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.protocolProgram.programId,
            0b0000100,
            newPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm setting max slippage to ${slippageBps} BPS`,
        },
        (txSig) => `Max slippage set to ${slippageBps} BPS: ${txSig}`,
      );
    });

  program
    .command("allowlist-token")
    .argument("<token>", "Token mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation", false)
    .description("Add a token to the swap allowlist")
    .action(async (token, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      const currentSlippage = policy?.maxSlippageBps || 50; // Default 50 BPS
      const currentAllowlist = policy?.swapAllowlist || [];

      if (currentAllowlist.find((t) => t.equals(token))) {
        console.error(`Token ${token} is already in the allowlist`);
        process.exit(1);
      }

      const newAllowlist = [...currentAllowlist, token];
      const newPolicy = new JupiterSwapPolicy(currentSlippage, newAllowlist);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.protocolProgram.programId,
            0b0000100,
            newPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm adding token ${token} to swap allowlist`,
        },
        (txSig) => `Token ${token} added to swap allowlist: ${txSig}`,
      );
    });

  program
    .command("remove-token")
    .argument("<token>", "Token mint public key", validatePublicKey)
    .option("-y, --yes", "Skip confirmation", false)
    .description("Remove a token from the swap allowlist")
    .action(async (token, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      if (!policy || !policy.swapAllowlist) {
        console.error("No swap allowlist found");
        process.exit(1);
      }

      if (!policy.swapAllowlist.find((t) => t.equals(token))) {
        console.error("Token not in allowlist. Removal not needed.");
        process.exit(1);
      }

      const newAllowlist = policy.swapAllowlist.filter((t) => !t.equals(token));
      const newPolicy = new JupiterSwapPolicy(
        policy.maxSlippageBps,
        newAllowlist.length > 0 ? newAllowlist : null,
      );
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.protocolProgram.programId,
            0b0000100,
            newPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm removing token ${token} from swap allowlist`,
        },
        (txSig) => `Token ${token} removed from swap allowlist: ${txSig}`,
      );
    });

  program
    .command("clear-allowlist")
    .option("-y, --yes", "Skip confirmation", false)
    .description("Clear the swap allowlist (allow all tokens)")
    .action(async (options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      if (!policy) {
        console.error("No policy found");
        process.exit(1);
      }
      const newPolicy = new JupiterSwapPolicy(policy.maxSlippageBps, null);
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.setProtocolPolicy(
            context.glamClient.protocolProgram.programId,
            0b0000100,
            newPolicy.encode(),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: "Confirm clearing swap allowlist",
        },
        (txSig) => `Swap allowlist cleared (all tokens now allowed): ${txSig}`,
      );
    });

  program
    .command("swap")
    .description("Swap assets held in the vault")
    .argument("<from>", "Source token mint or symbol")
    .argument("<to>", "Destination token mint or symbol")
    .argument("<amount>", "Decimal-adjusted UI amount", parseFloat)
    .option("-m, --max-accounts <num>", "Specify max accounts allowed")
    .option(
      "-s, --slippage-bps <bps>",
      "Slippage bps, defaults to 5 (0.05%)",
      "5",
    )
    .option("--use-v2", "Use v2 instruction", false)
    .option("-d, --only-direct-routes", "Direct routes only")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (from, to, amount, options) => {
      const jupApi = context.glamClient.jupiterSwap.jupApi;
      const tokenFrom = await findToken(jupApi, from);
      const tokenTo = await findToken(jupApi, to);
      const { maxAccounts, slippageBps, onlyDirectRoutes, useV2 } = options;

      const quoteParams = {
        inputMint: tokenFrom.address,
        outputMint: tokenTo.address,
        amount: Math.floor(amount * 10 ** tokenFrom.decimals),
        swapMode: "ExactIn",
        slippageBps: parseInt(slippageBps),
        excludeDexes: ["Obric V2"],
        asLegacyTransaction: false,
        ...(maxAccounts ? { maxAccounts: parseInt(maxAccounts) } : {}),
        ...(onlyDirectRoutes ? { onlyDirectRoutes } : {}),
        instructionVersion: useV2 ? "V2" : "V1",
      } as QuoteParams;

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterSwap.swap(
            { quoteParams },
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm swapping ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol} with quote params: ${JSON.stringify(
            quoteParams,
            null,
            2,
          )}`,
        },
        (txSig) =>
          `Swapped ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol}: ${txSig}`,
      );
    });
}
