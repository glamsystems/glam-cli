import { Command } from "commander";
import { CliContext, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installKaminoFarmsCommands(
  kfarms: Command,
  context: CliContext,
) {
  kfarms
    .command("list")
    .description("List Kamino farms GLAM vault has unclaimed rewards in")
    .action(async () => {
      const farmStates = await context.glamClient.kaminoFarm.findAndParseStates(
        context.glamClient.vaultPda,
      );
      const parsedFarms =
        await context.glamClient.kaminoFarm.fetchAndParseFarms(
          farmStates.map((f) => f.farmState),
        );

      for (let i = 0; i < farmStates.length; i++) {
        const { userState, farmState, unclaimedRewards } = farmStates[i];
        const { rewards } = parsedFarms.get(farmState.toBase58());
        for (const { index, mint } of rewards) {
          console.log(
            `vaultFarmState: ${userState}, reward token: ${mint}, unclaimed: ${unclaimedRewards[index]}`,
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
}
