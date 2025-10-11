import { Command } from "commander";
import { CliContext, confirmOperation, parseTxError } from "../utils";
import {
  IntegrationAcl,
  DelegateAcl,
  getProtocolNamesFromBitmask,
  getPermissionNamesFromBitmask,
  compareIntegrationAcls,
  compareDelegateAcls,
} from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export function installTimelockCommands(program: Command, context: CliContext) {
  program
    .command("get")
    .description("Get current timelock")
    .action(async () => {
      const stateModel = await context.glamClient.fetchStateModel();
      if (!stateModel) {
        console.error("State model not found");
        process.exit(1);
      }

      if (stateModel.timelockExpiresAt) {
        const expiresAt = new Date(stateModel.timelockExpiresAt * 1000);
        const now = new Date();
        const timeRemaining = Math.max(
          0,
          Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
        );
        console.log(
          `Timelock: ${stateModel.timelockDuration} seconds, remaining: ${timeRemaining}s (${Math.floor(timeRemaining / 60)}m ${timeRemaining % 60}s)`,
        );
      } else {
        console.log(`Timelock: ${stateModel.timelockDuration} seconds`);
      }

      if (
        stateModel.pendingStateUpdates &&
        Object.keys(stateModel.pendingStateUpdates).length > 0
      ) {
        console.log("\nPending state updates:");

        for (const [name, value] of Object.entries(
          stateModel.pendingStateUpdates,
        )) {
          if (name === "integrationAcls") {
            // Compare current and staged integrationAcls
            const diff = compareIntegrationAcls(
              stateModel.integrationAcls,
              value as IntegrationAcl[],
            );

            if (
              diff.added.length === 0 &&
              diff.removed.length === 0 &&
              diff.modified.length === 0
            ) {
              console.log("  integrationAcls: No changes");
              continue;
            }

            console.log("  integrationAcls:");

            // Show added integrations
            if (diff.added.length > 0) {
              console.log("    Added integrations:");
              diff.added.forEach((acl) => {
                const protocols = getProtocolNamesFromBitmask(
                  acl.integrationProgram,
                  acl.protocolsBitmask,
                );
                console.log(
                  `      [+] ${acl.integrationProgram.toBase58().slice(0, 8)}... (${protocols.join(", ")})`,
                );
              });
            }

            // Show removed integrations
            if (diff.removed.length > 0) {
              console.log("    Removed integrations:");
              diff.removed.forEach((acl) => {
                const protocols = getProtocolNamesFromBitmask(
                  acl.integrationProgram,
                  acl.protocolsBitmask,
                );
                console.log(
                  `      [-] ${acl.integrationProgram.toBase58().slice(0, 8)}... (${protocols.join(", ")})`,
                );
              });
            }

            // Show modified integrations
            if (diff.modified.length > 0) {
              console.log("    Modified integrations:");
              diff.modified.forEach((mod) => {
                console.log(
                  `      [~] ${mod.integrationProgram.toBase58().slice(0, 8)}...`,
                );
                if (mod.enabledProtocols.length > 0) {
                  console.log(
                    `          Enabling: ${mod.enabledProtocols.join(", ")}`,
                  );
                }
                if (mod.disabledProtocols.length > 0) {
                  console.log(
                    `          Disabling: ${mod.disabledProtocols.join(", ")}`,
                  );
                }
              });
            }
          } else if (name === "delegateAcls") {
            // Compare current and staged delegateAcls
            const diff = compareDelegateAcls(
              stateModel.delegateAcls,
              value as DelegateAcl[],
            );

            if (
              diff.added.length === 0 &&
              diff.removed.length === 0 &&
              diff.modified.length === 0
            ) {
              console.log("  delegateAcls: No changes");
              continue;
            }

            console.log("  delegateAcls:");

            // Show added delegates
            if (diff.added.length > 0) {
              console.log("    Added delegates:");
              diff.added.forEach((acl) => {
                console.log(
                  `      [+] ${acl.pubkey.toBase58().slice(0, 8)}...`,
                );
                const expiresAt = new Date(acl.expiresAt.toNumber() * 1000);
                console.log(`          Expires: ${expiresAt.toISOString()}`);
                if (acl.integrationPermissions.length > 0) {
                  console.log("          Permissions:");
                  acl.integrationPermissions.forEach((intPerm) => {
                    intPerm.protocolPermissions.forEach((protoPerm) => {
                      const protocolNames = getProtocolNamesFromBitmask(
                        intPerm.integrationProgram,
                        protoPerm.protocolBitflag,
                      );
                      const permissions = getPermissionNamesFromBitmask(
                        intPerm.integrationProgram,
                        protoPerm.protocolBitflag,
                        protoPerm.permissionsBitmask,
                      );
                      console.log(
                        `            ${protocolNames[0] || "Unknown"}: ${permissions.join(", ")}`,
                      );
                    });
                  });
                }
              });
            }

            // Show removed delegates
            if (diff.removed.length > 0) {
              console.log("    Removed delegates:");
              diff.removed.forEach((acl) => {
                console.log(
                  `      [-] ${acl.pubkey.toBase58().slice(0, 8)}...`,
                );
              });
            }

            // Show modified delegates
            if (diff.modified.length > 0) {
              console.log("    Modified delegates:");
              diff.modified.forEach((mod) => {
                console.log(
                  `      [~] ${mod.pubkey.toBase58().slice(0, 8)}...`,
                );

                // Show expiration changes
                if (!mod.currentExpiresAt.eq(mod.stagedExpiresAt)) {
                  const currentExpires = new Date(
                    mod.currentExpiresAt.toNumber() * 1000,
                  );
                  const stagedExpires = new Date(
                    mod.stagedExpiresAt.toNumber() * 1000,
                  );
                  console.log(
                    `          Expiration: ${currentExpires.toISOString()} → ${stagedExpires.toISOString()}`,
                  );
                }

                // Show permission changes
                if (mod.permissionChanges.length > 0) {
                  console.log("          Permission changes:");
                  mod.permissionChanges.forEach((change) => {
                    console.log(`            ${change.protocolName}:`);
                    if (change.addedPermissions.length > 0) {
                      console.log(
                        `              Adding: ${change.addedPermissions.join(", ")}`,
                      );
                    }
                    if (change.removedPermissions.length > 0) {
                      console.log(
                        `              Removing: ${change.removedPermissions.join(", ")}`,
                      );
                    }
                  });
                }
              });
            }
          } else if (name === "timelockDuration") {
            console.log(
              `  ${name}: ${stateModel.timelockDuration}s → ${value}s`,
            );
          } else {
            // For other fields, just show that they have pending changes
            console.log(`  ${name}: Has pending changes`);
          }
        }
      } else {
        console.log("\nNo pending state updates.");
      }
    });

  program
    .command("set")
    .argument("<duration>", "Timelock duration in seconds", parseInt)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Set timelock duration")
    .action(async (duration, { yes }) => {
      yes || (await confirmOperation(`Set timelock to ${duration} seconds?`));

      try {
        const txSig = await context.glamClient.state.update(
          { timelockDuration: duration },
          context.txOptions,
        );
        console.log(`Timelock updated:`, txSig);
      } catch (error) {
        console.error("Error setting timelock:", parseTxError(error));
        process.exit(1);
      }
    });

  program
    .command("apply")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Apply timelocked changes")
    .action(async ({ yes }) => {
      yes || (await confirmOperation("Apply timelocked changes?"));

      try {
        const txSig = await context.glamClient.state.updateApplyTimelock(
          context.txOptions,
        );
        console.log(`Timelock applied:`, txSig);
      } catch (error) {
        console.error("Error applying timelock:", parseTxError(error));
        process.exit(1);
      }
    });
}
