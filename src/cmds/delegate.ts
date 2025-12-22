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
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import { PublicKey } from "@solana/web3.js";

function validateProtocolName(input: string) {
  const protocol = input.replace(/\s+/g, "");
  const mapping = getProgramAndBitflagByProtocolName();
  const entry = mapping[protocol];
  if (!entry) {
    console.error(
      `Unknown protocol name: ${protocol}. Allowed values: ${Object.keys(mapping).join(", ")}.`,
    );
    process.exit(1);
  }
  return entry;
}

async function handleDelegatePermissions(
  operation: "grant" | "revoke",
  delegate: PublicKey,
  sIntegrationProgram: string,
  sProtocolBitflag: string,
  permissions: string[],
  context: CliContext,
  yes: boolean,
) {
  const integrationProgram = new PublicKey(sIntegrationProgram);
  const protocolBitflag = parseInt(sProtocolBitflag, 2);

  // Find permissions defined by the protocol
  const protocolPermissions =
    getProtocolsAndPermissions()[sIntegrationProgram]?.[sProtocolBitflag];
  if (!protocolPermissions) {
    console.error(
      `Protocol mapping not found for program ${sIntegrationProgram} and bitflag ${sProtocolBitflag}.`,
    );
    process.exit(1);
  }

  const permissionNameToBitflag: Record<string, BN> = {};
  for (const [permBitflagStr, name] of Object.entries(
    protocolPermissions.permissions,
  )) {
    permissionNameToBitflag[name] = new BN(permBitflagStr);
  }

  // Validate input permissions
  const unknown = permissions.filter(
    (p) => permissionNameToBitflag[p] === undefined,
  );
  if (unknown.length) {
    const allowed = Object.values(protocolPermissions.permissions).join(", ");
    console.error(
      `Unknown permission name(s): ${unknown.join(", ")}. Allowed values: ${allowed}.`,
    );
    process.exit(1);
  }

  const permissionsBitmask = permissions.reduce(
    (mask: BN, p) => mask.or(permissionNameToBitflag[p]),
    new BN(0),
  );
  const permissionNames = permissions.join(", ");

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
      message: `Confirm ${operation === "grant" ? "granting" : "revoking"} ${delegate} "${permissionNames}" permissions for protocol "${protocolPermissions.name}"?`,
    },
    (txSig) =>
      `${action} ${delegate} "${permissionNames}" permissions ${preposition} ${integrationProgram} for protocol "${protocolPermissions.name}": ${txSig}`,
  );
}

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
      validateProtocolName,
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Grant delegate permissions for a single protocol")
    .action(
      async (
        delegate: PublicKey,
        permissions: string[],
        { protocol: parsedProtocol, yes },
      ) => {
        await handleDelegatePermissions(
          "grant",
          delegate,
          parsedProtocol[0],
          parsedProtocol[1],
          permissions,
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
      validateProtocolName,
    )
    .argument("<permissions...>", "Permission names for the given protocol")
    .option("-y, --yes", "Skip confirmation prompt")
    .description("Revoke delegate permissions for a single protocol by name")
    .action(
      async (
        delegate: PublicKey,
        permissions: string[],
        { protocol: parsedProtocol, yes },
      ) => {
        await handleDelegatePermissions(
          "revoke",
          delegate,
          parsedProtocol[0],
          parsedProtocol[1],
          permissions,
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
