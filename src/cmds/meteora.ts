// import { BN } from "@coral-xyz/anchor";
// import {
//   fetchMeteoraPositions,
//   GlamClient,
//   TxOptions,
// } from "@glamsystems/glam-sdk";
// import { Command } from "commander";
// import { CliConfig, parseTxError, validatePublicKey } from "../utils";
// import { PublicKey } from "@solana/web3.js";

// export function installMeteoraCommands(
//   meteora: Command,
//   glamClient: GlamClient,
//   cliConfig: CliConfig,
//   txOptions: TxOptions = {},
// ) {
//   meteora
//     .command("init <pool>")
//     .description("Initialize Meteora DLMM position")
//     .action(async (pool) => {
//       try {
//         const txSig = await glamClient.meteoraDlmm.initializePosition(
//           pool,
//           txOptions,
//         );
//         console.log(`Initialized Meteora DLMM position: ${txSig}`);
//       } catch (e) {
//         console.error(parseTxError(e));
//         process.exit(1);
//       }
//     });

//   meteora
//     .command("list")
//     .description("List Meteora DLMM position")
//     .action(async (pool) => {
//       const vault = glamClient.vaultPda;
//       const positions = await fetchMeteoraPositions(
//         glamClient.provider.connection,
//         vault,
//       );
//       console.log(
//         "DLMM positions:",
//         positions.map((p) => p.toBase58()),
//       );
//     });

//   meteora
//     .command("add")
//     .argument("<position>", "Position pubkey", validatePublicKey)
//     .argument("<amountX>", "Amount of X token", parseFloat)
//     .argument("<amountY>", "Amount of Y token", parseFloat)
//     .argument(
//       "<strategy>",
//       "Strategy, must be one of: Spot, BidAsk, Curve",
//       (value) => {
//         if (["Spot", "BidAsk", "Curve"].includes(value)) {
//           return value;
//         }
//         throw new Error(
//           `Invalid strategy input: ${value}. Must be one of: Spot, BidAsk, Curve`,
//         );
//       },
//     )
//     .option(
//       "-m, --max-active-bin-slippage <maxActiveBinSlippage>",
//       "Max active bin slippage BPS, default is 10 BPS (0.1%)",
//     )
//     .description("Add liquidity to position")
//     .action(
//       async (
//         position: PublicKey,
//         amountX: number,
//         amountY: number,
//         strategy: string,
//         options,
//       ) => {
//         const maxActiveBinSlippage = parseInt(
//           options.maxActiveBinSlippage || 10,
//         );
//         const strategyType = strategy + "ImBalanced";

//         try {
//           const txSig = await glamClient.meteoraDlmm.addLiquidityByStrategy(
//             position,
//             new BN(amountX),
//             new BN(amountY),
//             strategyType as any,
//             maxActiveBinSlippage,
//             txOptions,
//           );
//           console.log(`Added liquidity to ${position}:`, txSig);
//         } catch (e) {
//           console.error(parseTxError(e));
//           process.exit(1);
//         }
//       },
//     );

//   meteora
//     .command("remove <position> <bps>")
//     .description("Remove liquidity from position")
//     .action(async (position, bps) => {
//       try {
//         const txSig = await glamClient.meteoraDlmm.removeLiquidityByRange(
//           position,
//           bps,
//           txOptions,
//         );
//         console.log(`Removed liquidity from ${position}:`, txSig);
//       } catch (e) {
//         console.error(parseTxError(e));
//         process.exit(1);
//       }
//     });

//   meteora
//     .command("claim <position>")
//     .description("Claim fee")
//     .action(async (position) => {
//       try {
//         const txSig = await glamClient.meteoraDlmm.claimFee(
//           position,
//           txOptions,
//         );
//         console.log(`Claimed fee from ${position}:`, txSig);
//       } catch (e) {
//         console.error(parseTxError(e));
//         process.exit(1);
//       }
//     });

//   meteora
//     .command("close <position>")
//     .description("Close a Meteora DLMM position")
//     .action(async (position) => {
//       try {
//         const txSig = await glamClient.meteoraDlmm.closePosition(
//           position,
//           txOptions,
//         );
//         console.log(`Closed Meteora DLMM position: ${txSig}`);
//       } catch (e) {
//         console.error(parseTxError(e));
//         process.exit(1);
//       }
//     });
// }
