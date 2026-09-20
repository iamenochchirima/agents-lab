import assert from "node:assert/strict";
import test from "node:test";
import { createLocalFixtureServer } from "../../src/capabilities/integrations/local-fixture/service.js";
import { HttpMcpServer } from "../../src/capabilities/integrations/mcp/http-server.js";
import { McpTransport } from "../../src/capabilities/integrations/mcp/local-transport.js";
import { MemorySecretStore, OAuthFlow } from "../../src/capabilities/integrations/oauth/flow.js";
import { HttpOAuthProvider } from "../../src/capabilities/integrations/oauth/http-provider.js";

const limits = {
  timeoutMs: 2_000,
  maxRequestBytes: 8_192,
  maxResponseBytes: 32_768,
  maxAttempts: 2,
} as const;

test("MCP uses the local fixture through Streamable HTTP and preserves bounded results", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  try {
    const endpoint = `http://${fixture.host}:${fixture.port}/mcp`;
    const server = new HttpMcpServer({ endpoint });
    const transport = new McpTransport({ server, endpoint, allowedEndpoints: [endpoint], limits });
    const tools = await transport.discover(new AbortController().signal);
    assert.deepEqual(tools.map((tool) => tool.name), ["fixture.lookup"]);
    assert.equal(tools[0]?.version, "1.0.0");
    const result = await transport.invoke(tools[0]!, "http-mcp-1", { key: "alpha" }, new AbortController().signal);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.output, { key: "alpha", value: "local fixture alpha" });
    assert.equal(result.attempts[0]?.providerRequestId, "mcp-http:http-mcp-1");
  } finally {
    await fixture.close();
  }
});

test("OAuth uses the local fixture process for PKCE, refresh, and revocation", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const secrets = new MemorySecretStore();
  const base = `http://${fixture.host}:${fixture.port}`;
  const provider = new HttpOAuthProvider({
    authorizationEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/oauth/token`,
    revocationEndpoint: `${base}/oauth/revoke`,
  });
  const flow = new OAuthFlow(provider, secrets);
  try {
    const started = flow.begin("local-http-oauth", `${base}/oauth/authorize`, "http://127.0.0.1/callback", ["fixture.read"]);
    const callback = await provider.authorize(started);
    assert.equal(callback.state, started.state);
    await flow.complete("local-http-oauth", callback.state, callback.code);
    assert.match(await flow.accessToken("local-http-oauth"), /^fixture-access-/);

    await secrets.write("local-http-oauth", {
      accessToken: "expired",
      refreshToken: (await secrets.read("local-http-oauth"))!.refreshToken,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      scopes: ["fixture.read"],
    });
    assert.match(await flow.accessToken("local-http-oauth"), /^fixture-access-/);
    await flow.revoke("local-http-oauth");
    assert.equal(await secrets.read("local-http-oauth"), null);
  } finally {
    await fixture.close();
  }
});

test("HTTP MCP rejects an endpoint that is not explicitly allowlisted", async () => {
  const endpoint = "http://127.0.0.1:9191/mcp";
  const server = new HttpMcpServer({ endpoint });
  assert.throws(() => new McpTransport({ server, endpoint, allowedEndpoints: [], limits }), /not allowlisted/);
});
