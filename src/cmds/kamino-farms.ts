import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
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
        const parsedFarmState = parsedFarms.get(farmState);
        if (!parsedFarmState) {
          console.error(`Farm state ${farmState} not found`);
          process.exit(1);
        }
        const { rewards } = parsedFarmState;
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
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Harvest rewards from Kamino farms")
    .action(async (farmStates: string[], options) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoFarm.harvest(
            farmStates.map((f) => new PublicKey(f)),
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm harvesting farm rewards from ${farmStates.length} farms`,
        },
        (txSig) => `Harvested farm rewards: ${txSig}`,
      );
    });

  kfarms
    .command("stake")
    .argument("<farm_state>", "Farm state to stake to", validatePublicKey)
    .argument("<amount>", "Amount of farm token to stake", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Stake token to a delegated farm")
    .action(async (farmState: PublicKey, amount: number, options) => {
      const farms = await context.glamClient.kaminoFarm.fetchAndParseFarmStates(
        [farmState],
      );
      const parsedFarmState = farms.get(farmState);
      if (!parsedFarmState) {
        throw new Error("Farm state not found");
      }
      const { farmTokenDecimals } = parsedFarmState;
      const amountBN = new BN(amount * 10 ** farmTokenDecimals.toNumber());

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoFarm.stake(
            amountBN,
            farmState,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm staking to farm ${farmState}`,
        },
        (txSig) => `Staked farm token: ${txSig}`,
      );
    });

  kfarms
    .command("unstake")
    .argument("<farm_state>", "Farm state to unstake from", validatePublicKey)
    .argument("<amount>", "Amount of farm token to unstake", parseFloat)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Unstake token from a delegated farm")
    .action(async (farmState: PublicKey, amount: number, options) => {
      const farms = await context.glamClient.kaminoFarm.fetchAndParseFarmStates(
        [farmState],
      );
      const parsedFarmState = farms.get(farmState);
      if (!parsedFarmState) {
        throw new Error("Farm state not found");
      }
      const { farmTokenDecimals } = parsedFarmState;
      const amountBN = new BN(amount * 10 ** farmTokenDecimals.toNumber()).mul(
        new BN(10).pow(new BN(18)),
      );

      await executeTxWithErrorHandling(
        () =>
          context.glamClient.kaminoFarm.unstake(
            amountBN,
            farmState,
            context.txOptions,
          ),
        {
          skip: options?.yes,
          message: `Confirm unstaking from farm ${farmState}`,
        },
        (txSig) => `Unstaked farm token: ${txSig}`,
      );
    });
}
