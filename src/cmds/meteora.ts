import { BN } from "@coral-xyz/anchor";
import {
  fetchMeteoraPositions,
  GlamClient,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";

export function installMeteoraCommands(
  meteora: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  meteora
    .command("init <pool>")
    .description("Initialize Meteora DLMM position")
    .action(async (pool) => {
      try {
        const txSig = await glamClient.meteoraDlmm.initializePosition(
          pool,
          txOptions,
        );
        console.log(`Initialized Meteora DLMM position: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  meteora
    .command("list")
    .description("List Meteora DLMM position")
    .action(async (pool) => {
      const vault = glamClient.vaultPda;
      const positions = await fetchMeteoraPositions(
        glamClient.provider.connection,
        vault,
      );
      console.log(
        "DLMM positions:",
        positions.map((p) => p.toBase58()),
      );
    });

  meteora
    .command("add <position> <amountX> <amountY> <strategy>")
    .description("Add liquidity to position")
    .action(async (position, amountX, amountY, strategy) => {
      try {
        const txSig = await glamClient.meteoraDlmm.addLiquidityByStrategy(
          position,
          new BN(amountX),
          new BN(amountY),
          strategy.toString(),
        );
        console.log(`Added liquidity to ${position}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  meteora
    .command("remove <position> <bps>")
    .description("Remove liquidity from position")
    .action(async (position, bps) => {
      try {
        const txSig = await glamClient.meteoraDlmm.removeLiquidityByRange(
          position,
          bps,
          txOptions,
        );
        console.log(`Removed liquidity from ${position}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  meteora
    .command("claim <position>")
    .description("Claim fee")
    .action(async (position) => {
      try {
        const txSig = await glamClient.meteoraDlmm.claimFee(
          position,
          txOptions,
        );
        console.log(`Claimed fee from ${position}:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  meteora
    .command("close <position>")
    .description("Close a Meteora DLMM position")
    .action(async (position) => {
      try {
        const txSig = await glamClient.meteoraDlmm.closePosition(
          position,
          txOptions,
        );
        console.log(`Closed Meteora DLMM position: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
