import { BN } from "@coral-xyz/anchor";
import { GlamClient, GlamPermissions, TxOptions } from "@glamsystems/glam-sdk";
import { Command } from "commander";
import { CliConfig, parseTxError } from "../utils";
import { PublicKey } from "@solana/web3.js";

export function installDelegateCommands(
  delegate: Command,
  glamClient: GlamClient,
  cliConfig: CliConfig,
  txOptions: TxOptions = {},
) {
  delegate
    .command("list")
    .description("List delegates and permissions")
    .action(async () => {
      const statePda = cliConfig.glamState;

      const stateModel = await glamClient.fetchState(statePda);
      const cnt = stateModel.delegateAcls.length;
      console.log(
        `${stateModel.name} (${statePda.toBase58()}) has ${cnt} delegate${cnt > 1 ? "s" : ""}`,
      );
      for (let [i, acl] of stateModel.delegateAcls.entries()) {
        console.log(
          `[${i}] ${acl.pubkey.toBase58()}:`,
          // @ts-ignore
          acl.permissions.map((p) => Object.keys(p)[0]).join(", "),
        );
      }
    });

  const allowedPermissions = GlamPermissions.map(
    (p) => p.slice(0, 1).toLowerCase() + p.slice(1),
  );
  delegate
    .command("set")
    .argument("<pubkey>", "Delegate pubkey")
    .argument(
      "<permissions...>",
      `A space-separated list of permissions to grant. Allowed values: ${allowedPermissions.join(", ")}.`,
    )
    .description("Set delegate permissions")
    .action(async (pubkey, permissions) => {
      const statePda = cliConfig.glamState;

      if (!permissions.every((p) => allowedPermissions.includes(p))) {
        console.error(
          `Invalid permissions: ${permissions}. Values must be among: ${allowedPermissions.join(", ")}`,
        );
        process.exit(1);
      }

      try {
        const txSig = await glamClient.state.upsertDelegateAcls(statePda, [
          {
            pubkey: new PublicKey(pubkey),
            permissions: permissions.map((p) => ({
              [p]: {},
            })),
            expiresAt: new BN(0),
          },
        ]);
        console.log("txSig:", txSig);
        console.log(`Granted ${pubkey} permissions ${permissions}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  delegate
    .command("delete <pubkey>")
    .description("Revoke all delegate permissions for a pubkey")
    .action(async (pubkey) => {
      const statePda = cliConfig.glamState;

      try {
        const txSig = await glamClient.state.deleteDelegateAcls(statePda, [
          new PublicKey(pubkey),
        ]);
        console.log("txSig:", txSig);
        console.log(`Revoked ${pubkey} access to ${statePda.toBase58()}`);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
