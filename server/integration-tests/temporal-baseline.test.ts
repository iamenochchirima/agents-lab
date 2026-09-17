import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../src/control-plane/application/run-service.js";
import type { PlatformExecutionReference } from "../src/control-plane/domain/types.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../src/capabilities/context/index.js";

const BASE_REQUEST = {
  platform: "temporal" as const,
  variant: "baseline" as const,
  task: { kind: "prompt" as const, prompt: "integration test prompt" },
  model: { provider: "fake" as const, model: "fake-success", contextWindowTokens: 128_000 },
};

/**
 * This suite intentionally requires a running local Temporal server and worker.
 * It is separate from `pnpm test` so unit tests stay offline, while the explicit
 * command fails with a useful timeout when the durable-execution profile is not
 * running instead of silently skipping the coverage.
 */
test("local Temporal baseline covers success, retry, ambiguity, timeout, cancellation, and reconciliation", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-temporal-integration-"));
  const config = loadServerConfig(
    {
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS: "500",
      AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_BACKOFF_MS: "25",
    },
    root,
  );
  const runners: TemporalBaselineRunner[] = [];

  try {
    const runner = await connectRunner(config);
    runners.push(runner);
    const store = new RunEvidenceStore(root);
    const service = createService(config, store, runner);

    const success = await service.createRun(BASE_REQUEST);
    const completed = await waitForTerminal(service, success.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result?.output, "Fake response: integration test prompt");
    await assertCompleteEvidence(root, completed, [
      "config.json",
      "events.jsonl",
      "trajectory.json",
      "metrics.json",
      "context.json",
      "result.json",
      "native/temporal.json",
    ]);
    assert.deepEqual(
      completed.events.map((event) => event.kind),
      ["RunCreated", "RunDispatched", "AgentStarted", "ContextPreparationStarted", "ContextPrepared", "ModelRequested", "ModelCompleted", "AgentCompleted", "RunCompleted"],
    );
    assert.ok(completed.context);
    assert.equal(completed.context?.budget.contextWindowTokens, 128_000);
    assert.equal(completed.context?.budget.quality, "estimated");
    assert.ok((completed.context?.budget.remainingPercent ?? 0) < 100);
    assert.ok(typeof completed.executionReference?.native.workflowId === "string");
    assert.ok(String(completed.executionReference?.native.workflowId).endsWith(completed.runId));
    assert.equal(completed.metrics?.modelCallCount, 1);

    const calculator = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "Use the calculator tool to add 17 and 25, then state the result." },
      model: { provider: "fake", model: "fake-tool-call", contextWindowTokens: 128_000 },
      capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 } },
    });
    const calculatorResult = await waitForTerminal(service, calculator.runId);
    assert.equal(calculatorResult.status, "completed");
    assert.equal(calculatorResult.result?.output, 'The calculator returned {"value":42}.');
    assert.deepEqual(calculatorResult.events.filter((event) => event.kind.startsWith("Tool")).map((event) => event.kind), [
      "ToolCallRequested",
      "ToolCallValidated",
      "ToolExecutionStarted",
      "ToolExecutionCompleted",
    ]);
    assert.equal(calculatorResult.metrics?.modelCallCount, 2);

    const retry = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "retry integration test" },
      model: { provider: "fake", model: "fake-pre-dispatch-retry", contextWindowTokens: 128_000 },
    });
    const retried = await waitForTerminal(service, retry.runId);
    assert.equal(retried.status, "completed");
    assert.equal(retried.result?.attemptCount, 2);
    assert.equal(retried.events.filter((event) => event.kind === "ModelRequested").length, 2);
    assert.equal(retried.events.filter((event) => event.kind === "ModelRetryScheduled").length, 1);

    const secondTurn = await service.createRun({
      ...BASE_REQUEST,
      sessionId: completed.context?.sessionId,
      task: { kind: "prompt", prompt: "Continue the same context" },
    });
    const continued = await waitForTerminal(service, secondTurn.runId);
    assert.equal(continued.status, "completed");
    assert.equal(continued.manifest.context.sessionId, completed.manifest.context.sessionId);
    assert.ok((continued.context?.budget.inputTokens ?? 0) > (completed.context?.budget.inputTokens ?? 0));

    const overflowSeed = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "seed context" },
      model: { provider: "fake", model: "fake-context-overflow", contextWindowTokens: 128_000 },
    });
    const seeded = await waitForTerminal(service, overflowSeed.runId);
    assert.equal(seeded.status, "completed");
    const overflow = await service.createRun({
      ...BASE_REQUEST,
      sessionId: seeded.context?.sessionId,
      task: { kind: "prompt", prompt: "recover context" },
      model: { provider: "fake", model: "fake-context-overflow", contextWindowTokens: 128_000 },
    });
    const recovered = await waitForTerminal(service, overflow.runId);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result?.output, "Fake response after context recovery: recover context");
    assert.equal(recovered.events.some((event) => event.kind === "ContextOverflowDetected"), true);
    assert.equal(recovered.events.some((event) => event.kind === "ContextRecoveryPrepared"), true);
    assert.ok((recovered.context?.compactionRevision ?? 0) > 0);

    const ambiguous = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "ambiguous integration test" },
      model: { provider: "fake", model: "fake-ambiguous", contextWindowTokens: 128_000 },
    });
    const ambiguousResult = await waitForTerminal(service, ambiguous.runId);
    assert.equal(ambiguousResult.status, "failed");
    assert.equal(ambiguousResult.result?.error?.failureKind, "outcome_unknown");
    assert.equal(ambiguousResult.events.filter((event) => event.kind === "ModelRequested").length, 1);
    assert.equal(ambiguousResult.events.some((event) => event.kind === "ModelRetryScheduled"), false);

    const timedOut = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "timeout integration test" },
      model: { provider: "fake", model: "fake-timeout", contextWindowTokens: 128_000 },
    });
    const timedOutResult = await waitForTerminal(service, timedOut.runId);
    assert.equal(timedOutResult.status, "failed");
    assert.equal(timedOutResult.result?.error?.failureKind, "timeout");
    assert.equal(timedOutResult.result?.error?.code, "MODEL_ACTIVITY_TIMEOUT");

    const cancelled = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "cancellation integration test" },
      model: { provider: "fake", model: "fake-cancel", contextWindowTokens: 128_000 },
    });
    await waitForEvent(service, cancelled.runId, "ModelRequested");
    const cancellationRequest = await service.cancelRun(cancelled.runId, "integration cancellation");
    assert.ok(cancellationRequest.status === "running" || cancellationRequest.status === "cancelled");
    const cancelledResult = await waitForTerminal(service, cancelled.runId);
    assert.equal(cancelledResult.status, "cancelled");
    assert.equal(cancelledResult.result?.error?.failureKind, "cancelled");
    assert.equal(cancelledResult.events.some((event) => event.kind === "RunCompleted"), false);
    assert.equal((await service.cancelRun(cancelled.runId, "repeat cancellation")).status, "cancelled");

    // Let the workflow finish while no server reads it. A new
    // service instance then projects the retained Temporal intents exactly once.
    const outageRun = await service.createRun({
      ...BASE_REQUEST,
      task: { kind: "prompt", prompt: "reconciliation integration test" },
      model: { provider: "fake", model: "fake-timeout", contextWindowTokens: 128_000 },
    });
    await waitForTemporalTerminal(runner, outageRun.executionReference);
    const restartedRunner = await connectRunner(config);
    runners.push(restartedRunner);
    const restartedService = createService(config, store, restartedRunner);
    const reconciled = await waitForTerminal(restartedService, outageRun.runId);
    assert.equal(reconciled.status, "failed");
    assert.equal(reconciled.events.filter((event) => event.kind === "RunFailed").length, 1);
    assert.equal((await restartedService.getRun(outageRun.runId)).events.length, reconciled.events.length);
  } finally {
    await Promise.all(runners.map((runner) => runner.close()));
    await rm(root, { recursive: true, force: true });
  }
});

async function connectRunner(config: ReturnType<typeof loadServerConfig>): Promise<TemporalBaselineRunner> {
  try {
    return await TemporalBaselineRunner.connect(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Local Temporal is not available at ${config.temporal.endpoint}. Start Temporal and the Lab worker before running pnpm run test:temporal. ${message}`);
  }
}

function createService(
  config: ReturnType<typeof loadServerConfig>,
  store: RunEvidenceStore,
  runner: TemporalBaselineRunner,
): RunService {
  return new RunService({
    config,
    context: new ContextService(new ContextSessionStore(config.contextRoot), new CharacterTokenEstimator()),
    evidence: store,
    registry: new PlatformRegistry([runner]),
  });
}

async function waitForTerminal(service: RunService, runId: string): Promise<RunView> {
  let latest: RunView | null = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    latest = await service.getRun(runId);
    if (latest.status === "completed" || latest.status === "failed" || latest.status === "cancelled" || latest.status === "reconciliation_required") {
      return latest;
    }
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Temporal workflow did not reach a terminal state within 10 seconds for ${runId}. Last status: ${latest?.status ?? "unknown"}. Is the worker running on the configured task queue?`);
}

async function waitForEvent(service: RunService, runId: string, kind: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const view = await service.getRun(runId);
    if (view.events.some((event) => event.kind === kind)) return;
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Event ${kind} was not observed for ${runId} within 10 seconds.`);
}

async function waitForTemporalTerminal(runner: TemporalBaselineRunner, reference: PlatformExecutionReference | null): Promise<void> {
  if (!reference) throw new Error("The outage test did not retain a Temporal execution reference.");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const inspection = await runner.inspect(reference);
    if (inspection.status === "completed" || inspection.status === "failed" || inspection.status === "cancelled") return;
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Temporal workflow ${reference.executionId} did not finish while the server projection was idle.`);
}

async function assertCompleteEvidence(root: string, run: RunView, expectedFiles: readonly string[]): Promise<void> {
  assert.ok(run.result);
  assert.ok(run.trajectory);
  assert.ok(run.metrics);
  assert.ok(run.executionReference);
  assert.deepEqual(run.metrics?.status, run.result?.status);
  await readEvidenceFiles(root, run.runId, expectedFiles);
}

async function readEvidenceFiles(root: string, runId: string, expectedFiles: readonly string[]): Promise<void> {
  const directory = join(root, runId);
  for (const file of expectedFiles) {
    await readFile(join(directory, file), "utf8");
  }
  const topLevel = await readdir(directory);
  assert.ok(topLevel.includes("logs"));
  assert.ok(topLevel.includes("artifacts"));
  assert.ok(topLevel.includes("native"));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
