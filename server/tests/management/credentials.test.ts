import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EncryptedCredentialStore, type CredentialSecret } from "../../src/capabilities/management/credentials.js";

const binding = { ownerId: "local-admin", connectionId: "notes", resource: "https://notes.example/mcp", purpose: "authentication" };

test("credentials persist encrypted, expose safe summaries, and enforce owner/resource bindings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  const store = new EncryptedCredentialStore(root, { primary: key }, "primary");
  const secrets: CredentialSecret[] = [
    { kind: "static-headers", headers: { Authorization: "Bearer header-fixture-secret" } },
    { kind: "personal-access-token", token: "pat-fixture-secret" },
    { kind: "oauth-tokens", accessToken: "access-fixture-secret", refreshToken: "refresh-fixture-secret", expiresAt: "2026-12-01T00:00:00Z", scopes: ["read"] },
    { kind: "oauth-client", clientId: "client", clientSecret: "client-fixture-secret" },
  ];
  const ids = await Promise.all(secrets.map((secret) => store.put(binding, secret)));
  assert.ok(ids.every(value => /^credential_[a-f0-9-]+$/.test(value.id)));
  const saved = await readFile(join(root, "credentials.json"), "utf8");
  assert.equal(saved.includes("fixture-secret"), false);
  assert.equal((await stat(join(root, "credentials.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  const replacement = new EncryptedCredentialStore(root, { primary: key }, "primary");
  for (let i = 0; i < ids.length; i++) assert.deepEqual(await replacement.get(ids[i].id, binding), secrets[i]);
  assert.equal(JSON.stringify(await replacement.summary(ids[1].id, binding)).includes("pat-fixture-secret"), false);
  await assert.rejects(replacement.get(ids[0].id, { ...binding, ownerId: "other" }), /binding/);
  await assert.rejects(replacement.delete(ids[0].id, { ...binding, resource: "https://other.example/mcp" }), /binding/);
  await store.put(binding, { kind: "personal-access-token", token: "replacement" }, ids[1].id);
  assert.deepEqual(await store.get(ids[1].id, binding), { kind: "personal-access-token", token: "replacement" });
  await store.delete(ids[1].id, binding);
  assert.equal(await store.get(ids[1].id, binding), null);
  await assert.rejects(store.put(binding, secrets[1], "oauth_alias"), /does not exist/);
  await store.upsert("oauth_alias", binding, secrets[2]);
  await store.upsert("oauth_alias", binding, { ...secrets[2] as Extract<CredentialSecret, { kind: "oauth-tokens" }>, accessToken: "rotated-access" });
  await assert.rejects(store.upsert("oauth_alias", { ...binding, ownerId: "other" }, secrets[2]), /binding/);
});

test("wrong keys and ciphertext or binding tampering fail closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EncryptedCredentialStore(root, { original: randomBytes(32) }, "original");
  const { id } = await store.put(binding, { kind: "personal-access-token", token: "secret" });
  const wrong = new EncryptedCredentialStore(root, { original: randomBytes(32) }, "original");
  await assert.rejects(wrong.get(id, binding), /encrypted record/);
  const path = join(root, "credentials.json");
  const original = await readFile(path, "utf8");
  const tampered = JSON.parse(original);
  tampered.records[id].binding.ownerId = "another-owner";
  await writeFile(path, JSON.stringify(tampered));
  await assert.rejects(store.get(id, { ...binding, ownerId: "another-owner" }), /encrypted record/);
  const ciphertextTamper = JSON.parse(original);
  ciphertextTamper.records[id].ciphertext = Buffer.from("changed").toString("base64url");
  await writeFile(path, JSON.stringify(ciphertextTamper));
  await assert.rejects(store.get(id, binding), /encrypted record/);
});

test("rotation publishes all records together and leaves corrupted snapshots untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstKey = randomBytes(32), secondKey = randomBytes(32);
  const store = new EncryptedCredentialStore(root, { first: firstKey }, "first");
  const first = await store.put(binding, { kind: "personal-access-token", token: "one" });
  const second = await store.put(binding, { kind: "personal-access-token", token: "two" });
  const path = join(root, "credentials.json");
  const original = await readFile(path, "utf8");
  const corrupted = JSON.parse(original);
  corrupted.records[second.id].tag = randomBytes(16).toString("base64url");
  await writeFile(path, JSON.stringify(corrupted));
  const beforeFailedRotation = await readFile(path, "utf8");
  await assert.rejects(store.rotate("second", secondKey), /encrypted record/);
  assert.equal(await readFile(path, "utf8"), beforeFailedRotation);
  await writeFile(path, original);
  assert.deepEqual(await store.rotate("second", secondKey), { records: 2, keyId: "second" });
  const restarted = new EncryptedCredentialStore(root, { second: secondKey }, "second");
  assert.deepEqual(await restarted.get(first.id, binding), { kind: "personal-access-token", token: "one" });
  assert.deepEqual(await restarted.get(second.id, binding), { kind: "personal-access-token", token: "two" });
  await assert.rejects(store.rotate("second", firstKey), /different key/);
});

test("deployment key loader preserves legacy settings and offline rotation command works", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lab-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const oldKey = randomBytes(32), nextKey = randomBytes(32);
  assert.throws(() => EncryptedCredentialStore.fromEnvironment(root, {}), /Saved credentials require/);
  const store = EncryptedCredentialStore.fromEnvironment(root, { AGENTLAB_OAUTH_SECRET_KEY_HEX: oldKey.toString("hex") });
  const { id } = await store.put(binding, { kind: "personal-access-token", token: "offline-secret-fixture" });
  const ring = JSON.stringify({ primary: oldKey.toString("hex"), replacement: nextKey.toString("hex") });
  EncryptedCredentialStore.fromEnvironment(root, { AGENTLAB_CREDENTIAL_KEYRING_JSON: ring, AGENTLAB_CREDENTIAL_KEY_HEX: oldKey.toString("hex") });
  assert.throws(() => EncryptedCredentialStore.fromEnvironment(root, { AGENTLAB_CREDENTIAL_KEYRING_JSON: ring, AGENTLAB_CREDENTIAL_KEY_HEX: nextKey.toString("hex") }), /settings are invalid/);
  const commandExtension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const imports = commandExtension === ".ts" ? ["--import", import.meta.resolve("tsx")] : [];
  const result = await promisify(execFile)(process.execPath, [...imports, fileURLToPath(new URL(`../../src/capabilities/management/rotate-credentials${commandExtension}`, import.meta.url)), root, "replacement"], {
    env: { ...process.env, AGENTLAB_CREDENTIAL_KEYRING_JSON: ring, AGENTLAB_CREDENTIAL_KEY_ID: "primary", AGENTLAB_CREDENTIAL_KEY_HEX: undefined, AGENTLAB_OAUTH_SECRET_KEY_HEX: undefined },
  });
  assert.match(result.stdout, /completed for 1 records/);
  assert.equal(result.stdout.includes("offline-secret-fixture"), false);
  assert.equal(result.stdout.includes(nextKey.toString("hex")), false);
  const replacement = new EncryptedCredentialStore(root, { replacement: nextKey }, "replacement");
  assert.deepEqual(await replacement.get(id, binding), { kind: "personal-access-token", token: "offline-secret-fixture" });
});

test("exclusive owner reconciliation atomically removes orphans and retains current references", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-credential-reconciliation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EncryptedCredentialStore(root, { current: randomBytes(32) }, "current");
  const retained = await store.put(binding, { kind: "personal-access-token", token: "active-token" });
  const orphan = await store.put(binding, { kind: "personal-access-token", token: "staged-orphan" });
  const path = join(root, "credentials.json"), original = await readFile(path, "utf8");
  await assert.rejects(store.reconcileReferences(new Set(["../unsafe"])), /identifier/);
  assert.equal(await readFile(path, "utf8"), original);
  assert.deepEqual(await store.reconcileReferences(new Set([retained.id])), { removed: 1 });
  assert.deepEqual(await store.get(retained.id, binding), { kind: "personal-access-token", token: "active-token" });
  assert.equal(await store.get(orphan.id, binding), null);
  assert.deepEqual(await store.reconcileReferences(new Set([retained.id])), { removed: 0 });
});
