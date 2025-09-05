import { BN } from "@coral-xyz/anchor";
import { formatBits, GlamClient, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError, validatePublicKey } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installDelegateCommands(
  delegate: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  delegate
    .command("list")
    .description("List delegates and their permissions")
    .action(async () => {
      const stateModel = await glamClient.fetchStateModel();
      const cnt = stateModel.delegateAcls.length;
      console.log(
        `${stateModel.nameStr} (${glamClient.statePda}) has ${cnt} delegate${cnt > 1 ? "s" : ""}`,
      );
      for (let [i, acl] of stateModel.delegateAcls.entries()) {
        console.log(`[${i}] ${acl.pubkey}`);

        acl.integrationPermissions.forEach((p) => {
          console.log(`  ${p.integrationProgram}`);

          p.protocolPermissions.forEach((pp) => {
            console.log(
              `    Protocol: ${formatBits(pp.protocolBitflag)}, Permissions: ${formatBits(pp.permissionsBitmask)}`,
            );
          });
        });
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
    .description("Grant delegate permissions to integration programs")
    .action(
      async (
        delegate: PublicKey,
        integrationProgram: PublicKey,
        protocolBitflag: number,
        permissionsBitmask: number,
      ) => {
        try {
          const txSig = await glamClient.access.grantDelegatePermissions(
            delegate,
            integrationProgram,
            protocolBitflag,
            new BN(permissionsBitmask),
            txOptions,
          );
          console.log(
            `Granted ${delegate} permissions ${formatBits(permissionsBitmask)} to ${integrationProgram} for protocol ${formatBits(protocolBitflag)}: ${txSig}`,
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
    .description(
      "Revoke delegate permissions to specified integration programs",
    )
    .action(
      async (
        delegate: PublicKey,
        integrationProgram: PublicKey,
        protocolBitflag: number,
        permissionsBitmask: number,
      ) => {
        try {
          const txSig = await glamClient.access.revokeDelegatePermissions(
            delegate,
            integrationProgram,
            protocolBitflag,
            new BN(permissionsBitmask),
            txOptions,
          );
          console.log(
            `Revoked ${delegate} permissions ${formatBits(permissionsBitmask)} to ${integrationProgram} for protocol ${formatBits(protocolBitflag)}: ${txSig}`,
          );
        } catch (e) {
          console.error(parseTxError(e));
          process.exit(1);
        }
      },
    );

  delegate
    .command("delete")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .description("Revoke delegate access entirely")
    .action(async (delegate: PublicKey) => {
      try {
        const txSig = await glamClient.access.emergencyAccessUpdate(
          { disabledDelegates: [delegate] },
          txOptions,
        );
        console.log(`Revoked ${delegate} access: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
