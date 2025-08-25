import { BN } from "@coral-xyz/anchor";
import {
  GlamClient,
  PriceDenom,
  RequestType,
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
import {
  encodeMintPolicy,
  MintPolicy,
  MintPolicyLayout,
} from "anchor/src/deser/integrationPolicies";

export function installManageCommands(
  manage: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions,
) {
  manage
    .command("price")
    .option("-d, --denom <denom>", "Price denomination, USD or SOL", "USD")
    .description("Price vault assets")
    .action(async (options) => {
      const priceDenom = PriceDenom.fromString(options?.denom);
      const ixs = await glamClient.price.priceVaultIxs(priceDenom); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      const tx = new Transaction().add(...ixs);

      try {
        const vTx = await glamClient.intoVersionedTransaction(tx, {
          ...txOptions,
          lookupTables,
        });
        const txSig = await glamClient.sendAndConfirm(vTx);
        console.log("Priced vault assets:", txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  manage
    .command("fulfill")
    .description("Fulfill queued subscriptions and redemptions")
    .action(async () => {
      const stateModel = await glamClient.fetchStateModel();
      const asset = stateModel.baseAssetMint;
      const priceDenom = PriceDenom.fromAsset(asset);

      const preInstructions = await glamClient.price.priceVaultIxs(priceDenom); // this loads lookup tables
      const lookupTables = glamClient.price.lookupTables;

      try {
        const txSig = await glamClient.invest.fulfill({
          ...txOptions,
          preInstructions,
          lookupTables,
          simulate: true,
        });
        console.log(`${glamClient.signer} triggered fulfillment:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("claim-fees")
    .description("Claim fees collected by tokenized vault")
    .action(async () => {
      try {
        const txSig = await glamClient.fees.claimFees();
        console.log(`${glamClient.signer} claimed fees:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("update-min-subscription")
    .argument("<amount>", "Minimum subscription amount", parseFloat)
    .description("Update the minimum subscription amount")
    .action(async (amount) => {
      const stateModel = await glamClient.fetchStateModel();
      const { mint } = await glamClient.fetchMintAndTokenProgram(
        stateModel.baseAssetMint,
      );
      const amountBN = new BN(amount * 10 ** mint.decimals);
      try {
        const txSig = await glamClient.mint.update(
          {
            ...stateModel.mintModel.notifyAndSettle,
            minSubscriptionAmount: amountBN,
          },
          txOptions,
        );
        console.log(`Updated minimum subscription amount to ${amount}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });

  manage
    .command("update-min-redemption")
    .argument("<amount>", "Minimum redemption amount", parseFloat)
    .description("Update the minimum redemption amount")
    .action(async (amount) => {
      const amountBN = new BN(amount * 10 ** 9); // share amount is always in 9 decimals

      const stateAccount = await glamClient.fetchStateAccount();
      const mintIntegrationPolicy = stateAccount.integrationAcls?.find((acl) =>
        acl.integrationProgram.equals(glamClient.mintProgram.programId),
      );
      const mintPolicyData = mintIntegrationPolicy?.protocolPolicies?.find(
        (policy) => policy.protocolBitflag === 1,
      )?.data;
      const mintPolicy = MintPolicyLayout.decode(mintPolicyData) as MintPolicy;

      const updatedMintPolicy = {
        ...mintPolicy,
        minRedemption: amountBN,
      };

      const encodedBuffer = encodeMintPolicy(updatedMintPolicy);

      try {
        const txSig = await glamClient.state.update(
          {
            integrationAcls: [
              {
                integrationProgram: glamClient.mintProgram.programId,
                protocolsBitmask: 0b1,
                protocolPolicies: [
                  {
                    protocolBitflag: 0b1,
                    data: encodedBuffer,
                  },
                ],
              },
            ],
          },
          txOptions,
        );
        console.log(`Updated minimum redemption amount to ${amount}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        throw e;
      }
    });
}
