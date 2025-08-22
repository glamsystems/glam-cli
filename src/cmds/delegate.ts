import { BN } from "@coral-xyz/anchor";
import { GlamClient, GlamPermissions, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError, validatePublicKey } from "../utils";
import { PublicKey } from "@solana/web3.js";

const allowedPermissions = GlamPermissions.map(
  (p: string) => p.slice(0, 1).toLowerCase() + p.slice(1),
);
const validate = (permissions: string[]) => {
  permissions.forEach((p) => {
    if (!allowedPermissions.includes(p)) {
      console.error(
        `Invalid permission: ${p}. Value must be among: ${allowedPermissions.join(", ")}`,
      );
      process.exit(1);
    }
  });
};

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
      console.log("cliConfig:", cliConfig);

      const stateModel = await glamClient.fetchStateModel();
      const cnt = stateModel.delegateAcls.length;
      console.log(
        `${stateModel.name} (${glamClient.statePda}) has ${cnt} delegate${cnt > 1 ? "s" : ""}`,
      );
      for (let [i, acl] of stateModel.delegateAcls.entries()) {
        console.log(
          `[${i}] ${acl.pubkey.toBase58()}:`,
          // @ts-ignore
          acl.permissions.map((p) => Object.keys(p)[0]).join(", "),
        );
      }
    });

  delegate
    .command("grant")
    .argument("<pubkey>", "Delegate pubkey")
    .argument(
      "<integration_programs...>",
      "Integration program to grant permissions to",
    )
    .description("Grant delegate new permissions")
    .action(async (pubkey, integrationPrograms: string[]) => {
      // validate(permissions);

      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.delegateAcls.find(
        (acl) => acl.pubkey.toBase58() === pubkey,
      );

      // if acl doesn't exist, it's a new delegate to add, and we add `wSol` automatically
      const existingPermissionKeys = new Set(
        acl
          ? acl.integrationPermissions.map((p) =>
              p.integrationProgram.toBase58(),
            )
          : [glamClient.protocolProgram.programId.toBase58()],
      );
      const newPermissionKeys = integrationPrograms.filter(
        (p) => !existingPermissionKeys.has(p),
      );
      if (newPermissionKeys.length === 0) {
        console.log(
          `Delegate ${pubkey} already has been granted access to: ${integrationPrograms.join(", ")}`,
        );
        return;
      }
      const integrationPermissions = Array.from(
        new Set([...existingPermissionKeys, ...newPermissionKeys]),
      ).map((p) => ({
        integrationProgram: new PublicKey(p),
        protocolPermissions: [
          {
            protocolBitflag: 0xff,
            permissionsBitmask: new BN(0xffffffff),
          },
        ],
      }));

      try {
        const txSig = await glamClient.state.upsertDelegateAcls(
          [
            {
              pubkey: new PublicKey(pubkey),
              expiresAt: new BN(0),
              integrationPermissions,
            },
          ],
          txOptions,
        );
        console.log(
          `Granted ${pubkey} permissions ${integrationPermissions}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  // delegate
  //   .command("revoke")
  //   .argument("<pubkey>", "Delegate pubkey")
  //   .argument(
  //     "<permissions...>",
  //     `A space-separated list of permissions to revoke. Allowed values: ${allowedPermissions.join(", ")}.`,
  //   )
  //   .description("Revoke delegate permissions")
  //   .action(async (pubkey, permissions) => {
  //     validate(permissions);

  //     const stateModel = await glamClient.fetchStateModel();
  //     const acl = stateModel.delegateAcls.find(
  //       (acl) => acl.pubkey.toBase58() === pubkey,
  //     );
  //     if (!acl) {
  //       console.error(`Delegate ${pubkey} not found. No need to revoke.`);
  //       return;
  //     }
  //     const existingPermissionKeys = new Set(
  //       acl.permissions.map((p) => Object.keys(p)[0]),
  //     );
  //     const updatedPermissions = Array.from(existingPermissionKeys)
  //       .filter((p) => !permissions.includes(p))
  //       .map((p) => ({ [p]: {} }));

  //     try {
  //       const txSig = await glamClient.state.upsertDelegateAcls(
  //         [
  //           {
  //             pubkey: new PublicKey(pubkey),
  //             permissions: updatedPermissions,
  //             expiresAt: new BN(0),
  //           },
  //         ],
  //         txOptions,
  //       );
  //       console.log(`Revoked ${pubkey} permissions ${permissions}: ${txSig}`);
  //     } catch (e) {
  //       console.error(parseTxError(e));
  //       process.exit(1);
  //     }
  //   });

  delegate
    .command("delete")
    .argument("<pubkey>", "Delegate pubkey", validatePublicKey)
    .description("Revoke delegate access entirely")
    .action(async (delegate: PublicKey) => {
      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.delegateAcls.find((acl) =>
        acl.pubkey.equals(delegate),
      );
      if (!acl) {
        console.error(`Delegate ${delegate} ACL not found. Nothing to delete.`);
        return;
      }

      try {
        const txSig = await glamClient.state.deleteDelegateAcls(
          [delegate],
          txOptions,
        );
        console.log(
          `Revoked ${delegate} access to ${glamClient.statePda}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
