import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CredentialBinding {
  readonly ownerId: string;
  readonly connectionId: string;
  readonly resource: string;
  readonly purpose: string;
}

export type CredentialSecret =
  | { readonly kind: "static-headers"; readonly headers: Readonly<Record<string, string>> }
  | { readonly kind: "personal-access-token"; readonly token: string; readonly expiresAt?: string; readonly expirySource?: "user" | "provider" }
  | { readonly kind: "oauth-tokens"; readonly accessToken: string; readonly refreshToken: string | null; readonly expiresAt: string; readonly scopes: readonly string[] }
  | { readonly kind: "oauth-client"; readonly clientId: string; readonly clientSecret: string };

export interface CredentialSummary {
  readonly id: string;
  readonly kind: CredentialSecret["kind"];
  readonly present: true;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
  readonly expirySource: "user" | "provider" | null;
}

interface Envelope {
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  id: string;
  keyId: string;
  kind: CredentialSecret["kind"];
  binding: CredentialBinding;
  iv: string;
  tag: string;
  ciphertext: string;
}
interface Payload { secret: CredentialSecret; updatedAt: string }
interface Snapshot { schemaVersion: 1; records: Record<string, Envelope> }
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 2048;

/**
 * Deployment-owned credential storage. Callers must authorize access before
 * supplying the owner/connection/resource binding. Returned secrets stay in the
 * backend; use summary() for browser responses. Keys are never saved here.
 *
 * One backend owns this directory. Mutations serialize within this instance;
 * multiple processes must use a shared transactional secret service instead.
 * Rotation validates and encrypts every record before one atomic snapshot swap.
 * Retain old deployment keys until the swap succeeds and backups are handled.
 */
export class EncryptedCredentialStore {
  private readonly keys = new Map<string, Buffer>();
  private currentKeyId: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string, keyring: Readonly<Record<string, Buffer | Uint8Array>>, currentKeyId: string) {
    for (const [id, key] of Object.entries(keyring)) this.keys.set(validId(id), validKey(key));
    if (!this.keys.has(currentKeyId)) throw new Error("Credential current key is missing from the deployment keyring.");
    this.currentKeyId = currentKeyId;
  }

  /** Accept the legacy deployment key while credentials migrate to generic settings. */
  static fromEnvironment(root: string, environment: NodeJS.ProcessEnv = process.env): EncryptedCredentialStore {
    const currentKeyId = environment.AGENTLAB_CREDENTIAL_KEY_ID?.trim() || "primary";
    const keyring: Record<string, Buffer> = Object.create(null);
    try {
      if (environment.AGENTLAB_CREDENTIAL_KEYRING_JSON) {
        const parsed: unknown = JSON.parse(environment.AGENTLAB_CREDENTIAL_KEYRING_JSON);
        if (!object(parsed)) throw new Error();
        for (const [id, encoded] of Object.entries(parsed)) {
          if (typeof encoded !== "string" || !/^[a-fA-F0-9]{64}$/.test(encoded)) throw new Error();
          validId(id);
          Object.defineProperty(keyring, id, { value: Buffer.from(encoded, "hex"), enumerable: true, configurable: true });
        }
      }
      const single = environment.AGENTLAB_CREDENTIAL_KEY_HEX ?? environment.AGENTLAB_OAUTH_SECRET_KEY_HEX;
      if (single) {
        if (!/^[a-fA-F0-9]{64}$/.test(single)) throw new Error();
        const key = Buffer.from(single, "hex");
        if (keyring[currentKeyId] && !keyring[currentKeyId].equals(key)) throw new Error();
        Object.defineProperty(keyring, currentKeyId, { value: key, enumerable: true, configurable: true });
      }
    } catch { throw new Error("Credential key settings are invalid. Supply 32-byte hexadecimal keys with unique key IDs."); }
    if (!Object.keys(keyring).length) throw new Error("Saved credentials require AGENTLAB_CREDENTIAL_KEY_HEX or AGENTLAB_CREDENTIAL_KEYRING_JSON, supplied separately from stored records.");
    return new EncryptedCredentialStore(root, keyring, currentKeyId);
  }

  async get(id: string, binding: CredentialBinding): Promise<CredentialSecret | null> {
    await this.queue;
    const records = (await this.readSnapshot()).records;
    const record = Object.hasOwn(records, validId(id)) ? records[id] : undefined;
    return record ? this.decrypt(record, binding).secret : null;
  }

  async summary(id: string, binding: CredentialBinding): Promise<CredentialSummary | null> {
    await this.queue;
    const records = (await this.readSnapshot()).records;
    const record = Object.hasOwn(records, validId(id)) ? records[id] : undefined;
    return record ? summarize(id, this.decrypt(record, binding)) : null;
  }

  /** Supplying an existing ID replaces only a record with the same binding. */
  async put(binding: CredentialBinding, secret: CredentialSecret, existingId?: string): Promise<CredentialSummary> {
    return this.persist(binding, secret, existingId, false);
  }

  /** Backend-owned stable aliases support OAuth refresh without changing connection metadata. */
  async upsert(id: string, binding: CredentialBinding, secret: CredentialSecret): Promise<CredentialSummary> {
    validId(id);
    return this.persist(binding, secret, id, true);
  }

  private async persist(binding: CredentialBinding, secret: CredentialSecret, existingId: string | undefined, allowCreate: boolean): Promise<CredentialSummary> {
    validateBinding(binding);
    validateSecret(secret);
    const copy = JSON.parse(JSON.stringify(secret)) as CredentialSecret;
    const boundCopy = { ...binding };
    return this.mutate(async () => {
      const snapshot = await this.readSnapshot();
      const id = existingId ? validId(existingId) : "credential_" + randomUUID();
      if (existingId) {
        const previous = Object.hasOwn(snapshot.records, id) ? snapshot.records[id] : undefined;
        if (!previous && !allowCreate) throw new Error("Credential to replace does not exist.");
        if (previous) this.decrypt(previous, boundCopy);
        else if (Object.keys(snapshot.records).length >= MAX_RECORDS) throw new Error("Credential store record limit reached.");
      } else if (Object.keys(snapshot.records).length >= MAX_RECORDS) throw new Error("Credential store record limit reached.");
      const payload = { secret: copy, updatedAt: new Date().toISOString() };
      snapshot.records[id] = this.encrypt(id, boundCopy, payload, this.currentKeyId);
      await this.publish(snapshot);
      return summarize(id, payload);
    });
  }

  async delete(id: string, binding: CredentialBinding): Promise<void> {
    validId(id);
    validateBinding(binding);
    await this.mutate(async () => {
      const snapshot = await this.readSnapshot();
      const record = Object.hasOwn(snapshot.records, id) ? snapshot.records[id] : undefined;
      if (!record) return;
      this.decrypt(record, binding);
      delete snapshot.records[id];
      await this.publish(snapshot);
    });
  }

  /**
   * Exclusive management owner supplies references from its published registry.
   * Orphaned staged/replaced grants are removed in one snapshot publication.
   * Historical run metadata intentionally does not keep credentials alive.
   */
  async reconcileReferences(referencedIds: ReadonlySet<string>): Promise<{ removed: number }> {
    if (referencedIds.size > 8192) throw new Error("Credential reference limit exceeded.");
    const references = new Set([...referencedIds].map(validId));
    return this.mutate(async () => {
      const snapshot = await this.readSnapshot();
      let removed = 0;
      for (const id of Object.keys(snapshot.records)) {
        if (!references.has(id)) { delete snapshot.records[id]; removed++; }
      }
      if (removed) await this.publish(snapshot);
      return { removed };
    });
  }

  /** Old keys remain available; removal is an explicit deployment operation. */
  async rotate(nextKeyId: string, nextKey?: Buffer | Uint8Array): Promise<{ records: number; keyId: string }> {
    validId(nextKeyId);
    const supplied = nextKey ? validKey(nextKey) : undefined;
    return this.mutate(async () => {
      const existing = this.keys.get(nextKeyId);
      if (existing && supplied && !existing.equals(supplied)) throw new Error("Credential key ID already identifies a different key.");
      if (!existing && !supplied) throw new Error("Credential rotation key is missing from the deployment keyring.");
      const original = await this.readSnapshot();
      // Decrypt all records before staging anything. Corruption cannot rotate a subset.
      const payloads = Object.values(original.records).map((record) => ({ record, payload: this.decrypt(record, record.binding) }));
      if (supplied && !existing) this.keys.set(nextKeyId, supplied);
      try {
        const staged: Snapshot = { schemaVersion: 1, records: {} };
        for (const { record, payload } of payloads) staged.records[record.id] = this.encrypt(record.id, record.binding, payload, nextKeyId);
        await this.publish(staged);
        this.currentKeyId = nextKeyId;
        return { records: payloads.length, keyId: nextKeyId };
      } catch (error) {
        if (!existing) this.keys.delete(nextKeyId);
        throw error;
      }
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readSnapshot(): Promise<Snapshot> {
    let encoded: string;
    try { encoded = await readFile(join(this.root, "credentials.json"), "utf8"); }
    catch (error) {
      if (isMissing(error)) return { schemaVersion: 1, records: {} };
      throw new Error("Credential store could not read its records.");
    }
    try {
      if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error();
      const value: unknown = JSON.parse(encoded);
      if (!object(value) || value.schemaVersion !== 1 || !object(value.records) || Object.keys(value.records).length > MAX_RECORDS) throw new Error();
      for (const [id, entry] of Object.entries(value.records)) {
        validId(id);
        if (!object(entry) || entry.id !== id || entry.schemaVersion !== 1 || entry.algorithm !== "aes-256-gcm"
          || typeof entry.keyId !== "string" || typeof entry.kind !== "string"
          || typeof entry.iv !== "string" || typeof entry.tag !== "string" || typeof entry.ciphertext !== "string") throw new Error();
        validId(entry.keyId);
        validateBinding(entry.binding as CredentialBinding);
      }
      return value as unknown as Snapshot;
    } catch { throw new Error("Credential store contains invalid records."); }
  }

  private encrypt(id: string, binding: CredentialBinding, payload: Payload, keyId: string): Envelope {
    const iv = randomBytes(12);
    const record: Envelope = { schemaVersion: 1, algorithm: "aes-256-gcm", id, keyId, kind: payload.secret.kind, binding,
      iv: iv.toString("base64url"), tag: "", ciphertext: "" };
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(keyId)!, iv);
    cipher.setAAD(aad(record));
    record.ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64url");
    record.tag = cipher.getAuthTag().toString("base64url");
    return record;
  }

  private decrypt(record: Envelope, expected: CredentialBinding): Payload {
    try {
      validateBinding(expected);
      if (bindingKey(record.binding) !== bindingKey(expected)) throw new Error();
      const key = this.keys.get(record.keyId);
      if (!key) throw new Error();
      const iv = Buffer.from(record.iv, "base64url"), tag = Buffer.from(record.tag, "base64url");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad(record));
      decipher.setAuthTag(tag);
      const payload: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64url")), decipher.final()]).toString("utf8"));
      if (!object(payload) || typeof payload.updatedAt !== "string" || !Number.isFinite(Date.parse(payload.updatedAt))) throw new Error();
      validateSecret(payload.secret as CredentialSecret);
      if ((payload.secret as CredentialSecret).kind !== record.kind) throw new Error();
      return payload as unknown as Payload;
    } catch { throw new Error("Credential binding, key or encrypted record is invalid."); }
  }

  private async publish(snapshot: Snapshot): Promise<void> {
    const encoded = JSON.stringify(snapshot) + "\n";
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error("Credential store size limit reached.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    const temporary = join(this.root, `.credentials-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, join(this.root, "credentials.json"));
    } finally { await unlink(temporary).catch(() => undefined); }
  }
}

function bindingKey(binding: CredentialBinding): string { return JSON.stringify([binding.ownerId, binding.connectionId, binding.resource, binding.purpose]); }
function aad(record: Envelope): Buffer { return Buffer.from(JSON.stringify([record.schemaVersion, record.algorithm, record.id, record.keyId, record.kind, bindingKey(record.binding)])); }
function validId(id: string): string { if (!SAFE_ID.test(id)) throw new Error("Credential identifier is invalid."); return id; }
function validKey(key: Buffer | Uint8Array): Buffer { const copy = Buffer.from(key); if (copy.length !== 32) throw new Error("Credential key must contain exactly 32 bytes."); return copy; }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function bounded(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 16_384 && !value.includes("\0"); }
function validateBinding(binding: CredentialBinding): void {
  if (!object(binding) || ![binding.ownerId, binding.connectionId, binding.resource, binding.purpose].every(bounded)) throw new Error("Credential binding is invalid.");
}
function validateSecret(secret: CredentialSecret): void {
  let valid = false;
  if (object(secret)) switch (secret.kind) {
    case "static-headers": valid = object(secret.headers) && Object.keys(secret.headers).length > 0 && Object.keys(secret.headers).length <= 32
      && Object.entries(secret.headers).every(([name, value]) => /^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/.test(name) && bounded(value) && !/[\r\n]/.test(value)); break;
    case "personal-access-token": valid = bounded(secret.token) && (secret.expiresAt === undefined || (bounded(secret.expiresAt) && Number.isFinite(Date.parse(secret.expiresAt))))
      && (secret.expirySource === undefined || secret.expirySource === "user" || secret.expirySource === "provider")
      && ((secret.expiresAt === undefined) === (secret.expirySource === undefined)); break;
    case "oauth-tokens": valid = bounded(secret.accessToken) && (secret.refreshToken === null || bounded(secret.refreshToken))
      && bounded(secret.expiresAt) && Number.isFinite(Date.parse(secret.expiresAt)) && Array.isArray(secret.scopes) && secret.scopes.length <= 128 && secret.scopes.every(bounded); break;
    case "oauth-client": valid = bounded(secret.clientId) && bounded(secret.clientSecret); break;
  }
  if (!valid || Buffer.byteLength(JSON.stringify(secret)) > 64 * 1024) throw new Error("Credential payload is invalid or exceeds its limit.");
}
function summarize(id: string, payload: Payload): CredentialSummary {
  const secret = payload.secret;
  return { id, kind: secret.kind, present: true, updatedAt: payload.updatedAt,
    expiresAt: secret.kind === "oauth-tokens" ? secret.expiresAt : secret.kind === "personal-access-token" ? secret.expiresAt ?? null : null,
    expirySource: secret.kind === "oauth-tokens" ? "provider" : secret.kind === "personal-access-token" ? secret.expirySource ?? null : null };
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
