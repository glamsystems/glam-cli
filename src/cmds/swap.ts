import { GlamClient, QuoteParams, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";

export function installSwapCommands(
  program: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  program
    .command("swap <from> <to> <amount>")
    .description("Swap assets held in the vault")
    .option("-m, --max-accounts <num>", "Specify max accounts allowed")
    .option("-s, --slippage-bps <bps>", "Specify slippage bps")
    .option("-d, --only-direct-routes", "Direct routes only")
    .action(async (from, to, amount, options) => {
      const { maxAccounts, slippageBps, onlyDirectRoutes } = options;

      const response = await fetch(
        "https://tokens.jup.ag/tokens?tags=verified",
      );
      const data = await response.json(); // an array of tokens

      const tokenFrom = data.find(
        (t) =>
          t.address === from || t.symbol.toLowerCase() === from.toLowerCase(),
      );
      const tokenTo = data.find(
        (t) => t.address === to || t.symbol.toLowerCase() === to.toLowerCase(),
      );

      if (!tokenFrom || !tokenTo) {
        console.error("Error: cannot swap unverified token");
        process.exit(1);
      }

      let quoteParams = {
        inputMint: tokenFrom.address,
        outputMint: tokenTo.address,
        amount: Math.floor(parseFloat(amount) * 10 ** tokenFrom.decimals),
        swapMode: "ExactIn",
        slippageBps: slippageBps ? parseInt(slippageBps) : 5,
        asLegacyTransaction: false,
      } as QuoteParams;
      if (maxAccounts) {
        quoteParams = {
          ...quoteParams,
          maxAccounts: parseInt(maxAccounts),
        };
      }
      if (onlyDirectRoutes) {
        quoteParams = {
          ...quoteParams,
          onlyDirectRoutes,
        };
      }
      console.log("Quote params:", quoteParams);
      try {
        const txSig = await glamClient.jupiterSwap.swap(
          { quoteParams },
          txOptions,
        );
        console.log(`Swapped ${amount} ${from} to ${to}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
