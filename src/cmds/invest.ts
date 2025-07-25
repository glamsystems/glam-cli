import { BN } from "@coral-xyz/anchor";
import {
  GlamClient,
  PriceDenom,
  TxOptions,
  USDC,
  WSOL,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliConfig,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import tokens from "../tokens-verified.json";

export function installInvestCommands(
  tokenized: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions,
) {
  tokenized
    .command("sub")
    .argument("<amount>", "Amount to subscribe", parseFloat)
    .argument(
      "[state]",
      "State pubkey of the vault to subscribe to. Leave empty to use the active GLAM in CLI config.",
      validatePublicKey,
    )
    .description("Subscribe to a tokenized vault")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-q, --queued", "Subscribe to a tokenized vault in queued mode")
    .action(async (amount, state, options) => {
      // Override default glamClient if state is provided
      if (state) {
        glamClient = new GlamClient({ statePda: state });
      }

      const stateModel = await glamClient.fetchStateModel();
      const baseAsset = stateModel.baseAsset;

      let name, symbol, decimals;
      const metadata = tokens.find((t) => t.address === baseAsset.toString());
      if (!metadata) {
        console.warn(`Base asset ${baseAsset} is unverified`);
      }
      if (metadata) {
        name = metadata.name;
        symbol = metadata.symbol;
        decimals = metadata.decimals;
      } else {
        const { mint } = await glamClient.fetchMintAndTokenProgram(baseAsset);
        name = baseAsset.toBase58();
        symbol = "token";
        decimals = mint.decimals;
      }

      options?.yes ||
        (await confirmOperation(
          `Confirm ${options?.queued ? "queued" : "instant"} subscription with ${amount} ${symbol} (${name})?`,
        ));

      const priceDenom = baseAsset.equals(WSOL)
        ? PriceDenom.SOL
        : baseAsset.equals(USDC)
          ? PriceDenom.USD
          : PriceDenom.ASSET;
      const amountBN = new BN(amount * 10 ** decimals);

      try {
        const txSig = await glamClient.invest.subscribe(
          stateModel.baseAsset,
          amountBN,
          0,
          !!options?.queued,
          {
            ...txOptions,
            preInstructions: await glamClient.price.priceVaultIxs(priceDenom),
          },
        );
        console.log(`${glamClient.signer} instant subscription:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("price")
    .description("Price vault assets")
    .action(async () => {
      const ixs = await glamClient.price.priceVaultIxs(PriceDenom.USD);
      const tx = new Transaction().add(...ixs);

      try {
        const vTx = await glamClient.intoVersionedTransaction(tx, txOptions);
        const txSig = await glamClient.sendAndConfirm(vTx);
        console.log("Priced vault assets:", txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  tokenized
    .command("fulfill")
    .description("Fulfill subscription and redemption")
    .action(async () => {
      const stateModel = await glamClient.fetchStateModel();
      const asset = stateModel.baseAsset!;
      const priceDenom = PriceDenom.fromAsset(asset);
      try {
        const txSig = await glamClient.invest.fulfill(0, {
          ...txOptions,
          preInstructions: await glamClient.price.priceVaultIxs(priceDenom),
          simulate: true,
        });
        console.log(`${glamClient.signer} triggered fulfillment:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("claim-sub")
    .description("Claim subscription and receive share tokens")
    .action(async () => {
      try {
        const glamMint = glamClient.mintPda;
        const txSig = await glamClient.invest.claim(glamMint, 0, {
          ...txOptions,
          preInstructions: await glamClient.price.priceVaultIxs(PriceDenom.SOL),
        });
        console.log(`${glamClient.signer} claimed shares:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("redeem <amount>")
    .description("Request to redeem share tokens")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (amount, options) => {
      const amountBN = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);

      options?.yes ||
        (await confirmOperation(
          `Confirm queued redemption of ${amount} shares?`,
        ));

      try {
        const txSig = await glamClient.invest.queuedRedeem(amountBN, 0, {
          ...txOptions,
        });
        console.log(`${glamClient.signer} requested to redeem:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  tokenized
    .command("claim-redeem")
    .description("Claim redemption to receive deposit asset")
    .action(async () => {
      try {
        const txSig = await glamClient.invest.claim(WSOL, 0, {
          ...txOptions,
          preInstructions: await glamClient.price.priceVaultIxs(PriceDenom.SOL),
        });
        console.log(`${glamClient.signer} claimed tokens:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
