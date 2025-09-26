import { Command } from "commander";
import { CliContext, parseTxError } from "../utils";
import { BN } from "@coral-xyz/anchor";
import { CctpPolicy, publicKeyToEvmAddress } from "@glamsystems/glam-sdk";
import { evmAddressToPublicKey } from "@glamsystems/glam-sdk";
import { PublicKey } from "@solana/web3.js";

async function fetchCctpPolicy(
  context: CliContext,
): Promise<CctpPolicy | null> {
  const cctpProgramId = context.glamClient.extCctpProgram.programId;
  const cctpProtocolBitflag = 0b01;

  const stateAccount = await context.glamClient.fetchStateAccount();
  const cctpIntegrationPolicy = stateAccount.integrationAcls?.find(
    (acl) => acl.integrationProgram.toString() === cctpProgramId.toString(),
  );
  const cctpPolicyData = cctpIntegrationPolicy?.protocolPolicies?.find(
    (policy) => policy.protocolBitflag === cctpProtocolBitflag,
  )?.data;
  if (cctpPolicyData) {
    return CctpPolicy.decode(cctpPolicyData);
  }
  return null;
}

export function installCctpCommands(program: Command, context: CliContext) {
  // https://developers.circle.com/cctp/cctp-supported-blockchains#cctp-v2-supported-domains
  program
    .command("bridge-usdc")
    .argument("<amount>", "USDC amount to bridge", parseFloat)
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "EVM address")
    .option("--base58", "Address is a base58 string")
    .option("--fast", "Fast transfer", false)
    .description("Bridge USDC to an EVM chain")
    .action(async (amount, domain, destinationAddress, { base58, fast }) => {
      const recipientPubkey = base58
        ? new PublicKey(destinationAddress)
        : evmAddressToPublicKey(destinationAddress);

      const cctpPolicy = await fetchCctpPolicy(context);
      if (
        cctpPolicy &&
        !cctpPolicy.allowedDestinations.find(
          (d) => d.domain === domain && d.address.equals(recipientPubkey),
        )
      ) {
        console.error(
          `Destination (${domain}, ${destinationAddress}) not whitelisted`,
        );
        process.exit(1);
      }

      const amountBN = new BN(amount * 10 ** 6);

      // https://developers.circle.com/cctp/technical-guide#cctp-finality-thresholds
      const maxFee = amountBN.mul(new BN(1)).div(new BN(10 ** 4));
      const minFinalityThreshold = fast ? 1000 : 2000;

      try {
        const txSig = await context.glamClient.vault.bridgeUsdc(
          amountBN,
          domain,
          recipientPubkey,
          {
            maxFee,
            minFinalityThreshold,
          },
          context.txOptions,
        );
        console.log(`Deposit for burn:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("view-policy")
    .description("View CCTP policy")
    .action(async () => {
      const cctpPolicy = await fetchCctpPolicy(context);
      if (!cctpPolicy) {
        console.error("CCTP policy not found");
        process.exit(1);
      }
      console.log("CCTP allowed destinations:");
      for (const destination of cctpPolicy.allowedDestinations) {
        console.log(
          `\t${destination.domain}: ${publicKeyToEvmAddress(destination.address)}`,
        );
      }
    });

  program
    .command("add-destination")
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "Destination address")
    .option("--base58", "Address is a base58 string")
    .description("Whitelist a destination")
    .action(async (domain, destinationAddress, { base58 }) => {
      const recipientPubkey = base58
        ? new PublicKey(destinationAddress)
        : evmAddressToPublicKey(destinationAddress);

      const cctpPolicy = (await fetchCctpPolicy(context)) ?? new CctpPolicy([]);
      if (
        cctpPolicy.allowedDestinations.find(
          (d) => d.domain === domain && d.address.equals(recipientPubkey),
        )
      ) {
        console.error(
          `Destination address ${destinationAddress} already whitelisted`,
        );
        process.exit(1);
      }

      cctpPolicy.allowedDestinations.push({ domain, address: recipientPubkey });
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extCctpProgram.programId,
          0b01,
          cctpPolicy.encode(),
          context.txOptions,
        );
        console.log(`CCTP policy updated:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("delete-destination")
    .argument("<domain>", "CCTP domain", parseInt)
    .argument("<destination_address>", "Destination address")
    .option("--base58", "Address is a base58 string")
    .description("Remove a destination address from whitelist")
    .action(async (domain, destinationAddress, { base58 }) => {
      const recipientPubkey = base58
        ? new PublicKey(destinationAddress)
        : evmAddressToPublicKey(destinationAddress);

      const cctpPolicy = await fetchCctpPolicy(context);
      if (!cctpPolicy) {
        console.error(`CCTP policy not found`);
        process.exit(1);
      }
      cctpPolicy.allowedDestinations = cctpPolicy.allowedDestinations.filter(
        (d) => !(d.domain === domain && d.address.equals(recipientPubkey)),
      );
      try {
        const txSig = await context.glamClient.access.setProtocolPolicy(
          context.glamClient.extCctpProgram.programId,
          0b01,
          cctpPolicy.encode(),
          context.txOptions,
        );
        console.log(`CCTP policy updated:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });
}
