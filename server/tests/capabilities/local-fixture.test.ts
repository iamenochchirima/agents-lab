import assert from "node:assert/strict";
import test from "node:test";

import { HttpConnectionRuntime } from "../../src/capabilities/integrations/runtime.js";
import { createLocalFixtureServer } from "../../src/capabilities/integrations/local-fixture/service.js";
import { createFixtureTools } from "../../src/capabilities/tools/fixtures.js";
import { ToolRegistry } from "../../src/capabilities/tools/registry.js";

async function executeTool(
  registry: ToolRegistry,
  name: string,
  argumentsValue: Readonly<Record<string, unknown>>,
  toolCallId: string,
) {
  const validation = registry.validateCall({ toolCallId, name, arguments: argumentsValue, round: 1 });
  assert.equal(validation.accepted, true);
  if (!validation.accepted) throw new Error("Tool validation failed.");
  return registry.execute(validation, {
    runId: "fixture-run",
    turnId: "fixture-turn",
    toolCallId,
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
