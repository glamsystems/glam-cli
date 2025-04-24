import {
  GlamClient,
  GlamIntegrations,
  StateModel,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installIntegrationCommands(
  integration: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  integration
    .command("list")
    .description("List enabled integrations")
    .action(async () => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      const stateModel = await glamClient.fetchState(statePda);
      const cnt = stateModel.integrations.length;
      console.log(
        `${stateModel.name} (${statePda.toBase58()}) has ${cnt} integration${
          cnt > 1 ? "s" : ""
        } enabled`,
      );
      for (let [i, integ] of stateModel.integrations.entries()) {
        console.log(`[${i}] ${Object.keys(integ)[0]}`);
      }
    });

  const allowIntegrations = GlamIntegrations.map(
    (i) => i.slice(0, 1).toLowerCase() + i.slice(1),
  );
  const integrationValidation = (input) => {
    if (!allowIntegrations.includes(input)) {
      console.error(
        `Invalid input: "${input}". Allowed values are: ${allowIntegrations.join(", ")}`,
      );
      process.exit(1);
    }
    return input; // Return validated input
  };

  integration
    .command("enable")
    .description("Enable an integration")
    .argument(
      "<integration>",
      `Integration to enable (must be one of: ${allowIntegrations.join(", ")})`,
      integrationValidation,
    )
    .action(async (integration) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      const stateModel = await glamClient.fetchState(statePda);
      const acl = stateModel.integrations.find(
        (integ) => Object.keys(integ)[0] === integration,
      );
      if (acl) {
        console.log(
          `${integration} is already enabled on ${stateModel.name} (${statePda.toBase58()})`,
        );
        process.exit(1);
      }

      const updated = new StateModel({
        // @ts-ignore
        integrations: [...stateModel.integrations, { [integration]: {} }],
      });

      try {
        const txSig = await glamClient.state.updateState(
          statePda,
          updated,
          txOptions,
        );
        console.log(`${integration} enabled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  integration
    .command("disable")
    .description("Disable an integration")
    .argument(
      "<integration>",
      `Integration to disable (must be one of: ${allowIntegrations.join(", ")})`,
      integrationValidation,
    )
    .action(async (integration) => {
      const statePda = cliConfig.glam_state
        ? new PublicKey(cliConfig.glam_state)
        : null;

      if (!statePda) {
        console.error("GLAM state not found in config file");
        process.exit(1);
      }

      const stateModel = await glamClient.fetchState(statePda);
      const updated = new StateModel({
        integrations: stateModel.integrations.filter(
          (integ) => Object.keys(integ)[0] !== integration,
        ),
      });

      try {
        const txSig = await glamClient.state.updateState(
          statePda,
          updated,
          txOptions,
        );
        console.log(`${integration} disabled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
