import type { Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { createRequire } from "module";
import path from "path";

export const DEFAULT_DERIVATION_PATH = "44'/501'/0'";

function parseDerivationPath(path: string): number[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment.replace(/'$/, ""), 10));
}

export function isValidLedgerDerivationPath(path: string): boolean {
  const segments = parseDerivationPath(path);
  if (
    (segments.length !== 3 && segments.length !== 4) ||
    segments.some((n) => Number.isNaN(n))
  ) {
    return false;
  }
  return true;
}

function loadLedgerDependencies(): {
  SolanaApp: any;
  TransportNodeHid: any;
} {
  try {
    return {
      SolanaApp: requireLedgerPackage("@ledgerhq/hw-app-solana").default,
      TransportNodeHid: requireLedgerPackage("@ledgerhq/hw-transport-node-hid")
        .default,
    };
  } catch {
    throw new Error(
      "Ledger dependencies are missing. Install @ledgerhq/hw-transport-node-hid and @ledgerhq/hw-app-solana to use usb://ledger.",
    );
  }
}

function requireLedgerPackage(packageName: string): any {
  const requireFrom = [
    path.join(__dirname, "package.json"),
    path.join(__dirname, "..", "package.json"),
    path.join(process.cwd(), "cli", "package.json"),
  ];

  for (const packageJsonPath of requireFrom) {
    try {
      return createRequire(packageJsonPath)(packageName);
    } catch {
      // Try the next package root.
    }
  }

  throw new Error(`Cannot find ${packageName}`);
}

export function normalizeLedgerError(error: any): Error {
  if (error?.statusText === "LOCKED_DEVICE" || error?.statusCode === 0x5515) {
    return new Error(
      "Ledger device is locked. Unlock it, open the Solana app, and retry.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export class LedgerWallet implements Wallet {
  private readonly derivationPath: string;
  private transport?: any;
  private app?: any;
  private cachedPk?: PublicKey;

  constructor(derivationPath: string = DEFAULT_DERIVATION_PATH) {
    if (!isValidLedgerDerivationPath(derivationPath)) {
      throw new Error(
        `Invalid Ledger derivation path: ${derivationPath}. Expected format like ${DEFAULT_DERIVATION_PATH}`,
      );
    }
    this.derivationPath = derivationPath;
  }

  get payer(): Keypair {
    throw new Error("Payer is not available for Ledger wallet.");
  }

  private async getApp(): Promise<any> {
    if (this.app) {
      return this.app;
    }

    const { SolanaApp, TransportNodeHid } = loadLedgerDependencies();
    this.transport = await TransportNodeHid.create();
    this.app = new SolanaApp(this.transport);
    return this.app;
  }

  private async getLedgerPubkey(): Promise<PublicKey> {
    if (this.cachedPk) {
      return this.cachedPk;
    }

    try {
      const app = await this.getApp();
      const response = await app.getAddress(this.derivationPath, false);
      this.cachedPk = new PublicKey(Buffer.from(response.address));
      return this.cachedPk;
    } catch (error) {
      throw normalizeLedgerError(error);
    }
  }

  get publicKey(): PublicKey {
    if (!this.cachedPk) {
      throw new Error(
        "Ledger public key not initialized yet. Please run a command that initializes the wallet first.",
      );
    }
    return this.cachedPk;
  }

  async connect(): Promise<void> {
    await this.getLedgerPubkey();
  }

  async disconnect(): Promise<void> {
    await this.transport?.close();
    this.transport = undefined;
    this.app = undefined;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const app = await this.getApp();
    await this.getLedgerPubkey();

    const serialized =
      tx instanceof VersionedTransaction
        ? tx.message.serialize()
        : tx.serializeMessage();

    let response: any;
    try {
      response = await app.signTransaction(
        this.derivationPath,
        Buffer.from(serialized),
      );
    } catch (error) {
      throw normalizeLedgerError(error);
    }

    const sig = Buffer.from(response.signature);
    if (tx instanceof VersionedTransaction) {
      tx.addSignature(this.publicKey, sig);
    } else {
      tx.addSignature(this.publicKey, sig);
    }

    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    const result: T[] = [];
    for (const tx of txs) {
      result.push(await this.signTransaction(tx));
    }
    return result;
  }
}
