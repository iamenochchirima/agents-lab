import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { loadHttpSource, loadMcpSource } from "../../src/capabilities/extensions/connected-sources.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../src/capabilities/tools/contracts.js";
import type { ConnectionResult } from "../../src/capabilities/integrations/contracts.js";
import type { HostedToolContribution } from "../../src/capabilities/extensions/contracts.js";

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => { void handler(request, response).catch(() => { response.writeHead(500); response.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local server address.");
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
async function body(request: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>; }
function json(response: ServerResponse, value: unknown, status = 200) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }
const connections: ConnectionResult[] = [];
const context: ToolExecutionContext = { runId: "run-source-test", turnId: "turn-one", toolCallId: "call-one", signal: new AbortController().signal, onConnectionResult: result => { connections.push(result); } };
const invoke = (tool: HostedToolContribution, input: Record<string, unknown>) => (tool.implementation as typeof tool.implementation & { executeResult(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult & { structuredContent?: unknown; contentBlocks?: readonly unknown[] }> }).executeResult(input, context);
const schema = { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false };

test("MCP discovery preserves pagination and rich failed feedback, then rejects definition drift", async () => {
  let changed = false, calls = 0;
  const local = await serve(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer source-test-secret");
    const input = await body(request);
    assert.equal(input.params._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
    assert.deepEqual(input.params._meta["io.modelcontextprotocol/clientCapabilities"], {});
    if (input.method === "tools/list") return json(response, { jsonrpc: "2.0", id: input.id, result: input.params.cursor ? { tools: [{ name: "getUser", inputSchema: changed ? { ...schema, required: [] } : schema }], } : { tools: [], nextCursor: "next-page" } });
    assert.equal(input.method, "tools/call"); calls++;
    json(response, { jsonrpc: "2.0", id: input.id, result: { isError: true, content: [{ type: "text", text: "Use the backup key instead." }, { type: "image", mimeType: "image/png", data: "synthetic" }], structuredContent: { retryKey: "backup" } } });
  });
  try {
    const [tool] = await loadMcpSource({ id: "external-notes", version: "1.0.0", endpoint: `${local.base}/mcp`, headers: { authorization: "Bearer source-test-secret" }, tools: [{ remoteName: "getUser", name: "notes_lookup", riskClass: "read" }] });
    assert.doesNotMatch(JSON.stringify(tool.descriptor), /source-test-secret|127\.0\.0\.1/);
    const result = await invoke(tool, { key: "primary" });
    assert.equal(result.status, "failed"); assert.match(result.content, /backup/); assert.equal(result.contentBlocks?.length, 2); assert.deepEqual(result.structuredContent, { retryKey: "backup" });
    assert.equal(tool.descriptor.failurePolicy, "feedback");
    assert.equal(result.connection?.attemptCount, 1);
    assert.equal(connections.at(-1)?.status, "failed");
    assert.equal(connections.at(-1)?.attempts[0].errorCode, "MCP_TOOL_ERROR");
    assert.deepEqual(connections.at(-1)?.output?.structuredContent, { retryKey: "backup" });
    changed = true;
    const drift = await invoke(tool, { key: "primary" });
    assert.equal(drift.status, "failed"); assert.match(drift.error?.message ?? "", /definition changed/); assert.equal(calls, 1, "drift blocks remote tools/call before dispatch");
  } finally { await local.close(); }
});

test("trusted HTTP operations use explicit query and JSON body while retaining known failure feedback", async () => {
  const requests: { method: string | undefined; key: string | null; value?: unknown }[] = [];
  const local = await serve(async (request, response) => {
    if (request.method === "GET") { requests.push({ method: request.method, key: new URL(request.url!, "http://local").searchParams.get("key") }); json(response, { error: "Choose the backup key." }, 400); }
    else { const input = await body(request); requests.push({ method: request.method, key: null, value: input.key }); json(response, { saved: true }); }
  });
  try {
    const tools = loadHttpSource({ id: "configured-api", version: "1.0.0", baseUrl: local.base, operations: [{ name: "lookup", method: "GET", path: "/records", inputSchema: schema, description: "Look up a record.", riskClass: "read" }, { name: "save", method: "POST", path: "/records", inputSchema: schema, description: "Save a record.", riskClass: "write" }] });
    const [differentBackend] = loadHttpSource({ id: "configured-api", version: "1.0.0", baseUrl: "http://127.0.0.2:65531", operations: [{ name: "lookup", method: "GET", path: "/records", inputSchema: schema, description: "Look up a record.", riskClass: "read" }] });
    assert.notEqual(differentBackend.descriptor.source.digest, tools[0].descriptor.source.digest, "changing configured backend invalidates the admitted source identity");
    assert.deepEqual(differentBackend.descriptor.definition, tools[0].descriptor.definition);
    const failed = await invoke(tools[0], { key: "missing" }); assert.equal(failed.status, "failed"); assert.match(failed.error?.message ?? "", /backup/);
    assert.equal(failed.connection?.errorCode, "HTTP_400"); assert.equal(connections.at(-1)?.attempts.length, 1);
    const completed = await invoke(tools[1], { key: "selected" }); assert.equal(completed.status, "completed");
    assert.deepEqual(requests, [{ method: "GET", key: "missing" }, { method: "POST", key: null, value: "selected" }]);
    assert.doesNotMatch(JSON.stringify(tools.map(tool => tool.descriptor)), /127\.0\.0\.1/);
  } finally { await local.close(); }
});

test("a write deadline preserves unknown effects and performs no automatic retry", async () => {
  let writes = 0;
  const local = await serve(async (request, response) => { await body(request); writes++; await new Promise(resolve => setTimeout(resolve, 60)); json(response, { saved: true }); });
  try {
    const [tool] = loadHttpSource({ id: "slow-writer", version: "1.0.0", baseUrl: local.base, operations: [{ name: "write", method: "POST", path: "/records", inputSchema: schema, description: "Write a record.", riskClass: "write", limits: { timeoutMs: 20 } }] });
    const result = await invoke(tool, { key: "synthetic" }); assert.equal(result.status, "unknown"); assert.equal(result.error?.code, "TOOL_UNKNOWN"); assert.equal(result.attemptCount, 1); assert.equal(writes, 1);
    assert.equal(result.connection?.attemptCount, 1); assert.equal(connections.at(-1)?.status, "unknown");
  } finally { await local.close(); }
});
