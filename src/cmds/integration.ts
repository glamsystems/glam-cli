import {
  formatBits,
  getProgramAndBitflagByProtocolName,
  parseProtocolsBitmask,
  getGlamMintProgramId,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

const validateIntegrationProgram = (input: string) => {
  const pubkey = validatePublicKey(input);
  if (pubkey.equals(getGlamMintProgramId())) {
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
    .description("Enable protocols by name (grouped per integration program)")
    .argument(
      "<protocols...>",
      "Protocol names (e.g., SplToken, JupiterSwap, DriftProtocol)",
    )
    .option("-y, --yes", "Skip confirmation")
    .action(async (protocols: string[], { yes }) => {
      const groups: Record<string, number> = {}; // Program ID -> Protocols Bitmask
      const unknown: string[] = [];

      const PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME =
        getProgramAndBitflagByProtocolName();

      for (const name of protocols) {
        const entry = PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME[name];
        if (!entry) {
          unknown.push(name);
          continue;
        }
        const [programIdStr, bitflagStr] = entry;

        if (programIdStr === getGlamMintProgramId().toBase58()) {
          console.error("Mint integration is not allowed");
          process.exit(1);
        }

        const bitflag = parseInt(bitflagStr, 2);
        groups[programIdStr] = (groups[programIdStr] || 0) | bitflag;
      }

      if (unknown.length) {
        console.error(`Unknown protocol name(s): ${unknown.join(", ")}`);
        process.exit(1);
      }

      const details = Object.entries(groups).map(([pid, mask]) => {
        const { protocols } = parseProtocolsBitmask(new PublicKey(pid), mask);
        const names = protocols.map((p) => p.name).join(", ");
        return `${pid} -> ${names}`;
      });

      const entries = Object.entries(groups);
      for (let i = 0; i < entries.length; i++) {
        const [pid, mask] = entries[i];
        const programId = new PublicKey(pid);
        const { protocols } = parseProtocolsBitmask(programId, mask);
        const names = protocols.map((p) => p.name).join(", ");
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.access.enableProtocols(
              programId,
              mask,
              context.txOptions,
            ),
          {
            skip: yes || i > 0,
            message: `Enable protocols from integration programs:\n${details.join("\n")}?`,
          },
          (txSig) => `Enabled ${names} on ${programId}: ${txSig}`,
        );
      }
    });

  integration
    .command("disable")
    .description("Disable protocols by name (grouped per integration program)")
    .argument(
      "<protocols...>",
      "Protocol names (e.g., SplToken, JupiterSwap, DriftProtocol)",
    )
    .option("-y, --yes", "Skip confirmation")
    .action(async (protocols: string[], { yes }) => {
      const groups: Record<string, number> = {};
      const unknown: string[] = [];

      const PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME =
        getProgramAndBitflagByProtocolName();

      for (const name of protocols) {
        const entry = PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME[name];
        if (!entry) {
          unknown.push(name);
          continue;
        }
        const [programIdStr, bitflagStr] = entry;

        if (programIdStr === getGlamMintProgramId().toBase58()) {
          console.error("Mint integration is not allowed");
          process.exit(1);
        }

        const mask = parseInt(bitflagStr, 2);
        groups[programIdStr] = (groups[programIdStr] || 0) | mask;
      }

      if (unknown.length) {
        console.error(`Unknown protocol name(s): ${unknown.join(", ")}`);
        process.exit(1);
      }

      const details = Object.entries(groups).map(([pid, mask]) => {
        const { protocols } = parseProtocolsBitmask(new PublicKey(pid), mask);
        const names = protocols.map((p) => p.name).join(", ");
        return `${pid} -> ${names}`;
      });

      const entries = Object.entries(groups);
      for (let i = 0; i < entries.length; i++) {
        const [pid, mask] = entries[i];
        const programId = new PublicKey(pid);
        const { protocols } = parseProtocolsBitmask(programId, mask);
        const names = protocols.map((p) => p.name).join(", ");
        await executeTxWithErrorHandling(
          () =>
            context.glamClient.access.disableProtocols(
              programId,
              mask,
              context.txOptions,
            ),
          {
            skip: yes || i > 0,
            message: `Disable protocols from integration programs:\n${details.join("\n")}?`,
          },
          (txSig) => `Disabled ${names} on ${programId}: ${txSig}`,
        );
      }
    });

  integration
    .command("disable-all")
    .argument(
      "<integration_program>",
      "Integration program ID",
      validateIntegrationProgram,
    )
    .option("-y, --yes", "Skip confirmation")
    .description("Disable all protocols from an integration")
    .action(async (integrationProgram: PublicKey, { yes }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.emergencyAccessUpdate(
            { disabledIntegrations: [integrationProgram] },
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Disable all protocols from integration ${integrationProgram}?`,
        },
        (txSig) =>
          `Disabled all protocols from ${integrationProgram}: ${txSig}`,
      );
    });
}
