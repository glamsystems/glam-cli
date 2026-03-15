import { Command } from "commander";
import {
  CliContext,
  executeTxWithErrorHandling,
  validatePublicKey,
} from "../utils";
import {
  isTokenAclEnabled,
  fetchMintAndTokenProgram,
  getTokenAclMintConfigPda,
  getTokenAclGateListConfigPda,
  getTokenAclGateWalletEntryPda,
} from "@glamsystems/glam-sdk";

function parseSeed(seedStr: string): Buffer {
  const seed = Buffer.alloc(32);
  Buffer.from(seedStr).copy(seed);
  return seed;
}

function parseMode(modeStr: string): number {
  switch (modeStr.toLowerCase()) {
    case "allow":
      return 0;
    case "block":
      return 1;
    case "allow-all-eoas":
      return 2;
    default:
      console.error(
        `Invalid mode: ${modeStr}. Allowed values: allow, block, allow-all-eoas`,
      );
      process.exit(1);
  }
}

export function installTokenAclCommands(
  tokenAcl: Command,
  context: CliContext,
) {
  tokenAcl
    .command("status")
    .description("Show Token ACL status for the current mint")
    .action(async () => {
      const { glamClient } = context;
      const mintPda = glamClient.mintPda;
      const enabled = await isTokenAclEnabled(glamClient.connection, mintPda);
      const { mint } = await fetchMintAndTokenProgram(
        glamClient.connection,
        mintPda,
      );
      const mintConfigPda = getTokenAclMintConfigPda(mintPda);

      console.log("Mint:", mintPda.toBase58());
      console.log("Token ACL enabled:", enabled);
      console.log(
        "Freeze authority:",
        mint.freezeAuthority?.toBase58() ?? "none",
      );
      console.log("MintConfig PDA:", mintConfigPda.toBase58());
    });

  tokenAcl
    .command("enable")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Enable Token ACL (sRFC-37) on the current mint")
    .action(async (options) => {
      const { glamClient, txOptions } = context;
      await executeTxWithErrorHandling(
        () =>
          glamClient.mint.enableTokenAcl(
            undefined,
            txOptions,
          ),
        {
          skip: options?.yes,
          message:
            "Enable Token ACL? This transfers freeze authority to the Token ACL program.",
        },
        (txSig) => `Token ACL enabled: ${txSig}`,
      );
    });

  tokenAcl
    .command("create-allowlist")
    .argument("<seed>", "Seed string for the allowlist (max 32 bytes)")
    .option("--mode <mode>", "List mode: allow, block, allow-all-eoas", "allow")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Create a Token ACL allowlist")
    .action(async (seedStr, options) => {
      const { glamClient, txOptions } = context;
      const seed = parseSeed(seedStr);
      const mode = parseMode(options.mode);
      const listConfigPda = getTokenAclGateListConfigPda(
        glamClient.mintPda,
        seed,
      );

      await executeTxWithErrorHandling(
        () => glamClient.mint.aclGateCreateList(seed, mode, txOptions),
        {
          skip: options?.yes,
          message: `Create ${options.mode} list "${seedStr}"? ListConfig PDA: ${listConfigPda.toBase58()}`,
        },
        (txSig) =>
          `Allowlist created: ${txSig}\nListConfig PDA: ${listConfigPda.toBase58()}`,
      );
    });

  tokenAcl
    .command("add-wallet")
    .argument("<wallet>", "Wallet public key to add", validatePublicKey)
    .requiredOption("--seed <seed>", "Seed string of the allowlist")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Add a wallet to a Token ACL allowlist")
    .action(async (wallet, options) => {
      const { glamClient, txOptions } = context;
      const seed = parseSeed(options.seed);
      const listConfigPda = getTokenAclGateListConfigPda(
        glamClient.mintPda,
        seed,
      );

      await executeTxWithErrorHandling(
        () =>
          glamClient.mint.aclGateAddWallet(listConfigPda, wallet, txOptions),
        {
          skip: options?.yes,
          message: `Add wallet ${wallet.toBase58()} to allowlist "${options.seed}"?`,
        },
        (txSig) => `Wallet added: ${txSig}`,
      );
    });

  tokenAcl
    .command("setup-gate")
    .requiredOption(
      "--seed <seeds...>",
      "Seed string(s) of the allowlist(s) to use for gating",
    )
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Setup gate extra metas for permissionless thaw")
    .action(async (options) => {
      const { glamClient, txOptions } = context;
      const listConfigs = options.seed.map((seedStr: string) =>
        getTokenAclGateListConfigPda(glamClient.mintPda, parseSeed(seedStr)),
      );

      await executeTxWithErrorHandling(
        () =>
          glamClient.mint.aclGateSetupExtraMetas(listConfigs, txOptions),
        {
          skip: options?.yes,
          message: `Setup gate extra metas with ${listConfigs.length} list config(s)?`,
        },
        (txSig) => `Gate extra metas configured: ${txSig}`,
      );
    });

  tokenAcl
    .command("thaw")
    .argument("<wallet>", "Wallet to thaw", validatePublicKey)
    .requiredOption("--seed <seed>", "Seed string of the allowlist")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Permissionless thaw for an allowlisted wallet")
    .action(async (wallet, options) => {
      const { glamClient, txOptions } = context;
      const seed = parseSeed(options.seed);
      const listConfigPda = getTokenAclGateListConfigPda(
        glamClient.mintPda,
        seed,
      );
      const walletEntryPda = getTokenAclGateWalletEntryPda(
        listConfigPda,
        wallet,
      );

      await executeTxWithErrorHandling(
        () =>
          glamClient.mint.thawPermissionless(
            wallet,
            [{ listConfig: listConfigPda, walletEntry: walletEntryPda }],
            txOptions,
          ),
        {
          skip: options?.yes,
          message: `Thaw token account for wallet ${wallet.toBase58()}?`,
        },
        (txSig) => `Token account thawed: ${txSig}`,
      );
    });
}
