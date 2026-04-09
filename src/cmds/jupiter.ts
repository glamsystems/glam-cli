import {
  getAssetMeta,
  JupiterSwapPolicy,
  QuoteParams,
  SOL_ORACLE,
  TokenListItem,
  fromUiAmount,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  resolveTokenMint,
  validatePublicKey,
} from "../utils";

function buildQuoteParams(
  tokenFrom: TokenListItem,
  tokenTo: TokenListItem,
  amount: string | number,
  options: {
    maxAccounts?: string;
    slippageBps: string;
    onlyDirectRoutes?: boolean;
    instructionVersion: "V1" | "V2";
  },
): QuoteParams {
  const { maxAccounts, slippageBps, onlyDirectRoutes, instructionVersion } =
    options;

  return {
    inputMint: tokenFrom.address,
    outputMint: tokenTo.address,
    amount: fromUiAmount(amount, tokenFrom.decimals).toNumber(),
    swapMode: "ExactIn",
    slippageBps: parseInt(slippageBps),
    excludeDexes: ["Obric V2"],
    asLegacyTransaction: false,
    ...(maxAccounts ? { maxAccounts: parseInt(maxAccounts) } : {}),
    ...(onlyDirectRoutes ? { onlyDirectRoutes } : {}),
    instructionVersion,
  };
}

type SwapV2OracleOptions = {
  skipQuotePriceCheck?: boolean;
};

function getJupiterSwapV2OracleAccounts(
  context: CliContext,
  tokenFrom: TokenListItem,
  tokenTo: TokenListItem,
  options: SwapV2OracleOptions,
): {
  solUsdOracle?: PublicKey;
  inputTokenOracle?: PublicKey;
  outputTokenOracle?: PublicKey;
} {
  let inputAssetMeta = null;
  let outputAssetMeta = null;

  try {
    inputAssetMeta = getAssetMeta(
      tokenFrom.address,
      context.glamClient.cluster,
    );
  } catch {
    inputAssetMeta = null;
  }

  try {
    outputAssetMeta = getAssetMeta(tokenTo.address, context.glamClient.cluster);
  } catch {
    outputAssetMeta = null;
  }

  if (!options.skipQuotePriceCheck) {
    const unsupportedToken = [
      { token: tokenFrom, assetMeta: inputAssetMeta },
      { token: tokenTo, assetMeta: outputAssetMeta },
    ].find(({ assetMeta }) => assetMeta?.aggIndex !== undefined)?.token;

    if (unsupportedToken) {
      throw new Error(
        `swap-v2 quote price checks do not support Scope-based oracles for ${unsupportedToken.symbol}. Pass --skip-quote-price-check if your signer has the SkipQuotePriceCheck permission.`,
      );
    }
  }

  const oracleAccounts = {
    solUsdOracle: SOL_ORACLE,
    inputTokenOracle: inputAssetMeta?.oracle,
    outputTokenOracle: outputAssetMeta?.oracle,
  };

  if (
    !options.skipQuotePriceCheck &&
    (!oracleAccounts.inputTokenOracle || !oracleAccounts.outputTokenOracle)
  ) {
    const missingOracles = [
      !oracleAccounts.inputTokenOracle ? tokenFrom.symbol : null,
      !oracleAccounts.outputTokenOracle ? tokenTo.symbol : null,
    ].filter(Boolean);

    throw new Error(
      `swap-v2 requires oracle accounts when quote price checks are enabled, but no oracle is configured in glam_config for ${missingOracles.join(", ")}. Pass --skip-quote-price-check if your signer has the SkipQuotePriceCheck permission, or add the missing oracle(s) to glam_config.`,
    );
  }

  return oracleAccounts;
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
      console.log(`Max deviation BPS: ${policy.maxDeviationBps}`);
      if (policy.swapAllowlist) {
        console.log("Swap allowlist:");
        for (let i = 0; i < policy.swapAllowlist.length; i++) {
          console.log(`[${i}] ${policy.swapAllowlist[i]}`);
        }
      } else {
        console.log("Swap allowlist: []");
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
      const currentAllowlist = policy?.swapAllowlist || [];
      const currentMaxDeviation = policy?.maxDeviationBps || 0;

      const newPolicy = new JupiterSwapPolicy(
        slippageBps,
        currentAllowlist,
        currentMaxDeviation,
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
          message: `Confirm setting max slippage to ${slippageBps} BPS`,
        },
        (txSig) => `Max slippage set to ${slippageBps} BPS: ${txSig}`,
      );
    });

  program
    .command("set-max-deviation")
    .argument(
      "<deviation_bps>",
      "Maximum quote price deviation in basis points (range: -32768 to 32767; 0 requires quote to match or beat oracle, negative requires the quote to beat oracle by at least that many bps)",
      (raw) => {
        const parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed) || `${parsed}` !== raw.trim()) {
          throw new Error(`Invalid deviation_bps: "${raw}" is not an integer`);
        }
        if (parsed < -32768 || parsed > 32767) {
          throw new Error(
            `Invalid deviation_bps: ${parsed} is outside the i16 range [-32768, 32767]`,
          );
        }
        return parsed;
      },
    )
    .option("-y, --yes", "Skip confirmation", false)
    .description("Set the maximum allowed quote price deviation for swaps")
    .action(async (deviationBps, options) => {
      const policy = await context.glamClient.fetchProtocolPolicy(
        context.glamClient.protocolProgram.programId,
        0b0000100,
        JupiterSwapPolicy,
      );
      const currentAllowlist = policy?.swapAllowlist || [];
      const currentMaxSlippage = policy?.maxSlippageBps || 0;

      const newPolicy = new JupiterSwapPolicy(
        currentMaxSlippage,
        currentAllowlist,
        deviationBps,
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
          message: `Confirm setting max deviation to ${deviationBps} BPS`,
        },
        (txSig) => `Max deviation set to ${deviationBps} BPS: ${txSig}`,
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
      const currentSlippage = policy?.maxSlippageBps || 50;
      const currentAllowlist = policy?.swapAllowlist || [];

      if (currentAllowlist.find((t) => t.equals(token))) {
        console.error(`Token ${token} is already in the allowlist`);
        process.exit(1);
      }

      const newAllowlist = [...currentAllowlist, token];
      const newPolicy = new JupiterSwapPolicy(
        currentSlippage,
        newAllowlist,
        policy?.maxDeviationBps || 0,
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
        policy.maxDeviationBps,
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
    .description("Clear the swap allowlist")
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
      const newPolicy = new JupiterSwapPolicy(
        policy.maxSlippageBps,
        null,
        policy.maxDeviationBps,
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
          message: "Confirm clearing swap allowlist",
        },
        (txSig) => `Swap allowlist cleared: ${txSig}`,
      );
    });

  program
    .command("swap")
    .description("Swap assets held in the vault")
    .argument("<from>", "Source token mint or symbol")
    .argument("<to>", "Destination token mint or symbol")
    .argument("<amount>", "Decimal-adjusted UI amount")
    .option("-m, --max-accounts <num>", "Specify max accounts allowed")
    .option(
      "-s, --slippage-bps <bps>",
      "Slippage bps, defaults to 5 (0.05%)",
      "5",
    )
    .option("--use-v1", "Use v1 instruction (default: v2)", false)
    .option("-d, --only-direct-routes", "Direct routes only")
    .option("-t, --tracking-account <pubkey>", "Tracking account public key")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (from, to, amount, options) => {
      const tokenFrom = await resolveTokenMint(context.glamClient, from);
      const tokenTo = await resolveTokenMint(context.glamClient, to);
      const {
        maxAccounts,
        slippageBps,
        onlyDirectRoutes,
        useV1,
        trackingAccount,
      } = options;

      const quoteParams = buildQuoteParams(tokenFrom, tokenTo, amount, {
        maxAccounts,
        slippageBps,
        onlyDirectRoutes,
        instructionVersion: useV1 ? "V1" : "V2",
      });

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterSwap.swap(
            {
              quoteParams,
              trackingAccount: trackingAccount
                ? new PublicKey(trackingAccount)
                : undefined,
            },
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

  program
    .command("swap-v2")
    .description("Swap assets held in the vault using jupiter_swap_v2")
    .argument("<from>", "Source token mint or symbol")
    .argument("<to>", "Destination token mint or symbol")
    .argument("<amount>", "Decimal-adjusted UI amount")
    .option("-m, --max-accounts <num>", "Specify max accounts allowed")
    .option(
      "-s, --slippage-bps <bps>",
      "Slippage bps, defaults to 5 (0.05%)",
      "5",
    )
    .option("-d, --only-direct-routes", "Direct routes only")
    .option(
      "--skip-quote-price-check",
      "Skip the oracle quote price check when the signer has permission",
      false,
    )
    .option("-t, --tracking-account <pubkey>", "Tracking account public key")
    .option("-y, --yes", "Skip confirmation", false)
    .action(async (from, to, amount, options) => {
      const tokenFrom = await resolveTokenMint(context.glamClient, from);
      const tokenTo = await resolveTokenMint(context.glamClient, to);
      const {
        maxAccounts,
        slippageBps,
        onlyDirectRoutes,
        skipQuotePriceCheck,
        trackingAccount,
      } = options;

      const quoteParams = buildQuoteParams(tokenFrom, tokenTo, amount, {
        maxAccounts,
        slippageBps,
        onlyDirectRoutes,
        instructionVersion: "V2",
      });
      const oracleAccounts = getJupiterSwapV2OracleAccounts(
        context,
        tokenFrom,
        tokenTo,
        options,
      );

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.jupiterSwap.swapV2(
            {
              quoteParams,
              skipQuotePriceCheck,
              oracleAccounts,
              trackingAccount: trackingAccount
                ? new PublicKey(trackingAccount)
                : undefined,
            },
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm swapping ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol} with jupiter_swap_v2 and quote params: ${JSON.stringify(
            quoteParams,
            null,
            2,
          )}`,
        },
        (txSig) =>
          `Swapped ${amount} ${tokenFrom.symbol} to ${tokenTo.symbol} with jupiter_swap_v2: ${txSig}`,
      );
    });
}
