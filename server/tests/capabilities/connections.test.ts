import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager, type ConnectionDefinition } from "../../src/capabilities/integrations/connections.js";
import { MemorySecretStore, OAuthFlow, type OAuthProvider } from "../../src/capabilities/integrations/oauth/flow.js";

const staticConnection: ConnectionDefinition = { ref: "conn_business", displayName: "Business", provider: "fixture", owner: "local-admin", resource: "https://api.example.test", scopes: ["tickets.write"], auth: { kind: "static", headersEnv: { Authorization: "FIXTURE_AUTHORIZATION" } } };

test("connection binding refreshes credentials without changing authority, while revoke/reconnect invalidates retained bindings across restart", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "lab-connection-"));
  const environment = { FIXTURE_AUTHORIZATION: "Bearer first" };
  try {
    const manager = await ConnectionManager.create([staticConnection], { stateRoot, environment });
    const binding = await manager.binding(staticConnection.ref);
    assert.deepEqual(await binding.resolveHeaders(new AbortController().signal), { Authorization: "Bearer first" });
    environment.FIXTURE_AUTHORIZATION = "Bearer rotated";
    assert.deepEqual(await binding.resolveHeaders(new AbortController().signal), { Authorization: "Bearer rotated" });
    assert.equal((await manager.summary(staticConnection.ref)).authorityRevision, binding.connection.authorityRevision);
    manager.reportSourceAvailability(staticConnection.ref, "Service discovery unavailable."); assert.equal((await manager.summary(staticConnection.ref)).status, "unavailable");
    await manager.refresh(staticConnection.ref); assert.equal((await manager.summary(staticConnection.ref)).status, "available");
    await manager.revoke(staticConnection.ref); await assert.rejects(() => binding.resolveHeaders(new AbortController().signal), /authority/);
    const restarted = await ConnectionManager.create([staticConnection], { stateRoot, environment });
    assert.equal((await restarted.summary(staticConnection.ref)).status, "revoked");
    await restarted.connect(staticConnection.ref);
    assert.notEqual((await restarted.binding(staticConnection.ref)).connection.authorityRevision, binding.connection.authorityRevision);
    assert.doesNotMatch(JSON.stringify(await restarted.summaries()), /Bearer|rotated|FIXTURE_AUTHORIZATION/);
    const originalRevision = (await restarted.summary(staticConnection.ref)).authorityRevision;
    await ConnectionManager.create([{ ...staticConnection, scopes: ["tickets.read"] }], { stateRoot, environment });
    const restoredConfig = await ConnectionManager.create([staticConnection], { stateRoot, environment });
    assert.notEqual((await restoredConfig.summary(staticConnection.ref)).authorityRevision, originalRevision);
  } finally { await rm(stateRoot, { recursive: true, force: true }); }
});

test("OAuth callback binds state to connection and issuer, expires, and refresh retains omitted grant material", async () => {
  let now = Date.now(), exchanges = 0;
  const secrets = new MemorySecretStore();
  const provider: OAuthProvider = {
    async authorize(request) { return { state: request.state, code: "unused" }; },
    async exchange() { exchanges++; return { accessToken: "initial", refreshToken: "original-refresh", expiresAt: new Date(now - 1).toISOString(), scopes: [], scopesProvided: false }; },
    async refresh(refreshToken) { assert.equal(refreshToken, "original-refresh"); return { accessToken: "rotated", refreshToken: null, expiresAt: new Date(now + 100000).toISOString(), scopes: [], scopesProvided: false }; },
    async revoke() {},
  };
  const flow = new OAuthFlow(provider, secrets, { now: () => now, stateTtlMs: 100 });
  const begin = () => flow.begin("conn_business", "https://issuer.example.test/authorize", "http://127.0.0.1/callback", ["tickets.write"], { clientId: "registered-client", resource: "https://api.example.test", issuer: "https://issuer.example.test", issuerRequired: true });
  const request = begin(); assert.equal(new URL(request.authorizationUrl).searchParams.get("client_id"), "registered-client");
  await assert.rejects(() => flow.complete("conn_other", request.state, "code", undefined, "https://issuer.example.test"), /another connection/); assert.equal(exchanges, 0);
  await assert.rejects(() => flow.complete("conn_business", request.state, "code", undefined, "https://wrong.example.test"), /issuer/); assert.equal(exchanges, 0);
  const expired = begin(); now += 101; await assert.rejects(() => flow.complete("conn_business", expired.state, "code", undefined, "https://issuer.example.test"), /expired/);
  const valid = begin(); await flow.complete("conn_business", valid.state, "code", undefined, "https://issuer.example.test");
  assert.equal(await flow.accessToken("conn_business"), "rotated");
  assert.deepEqual((await secrets.read("conn_business"))?.scopes, ["tickets.write"]); assert.equal((await secrets.read("conn_business"))?.refreshToken, "original-refresh");
});

test("OAuth manager uses bounded allowlisted metadata and PKCE/resource-bound token exchange", async () => {
  let sentBody = "", challengedScope = "tickets.write";
  const secrets = new MemorySecretStore();
  const config: ConnectionDefinition = { ...staticConnection, ref: "conn_oauth", resource: "https://api.example.test/mcp", auth: { kind: "oauth", clientId: "registered-client", redirectUri: "http://127.0.0.1/callback", discovery: { kind: "mcp", allowedIssuers: ["https://issuer.example.test"] } } };
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === config.resource) return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="https://api.example.test/custom-resource-metadata", scope="${challengedScope}"` } });
    if (url === "https://api.example.test/custom-resource-metadata") return Response.json({ resource: config.resource, authorization_servers: ["https://issuer.example.test"] });
    if (url.includes("oauth-authorization-server")) return Response.json({ issuer: "https://issuer.example.test", authorization_endpoint: "https://issuer.example.test/authorize", token_endpoint: "https://issuer.example.test/token", code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true });
    assert.equal(url, "https://issuer.example.test/token"); sentBody = String(init?.body); return Response.json({ access_token: "private-token", refresh_token: "private-refresh", expires_in: 3600, token_type: "Bearer", scope: "tickets.write" });
  };
  const manager = await ConnectionManager.create([config], { secrets, fetchImplementation });
  const pending = await manager.connect(config.ref); const authorization = new URL(pending.authorizationUrl!);
  assert.equal(authorization.searchParams.get("resource"), config.resource);
  await manager.complete(config.ref, authorization.searchParams.get("state")!, "code", "https://issuer.example.test");
  assert.equal(new URLSearchParams(sentBody).get("resource"), config.resource); assert.equal(new URLSearchParams(sentBody).get("client_id"), "registered-client"); assert.ok(new URLSearchParams(sentBody).get("code_verifier"));
  assert.deepEqual(await (await manager.binding(config.ref)).resolveHeaders(new AbortController().signal), { authorization: "Bearer private-token" });
  assert.doesNotMatch(JSON.stringify(await manager.summaries()), /private-token|private-refresh/);
  challengedScope = "tickets.admin";
  const excessive = await ConnectionManager.create([config], { secrets, fetchImplementation });
  await assert.rejects(() => excessive.connect(config.ref), /beyond the configured grant/);
  assert.equal((await excessive.summary(config.ref)).status, "authorization_required");
  await assert.rejects(async () => (await excessive.binding(config.ref)).resolveHeaders(new AbortController().signal), /configured grant/);
  assert.equal((await secrets.read(config.ref))?.accessToken, "private-token");
  const metadataFailure = await ConnectionManager.create([config], { secrets, fetchImplementation: async () => { throw new Error("Offline metadata"); } });
  assert.equal((await metadataFailure.revoke(config.ref)).status, "revoked");
  assert.equal(await secrets.read(config.ref), null);
  assert.match((await metadataFailure.summary(config.ref)).reason!, /remote token revocation could not be confirmed/);
  const unavailable = await ConnectionManager.create([config], { oauthUnavailableReason: "Encryption key is not configured." });
  assert.equal((await unavailable.summary(config.ref)).status, "unavailable"); await assert.rejects(() => unavailable.connect(config.ref), /Encryption key/);
});
