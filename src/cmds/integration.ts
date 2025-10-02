import {
  formatBits,
  GlamMintIdl,
  parseProtocolsBitmask,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

const validateIntegrationProgram = (input: string) => {
  const pubkey = validatePublicKey(input);
  if (pubkey.equals(new PublicKey(GlamMintIdl.address))) {
    console.error("Mint integration is not allowed");
    process.exit(1);
  }
  return pubkey;
};

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
        } enabled:`,
      );
      for (let [
        i,
        { integrationProgram, protocolsBitmask },
      ] of stateModel.integrationAcls.entries()) {
        const { protocols } = parseProtocolsBitmask(
          integrationProgram,
          protocolsBitmask,
        );

        console.log(
          `[${i}] ${integrationProgram}, protocols (${formatBits(
            protocolsBitmask,
          )}): ${protocols.map((p) => p.name).join(", ")}`,
        );
      }
    });

  integration
    .command("enable")
    .description("Enable protocols for an integration")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validateIntegrationProgram,
    )
    .argument("<protocols_bitmask>", "Protocols to eanble", parseInt)
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        integrationProgram: PublicKey,
        protocolsBitmask: number,
        { yes },
      ) => {
        const { protocols } = parseProtocolsBitmask(
          integrationProgram,
          protocolsBitmask,
        );
        const protocolNames = protocols.map((p) => p.name).join(", ");

        !yes &&
          (await confirmOperation(
            `Enable integration ${integrationProgram} and protocol(s): ${protocolNames}?`,
          ));

        try {
          const txSig = await context.glamClient.access.enableProtocols(
            integrationProgram,
            protocolsBitmask,
            context.txOptions,
          );
          console.log(
            `Enabled ${protocolNames} from ${integrationProgram}: ${txSig}`,
          );
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  integration
    .command("disable")
    .description("Disable protocols for an integration")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validateIntegrationProgram,
    )
    .argument("<protocols_bitmask>", "Protocols to disable", parseInt)
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        integrationProgram: PublicKey,
        protocolsBitmask: number,
        { yes },
      ) => {
        const { protocols } = parseProtocolsBitmask(
          integrationProgram,
          protocolsBitmask,
        );
        const protocolNames = protocols.map((p) => p.name).join(", ");

        !yes &&
          (await confirmOperation(
            `Disable integration ${integrationProgram} and protocol(s): ${protocolNames}?`,
          ));

        try {
          const txSig = await context.glamClient.access.disableProtocols(
            integrationProgram,
            protocolsBitmask,
            context.txOptions,
          );
          console.log(
            `Disabled ${protocolNames} from ${integrationProgram}: ${txSig}`,
          );
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  integration
    .command("disable-all")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validateIntegrationProgram,
    )
    .option("-y, --yes", "Skip confirmation")
    .description("Disable all protocols for an integration")
    .action(async (integrationProgram: PublicKey, { yes }) => {
      !yes &&
        (await confirmOperation(
          `Disable all protocols for integration ${integrationProgram}?`,
        ));

      try {
        const txSig = await context.glamClient.access.emergencyAccessUpdate(
          { disabledIntegrations: [integrationProgram] },
          context.txOptions,
        );
        console.log(
          `Disabled all protocols for ${integrationProgram}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
