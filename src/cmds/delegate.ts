import { BN } from "@coral-xyz/anchor";
import {
  formatBits,
  parseProtocolPermissionsBitmask,
  getProgramAndBitflagByProtocolName,
  getProtocolsAndPermissions,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  confirmOperation,
  parseTxError,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installDelegateCommands(
  delegate: Command,
  context: CliContext,
) {
  delegate
    .command("list")
    .description("List delegates and their permissions")
    .action(async () => {
      const stateModel = await context.glamClient.fetchStateModel();
      const cnt = stateModel.delegateAcls.length;
      console.log(
        `${stateModel.nameStr} (${context.glamClient.statePda}) has ${cnt} delegate${cnt > 1 ? "s" : ""}:`,
      );
      for (let [i, acl] of stateModel.delegateAcls.entries()) {
        console.log(`[${i}] ${acl.pubkey}`);

        acl.integrationPermissions.forEach(
          ({ integrationProgram, protocolPermissions }) => {
            console.log(`  Integration: ${integrationProgram}`);

            protocolPermissions.forEach(
              ({ protocolBitflag, permissionsBitmask }) => {
                const { protocol, permissions } =
                  parseProtocolPermissionsBitmask(
                    integrationProgram,
                    protocolBitflag,
                    permissionsBitmask,
                  );
                const permissionNames =
                  permissions.map((perm) => perm.name).join(", ") ||
                  formatBits(permissionsBitmask);
                console.log(`    ${protocol}: ${permissionNames}`);
              },
            );
          },
        );
      }
    });

  delegate
    .command("grant")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .requiredOption(
      "--protocol <name>",
      "Protocol name (e.g., DriftProtocol, KaminoLend, SplToken)",
      (protocol) => protocol.replace(/\s+/g, ""),
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Grant delegate permissions for a single protocol")
    .action(
      async (delegate: PublicKey, permissions: string[], { protocol, yes }) => {
        const PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME =
          getProgramAndBitflagByProtocolName();
        const entry = PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME[protocol];
        if (!entry) {
          console.error(
            `Unknown protocol name: ${protocol}. Please use a valid protocol name (e.g., DriftProtocol, KaminoLend, SplToken).`,
          );
          process.exit(1);
        }

        const [programIdStr, bitflagStr] = entry;
        const integrationProgram = new PublicKey(programIdStr);
        const protocolBitflag = parseInt(bitflagStr, 2);

        // Find permissions defined by the protocol
        const protocolEntry =
          getProtocolsAndPermissions()[programIdStr]?.[bitflagStr];
        if (!protocolEntry) {
          console.error(
            `Protocol mapping not found for program ${programIdStr} and bitflag ${bitflagStr}.`,
          );
          process.exit(1);
        }

        const permissionNameToBitflag: Record<string, BN> = {};
        for (const [permBitflagStr, permName] of Object.entries(
          protocolEntry.permissions,
        )) {
          // keys in constants are strings, convert to BN as permission bitflag is u64
          permissionNameToBitflag[permName] = new BN(permBitflagStr);
        }

        // Validate input permissions
        const unknown = permissions.filter(
          (p) => permissionNameToBitflag[p] === undefined,
        );
        if (unknown.length) {
          const allowed = Object.values(protocolEntry.permissions).join(", ");
          console.error(
            `Unknown permission name(s): ${unknown.join(", ")}. Allowed: ${allowed}.`,
          );
          process.exit(1);
        }

        const permissionsBitmask = permissions.reduce(
          (mask: BN, p) => mask.or(permissionNameToBitflag[p]),
          new BN(0),
        );

        const permissionNames =
          permissions.join(", ") || formatBits(permissionsBitmask);

        yes ||
          (await confirmOperation(
            `Confirm granting ${delegate} "${permissionNames}" permissions for protocol "${protocolEntry.name}"?`,
          ));

        try {
          const txSig =
            await context.glamClient.access.grantDelegatePermissions(
              delegate,
              integrationProgram,
              protocolBitflag,
              permissionsBitmask,
              context.txOptions,
            );
          console.log(
            `Granted ${delegate} "${permissionNames}" permissions to ${integrationProgram} for protocol "${protocolEntry.name}": ${txSig}`,
          );
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  delegate
    .command("revoke")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .requiredOption(
      "--protocol <name>",
      "Protocol name (e.g., DriftProtocol, KaminoLend, SplToken)",
      (protocol) => protocol.replace(/\s+/g, ""),
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Revoke delegate permissions for a single protocol by name")
    .action(
      async (delegate: PublicKey, permissions: string[], { protocol, yes }) => {
        const PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME =
          getProgramAndBitflagByProtocolName();
        const entry = PROGRAM_AND_BITFLAG_BY_PROTOCOL_NAME[protocol];
        if (!entry) {
          console.error(
            `Unknown protocol name: ${protocol}. Please use a valid protocol name (e.g., DriftProtocol, KaminoLend, SplToken).`,
          );
          process.exit(1);
        }

        const [programIdStr, bitflagStr] = entry;
        const integrationProgram = new PublicKey(programIdStr);
        const protocolBitflag = parseInt(bitflagStr, 2);

        const protocolEntry =
          getProtocolsAndPermissions()[programIdStr]?.[bitflagStr];
        if (!protocolEntry) {
          console.error(
            `Protocol mapping not found for program ${programIdStr} and bitflag ${bitflagStr}.`,
          );
          process.exit(1);
        }

        const permissionNameToBitflag: Record<string, BN> = {};
        for (const [permBitflagStr, permName] of Object.entries(
          protocolEntry.permissions,
        )) {
          permissionNameToBitflag[permName] = new BN(permBitflagStr);
        }

        const unknown = permissions.filter(
          (p) => permissionNameToBitflag[p] === undefined,
        );
        if (unknown.length) {
          const allowed = Object.values(protocolEntry.permissions).join(", ");
          console.error(
            `Unknown permission name(s): ${unknown.join(", ")}. Allowed: ${allowed}.`,
          );
          process.exit(1);
        }

        const permissionsBitmask = permissions.reduce(
          (mask: BN, p) => mask.or(permissionNameToBitflag[p]),
          new BN(0),
        );

        const permissionNames =
          permissions.join(", ") || formatBits(permissionsBitmask);

        yes ||
          (await confirmOperation(
            `Confirm revoking ${delegate} "${permissionNames}" permissions for protocol "${protocolEntry.name}"?`,
          ));

        try {
          const txSig =
            await context.glamClient.access.revokeDelegatePermissions(
              delegate,
              integrationProgram,
              protocolBitflag,
              permissionsBitmask,
              context.txOptions,
            );
          console.log(
            `Revoked ${delegate} "${permissionNames}" permissions from ${integrationProgram} for protocol "${protocolEntry.name}": ${txSig}`,
          );
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  delegate
    .command("revoke-all")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Revoke delegate access entirely")
    .action(async (delegate: PublicKey, { yes }) => {
      yes ||
        (await confirmOperation(
          `Confirm revoking all ${delegate} permissions to the vault?`,
        ));

      try {
        const txSig = await context.glamClient.access.emergencyAccessUpdate(
          { disabledDelegates: [delegate] },
          context.txOptions,
        );
        console.log(`Revoked ${delegate} access: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
