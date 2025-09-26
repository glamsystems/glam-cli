import { Command } from "commander";
import { CliContext, parseTxError } from "../utils";
import { BN } from "@coral-xyz/anchor";
import { CctpPolicy } from "anchor/src/deser/integrationPolicies";

async function fetchCctpPolicyData(context: CliContext) {
  const cctpProgramId = context.glamClient.extCctpProgram.programId;
  const cctpProtocolBitflag = 0b01;

  const stateAccount = await context.glamClient.fetchStateAccount();
  const cctpIntegrationPolicy = stateAccount.integrationAcls?.find(
    (acl) => acl.integrationProgram.toString() === cctpProgramId.toString(),
  );
  const cctpPolicyData = cctpIntegrationPolicy?.protocolPolicies?.find(
    (policy) => policy.protocolBitflag === cctpProtocolBitflag,
  )?.data;
  return cctpPolicyData;
}

export function installCctpCommands(program: Command, context: CliContext) {
  program
    .command("bridge-usdc")
    .argument("<amount>", "USDC amount to bridge", parseFloat)
    .argument("<domain>", "CCTP domain", parseInt)
    .description("Bridge USDC to an EVM chain")
    .action(async (amount, domain) => {
      const cctpPolicyData = await fetchCctpPolicyData(context);
      const cctpPolicy = cctpPolicyData
        ? CctpPolicy.decode(cctpPolicyData)
        : new CctpPolicy([], []);
      console.log("cctpPolicy:", cctpPolicy);

      if (!cctpPolicy.destDomains.includes(domain)) {
        console.error(`Domain ${domain} not whitelisted`);
        process.exit(1);
      }

      const amountBN = new BN(amount * 10 ** 6);

      try {
        const txSig = await context.glamClient.vault.bridgeUsdc(
          amountBN,
          context.txOptions,
        );
        console.log(`Deposit for burn:`, txSig);
      } catch (e) {
        console.error(parseTxError(e));
        process.exit(1);
      }
    });

  program
    .command("add-domain")
    .argument("<domain>", "CCTP domain", parseInt)
    .description("Whitelist a CCTP domain")
    .action(async (domain) => {
      const cctpPolicyData = await fetchCctpPolicyData(context);
      const cctpPolicy = cctpPolicyData
        ? CctpPolicy.decode(cctpPolicyData)
        : new CctpPolicy([], []);
      if (cctpPolicy.destDomains.includes(domain)) {
        console.error(`Domain ${domain} already whitelisted`);
        process.exit(1);
      }
      cctpPolicy.destDomains.push(domain);
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
    .command("add-address")
    .argument("<address>", "Destination address")
    .description("Whitelist a destination address")
    .action(async (address) => {
      const cctpPolicyData = await fetchCctpPolicyData(context);
      const cctpPolicy = cctpPolicyData
        ? CctpPolicy.decode(cctpPolicyData)
        : new CctpPolicy([], []);
      if (cctpPolicy.destAddresses.includes(address)) {
        console.error(`Destination address ${address} already whitelisted`);
        process.exit(1);
      }
      cctpPolicy.destAddresses.push(address);
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
