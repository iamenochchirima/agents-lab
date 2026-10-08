import { retainRestartEvidence } from "../src/evals/restart-evidence.js";
import { Client, Connection } from "@temporalio/client";
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createLocalFixtureServer } from "../src/capabilities/integrations/local-fixture/service.js";
import { createDefaultCapabilityCatalog } from "../src/capabilities/catalog.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";

test(
  "native Temporal replays a completed MCP Activity and preserves an unknown in-flight model outcome after worker replacement",
  {
    skip:
      process.env.AGENTLAB_RUN_TEMPORAL_NATIVE_MCP_RESTART_INTEGRATION === "1"
        ? false
        : "Set AGENTLAB_RUN_TEMPORAL_NATIVE_MCP_RESTART_INTEGRATION=1 to run the isolated native MCP restart exercise.",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "agentlab-temporal-mcp-restart-"));
    const contextRoot = await mkdtemp(join(tmpdir(), "agentlab-temporal-mcp-context-"));
    const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
    const taskQueue = `agentlab-temporal-mcp-${Date.now()}`;
    const environment = {
      ...process.env,
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_X01_MODEL_ATTEMPTS_FILE: join(root, "synthetic-model-attempts.jsonl"),
      AGENTLAB_CONTEXT_ROOT: contextRoot,
      AGENTLAB_TEMPORAL_ENDPOINT: process.env.AGENTLAB_TEMPORAL_ENDPOINT ?? "localhost:7233",
      AGENTLAB_TEMPORAL_NAMESPACE: process.env.AGENTLAB_TEMPORAL_NAMESPACE ?? "default",
      AGENTLAB_TEMPORAL_TASK_QUEUE: taskQueue,
      AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS: "30000",
      AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS: "2000",
      AGENTLAB_LOCAL_FIXTURE_URL: `http://127.0.0.1:${fixture.port}`,
      AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
    };
    let worker: ChildProcess | null = null;
    let runner: TemporalBaselineRunner | null = null;

    try {
      const config = loadServerConfig(environment, process.cwd());
      worker = startWorker(environment);
      runner = await TemporalBaselineRunner.connect(config);
      const service = new RunService({
        config,
        context: new ContextService(new ContextSessionStore(contextRoot), new CharacterTokenEstimator()),
        evidence: new RunEvidenceStore(root),
        registry: new PlatformRegistry([runner]),
        capabilities: createDefaultCapabilityCatalog(),
      });

      const created = await service.createRun({
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Replay the completed MCP Activity after the worker is replaced." },
        model: { provider: "fake", model: "fake-mcp-tool-call-delay", contextWindowTokens: 16_384 },
        capabilities: {
          profileId: "local-mcp-safe",
          tools: { enabledNames: [], maxRounds: 3, maxCalls: 2 },
        },
      });

      await waitForModelActivityAfterMcp(service, created.runId, worker);
      const beforeRestart = await service.getRun(created.runId);
      const providerCallsBefore = fixture.mcpCallCount;
      worker.kill("SIGKILL");
      await new Promise<void>(done => worker!.once("exit", () => done()));
      worker = startWorker(environment);
      const completed = await waitForTerminal(service, created.runId);

      assert.equal(completed.status, "failed", JSON.stringify({ result: completed.result, events: completed.events.map((event) => event.kind) }));
      assert.equal(completed.result?.error?.failureKind, "outcome_unknown");
      const toolCompletion = completed.events.find((event) => event.kind === "ToolExecutionCompleted" && event.payload.toolName === "mcp_fixture_lookup");
      assert.ok(toolCompletion);
      assert.equal((toolCompletion.payload.connection as { providerRequestIds?: readonly string[] } | undefined)?.providerRequestIds?.length, 1);
      assert.equal(fixture.mcpCallCount, 1, "Temporal history must replay the completed MCP Activity instead of dispatching it again");
      assert.equal(completed.executionReference?.native.workflowId, `agentlab:${created.runId}`);
      const connection = await Connection.connect({ address: environment.AGENTLAB_TEMPORAL_ENDPOINT });
      try {
        const history = await new Client({ connection, namespace: environment.AGENTLAB_TEMPORAL_NAMESPACE }).workflow.getHandle(`agentlab:${created.runId}`).fetchHistory();
        const scheduled = new Set((history.events ?? []).filter(event => event.activityTaskScheduledEventAttributes?.activityType?.name === "requestModel").map(event => String(event.eventId)));
        const activityAttempts = (history.events ?? []).filter(event => event.activityTaskStartedEventAttributes && scheduled.has(String(event.activityTaskStartedEventAttributes.scheduledEventId))).length;
        await retainRestartEvidence(process.env.AGENTLAB_X01_EVIDENCE, { platform: "temporal", deployment: `native:${environment.AGENTLAB_TEMPORAL_ENDPOINT}/${taskQueue}`, runId: created.runId,
          before: { status: beforeRestart.status, events: beforeRestart.events, native: beforeRestart.executionReference }, after: { status: completed.status, events: completed.events, result: completed.result, native: completed.executionReference },
          beforeModelOutcomePersistence: beforeRestart.events.filter(event => event.kind === "ModelRequested").length >= 2 && beforeRestart.status === "running",
          afterToolPersistence: beforeRestart.events.some(event => event.kind === "ToolExecutionCompleted"),
          sameNativeIdentity: beforeRestart.executionReference?.executionId === completed.executionReference?.executionId,
          retainedState: !!toolCompletion && completed.result?.error?.failureKind === "outcome_unknown", providerCallsBefore, providerCallsAfter: fixture.mcpCallCount,
          normalizedModelRequests: completed.events.filter(event => event.kind === "ModelRequested").length, nativeModelActivityAttempts: activityAttempts, providerModelDispatches: (await readFile(environment.AGENTLAB_X01_MODEL_ATTEMPTS_FILE, "utf8")).trim().split("\n").map(line => JSON.parse(line)) });
      } finally { await connection.close(); }
    } finally {
      // Let timed-out workflow queries settle while the replacement worker can
      // still service them, then close the client before stopping that worker.
      await delay(2_500);
      await runner?.close();
      await stopWorker(worker);
      await fixture.close();
      await rm(root, { recursive: true, force: true });
      await rm(contextRoot, { recursive: true, force: true });
    }
  },
);

function startWorker(environment: NodeJS.ProcessEnv): ChildProcess {
  const entrypoint = resolve(process.cwd(), "dist/src/platforms/temporal/runner-adapter/worker-entry.js");
  return spawn(process.execPath, ["--enable-source-maps", entrypoint], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForModelActivityAfterMcp(service: RunService, runId: string, worker: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await service.getRun(runId);
    const mcpCompleted = run.events.some((event) => event.kind === "ToolExecutionCompleted" && event.payload.toolName === "mcp_fixture_lookup");
    const modelRequests = run.events.filter((event) => event.kind === "ModelRequested");
    if (mcpCompleted && modelRequests.length >= 2) return;
    if (worker.exitCode !== null) throw new Error(`Temporal worker exited before the MCP Activity ran with code ${worker.exitCode}.`);
    await delay(50);
  }
  throw new Error("Temporal did not reach the in-flight post-MCP model Activity before the replacement window.");
}

async function waitForTerminal(service: RunService, runId: string): Promise<RunView> {
  const deadline = Date.now() + 45_000;
  let latest: RunView | null = null;
  while (Date.now() < deadline) {
    latest = await service.getRun(runId);
    if (["completed", "failed", "cancelled", "reconciliation_required"].includes(latest.status)) return latest;
    await delay(100);
  }
  throw new Error(`Temporal MCP restart run did not reach a terminal result: ${latest?.status ?? "unknown"}.`);
}

async function stopWorker(worker: ChildProcess | null): Promise<void> {
  if (!worker || worker.exitCode !== null) return;
  worker.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => worker.once("exit", () => resolveExit())),
    delay(5_000).then(() => {
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }),
  ]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
