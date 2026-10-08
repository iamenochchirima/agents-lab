import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { ConnectionManager } from "../../src/capabilities/integrations/connections.js";
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

test("HTTP effect contracts distinguish rejection, uncertain mutation and invalid acknowledgement", async () => {
  let writes = 0;
  const local = await serve(async (request, response) => { const input = await body(request); writes++; json(response, input.key === "invalid" ? { unexpected: true } : { error: "provider rejected" }, input.key === "invalid" ? 200 : Number(input.key)); });
  try {
    const [tool] = loadHttpSource({ id: "effects", version: "1.0.0", baseUrl: local.base, operations: [{ name: "save", method: "POST", path: "/records", inputSchema: schema,
      outputSchema: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"] }, description: "Save", riskClass: "write", approvalMode: "invocation", effectContract: { rejectionStatusCodes: [409] } }] });
    for (const [key, status, effect] of [["409", "failed", "rejected"], ["500", "unknown", "unknown"], ["invalid", "unknown", "acknowledged"]] as const) {
      const result = await invoke(tool, { key }); assert.equal(result.status, status); assert.equal(result.effect?.state, effect);
      if (key === "invalid") assert.equal(result.presentation, "invalid");
    }
    assert.equal(writes, 3, "each requested operation dispatches once without transport retries");
    assert.equal(tool.descriptor.definition.approvalMode, "invocation");
  } finally { await local.close(); }
});

test("HTTP bindings encode paths, query, form and stable provider idempotency with rotating credentials", async () => {
  let token = "first", observed: { url?: string; headers?: IncomingMessage["headers"]; form?: string } = {};
  const local = await serve(async (request, response) => {
    observed = { url: request.url, headers: request.headers }; const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); observed.form = Buffer.concat(chunks).toString(); json(response, { saved: true });
  });
  try {
    const options = { id: "binding", version: "1.0.0", baseUrl: local.base, connection: { ref: "conn_business", authorityRevision: "1", resource: local.base, scopes: ["write"] }, resolveHeaders: async () => ({ authorization: `Bearer ${token}` }), operations: [{ name: "save", method: "POST" as const, path: "/records/{id}", inputSchema: { type: "object" }, description: "Save", riskClass: "write" as const,
      bindings: { path: { id: "record" }, query: { mode: "mode" }, headers: { "X-Business-Tag": "tag" }, body: { value: "value" } }, requestEncoding: "form" as const, idempotency: { header: "Idempotency-Key" } }] };
    const [tool] = loadHttpSource(options); await invoke(tool, { record: "a/b", mode: "x y", tag: "known", value: "one&two" });
    assert.equal(observed.url, "/records/a%2Fb?mode=x+y"); assert.equal(observed.form, "value=one%26two"); assert.equal(observed.headers?.authorization, "Bearer first"); assert.equal(observed.headers?.["x-business-tag"], "known");
    const key = observed.headers?.["idempotency-key"]; token = "second";
    const [reloaded] = loadHttpSource(options); assert.equal(reloaded.descriptor.source.digest, tool.descriptor.source.digest, "token refresh preserves stable authority identity");
    await invoke(tool, { record: "a/b", mode: "x y", tag: "known", value: "one&two" }); assert.equal(observed.headers?.authorization, "Bearer second"); assert.equal(observed.headers?.["idempotency-key"], key);
    assert.throws(() => loadHttpSource({ ...options, operations: [{ ...options.operations[0], bindings: { headers: { Authorization: "token" } } }] }), /credential headers/);
  } finally { await local.close(); }
});

test("MCP consumes correlated chunked SSE without waiting for EOF and mirrors trusted headers", async () => {
  let token = "first", calls = 0;
  const annotated = { type: "object", properties: { key: { type: "string", "x-mcp-header": "BusinessKey" } }, required: ["key"] };
  const local = await serve(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const input = await body(request);
    if (input.method === "tools/list") return json(response, { jsonrpc: "2.0", id: input.id, result: { tools: [{ name: "lookup", inputSchema: annotated }] } });
    calls++; assert.equal(request.headers["x-agentlab-session-id"], "trusted-session"); assert.equal(request.headers["mcp-param-businesskey"], "=?base64?5LiW55WM?=");
    response.writeHead(200, { "content-type": "text/event-stream" }); response.write(': keepalive\n\n');
    for (let index = 0; index < 40; index++) response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: index, total: 40, message: `Bearer ${token}` } })}\n\n`);
    const event = `data: ${JSON.stringify({ jsonrpc: "2.0", id: input.id, result: { content: [{ type: "text", text: "complete" }] } })}\n\n`;
    response.write(event.slice(0, 17)); response.write(event.slice(17)); // Deliberately never call end().
  });
  try {
    const [tool] = await loadMcpSource({ id: "streaming", version: "1.0.0", endpoint: `${local.base}/mcp`, resolveHeaders: async () => ({ authorization: `Bearer ${token}`, "X-AgentLab-Session-Id": "untrusted-config" }), trustedContext: "session", connection: { ref: "conn_stream", authorityRevision: "1", resource: local.base, scopes: ["read"] }, tools: [{ remoteName: "lookup", name: "lookup", riskClass: "read", limits: { timeoutMs: 1000 } }] });
    token = "second";
    const result = await tool.implementation.executeResult!({ key: "世界" }, { ...context, sessionId: "trusted-session" });
    assert.equal(result.status, "completed"); assert.match(result.content, /complete/); assert.equal(calls, 1); assert.equal(result.effect?.state, "none");
    const progress = connections.at(-1)?.attempts[0].progress;
    assert.equal(progress?.notifications.length, 32); assert.equal(progress?.omitted, 8);
    assert.equal(progress?.notifications[0].progress, 0); assert.equal(progress?.notifications[0].message, "[REDACTED]");
  } finally { await local.close(); }
});


test("HTTP pagination binds one bounded cursor and maps payload and provider request ID", async () => {
  let calls = 0, invalidCursor = false;
  const local = await serve(async (request, response) => {
    calls++; assert.equal(request.url, "/records?after=page%2Ftwo");
    response.setHeader("X-Provider-Trace", "provider-page-two");
    json(response, { result: { records: [{ id: "record-two" }] }, paging: { next: invalidCursor ? "x".repeat(2049) : "page/three" } });
  });
  try {
    const [tool] = loadHttpSource({ id: "pagination", version: "1.0.0", baseUrl: local.base, operations: [{ name: "list_records", method: "GET", path: "/records", description: "List one page", riskClass: "read", inputSchema: { type: "object", properties: { cursor: { type: "string" } } },
      pagination: { cursorArgument: "cursor", cursorQuery: "after", nextCursorPath: ["paging", "next"] }, responseMapping: { valuePath: ["result", "records"], requestIdHeader: "X-Provider-Trace" } }] });
    const result = await invoke(tool, { cursor: "page/two" });
    assert.equal(result.status, "completed"); assert.deepEqual(result.structuredContent, { value: [{ id: "record-two" }], nextCursor: "page/three" });
    assert.equal(connections.at(-1)?.attempts[0].providerRequestId, "provider-page-two"); assert.equal(calls, 1, "pagination never silently requests the next page");
    invalidCursor = true; assert.equal((await invoke(tool, { cursor: "page/two" })).status, "failed");
    assert.equal((await invoke(tool, { cursor: "x".repeat(2049) })).effect?.state, "not_dispatched"); assert.equal(calls, 2);
  } finally { await local.close(); }
});


test("live authority is rechecked between MCP discovery and dispatch, preserving rotation and rejecting revoked writes", async () => {
  const environment = { FIXTURE_AUTHORIZATION: "first-secret" };
  let manager: ConnectionManager, lists = 0, effects = 0, httpEffects = 0;
  const local = await serve(async (request, response) => {
    if (request.url === "/write") { httpEffects++; return json(response, { saved: true }); }
    const input = await body(request);
    if (input.method === "tools/list") {
      lists++;
      if (lists === 2) environment.FIXTURE_AUTHORIZATION = "second-secret";
      if (lists === 3) await manager.revoke("conn_live");
      return json(response, { jsonrpc: "2.0", id: input.id, result: { tools: [{ name: "write", inputSchema: schema }] } });
    }
    assert.equal(input.method, "tools/call"); assert.equal(request.headers.authorization, "second-secret"); assert.equal(request.headers["x-agentlab-session-id"], "trusted-session"); effects++;
    json(response, { jsonrpc: "2.0", id: input.id, result: { content: [{ type: "text", text: "first-secret second-secret" }] } });
  });
  try {
    manager = await ConnectionManager.create([{ ref: "conn_live", displayName: "Live", provider: "fixture", owner: "local-admin", resource: local.base, scopes: ["write"], auth: { kind: "static", headersEnv: { authorization: "FIXTURE_AUTHORIZATION" } } }], { environment });
    const binding = await manager.binding("conn_live");
    const options = { id: "live-dispatch", version: "1.0.0", endpoint: `${local.base}/mcp`, ...binding, trustedContext: "session" as const, tools: [{ remoteName: "write", name: "write", riskClass: "write" as const }] };
    const [tool] = await loadMcpSource(options);
    const result = await tool.implementation.executeResult!({ key: "one" }, { ...context, sessionId: "trusted-session" });
    assert.equal(result.status, "completed"); assert.equal(effects, 1); assert.doesNotMatch(result.content, /first-secret|second-secret/); assert.doesNotMatch(JSON.stringify(connections.at(-1)), /first-secret|second-secret/);
    assert.equal((await manager.summary("conn_live")).authorityRevision, binding.connection.authorityRevision, "credential rotation does not alter admission");
    const revoked = await tool.implementation.executeResult!({ key: "two" }, { ...context, sessionId: "trusted-session" });
    assert.equal(revoked.status, "failed"); assert.equal(revoked.effect?.state, "not_dispatched"); assert.equal(effects, 1);
    let resolutions = 0;
    const [http] = loadHttpSource({ id: "live-http", version: "1.0.0", baseUrl: local.base, resolveHeaders: async () => { if (++resolutions === 2) throw new Error("Authority revoked before HTTP send"); return { authorization: "service-secret" }; }, operations: [{ name: "http_write", method: "POST", path: "/write", inputSchema: schema, description: "Write", riskClass: "write" }] });
    const denied = await invoke(http, { key: "one" });
    assert.equal(denied.status, "failed"); assert.equal(denied.effect?.state, "not_dispatched"); assert.equal(httpEffects, 0);
  } finally { await local.close(); }
});
