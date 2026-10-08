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

test("HTTP MCP fails closed when an allowlisted endpoint is unavailable", async () => {
  const endpoint = "http://127.0.0.1:1/mcp";
  const server = new HttpMcpServer({ endpoint, serverName: "unavailable-fixture" });
  const transport = new McpTransport({ server, endpoint, allowedEndpoints: [endpoint], limits: { ...limits, timeoutMs: 250 } });
  await assert.rejects(transport.discover(new AbortController().signal));
});

test("HTTP MCP uses the current per-request protocol without a legacy handshake", async () => {
  const methods: string[] = [];
  const endpoint = "https://mcp.example.test/stream";
  const server = new HttpMcpServer({
    endpoint,
    protocolVersion: "2026-07-28",
    serverName: "modern-fixture",
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; id: string; params: { _meta: Record<string, unknown> } };
      methods.push(body.method);
      assert.equal(body.params._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
      const result = body.method === "tools/list"
        ? { tools: [{ name: "fixture.lookup", description: "Read fixture data", inputSchema: { type: "object" }, _meta: { agentlabVersion: "1.0.0" } }] }
        : { structuredContent: { key: "alpha", value: "modern fixture" }, content: [], isError: false };
      return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { data: "progress" } })}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const transport = new McpTransport({ server, endpoint, allowedEndpoints: [endpoint], limits });

  const tools = await transport.discover(new AbortController().signal);
  const result = await transport.invoke(tools[0]!, "modern-mcp-1", { key: "alpha" }, new AbortController().signal);

  assert.deepEqual(methods, ["tools/list", "tools/call"]);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { key: "alpha", value: "modern fixture" });
});

test("HTTP MCP classifies a lost tool-call response as an unknown outcome", async () => {
  const endpoint = "https://mcp.example.test/unknown";
  let calls = 0;
  const server = new HttpMcpServer({
    endpoint,
    protocolVersion: "2026-07-28",
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; id: string };
      if (body.method === "tools/call") {
        calls++;
        if (calls === 1) throw new Error("socket closed after dispatch");
        return new Response(JSON.stringify({jsonrpc:"2.0",id:"unrelated",result:{content:[]}}),{status:200});
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "fixture.lookup", description: "Read fixture data", inputSchema: { type: "object" } }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const transport = new McpTransport({ server, endpoint, allowedEndpoints: [endpoint], limits });
  const [tool] = await transport.discover(new AbortController().signal);

  const result = await transport.invoke(tool!, "unknown-mcp-1", { key: "alpha" }, new AbortController().signal);

  assert.equal(result.status, "unknown");
  assert.equal(result.error?.code, "MCP_OUTCOME_UNKNOWN");
  assert.equal(result.attempts[0]?.retryable, false);
  assert.equal((await transport.invoke(tool!, "malformed-mcp-1", { key: "alpha" }, new AbortController().signal)).status,"unknown");
  assert.equal(calls,2,"lost or corrupt acknowledgements are never retried automatically");
});
