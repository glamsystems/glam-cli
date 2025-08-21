import { PublicKey } from "@solana/web3.js";
import { GlamClient } from "@glamsystems/glam-sdk";

export const idlCheck = async (glamClient: GlamClient) => {
  // Fetch anchor idl and parse it
  const base = PublicKey.findProgramAddressSync(
    [],
    glamClient.protocolProgram.programId,
  )[0];
  const idlPda = await PublicKey.createWithSeed(
    base,
    "anchor:idl",
    glamClient.protocolProgram.programId,
  );

  const idlAccountInfo =
    await glamClient.provider.connection.getAccountInfo(idlPda);
  if (idlAccountInfo) {
    const dataLength = idlAccountInfo.data.readUInt32LE(40);
    const compressedData = idlAccountInfo.data.subarray(44, 44 + dataLength);

    const zlib = await import("zlib");
    const decompressedData = zlib.inflateSync(compressedData);
    const idlString = decompressedData.toString("utf8");
    const idlJson = JSON.parse(idlString);

    const onchainIdlVersion = idlJson.metadata.version;
    const cliIdlVersion = glamClient.protocolProgram.idl.metadata.version;

    if (cliIdlVersion < onchainIdlVersion) {
      console.warn(
        "CLI is using an older version of the GLAM Protocol IDL. If you experience issues, please update the CLI to the latest version.",
      );
    }
  }
};
