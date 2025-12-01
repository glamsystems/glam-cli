import {
  fetchTokensList,
  QuoteParams,
  JupiterSwapPolicy,
  TokenListItem,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";

async function findToken(value: string): Promise<TokenListItem> {
  const tokenList = await fetchTokensList();
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
    .description("Set the maximum allowed slippage for swaps")
    .action(async (slippageBps) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      const currentAllowlist = policy?.swapAllowlist || null;

      const newPolicy = new JupiterSwapPolicy(slippageBps, currentAllowlist);
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.protocolProgram.programId,
          0b0000100,
          newPolicy.encode(),
          context.txOptions,
        );
        console.log(`Max slippage set to ${slippageBps} BPS:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("allowlist-token")
    .argument("<token>", "Token mint public key", validatePublicKey)
    .description("Add a token to the swap allowlist")
    .action(async (token) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.protocolProgram.programId,
          0b0000100,
          newPolicy.encode(),
          context.txOptions,
        );
        console.log(`Token ${token} added to swap allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("remove-token")
    .argument("<token>", "Token mint public key", validatePublicKey)
    .description("Remove a token from the swap allowlist")
    .action(async (token) => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.protocolProgram.programId,
          0b0000100,
          newPolicy.encode(),
          context.txOptions,
        );
        console.log(`Token ${token} removed from swap allowlist:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("clear-allowlist")
    .description("Clear the swap allowlist (allow all tokens)")
    .action(async () => {
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
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.protocolProgram.programId,
          0b0000100,
          newPolicy.encode(),
          context.txOptions,
        );
        console.log(`Swap allowlist cleared (all tokens now allowed):`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
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
    .option("-y, --yes", "Skip confirmation")
    .action(async (from, to, amount, options) => {
      const tokenFrom = await findToken(from);
      const tokenTo = await findToken(to);
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

      options?.yes ||
        (await confirmOperation(
          `Confirm swapping ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol} with quote params: ${JSON.stringify(
            quoteParams,
            null,
            2,
          )}`,
        ));

      try {
        const txSig = await context.glamClient.jupiterSwap.swap(
          { quoteParams },
          context.txOptions,
        );
        console.log(
          `Swapped ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
