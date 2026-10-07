import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { createLocalFixtureServer } from "../../../src/capabilities/integrations/local-fixture/service.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";
import { MastraWorkflowRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-workflow-runner.js";

test("Mastra workflow completes a native stored run", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-"));
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const manifest = manifestFor(runner, "Say hello.");
    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);

    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.status, "completed");
    assert.equal(inspection.result?.output, "Deterministic Mastra response.");
    assert.equal(inspection.reference.native.nativeStatus, "success");
    assert.equal(inspection.reference.native.evidenceSchema, "mastra.native.v2");
    assert.equal(inspection.reference.native.eventCount, inspection.eventIntents.length);
    assert.equal(inspection.reference.native.toolCallCount, 0);
    assert.ok(inspection.eventIntents.some((event) => event.kind === "WorkflowCompleted"));
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow shares the call budget across tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-budget-"));
  let requests = 0;
  const runner = new MastraWorkflowRunner({
    storagePath: join(root, "workflow.db"),
    modelFactory: () => ({
      specificationVersion: "v2", provider: "agentlab.fake", modelId: "fake-success", supportedUrls: {},
      doStream: async () => { throw new Error("This fixture supports generate only."); },
      doGenerate: async () => {
        const toolName = ["calculator", "fixture_lookup"][requests++];
        return {
          content: toolName ? [{
            type: "tool-call", toolCallId: `budget-${requests}`, toolName,
            input: JSON.stringify(toolName === "calculator" ? { operation: "add", left: 17, right: 25 } : { key: "alpha" }),
          }] : [{ type: "text", text: "Done." }],
          finishReason: toolName ? "tool-calls" : "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [],
        };
      },
    } as ReturnType<typeof createDeterministicFakeModel>),
  });
  try {
    const manifest = buildRunManifest({
      platform: "mastra", variant: "workflow", task: { kind: "prompt", prompt: "Exercise limits." },
      model: { provider: "fake", model: "fake-success" },
      capabilities: { tools: { enabledNames: ["calculator", "fixture_lookup"], maxCalls: 1, maxRounds: 4 } },
    }, { runId: "mastra-workflow-budget", platformConfig: runner.manifestConfiguration() });
    const inspection = await waitForStatus(runner, await runner.start(manifest), "failed");
    assert.equal(inspection.eventIntents.filter((event) => event.kind === "ToolExecutionStarted").length, 1);
    assert.equal(inspection.eventIntents.filter((event) =>
      event.kind === "ToolCallRejected" && event.payload.code === "TOOL_CALL_LIMIT_EXCEEDED").length, 1);
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow passes the server-owned MCP binding into its native agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-mcp-"));
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const manifest = buildRunManifest({
      platform: "mastra",
      variant: "workflow",
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
    }, { runId: "mastra-workflow-mcp", platformConfig: runner.manifestConfiguration() });
    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);
    assert.equal(inspection.status, "completed");
    assert.match(inspection.result?.output ?? "", /local fixture/);
    const completion = inspection.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
    assert.equal(completion?.payload.toolName, "mcp_fixture_lookup");
    assert.equal((completion?.payload.connection as { mcp?: { toolName?: string } } | undefined)?.mcp?.toolName, "fixture.lookup");
  } finally {
    await runner.close();
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow restores persisted MCP lifecycle evidence after runner replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-mcp-replacement-"));
  const storagePath = join(root, "workflow.db");
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  const original = new MastraWorkflowRunner({ storagePath });

  try {
    const manifest = buildRunManifest({
      platform: "mastra",
      variant: "workflow",
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
    }, { runId: "mastra-workflow-mcp-replacement", platformConfig: original.manifestConfiguration() });
    const reference = await original.start(manifest);
    const completed = await waitForTerminal(original, reference);
    assert.equal(completed.status, "completed");
    assert.ok(completed.eventIntents.some((event) => event.kind === "ToolExecutionCompleted"));
    await original.close();

    const replacement = new MastraWorkflowRunner({ storagePath });
    try {
      const inspected = await replacement.inspect(reference);
      assert.equal(inspected.status, "completed");
      assert.ok(inspected.eventIntents.some((event) => event.kind === "ToolExecutionCompleted"));
      assert.equal(inspected.reference.native.toolCallCount, 1);
    } finally {
      await replacement.close();
    }
  } finally {
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow preserves an unknown MCP outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-mcp-unknown-"));
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "disconnect" });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const manifest = buildRunManifest({
      platform: "mastra",
      variant: "workflow",
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
    }, { runId: "mastra-workflow-mcp-unknown", platformConfig: runner.manifestConfiguration() });
    const reference = await runner.start(manifest);
    const inspection = await waitForStatus(runner, reference, "failed");
    assert.equal(inspection.result?.error?.code, "TOOL_UNKNOWN");
    assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
    const unknown = inspection.eventIntents.find((event) => event.kind === "ToolExecutionUnknown");
    assert.equal((unknown?.payload.connection as { status?: string } | undefined)?.status, "unknown");
  } finally {
    await runner.close();
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow preserves a known MCP provider failure before model recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-mcp-failure-"));
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "error" });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const reference = await runner.start(mcpManifest(runner, "mastra-workflow-mcp-failure"));
    const completed = await waitForStatus(runner, reference, "completed");
    assert.equal(completed.result?.status, "completed");
    assert.ok(completed.eventIntents.some((event) => event.kind === "ToolExecutionFailed"));
  } finally {
    await runner.close();
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow preserves cancellation during an MCP call", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-mcp-cancel-"));
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "delay", mcpCallDelayMs: 5_000 });
  const previousFixtureUrl = process.env.AGENTLAB_LOCAL_FIXTURE_URL;
  process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixture.port}`;
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const reference = await runner.start(mcpManifest(runner, "mastra-workflow-mcp-cancel"));
    await waitForEvent(runner, reference, "ToolExecutionStarted");
    const cancellation = await runner.cancel(reference, "stop MCP call for test");
    assert.equal(cancellation.accepted, true);
    const cancelled = await waitForStatus(runner, reference, "cancelled");
    assert.equal(cancelled.result?.error?.failureKind, "cancelled");
    assert.ok(cancelled.eventIntents.some((event) => event.kind === "RunCancelled"));
  } finally {
    await runner.close();
    if (previousFixtureUrl === undefined) delete process.env.AGENTLAB_LOCAL_FIXTURE_URL;
    else process.env.AGENTLAB_LOCAL_FIXTURE_URL = previousFixtureUrl;
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow reports an invalid storage path as unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-storage-error-"));
  const storageDirectory = join(root, "workflow-storage-directory");
  await mkdir(storageDirectory);

  const runner = new MastraWorkflowRunner({ storagePath: storageDirectory });
  try {
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, false);
    assert.match(connectivity.message, /storage|database|connection/i);
    await assert.rejects(runner.start(manifestFor(runner, "Say hello.", "mastra-invalid-storage")), /storage|database|connection/i);
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow reports a corrupt storage file as unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-corrupt-storage-"));
  const storagePath = join(root, "workflow.db");
  await writeFile(storagePath, "not a sqlite database", "utf8");
  const runner = new MastraWorkflowRunner({ storagePath });

  try {
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, false);
    assert.match(connectivity.message, /storage|database|connection|malformed/i);
    await assert.rejects(runner.start(manifestFor(runner, "Say hello.", "mastra-corrupt-storage")), /storage|database|connection|malformed/i);
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow suspends, resumes, and can be inspected by a replacement runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-resume-"));
  const storagePath = join(root, "workflow.db");
  const original = new MastraWorkflowRunner({ storagePath });
  const manifest = manifestFor(original, "[approval] Publish the prepared post.", "mastra-workflow-approval");
  const reference = await original.start(manifest);
  const suspended = await waitForStatus(original, reference, "suspended");
  assert.equal(suspended.result, null);
  assert.equal(suspended.reference.native.nativeStatus, "suspended");
  assert.equal(suspended.reference.native.evidenceSchema, "mastra.native.v2");
  assert.equal(suspended.reference.native.eventCount, suspended.eventIntents.length);
  await original.close();

  const replacement = new MastraWorkflowRunner({ storagePath });
  try {
    const duplicateStart = await replacement.start(manifest);
    assert.deepEqual(duplicateStart, reference);
    const recovered = await replacement.inspect(reference);
    assert.equal(recovered.status, "suspended");
    assert.ok(recovered.eventIntents.some((event) => event.kind === "WorkflowSuspended"));

    await assert.rejects(
      replacement.resume(reference, { approved: "yes" }),
      /approved boolean/,
    );
    const resume = await replacement.resume(reference, { approved: true });
    assert.equal(resume.accepted, true);
    const completed = await waitForTerminal(replacement, reference);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result?.output, "Deterministic Mastra response.");
    assert.ok(completed.eventIntents.some((event) => event.kind === "WorkflowResumed"));
  } finally {
    await replacement.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow cancellation remains cancelled after native inspection", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-cancel-"));
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const reference = await runner.start(manifestFor(runner, "Run slowly.", "mastra-workflow-cancel", "fake-slow"));
    const cancellation = await runner.cancel(reference, "stop for test");
    assert.equal(cancellation.accepted, true);
    const cancelled = await waitForStatus(runner, reference, "cancelled");
    assert.equal(cancelled.result?.status, "cancelled");
    assert.equal(cancelled.result?.error?.failureKind, "cancelled");
    assert.ok(cancelled.eventIntents.some((event) => event.kind === "RunCancelled"));
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

function manifestFor(
  runner: MastraWorkflowRunner,
  prompt: string,
  runId = `mastra-workflow-${prompt.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  model = "fake-success",
): RunManifest {
  return buildRunManifest(
    {
      platform: "mastra",
      variant: "workflow",
      task: { kind: "prompt", prompt },
      model: { provider: "fake", model },
    },
    { runId, platformConfig: runner.manifestConfiguration() },
  );
}

function mcpManifest(runner: MastraWorkflowRunner, runId: string): RunManifest {
  return buildRunManifest({
    platform: "mastra",
    variant: "workflow",
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
  }, { runId, platformConfig: runner.manifestConfiguration() });
}

async function waitForTerminal(
  runner: MastraWorkflowRunner,
  reference: Awaited<ReturnType<MastraWorkflowRunner["start"]>>,
) {
  return waitForStatus(runner, reference, "completed");
}

async function waitForStatus(
  runner: MastraWorkflowRunner,
  reference: Awaited<ReturnType<MastraWorkflowRunner["start"]>>,
  expected: "suspended" | "completed" | "failed" | "cancelled",
) {
  let lastStatus: string | undefined;
  let lastEvents: readonly string[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    lastStatus = inspection.status;
    lastEvents = inspection.eventIntents.map((event) => event.kind);
    if (inspection.status === expected) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Mastra workflow did not reach ${expected}; last status=${lastStatus ?? "unknown"}, events=${lastEvents.join(",")}.`);
}

async function waitForEvent(
  runner: MastraWorkflowRunner,
  reference: Awaited<ReturnType<MastraWorkflowRunner["start"]>>,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.eventIntents.some((event) => event.kind === expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Mastra workflow did not emit ${expected}.`);
}
