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
