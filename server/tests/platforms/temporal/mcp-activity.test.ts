import assert from "node:assert/strict";
import test from "node:test";

import { createLocalFixtureServer } from "../../../src/capabilities/integrations/local-fixture/service.js";
import { executeToolWithSignal } from "../../../src/platforms/temporal/variants/baseline/activities.js";

test("Temporal MCP tool activity crosses the local HTTP boundary", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const result = await executeToolWithSignal({
      runId: "temporal-mcp-activity",
      turnId: "temporal-mcp-turn",
      enabledNames: ["mcp_fixture_lookup"],
      connectionBindings: [{
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
      }],
      call: {
        toolCallId: "temporal-mcp-call-1",
        name: "mcp_fixture_lookup",
        arguments: { key: "alpha" },
        round: 1,
      },
    }, new AbortController().signal);

    assert.equal(result.status, "completed");
    assert.equal(result.content, '{"key":"alpha","value":"local fixture alpha"}');
    assert.deepEqual(result.connection?.providerRequestIds, ["mcp-http:temporal-mcp-activity:temporal-mcp-turn:temporal-mcp-call-1"]);
    assert.equal(result.connection?.mcp?.phase, "invocation");
    assert.equal(result.connection?.mcp?.toolName, "fixture.lookup");
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
  }
});

test("Temporal MCP Activity preserves a provider-declared failure", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "error" });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const result = await executeToolWithSignal(mcpInput("temporal-mcp-failure"), new AbortController().signal);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "TOOL_EXECUTION_FAILED");
    assert.equal(result.connection?.errorCode, "MCP_CALL_FAILED");
    assert.equal(result.connection?.mcp?.phase, "invocation");
    assert.equal(result.attemptCount, 1);
  } finally {
    restoreFixtureUrl(previousFixtureUrl);
    await fixture.close();
  }
});

test("Temporal MCP Activity reports an ambiguous dispatch without retrying", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "disconnect" });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const result = await executeToolWithSignal(mcpInput("temporal-mcp-unknown"), new AbortController().signal);
    assert.equal(result.status, "unknown");
    assert.equal(result.error?.code, "TOOL_UNKNOWN");
    assert.equal(result.connection?.errorCode, "MCP_OUTCOME_UNKNOWN");
    assert.equal(result.connection?.attemptCount, 1);
  } finally {
    restoreFixtureUrl(previousFixtureUrl);
    await fixture.close();
  }
});

test("Temporal MCP Activity preserves cancellation during an in-flight call", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "delay", mcpCallDelayMs: 250 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const controller = new AbortController();
    const pending = executeToolWithSignal(mcpInput("temporal-mcp-cancel"), controller.signal);
    setTimeout(() => controller.abort(new Error("cancelled by test")), 80);
    const result = await pending;
    assert.equal(result.status, "cancelled");
    assert.equal(result.error?.code, "TOOL_CANCELLED");
    assert.equal(result.connection?.errorCode, "MCP_CANCELLED");
  } finally {
    restoreFixtureUrl(previousFixtureUrl);
    await fixture.close();
  }
});

function mcpInput(runId: string) {
  return {
    runId,
    turnId: `${runId}:turn`,
    enabledNames: ["mcp_fixture_lookup"],
    connectionBindings: [{
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
    }],
    call: {
      toolCallId: `${runId}-call`,
      name: "mcp_fixture_lookup",
      arguments: { key: "alpha" },
      round: 1,
    },
  } as const;
}

function restoreFixtureUrl(previousFixtureUrl: string | undefined): void {
  if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
}
