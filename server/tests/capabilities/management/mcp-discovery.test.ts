import assert from "node:assert/strict";
import test from "node:test";
import { HttpMcpServer } from "../../../src/capabilities/integrations/mcp/http-server.js";
import { discoverHttpMcp } from "../../../src/capabilities/management/mcp-discovery.js";
import { loadCapabilityPackageRecords } from "../../../src/capabilities/extensions/packages.js";

const manifest = { name: "echo", description: "Echo test input.", inputSchema: { type: "object" } };
const response = (id: string, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });

test("HTTP discovery accepts provider catalogs above 64 tools while retaining a 128-tool bound", async () => {
  const signal = new AbortController().signal;
  for (const count of [70, 129]) {
    const fetchImplementation: typeof fetch = async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      return response(input.id, { tools: Array.from({ length: count }, (_, index) => ({ ...manifest, name: `tool_${index}` })) });
    };
    const server = new HttpMcpServer({ endpoint: "https://provider.example/mcp", protocolVersion: "2026-07-28", fetchImplementation });
    if (count <= 128) {
      assert.equal((await server.listTools(signal)).length, count);
      const loaded = await loadCapabilityPackageRecords({ schemaVersion: 1, packages: [{ id: "large-provider", version: "1.0.0", source: "mcp", endpoint: "https://provider.example/mcp", protocolVersion: "2026-07-28", tools: Array.from({ length: count }, (_, index) => ({ remoteName: `tool_${index}`, name: `provider_${index}`, riskClass: "external", approvalMode: "invocation" })) }] }, process.cwd(), { fetchImplementation });
      assert.equal(loaded.tools.length, count);
    }
    else await assert.rejects(server.listTools(signal), /too many tools/);
  }
});

test("HTTP discovery falls back from stateless protocol and pins server-negotiated legacy version", async () => {
  const requests: { method: string; version: string }[] = [];
  const fetchImplementation: typeof fetch = async (_url, init) => {
    const version = new Headers(init?.headers).get("MCP-Protocol-Version")!;
    const input = JSON.parse(String(init?.body)); requests.push({ method: input.method, version });
    if (version === "2026-07-28") return Response.json({ error: "Legacy initialization required." }, { status: 400 });
    if (input.method === "initialize") return response(input.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1.0.0" } });
    if (input.method === "notifications/initialized") return new Response(null, { status: 202 });
    assert.equal(input.method, "tools/list"); return response(input.id, { tools: [manifest] });
  };
  const result = await discoverHttpMcp({ endpoint: "https://provider.example/mcp", fetchImplementation }, new AbortController().signal);
  assert.equal(result.protocolVersion, "2025-06-18"); assert.equal(result.tools[0]?.name, "echo");
  assert.deepEqual(requests, [{ method: "tools/list", version: "2026-07-28" }, { method: "initialize", version: "2025-11-25" }, { method: "notifications/initialized", version: "2025-06-18" }, { method: "tools/list", version: "2025-06-18" }]);
});

test("unsupported negotiation fails before tool dispatch and modern discovery never initializes", async () => {
  const methods: string[] = [];
  const incompatible = new HttpMcpServer({ endpoint: "https://provider.example/mcp", protocolVersion: "2025-11-25", fetchImplementation: async (_url, init) => { const input = JSON.parse(String(init?.body)); methods.push(input.method); return response(input.id, { protocolVersion: "2099-01-01" }); } });
  await assert.rejects(incompatible.callTool("echo", {}, "not-dispatched", new AbortController().signal), /unsupported protocol/);
  assert.deepEqual(methods, ["initialize"]);
  methods.length = 0;
  const modern = await discoverHttpMcp({ endpoint: "https://provider.example/mcp", fetchImplementation: async (_url, init) => { const input = JSON.parse(String(init?.body)); methods.push(input.method); return response(input.id, { tools: [manifest] }); } }, new AbortController().signal);
  assert.equal(modern.protocolVersion, "2026-07-28"); assert.deepEqual(methods, ["tools/list"]);
});

test("trusted package construction uses injected network policy for discovery and invocation", async () => {
  const called: string[] = [];
  const fetchImplementation: typeof fetch = async (url, init) => {
    called.push(String(url));
    if (String(url) === "https://api.example/read") return Response.json({ value: "http" });
    const input = JSON.parse(String(init?.body));
    return response(input.id, input.method === "tools/list" ? { tools: [manifest] } : { structuredContent: { value: "mcp" }, content: [] });
  };
  const loaded = await loadCapabilityPackageRecords({ schemaVersion: 1, packages: [
    { id: "mcp-provider", version: "1.0.0", source: "mcp", endpoint: "https://provider.example/mcp", protocolVersion: "2026-07-28", tools: [{ remoteName: "echo", name: "provider_echo", riskClass: "read" }] },
    { id: "http-provider", version: "1.0.0", source: "http", baseUrl: "https://api.example", operations: [{ name: "provider_read", description: "Read a test value.", method: "GET", path: "/read", inputSchema: { type: "object" }, riskClass: "read" }] },
  ] }, process.cwd(), { fetchImplementation });
  const context = { runId: "policy-proof", turnId: "first", toolCallId: "call-one", toolRound: 1, signal: new AbortController().signal };
  for (const tool of loaded.tools) assert.equal((await tool.implementation.executeResult!({}, context)).status, "completed");
  assert.deepEqual(called, ["https://provider.example/mcp", "https://provider.example/mcp", "https://provider.example/mcp", "https://api.example/read"]);
});
