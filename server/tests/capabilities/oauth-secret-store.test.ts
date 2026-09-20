import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { EncryptedFileSecretStore } from "../../src/capabilities/integrations/oauth/encrypted-file-store.js";

test("encrypted OAuth secret store survives process replacement without plaintext tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-oauth-secrets-"));
  const key = randomBytes(32);
  const tokens = {
    accessToken: "fixture-access-secret",
    refreshToken: "fixture-refresh-secret",
    expiresAt: "2026-09-20T12:00:00.000Z",
    scopes: ["fixture.read"],
  } as const;

  const first = new EncryptedFileSecretStore(root, key);
  await first.write("local-http-oauth", tokens);
  const path = join(root, "local-http-oauth.json");
  const encoded = await readFile(path, "utf8");
  assert.equal(encoded.includes(tokens.accessToken), false);
  assert.equal(encoded.includes(tokens.refreshToken), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const replacement = new EncryptedFileSecretStore(root, key);
  assert.deepEqual(await replacement.read("local-http-oauth"), tokens);
  await replacement.delete("local-http-oauth");
  assert.equal(await replacement.read("local-http-oauth"), null);
});

test("encrypted OAuth secret store rejects unsafe references and incorrect keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-oauth-secrets-"));
  assert.throws(() => new EncryptedFileSecretStore(root, Buffer.alloc(31)), /exactly 32 bytes/);
  const store = new EncryptedFileSecretStore(root, Buffer.alloc(32));
  await assert.rejects(() => store.read("../token"), /reference is unsafe/);
});
