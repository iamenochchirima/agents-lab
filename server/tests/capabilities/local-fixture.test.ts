import assert from "node:assert/strict";
import test from "node:test";

import { HttpConnectionRuntime } from "../../src/capabilities/integrations/runtime.js";
import { HttpMcpConnectionRuntime } from "../../src/capabilities/integrations/mcp/runtime.js";
import { createLocalFixtureServer } from "../../src/capabilities/integrations/local-fixture/service.js";
import { createFixtureTools } from "../../src/capabilities/tools/fixtures.js";
import { createMcpFixtureTools } from "../../src/capabilities/tools/mcp-fixture.js";
import { ToolRegistry } from "../../src/capabilities/tools/registry.js";

async function executeTool(
  registry: ToolRegistry,
  name: string,
  argumentsValue: Readonly<Record<string, unknown>>,
  toolCallId: string,
  connectionBindings?: readonly { readonly toolName: string; readonly connectionRef: string; readonly operations: readonly string[]; readonly mcp?: {
    readonly endpointRef: string;
    readonly serverName: string;
    readonly protocolVersion: string;
    readonly toolName: string;
    readonly toolVersion: string;
  } }[],
) {
  const validation = registry.validateCall({ toolCallId, name, arguments: argumentsValue, round: 1 });
  assert.equal(validation.accepted, true);
  if (!validation.accepted) throw new Error("Tool validation failed.");
  return registry.execute(validation, {
    runId: "fixture-run",
    turnId: "fixture-turn",
    toolCallId,
    ...(connectionBindings ? { connectionBindings } : {}),
    signal: new AbortController().signal,
  });
}

test("platform tools execute through the local HTTP connection and retain bounded evidence", async () => {
  const server = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  try {
    const runtime = new HttpConnectionRuntime({ endpoint: `http://127.0.0.1:${server.port}` });
    const tools = createFixtureTools(runtime);
    const registry = new ToolRegistry({ enabledNames: [tools.fixtureLookupTool.definition.name] });
    registry.register(tools.fixtureLookupTool);

    const result = await executeTool(registry, "fixture_lookup", { key: "alpha" }, "call-lookup-1");

    assert.equal(result.status, "completed");
    assert.equal(result.content, '{"key":"alpha","value":"local fixture alpha"}');
    assert.deepEqual(result.connection, {
      requestId: "fixture-run:fixture-turn:call-lookup-1",
      status: "completed",
      attemptCount: 1,
      providerRequestIds: ["local-direct:fixture-run:fixture-turn:call-lookup-1"],
      errorCode: null,
    });
  } finally {
    await server.close();
  }
});

test("the MCP-backed tool executes through the local Streamable HTTP boundary", async () => {
  const server = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  try {
    const endpoint = `http://127.0.0.1:${server.port}`;
    const runtime = new HttpMcpConnectionRuntime({ endpoint: `${endpoint}/mcp` });
    const tools = createMcpFixtureTools(runtime);
    const registry = new ToolRegistry({ enabledNames: [tools.mcpFixtureLookupTool.definition.name] });
    registry.register(tools.mcpFixtureLookupTool);
    const result = await executeTool(registry, "mcp_fixture_lookup", { key: "alpha" }, "call-mcp-lookup-1", [{
      toolName: "mcp_fixture_lookup",
      connectionRef: "conn_local_mcp_fixture",
      operations: ["lookup"],
      mcp: {
        endpointRef: "local-fixture-mcp",
        serverName: "agentlab-local-mcp",
        protocolVersion: "2025-06-18",
        toolName: "fixture.lookup",
        toolVersion: "1.0.0",
      },
    }]);

    assert.equal(result.status, "completed");
    assert.equal(result.content, '{"key":"alpha","value":"local fixture alpha"}');
    assert.deepEqual(result.connection?.providerRequestIds, ["mcp-http:fixture-run:fixture-turn:call-mcp-lookup-1"]);
    assert.deepEqual(result.connection?.mcp, {
      endpointRef: "local-fixture-mcp",
      serverName: "agentlab-local-mcp",
      protocolVersion: "2025-06-18",
      toolName: "fixture.lookup",
      toolVersion: "1.0.0",
      phase: "invocation",
    });
  } finally {
    await server.close();
  }
});

test("the MCP tool fails closed when the selected server tool does not match discovery", async () => {
  const server = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  try {
    const runtime = new HttpMcpConnectionRuntime({ endpoint: `http://127.0.0.1:${server.port}/mcp` });
    const tools = createMcpFixtureTools(runtime);
    const registry = new ToolRegistry({ enabledNames: [tools.mcpFixtureLookupTool.definition.name] });
    registry.register(tools.mcpFixtureLookupTool);
    const result = await executeTool(registry, "mcp_fixture_lookup", { key: "alpha" }, "call-mcp-mismatch-1", [{
      toolName: "mcp_fixture_lookup",
      connectionRef: "conn_local_mcp_fixture",
      operations: ["lookup"],
      mcp: {
        endpointRef: "local-fixture-mcp",
        serverName: "agentlab-local-mcp",
        protocolVersion: "2025-06-18",
        toolName: "fixture.other",
        toolVersion: "1.0.0",
      },
    }]);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "TOOL_EXECUTION_FAILED");
    assert.equal(result.content.includes("fixture.other"), false);
  } finally {
    await server.close();
  }
});

test("the local HTTP provider makes approved writes idempotent", async () => {
  const server = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  try {
    const runtime = new HttpConnectionRuntime({ endpoint: `http://127.0.0.1:${server.port}` });
    const tools = createFixtureTools(runtime);
    const registry = new ToolRegistry({ enabledNames: [tools.fixtureWriteTool.definition.name], approvedNames: [tools.fixtureWriteTool.definition.name] });
    registry.register(tools.fixtureWriteTool);

    const first = await executeTool(registry, "fixture_write", { key: "learn", value: "connection" }, "call-write-1");
    const duplicate = await executeTool(registry, "fixture_write", { key: "learn", value: "connection" }, "call-write-1");

    assert.equal(first.status, "completed");
    assert.equal(duplicate.status, "completed");
    assert.deepEqual(duplicate.connection?.providerRequestIds, ["local-direct:fixture-run:fixture-turn:call-write-1"]);
  } finally {
    await server.close();
  }
});

test("a lost local write acknowledgement is reported as unknown", async () => {
  const server = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const runtime = new HttpConnectionRuntime({ endpoint: `http://127.0.0.1:${server.port}`, limits: {
    timeoutMs: 100,
    maxRequestBytes: 1_024,
    maxResponseBytes: 2_048,
    maxAttempts: 1,
  } });
  await server.close();

  const result = await runtime.request("conn_local_fixture", {
    requestId: "unknown-write-request",
    operation: "fixture.write",
    input: { key: "unknown", value: "outcome" },
    idempotencyKey: "unknown-write-key",
    limits: { timeoutMs: 100, maxRequestBytes: 1_024, maxResponseBytes: 2_048, maxAttempts: 1 },
  }, { readOnly: false, signal: new AbortController().signal });

  assert.equal(result.status, "unknown");
  assert.equal(result.error?.code, "API_OUTCOME_UNKNOWN");
});
