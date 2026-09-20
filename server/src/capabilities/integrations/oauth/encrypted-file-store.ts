import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OAuthTokenSet, SecretStore } from "./flow.js";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const MAX_RECORD_BYTES = 64 * 1024;
const REF_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

interface EncryptedSecretRecord {
  readonly schemaVersion: 1;
  readonly algorithm: typeof ALGORITHM;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

/**
 * Small encrypted file-backed store for local/server deployments.
 *
 * The encryption key is supplied by the deployment and is never written to
 * this store. This class is intentionally a SecretStore boundary: OAuth
 * lifecycle code can persist tokens without placing them in manifests,
 * evidence, logs, or browser state. Hosted deployments should replace it
 * with their managed secret store rather than sharing a filesystem key.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private readonly key: Buffer;

  constructor(private readonly rootDirectory: string, key: Buffer | Uint8Array | string) {
    this.key = normalizeKey(key);
  }

  static fromEnvironment(rootDirectory: string, environment: NodeJS.ProcessEnv = process.env): EncryptedFileSecretStore {
    const encoded = environment.AGENTLAB_OAUTH_SECRET_KEY_HEX?.trim();
    if (!encoded) throw new Error("AGENTLAB_OAUTH_SECRET_KEY_HEX is required for the encrypted OAuth secret store.");
    if (!/^[0-9a-fA-F]{64}$/.test(encoded)) throw new Error("AGENTLAB_OAUTH_SECRET_KEY_HEX must contain exactly 32 bytes encoded as hex.");
    return new EncryptedFileSecretStore(rootDirectory, Buffer.from(encoded, "hex"));
  }

  async read(ref: string): Promise<OAuthTokenSet | null> {
    const path = this.pathFor(ref);
    let encoded: string;
    try {
      encoded = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new Error("OAuth secret store could not read the configured connection.");
    }
    if (Buffer.byteLength(encoded, "utf8") > MAX_RECORD_BYTES) {
      throw new Error("OAuth secret record exceeds the configured limit.");
    }
    try {
      const record = parseRecord(JSON.parse(encoded));
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(record.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return parseTokenSet(JSON.parse(plaintext));
    } catch {
      throw new Error("OAuth secret record is invalid or could not be decrypted.");
    }
  }

  async write(ref: string, tokens: OAuthTokenSet): Promise<void> {
    const path = this.pathFor(ref);
    validateTokenSet(tokens);
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.rootDirectory, 0o700);

    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(tokens), "utf8"),
      cipher.final(),
    ]);
    const record: EncryptedSecretRecord = {
      schemaVersion: 1,
      algorithm: ALGORITHM,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    const encoded = `${JSON.stringify(record)}\n`;
    const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporaryPath, encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async delete(ref: string): Promise<void> {
    const path = this.pathFor(ref);
    await unlink(path).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw new Error("OAuth secret store could not remove the configured connection.");
    });
  }

  private pathFor(ref: string): string {
    if (!REF_PATTERN.test(ref)) throw new Error("OAuth secret reference is unsafe.");
    return join(this.rootDirectory, `${ref}.json`);
  }
}

function normalizeKey(key: Buffer | Uint8Array | string): Buffer {
  const value = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (value.byteLength !== KEY_BYTES) throw new Error("OAuth secret store key must contain exactly 32 bytes.");
  return value;
}

function parseRecord(value: unknown): EncryptedSecretRecord {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.algorithm !== ALGORITHM
    || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string") {
    throw new Error("Invalid encrypted OAuth secret record.");
  }
  return value as unknown as EncryptedSecretRecord;
}

function parseTokenSet(value: unknown): OAuthTokenSet {
  if (!isRecord(value) || typeof value.accessToken !== "string" || (value.refreshToken !== null && typeof value.refreshToken !== "string")
    || typeof value.expiresAt !== "string" || !Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === "string")) {
    throw new Error("Invalid OAuth token set.");
  }
  const tokens: OAuthTokenSet = {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken as string | null,
    expiresAt: value.expiresAt,
    scopes: value.scopes as string[],
  };
  validateTokenSet(tokens);
  return tokens;
}

function validateTokenSet(tokens: OAuthTokenSet): void {
  if (tokens.accessToken.length === 0 || tokens.accessToken.length > 16_384
    || (tokens.refreshToken !== null && (tokens.refreshToken.length === 0 || tokens.refreshToken.length > 16_384))
    || !Number.isFinite(Date.parse(tokens.expiresAt)) || tokens.scopes.length > 128
    || tokens.scopes.some((scope) => scope.length === 0 || scope.length > 256)) {
    throw new Error("OAuth token set is invalid or unbounded.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
