import { resolve } from "node:path";
import { EncryptedCredentialStore } from "./credentials.js";

/** Offline maintenance command. Key values arrive through deployment environment only. */
async function main(): Promise<void> {
  const [root, nextKeyId, ...extra] = process.argv.slice(2);
  if (!root || !nextKeyId || extra.length) {
    throw new Error("Usage: tsx src/capabilities/management/rotate-credentials.ts <credential-directory> <next-key-id>. Stop the API before rotation and supply keys through the deployment environment.");
  }
  const store = EncryptedCredentialStore.fromEnvironment(resolve(root));
  const result = await store.rotate(nextKeyId);
  process.stdout.write(`Credential rotation completed for ${result.records} records. Configure the deployment current key ID to the new key before restarting.\n`);
}

main().catch((error: unknown) => {
  // Never include an arbitrary library/provider exception in maintenance output.
  const safeMessages = /^(Usage:|Saved credentials require |Credential )/;
  const message = error instanceof Error && safeMessages.test(error.message)
    ? error.message : "Credential rotation failed. The previously published snapshot remains authoritative; retain the old key and inspect deployment permissions.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
