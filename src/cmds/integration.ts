import {
  GlamClient,
  GlamIntegrations,
  StateModel,
  TxOptions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError, validatePublicKey } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installIntegrationCommands(
  integration: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  integration
    .command("list")
    .description("List enabled integration programs and protocols")
    .action(async () => {
      const stateModel = await glamClient.fetchStateModel();
      const cnt = stateModel.integrationAcls.length;
      console.log(
        `${stateModel.nameStr} (${glamClient.statePda}) has ${cnt} integration program${
          cnt > 1 ? "s" : ""
        } enabled`,
      );
      for (let [i, integ] of stateModel.integrationAcls.entries()) {
        console.log(
          `[${i}] ${integ.integrationProgram} protocolsBitmask: ${integ.protocolsBitmask.toString(2).padStart(16, "0")}`,
        );
      }
    });

  const allowIntegrations = GlamIntegrations.map(
    (i) => i.slice(0, 1).toLowerCase() + i.slice(1),
  );
  const validateIntegration = (input) => {
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
    .description("Enable an integration program")
    .argument(
      "<integration_program_id>",
      "Integration program to enable",
      validatePublicKey,
    )
    .action(async (integrationProgramId: PublicKey) => {
      const stateModel = await glamClient.fetchStateModel();
      const enabled = stateModel.integrationAcls.find((integ) =>
        integ.integrationProgram.equals(integrationProgramId),
      );
      if (enabled) {
        console.log(
          `${integrationProgramId} is already enabled on ${stateModel.name}`,
        );
        process.exit(1);
      }

      try {
        const txSig = await glamClient.state.update(
          {
            integrationAcls: [
              ...stateModel.integrationAcls,
              {
                integrationProgram: integrationProgramId,
                protocolsBitmask: 0xffff, // FIXME: more granular control
                protocolPolicies: [],
              },
            ],
          },
          txOptions,
        );
        console.log(`${integrationProgramId} enabled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  integration
    .command("disable")
    .description("Disable an integration")
    .argument(
      "<integration_program_id>",
      `Integration to disable (must be one of: ${allowIntegrations.join(", ")})`,
      validatePublicKey,
    )
    .action(async (integrationProgramId) => {
      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.integrationAcls.find((integ) =>
        integ.integrationProgram.equals(integrationProgramId),
      );
      if (!acl) {
        console.log(
          `${integrationProgramId} is not enabled on ${stateModel.name}`,
        );
        process.exit(1);
      }
      acl.protocolsBitmask = 0; // disable all protocols == disable the integration program

      try {
        const txSig = await glamClient.state.update(
          {
            integrationAcls: [acl],
          },
          txOptions,
        );
        console.log(`${integrationProgramId} disabled: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
