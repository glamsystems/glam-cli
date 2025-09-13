import {
  GlamClient,
  TxOptions,
  WSOL,
  fetchTokenPrices,
  fetchTokensList,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliConfig,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
export function installVaultCommands(
  program: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  program
    .command("withdraw-sol")
    .argument("<amount>", "Amount to withdraw", parseFloat)
    .description("Withdraw SOL from the vault")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (amount, options) => {
      options?.yes ||
        (await confirmOperation(`Confirm withdrawal of ${amount} SOL?`));

      try {
        const txSig = await glamClient.vault.systemTransfer(
          new BN(amount * LAMPORTS_PER_SOL),
          glamClient.signer,
          txOptions,
        );
        console.log(`Withdrawn ${amount} SOL:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("withdraw-token")
    .argument(
      "<asset>",
      "Mint pubkey of the asset to withdraw",
      validatePublicKey,
    )
    .argument("<amount>", "Amount to withdraw", parseFloat)
    .description("Withdraw the specified amount of asset from the vault")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (asset: PublicKey, amount: number, options) => {
      options?.yes ||
        (await confirmOperation(`Confirm withdrawal of ${amount} ${asset}?`));

      const { mint } = await glamClient.fetchMintAndTokenProgram(asset);
      try {
        const txSig = await glamClient.vault.withdraw(
          new PublicKey(asset),
          new BN(amount * 10 ** mint.decimals),
          txOptions,
        );
        console.log(`Withdrawn ${amount} ${asset}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("wrap")
    .argument("<amount>", "Amount to wrap", parseFloat)
    .description("Wrap SOL")
    .action(async (amount: number) => {
      const lamports = new BN(amount * LAMPORTS_PER_SOL);

      if (lamports.lte(new BN(0))) {
        console.error("Error: amount must be greater than 0");
        process.exit(1);
      }

      try {
        const txSig = await glamClient.vault.wrap(lamports, txOptions);
        console.log(`Wrapped ${amount} SOL:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("unwrap")
    .description("Unwrap wSOL")
    .action(async () => {
      try {
        const txSig = await glamClient.vault.unwrap(txOptions);
        console.log(`All wSOL unwrapped:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("balances")
    .description("Get balances")
    .option(
      "-a, --all",
      "Show all assets including token accounts with 0 balance",
    )
    .action(async (options) => {
      const { all } = options;
      const vault = glamClient.vaultPda;
      const { uiAmount: solUiAmount, tokenAccounts } =
        await glamClient.getSolAndTokenBalances(vault);

      const mints = tokenAccounts.map((ta) => ta.mint.toBase58());
      if (!mints.includes(WSOL.toBase58())) {
        mints.push(WSOL.toBase58());
      }

      const tokenPrices = await fetchTokenPrices(mints);
      const mintToPrice = new Map(
        tokenPrices.map(({ mint, price }) => [mint, price]),
      );
      const tokenList = await fetchTokensList();

      // Define column widths
      const colWidths = [12, 45, 15, 20];
      const printRow = (items: string[]) => {
        console.log(
          items[0].padEnd(colWidths[0]),
          items[1].padEnd(colWidths[1]),
          items[2].padEnd(colWidths[2]),
          items[3].padEnd(colWidths[3]),
        );
      };

      printRow(["Token", "Mint", "Amount", "Value (USD)"]); // header row
      printRow([
        "SOL",
        "N/A",
        solUiAmount.toFixed(9).toString(),
        (mintToPrice.get(WSOL.toBase58()) * solUiAmount).toFixed(6),
      ]);

      tokenAccounts.forEach((ta) => {
        const { uiAmount, mint } = ta;
        const mintStr = mint.toBase58();

        if (all || uiAmount > 0) {
          const token = tokenList.find((t) => t.address === mintStr);
          const tokenSymbol =
            token?.symbol === "SOL" ? "wSOL" : token?.symbol || "Unknown";
          const value = mintToPrice.get(mintStr) * uiAmount;

          printRow([
            tokenSymbol,
            mintStr,
            uiAmount.toString(),
            value ? value.toFixed(6) : "NaN",
          ]);
        }
      });
    });
}
