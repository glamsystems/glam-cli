import { BN } from "@coral-xyz/anchor";
import {
  GlamClient,
  PriceDenom,
  RequestType,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliConfig,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import tokens from "../tokens-verified.json";

export function installInvestCommands(
  invest: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions,
) {
  invest
    .command("subscribe")
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
      const baseAsset = stateModel.baseAssetMint;

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

      const priceDenom = PriceDenom.fromAsset(baseAsset);
      const amountBN = new BN(amount * 10 ** decimals);
      const preInstructions = await glamClient.price.priceVaultIxs(priceDenom); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      try {
        const txSig = await glamClient.invest.subscribe(
          amountBN,
          !!options?.queued,
          {
            ...txOptions,
            preInstructions,
            lookupTables,
          },
        );
        console.log(`${glamClient.signer} instant subscription:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  invest
    .command("claim-subscription")
    .description(
      "Claim subscription and receive share tokens. Only needed for queued subscriptions.",
    )
    .action(async () => {
      const preInstructions = await glamClient.price.priceVaultIxs(
        PriceDenom.SOL,
      );
      const lookupTables = glamClient.price.lookupTables;

      try {
        const glamMint = glamClient.mintPda;
        const txSig = await glamClient.invest.claim(RequestType.SUBSCRIPTION, {
          ...txOptions,
          preInstructions,
          lookupTables,
        });
        console.log(`${glamClient.signer} claimed shares:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  invest
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
        const txSig = await glamClient.invest.queuedRedeem(amountBN, {
          ...txOptions,
        });
        console.log(`${glamClient.signer} requested to redeem:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  invest
    .command("claim-redemption")
    .description("Claim redemption to receive deposit asset")
    .action(async () => {
      const preInstructions = await glamClient.price.priceVaultIxs(
        PriceDenom.SOL,
      ); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      try {
        const txSig = await glamClient.invest.claim(RequestType.REDEMPTION, {
          ...txOptions,
          preInstructions,
          lookupTables,
        });
        console.log(`${glamClient.signer} claimed tokens:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
