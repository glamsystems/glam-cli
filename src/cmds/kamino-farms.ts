import { Command } from "commander";
import { CliContext, parseTxError, validatePublicKey } from "../utils";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export function installKaminoFarmsCommands(
  kfarms: Command,
  context: CliContext,
) {
  kfarms
    .command("list")
    .description("List Kamino farms GLAM vault has unclaimed rewards in")
    .action(async () => {
      const farmStates =
        await context.glamClient.kaminoFarm.findAndParseFarmUserStates(
          context.glamClient.vaultPda,
        );
      const parsedFarms =
        await context.glamClient.kaminoFarm.fetchAndParseFarmStates(
          farmStates.map((f) => f.farmState),
        );

      for (let i = 0; i < farmStates.length; i++) {
        const {
          pubkey: userState,
          farmState,
          unclaimedRewards,
        } = farmStates[i];
        const { rewards } = parsedFarms.get(farmState.toBase58());
        for (const { index, mint } of rewards) {
          console.log(
            `vaultFarmUser: ${userState}, reward token: ${mint}, unclaimed: ${unclaimedRewards[index]}`,
          );
        }
      }
    });

  kfarms
    .command("harvest")
    .argument(
      "<farm_states...>",
      "Vault-owned farm states to harvest rewards from",
    )
    .description("Harvest rewards from Kamino farms")
    .action(async (farmStates: string[]) => {
      try {
        const txSig = await context.glamClient.kaminoFarm.harvest(
          farmStates.map((f) => new PublicKey(f)),
          context.txOptions,
        );
        console.log(`Harvested farm rewards:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kfarms
    .command("stake")
    .argument("<farm_state>", "Farm state to stake to", validatePublicKey)
    .argument("<amount>", "Amount of farm token to stake", parseFloat)
    .description("Stake token to a delegated farm")
    .action(async (farmState: PublicKey, amount: number) => {
      const farms = await context.glamClient.kaminoFarm.fetchAndParseFarmStates(
        [farmState],
      );
      const parsedFarmState = farms.get(farmState.toBase58());
      if (!parsedFarmState) {
        throw new Error("Farm state not found");
      }
      const { farmTokenDecimals } = parsedFarmState;
      const amountBN = new BN(amount * 10 ** farmTokenDecimals.toNumber());

      try {
        const txSig = await context.glamClient.kaminoFarm.stake(
          amountBN,
          farmState,
          context.txOptions,
        );
        console.log(`Staked farm token:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  kfarms
    .command("unstake")
    .argument("<farm_state>", "Farm state to unstake from", validatePublicKey)
    .argument("<amount>", "Amount of farm token to unstake", parseFloat)
    .description("Unstake token from a delegated farm")
    .action(async (farmState: PublicKey, amount: number) => {
      const farms = await context.glamClient.kaminoFarm.fetchAndParseFarmStates(
        [farmState],
      );
      const parsedFarmState = farms.get(farmState.toBase58());
      if (!parsedFarmState) {
        throw new Error("Farm state not found");
      }
      const { farmTokenDecimals } = parsedFarmState;
      const amountBN = new BN(amount * 10 ** farmTokenDecimals.toNumber()).mul(
        new BN(10).pow(new BN(18)),
      );

      try {
        const txSig = await context.glamClient.kaminoFarm.unstake(
          amountBN,
          farmState,
          context.txOptions,
        );
        console.log(`Unstaked farm token:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
