import assert from "node:assert/strict";
import test from "node:test";

import { createLocalFixtureServer } from "../../../src/capabilities/integrations/local-fixture/service.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { PlatformExecutionReference } from "../../../src/control-plane/domain/types.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";

test("Mastra native tool execution crosses the local HTTP connection boundary", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const runner = new MastraBaselineRunner();
    const manifest = buildRunManifest({
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Read the alpha fixture." },
      model: { provider: "fake", model: "fake-connected-tool" },
      capabilities: {
        tools: { enabledNames: ["fixture_lookup"], maxRounds: 3, maxCalls: 2 },
        connections: [{ toolName: "fixture_lookup", connectionRef: "conn_local_fixture", operations: ["lookup"] }],
      },
    }, { runId: "mastra-http-connection", platformConfig: runner.manifestConfiguration() });

    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);
    assert.equal(inspection.result?.status, "completed");
    const completion = inspection.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
    assert.equal(completion?.payload.toolName, "fixture_lookup");
    assert.deepEqual(completion?.payload.connection, {
      requestId: "mastra-http-connection:mastra-http-connection_turn_1:mastra-fixture-lookup-1",
      status: "completed",
      attemptCount: 1,
      providerRequestIds: ["local-direct:mastra-http-connection:mastra-http-connection_turn_1:mastra-fixture-lookup-1"],
      errorCode: null,
    });
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
  }
});

test("Mastra native MCP tool crosses the local Streamable HTTP boundary", async () => {
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  try {
    const runner = new MastraBaselineRunner();
    const manifest = buildRunManifest({
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Read the alpha fixture through MCP." },
      model: { provider: "fake", model: "fake-mcp-connected-tool" },
      capabilities: {
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
      },
    }, { runId: "mastra-mcp-connection", platformConfig: runner.manifestConfiguration() });

    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);
    assert.equal(inspection.result?.status, "completed");
    const completion = inspection.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
    assert.equal(completion?.payload.toolName, "mcp_fixture_lookup");
    assert.deepEqual(completion?.payload.connection, {
      requestId: "mastra-mcp-connection:mastra-mcp-connection:turn:1:mastra-mcp-fixture-lookup-1",
      status: "completed",
      attemptCount: 1,
      providerRequestIds: ["mcp-http:mastra-mcp-connection:mastra-mcp-connection:turn:1:mastra-mcp-fixture-lookup-1"],
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

async function waitForTerminal(runner: MastraBaselineRunner, reference: PlatformExecutionReference) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Mastra connection boundary run did not reach a terminal result.");
}
