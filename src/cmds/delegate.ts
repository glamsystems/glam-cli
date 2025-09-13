import { BN } from "@coral-xyz/anchor";
import { GlamClient, GlamPermissions, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
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
    .command("set")
    .argument("<pubkey>", "Delegate pubkey")
    .argument(
      "<permissions...>",
      `A space-separated list of permissions to grant. Allowed values: ${allowedPermissions.join(", ")}.`,
    )
    .description(
      "(Deprecated. Use `delegate grant` instead.) Set delegate permissions",
    )
    .action(async (pubkey, permissions) => {
      console.warn(
        "This command is deprecated and will be removed in the future. Use `delegate grant` instead.",
      );
      if (!permissions.every((p) => allowedPermissions.includes(p))) {
        console.error(
          `Invalid permissions: ${permissions}. Values must be among: ${allowedPermissions.join(", ")}`,
        );
        process.exit(1);
      }

      try {
        const txSig = await glamClient.state.upsertDelegateAcls(
          [
            {
              pubkey: new PublicKey(pubkey),
              permissions: permissions.map((p) => ({
                [p]: {},
              })),
              expiresAt: new BN(0),
            },
          ],
          txOptions,
        );
        console.log(`Granted ${pubkey} permissions ${permissions}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  delegate
    .command("grant")
    .argument("<pubkey>", "Delegate pubkey")
    .argument(
      "<permissions...>",
      `A space-separated list of permissions to grant. Allowed values: ${allowedPermissions.join(", ")}.`,
    )
    .description("Grant delegate new permissions")
    .action(async (pubkey, permissions: string[]) => {
      validate(permissions);

      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.delegateAcls.find(
        (acl) => acl.pubkey.toBase58() === pubkey,
      );

      // if acl doesn't exist, it's a new delegate to add, and we add `wSol` automatically
      const existingPermissionKeys = new Set(
        acl ? acl.permissions.map((p) => Object.keys(p)[0]) : ["wSol"],
      );
      const newPermissionKeys = permissions.filter(
        (p) => !existingPermissionKeys.has(p),
      );
      if (newPermissionKeys.length === 0) {
        console.log(
          `Delegate ${pubkey} already has permissions: ${permissions.join(", ")}`,
        );
        return;
      }
      const updatedPermissions = Array.from(
        new Set([...existingPermissionKeys, ...newPermissionKeys]),
      ).map((p) => ({ [p]: {} }));

      try {
        const txSig = await glamClient.state.upsertDelegateAcls(
          [
            {
              pubkey: new PublicKey(pubkey),
              permissions: updatedPermissions,
              expiresAt: new BN(0),
            },
          ],
          txOptions,
        );
        console.log(`Granted ${pubkey} permissions ${permissions}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  delegate
    .command("revoke")
    .argument("<pubkey>", "Delegate pubkey")
    .argument(
      "<permissions...>",
      `A space-separated list of permissions to revoke. Allowed values: ${allowedPermissions.join(", ")}.`,
    )
    .description("Revoke delegate permissions")
    .action(async (pubkey, permissions) => {
      validate(permissions);

      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.delegateAcls.find(
        (acl) => acl.pubkey.toBase58() === pubkey,
      );
      if (!acl) {
        console.error(`Delegate ${pubkey} not found. No need to revoke.`);
        return;
      }
      const existingPermissionKeys = new Set(
        acl.permissions.map((p) => Object.keys(p)[0]),
      );
      const updatedPermissions = Array.from(existingPermissionKeys)
        .filter((p) => !permissions.includes(p))
        .map((p) => ({ [p]: {} }));

      try {
        const txSig = await glamClient.state.upsertDelegateAcls(
          [
            {
              pubkey: new PublicKey(pubkey),
              permissions: updatedPermissions,
              expiresAt: new BN(0),
            },
          ],
          txOptions,
        );
        console.log(`Revoked ${pubkey} permissions ${permissions}: ${txSig}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  delegate
    .command("delete <pubkey>")
    .description("Revoke delegate access entirely")
    .action(async (pubkey) => {
      const stateModel = await glamClient.fetchStateModel();
      const acl = stateModel.delegateAcls.find(
        (acl) => acl.pubkey.toBase58() === pubkey,
      );
      if (!acl) {
        console.error(`Delegate ${pubkey} not found. No need to delete.`);
        return;
      }

      try {
        const txSig = await glamClient.state.deleteDelegateAcls(
          [new PublicKey(pubkey)],
          txOptions,
        );
        console.log(
          `Revoked ${pubkey} access to ${glamClient.statePda}: ${txSig}`,
        );
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
