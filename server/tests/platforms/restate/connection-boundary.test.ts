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

test("Restate preserves a known failed MCP read as correlated model feedback", async () => {
  const result = await runMcpWorkflow("restate-mcp-failure", { mcpCallBehavior: "error" }, undefined, true);
  assert.equal(result.status, "completed");
  assert.equal(result.error, null);
  const failure = result.eventIntents.find((event) => event.kind === "ToolExecutionFailed");
  assert.equal(failure?.payload.connection && (failure.payload.connection as { errorCode?: string }).errorCode, "MCP_CALL_FAILED");
  const tool = result.eventIntents.find(event => event.kind === "EvalToolObserved");
  assert.equal(tool?.payload.status, "failed");
  const requests = result.eventIntents.filter(event => event.kind === "EvalModelObserved");
  assert.equal(requests.length, 2);
  const next = requests[1]?.payload.observation as { messages?: { role: string; toolCallId?: string; content?: string }[] };
  const feedback = next.messages?.find(message => message.role === "tool" && message.toolCallId === tool?.payload.toolCallId);
  assert.equal(feedback?.content, tool?.payload.output);
  assert.deepEqual(JSON.parse(feedback?.content ?? "null"), {
    error: "The deterministic MCP fixture rejected the call.", code: "TOOL_EXECUTION_FAILED",
  });
  assert.equal(result.output, `Tool feedback: ${feedback?.content}`);
  assert.equal(result.eventIntents.filter(event => event.kind === "ToolExecutionStarted").length, 1);
  assert.equal(result.eventIntents.filter(event => event.kind === "ToolExecutionCompleted").length, 0);
});

test("Restate preserves an ambiguous MCP dispatch and does not retry it", async () => {
  const result = await runMcpWorkflow("restate-mcp-unknown", { mcpCallBehavior: "disconnect" });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_UNKNOWN");
  assert.equal(result.error?.failureKind, "outcome_unknown");
  const unknown = result.eventIntents.find((event) => event.kind === "ToolExecutionUnknown");
  assert.equal(unknown?.payload.connection && (unknown.payload.connection as { status?: string }).status, "unknown");
  assert.equal(unknown?.payload.connection && (unknown.payload.connection as { attemptCount?: number }).attemptCount, 1);
});

test("Restate preserves cancellation while an MCP action is in flight", async () => {
  const controller = new AbortController();
  const pending = runMcpWorkflow("restate-mcp-cancel", { mcpCallBehavior: "delay", mcpCallDelayMs: 250 }, controller.signal);
  setTimeout(() => controller.abort(new Error("cancelled by test")), 10);
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "TOOL_CANCELLED");
  assert.equal(result.error?.failureKind, "cancelled");
  assert.equal(result.eventIntents.at(-1)?.kind, "RunCancelled");
});

async function runMcpWorkflow(
  runId: string,
  fixtureOptions: { readonly mcpCallBehavior: "error" | "disconnect" | "delay"; readonly mcpCallDelayMs?: number },
  signal = new AbortController().signal,
  observeFeedback = false,
) {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, ...fixtureOptions });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    return await workflowRun(createContext(signal), {
      runId,
      prompt: observeFeedback ? `[eval-behaviour:${Buffer.from(JSON.stringify({ action: "tool", toolName: "mcp_fixture_lookup", input: { key: "alpha" } })).toString("base64url")}]`
        : "Read the alpha fixture through MCP.",
      systemInstruction: "Use the selected MCP connection.",
      model: { provider: "fake", model: observeFeedback ? "fake-eval-behaviour" : "fake-mcp-connected-tool" },
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
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
  }
}

function createContext(signal = new AbortController().signal) {
  let timestamp = Date.parse("2026-09-20T00:00:00.000Z");
  return {
    key: "agentlab:restate-http-connection",
    request: () => ({ id: "restate-http-invocation", attemptCompletedSignal: signal }),
    date: { toJSON: async () => new Date(timestamp += 1).toISOString() },
    set: (_name: string, _value: unknown) => undefined,
    run: async <T>(_name: string, action: () => Promise<T> | T): Promise<T> => action(),
  };
}
