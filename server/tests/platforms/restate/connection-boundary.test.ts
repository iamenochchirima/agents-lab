import assert from "node:assert/strict";
import test from "node:test";

import { createLocalFixtureServer } from "../../../src/capabilities/integrations/local-fixture/service.js";
import { baselineWorkflow } from "../../../src/platforms/restate/variants/baseline/workflow.js";
import type { RestateWorkflowInput, RestateWorkflowResult } from "../../../src/platforms/restate/variants/baseline/contracts.js";

const workflowRun = (baselineWorkflow as unknown as {
  readonly workflow: {
    readonly run: (context: unknown, input: RestateWorkflowInput) => Promise<RestateWorkflowResult>;
  };
}).workflow.run;

test("Restate native tool execution crosses the local HTTP connection boundary", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const result = await workflowRun(createContext(), {
      runId: "restate-http-connection",
      prompt: "Read the alpha fixture.",
      systemInstruction: "Use the selected connection.",
      model: { provider: "fake", model: "fake-connected-tool" },
      tools: { enabledNames: ["fixture_lookup"], maxRounds: 3, maxCalls: 2 },
      connections: [{ toolName: "fixture_lookup", connectionRef: "conn_local_fixture", operations: ["lookup"] }],
    });

    assert.equal(result.status, "completed");
    const completion = result.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
    assert.equal(completion?.payload.toolName, "fixture_lookup");
    assert.deepEqual(completion?.payload.connection, {
      requestId: "restate-http-connection:restate-http-connection_turn_1:call-fixture-lookup-1",
      status: "completed",
      attemptCount: 1,
      providerRequestIds: ["local-direct:restate-http-connection:restate-http-connection_turn_1:call-fixture-lookup-1"],
      errorCode: null,
    });
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
  }
});

test("Restate native MCP action crosses the local Streamable HTTP boundary", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const result = await workflowRun(createContext(), {
      runId: "restate-mcp-connection",
      prompt: "Read the alpha fixture through MCP.",
      systemInstruction: "Use the selected MCP connection.",
      model: { provider: "fake", model: "fake-mcp-connected-tool" },
      tools: { enabledNames: ["mcp_fixture_lookup"], maxRounds: 3, maxCalls: 2 },
      connections: [{
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
    });

    assert.equal(result.status, "completed");
    const completion = result.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
    assert.equal(completion?.payload.toolName, "mcp_fixture_lookup");
    assert.deepEqual(completion?.payload.connection, {
      requestId: "restate-mcp-connection:restate-mcp-connection:turn:1:call-mcp-fixture-lookup-1",
      status: "completed",
      attemptCount: 1,
      providerRequestIds: ["mcp-http:restate-mcp-connection:restate-mcp-connection:turn:1:call-mcp-fixture-lookup-1"],
      errorCode: null,
      mcp: {
        endpointRef: "local-fixture-mcp",
        serverName: "agentlab-local-mcp",
        protocolVersion: "2025-06-18",
        toolName: "fixture.lookup",
        toolVersion: "1.0.0",
        phase: "invocation",
      },
    });
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
  }
});

function createContext() {
  let timestamp = Date.parse("2026-09-20T00:00:00.000Z");
  return {
    key: "agentlab:restate-http-connection",
    request: () => ({ id: "restate-http-invocation", attemptCompletedSignal: new AbortController().signal }),
    date: { toJSON: async () => new Date(timestamp += 1).toISOString() },
    set: (_name: string, _value: unknown) => undefined,
    run: async <T>(_name: string, action: () => Promise<T> | T): Promise<T> => action(),
  };
}
