import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityManagement } from "../../../server/src/capabilities/management/service.js";
import { HttpMcpServer } from "../../../server/src/capabilities/integrations/mcp/http-server.js";

let stage = "startup";
async function main() {
  const issuer = "http://127.0.0.1:" + (process.env.AGENTLAB_OAUTH_PROBE_PORT || "9198");
  const root = await mkdtemp(join(tmpdir(), "lab-oauth-mcp-check-"));
  const management = await CapabilityManagement.create({ root, environment: { AGENTLAB_CREDENTIAL_KEY_HEX: randomBytes(32).toString("hex") } });
  const config = { ref: "conn_oauth_probe", displayName: "Fake OAuth probe", provider: "Local fake fixture", owner: "local-workspace" as const,
    resource: issuer + "/mcp", scopes: ["probe.read"], enabled: true,
    auth: { kind: "oauth" as const, clientId: "lab-check", redirectUri: "http://localhost:5173/api/management/connections/conn_oauth_probe/callback", issuer,
      discovery: { kind: "mcp" as const, allowedIssuers: [issuer] } } };
  try {
    const challenge = await fetch(config.resource);
    assert.equal(challenge.status, 401);
    assert.match(challenge.headers.get("www-authenticate")!, /resource_metadata/);
    await management.saveConnection(0, config);
    stage = "connect";
    const start = await management.connectionAction(config.ref, "connect");
    assert.ok(start.authorizationUrl);
    stage = "authorize";
    const authorization = await fetch(start.authorizationUrl, { redirect: "manual" });
    assert.equal(authorization.status, 302);
    const callback = new URL(authorization.headers.get("location")!);
    stage = "callback";
    await management.connections.complete(config.ref, callback.searchParams.get("state")!, callback.searchParams.get("code")!, callback.searchParams.get("iss")!);
    await management.reload();
    stage = "discover";
    const discovery = await management.connectionAction(config.ref, "discover");
    assert.equal(discovery.tools?.[0].name, "oauth_probe");
    const admitted = await management.connections.binding(config.ref);
    const client = new HttpMcpServer({ endpoint: config.resource, protocolVersion: "2026-07-28", resolveHeaders: admitted.resolveHeaders });
    try {
      stage = "MCP call";
      const result = await client.callTool("oauth_probe", {}, "oauth-probe-call", AbortSignal.timeout(5000));
      assert.equal(result.output.text, "oauth-fixture-connected");
    } finally { await client.close(); }
    const binding = management.credentialBinding(config, "oauth-grant");
    const alias = "oauth_" + createHash("sha256").update(JSON.stringify(binding)).digest("hex").slice(0, 40);
    const before = await management.credentials!.get(alias, binding);
    if (!before || before.kind !== "oauth-tokens") throw new Error("Expected saved OAuth grant.");
    // Controlled expiry exercises the real refresh endpoint immediately, without
    // waiting or sending a model request. Provider access token is still valid.
    await management.credentials!.upsert(alias, binding, { ...before, expiresAt: "2000-01-01T00:00:00Z" });
    stage = "refresh";
    await management.connectionAction(config.ref, "refresh");
    const after = await management.credentials!.get(alias, binding);
    if (!after || after.kind !== "oauth-tokens") throw new Error("Expected refreshed OAuth grant.");
    assert.notEqual(after.accessToken, before.accessToken);
    assert.notEqual(after.refreshToken, before.refreshToken);
    const replay = await fetch(issuer + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: before.refreshToken!, client_id: "lab-check", resource: config.resource }) });
    assert.equal(replay.status, 400);
    stage = "revoke";
    await management.connectionAction(config.ref, "revoke");
    assert.equal(await management.credentials!.get(alias, binding), null);
    const revoked = await fetch(config.resource, { method: "GET", headers: { Authorization: "Bearer " + after.accessToken } });
    assert.equal(revoked.status, 401);
    process.stdout.write("OAuth fixture acceptance passed: challenge/discovery, PKCE callback, encrypted grant, MCP read, rotated refresh, stale refresh rejection and revocation. No model calls.\n");
  } finally { await management.close(); await rm(root, { recursive: true, force: true }); }
}
main().catch(() => { process.stderr.write("OAuth fixture acceptance failed at " + stage + ". Check that the documented loopback provider is running; no credentials are printed.\n"); process.exitCode = 1; });
