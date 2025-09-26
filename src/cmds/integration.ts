import { formatBits } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliContext, parseTxError, validatePublicKey } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installIntegrationCommands(
  integration: Command,
  context: CliContext,
) {
  integration
    .command("list")
    .description("List enabled integration programs and protocols")
    .action(async () => {
      const stateModel = await context.glamClient.fetchStateModel();
      const cnt = stateModel.integrationAcls.length;
      console.log(
        `${stateModel.nameStr} (${context.glamClient.statePda}) has ${cnt} integration program${
          cnt > 1 ? "s" : ""
        } enabled`,
      );
      for (let [i, integ] of stateModel.integrationAcls.entries()) {
        console.log(
          `[${i}] ${integ.integrationProgram} protocolsBitmask: ${formatBits(integ.protocolsBitmask)}`,
        );
      }
    });

  integration
    .command("enable")
    .description("Enable protocols for an integration program")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validatePublicKey,
    )
    .argument("<protocols_bitmask>", "Protocols to eanble", parseInt)
    .action(async (integrationProgram: PublicKey, protocolsBitmask: number) => {
      try {
        const txSig = await context.glamClient.access.enableProtocols(
          integrationProgram,
          protocolsBitmask,
          context.txOptions,
        );
        console.log(
          `Enabled ${formatBits(protocolsBitmask)} for ${integrationProgram}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  integration
    .command("disable")
    .description("Disable an integration")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validatePublicKey,
    )
    .argument("<protocols_bitmask>", "Protocols to disable", parseInt)
    .action(async (integrationProgram: PublicKey, protocolsBitmask: number) => {
      if (integrationProgram.equals(context.glamClient.mintProgram.programId)) {
        console.error(
          "Disabling protocols for the mint integration is not allowed",
        );
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.access.disableProtocols(
          integrationProgram,
          protocolsBitmask,
          context.txOptions,
        );
        console.log(
          `Disabled ${formatBits(protocolsBitmask)} for ${integrationProgram}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  integration
    .command("delete")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validatePublicKey,
    )
    .description("Delete an integration program")
    .action(async (integrationProgram: PublicKey) => {
      if (integrationProgram.equals(context.glamClient.mintProgram.programId)) {
        console.error("Deleting the mint integration is not allowed");
        process.exit(1);
      }

      try {
        const txSig = await context.glamClient.access.emergencyAccessUpdate(
          { disabledIntegrations: [integrationProgram] },
          context.txOptions,
        );
        console.log(`Deleted ${integrationProgram} access: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
