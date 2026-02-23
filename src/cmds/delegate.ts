import { BN } from "@coral-xyz/anchor";
import {
  formatBits,
  parseProtocolPermissionsBitmask,
  parsePermissionNames,
} from "@glamsystems/glam-sdk";
import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  resolvePermissionNames,
  resolveProtocolName,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

async function handleDelegatePermissions(
  operation: "grant" | "revoke",
  delegate: PublicKey,
  integrationProgram: PublicKey,
  protocolBitflag: number,
  protocolName: string,
  permissionsBitmask: BN,
  permissionNames: string[],
  context: CliContext,
  yes: boolean,
) {
  const action = operation === "grant" ? "Granted" : "Revoked";
  const preposition = operation === "grant" ? "to" : "from";

  await executeTxWithErrorHandling(
    () =>
      operation === "grant"
        ? context.glamClient.access.grantDelegatePermissions(
            delegate,
            integrationProgram,
            protocolBitflag,
            permissionsBitmask,
            context.txOptions,
          )
        : context.glamClient.access.revokeDelegatePermissions(
            delegate,
            integrationProgram,
            protocolBitflag,
            permissionsBitmask,
            context.txOptions,
          ),
    {
      skip: yes,
      message: `Confirm ${operation === "grant" ? "granting" : "revoking"} ${delegate} "${permissionNames}" permissions for protocol "${protocolName}"?`,
    },
    (txSig) =>
      `${action} ${delegate} "${permissionNames}" permissions ${preposition} ${integrationProgram} for protocol "${protocolName}": ${txSig}`,
  );
}

export function installDelegateCommands(
  delegate: Command,
  context: CliContext,
) {
  const staging = context.glamClient.staging;

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
                    staging,
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
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Grant delegate permissions for a single protocol")
    .action(
      async (delegate: PublicKey, permissions: string[], { protocol, yes }) => {
        const resolvedProtocol = resolveProtocolName(protocol, staging);
        const resolvedPermissions = resolvePermissionNames(
          resolvedProtocol,
          permissions,
          staging,
        );
        const { integrationProgram, protocolBitflag, permissionsBitmask } =
          parsePermissionNames({
            protocolName: resolvedProtocol,
            permissionNames: resolvedPermissions,
            staging,
          });
        await handleDelegatePermissions(
          "grant",
          delegate,
          integrationProgram,
          protocolBitflag,
          resolvedProtocol,
          permissionsBitmask,
          resolvedPermissions,
          context,
          yes,
        );
      },
    );

  delegate
    .command("revoke")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .requiredOption(
      "--protocol <name>",
      "Protocol name (e.g., DriftProtocol, KaminoLend, SplToken)",
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Revoke delegate permissions for a single protocol by name")
    .action(
      async (delegate: PublicKey, permissions: string[], { protocol, yes }) => {
        const resolvedProtocol = resolveProtocolName(protocol, staging);
        const resolvedPermissions = resolvePermissionNames(
          resolvedProtocol,
          permissions,
          staging,
        );
        const { integrationProgram, protocolBitflag, permissionsBitmask } =
          parsePermissionNames({
            protocolName: resolvedProtocol,
            permissionNames: resolvedPermissions,
            staging,
          });
        await handleDelegatePermissions(
          "revoke",
          delegate,
          integrationProgram,
          protocolBitflag,
          resolvedProtocol,
          permissionsBitmask,
          resolvedPermissions,
          context,
          yes,
        );
      },
    );

  delegate
    .command("revoke-all")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Revoke delegate access entirely")
    .action(async (delegate: PublicKey, { yes }) => {
      await executeTxWithErrorHandling(
        () =>
          context.glamClient.access.emergencyAccessUpdate(
            { disabledDelegates: [delegate] },
            context.txOptions,
          ),
        {
          skip: yes,
          message: `Confirm revoking all ${delegate} permissions to the vault?`,
        },
        (txSig) => `Revoked ${delegate} access: ${txSig}`,
      );
    });
}
