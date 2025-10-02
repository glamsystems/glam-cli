import { BN } from "@coral-xyz/anchor";
import {
  formatBits,
  parseProtocolPermissionsBitmask,
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
    .argument(
      "<integration_program>",
      "Integration programs to grant permissions to",
      validatePublicKey,
    )
    .argument("<protocol_bitflag>", "Protocol bitflag", parseInt)
    .argument("<permissions_bitmask>", "Permissions bitmask", parseInt)
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Grant delegate permissions to integration programs")
    .action(
      async (
        delegate: PublicKey,
        integrationProgram: PublicKey,
        protocolBitflag: number,
        permissionsBitmask: number,
        { yes },
      ) => {
        const { protocol, permissions } = parseProtocolPermissionsBitmask(
          integrationProgram,
          protocolBitflag,
          permissionsBitmask,
        );
        const permissionNames =
          permissions.map((perm) => perm.name).join(", ") ||
          formatBits(permissionsBitmask);

        yes ||
          (await confirmOperation(
            `Confirm granting ${delegate} "${permissionNames}" permissions for protocol "${protocol}"?`,
          ));

        try {
          const txSig =
            await context.glamClient.access.grantDelegatePermissions(
              delegate,
              integrationProgram,
              protocolBitflag,
              new BN(permissionsBitmask),
              context.txOptions,
            );
          console.log(
            `Granted ${delegate} "${permissionNames}" permissions to ${integrationProgram} for protocol "${protocol}": ${txSig}`,
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
    .argument(
      "<integration_program>",
      "Integration programs to grant permissions to",
      validatePublicKey,
    )
    .argument("<protocol_bitflag>", "Protocol bitflag", parseInt)
    .argument("<permissions_bitmask>", "Permissions bitmask", parseInt)
    .option("-y, --yes", "Skip confirmation prompt")
    .description(
      "Revoke delegate permissions to specified integration programs",
    )
    .action(
      async (
        delegate: PublicKey,
        integrationProgram: PublicKey,
        protocolBitflag: number,
        permissionsBitmask: number,
        { yes },
      ) => {
        const { protocol, permissions } = parseProtocolPermissionsBitmask(
          integrationProgram,
          protocolBitflag,
          permissionsBitmask,
        );
        const permissionNames =
          permissions.map((perm) => perm.name).join(", ") ||
          formatBits(permissionsBitmask);

        yes ||
          (await confirmOperation(
            `Confirm revoking ${delegate} "${permissionNames}" permissions for protocol "${protocol}"?`,
          ));

        try {
          const txSig =
            await context.glamClient.access.revokeDelegatePermissions(
              delegate,
              integrationProgram,
              protocolBitflag,
              new BN(permissionsBitmask),
              context.txOptions,
            );
          console.log(
            `Revoked ${delegate} "${permissionNames}" permissions from ${integrationProgram} for protocol "${protocol}": ${txSig}`,
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
          `Confirm revoking ${delegate} access to the vault?`,
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
