import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import type {
  RunEventIntent,
  RunManifest,
  RunResult,
  WorkflowExecutionReference,
} from "../../src/control-plane/domain/types.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../src/control-plane/ports/runner.js";

class FakeRunner implements PlatformRunner {
  readonly platform = "temporal" as const;
  readonly variant = "baseline" as const;
  state: "running" | "completed" | "cancelled" = "completed";
  unavailable = false;

  validate(_manifest: RunManifest): RunnerValidationResult {
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    return { reachable: !this.unavailable, message: this.unavailable ? "unavailable" : "reachable" };
  }

  async start(manifest: RunManifest): Promise<WorkflowExecutionReference> {
    return referenceFor(manifest);
  }

  async cancel(_reference: WorkflowExecutionReference, _reason: string): Promise<RunnerCancellationResult> {
    this.state = "cancelled";
    return { accepted: true, alreadyTerminal: false, message: "accepted" };
  }

  async inspect(reference: WorkflowExecutionReference): Promise<RunnerInspection> {
    if (this.unavailable) {
      throw new Error("Temporal unavailable");
    }

    const events = eventsFor(reference.workflowId.replace("agentlab:", ""), this.state);
    const result = this.state === "running" ? null : resultFor(reference.workflowId.replace("agentlab:", ""), this.state);
    return {
      status: this.state,
      reference,
      eventIntents: events,
      result,
      trajectory: result ? { schemaVersion: 1, runId: result.runId, phases: [] } : null,
      metrics: null,
    };
  }
}

async function withService(run: (service: RunService, store: RunEvidenceStore, runner: FakeRunner, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-run-service-"));
  try {
    const runner = new FakeRunner();
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const service = new RunService({ config, evidence: store, registry: new PlatformRegistry([runner]) });
    await run(service, store, runner, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("creates a run before dispatch and projects a completed runner result", async () => {
  await withService(async (service, store) => {
    const view = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Hello" },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.equal(view.status, "completed");
    assert.equal(view.result?.output, "fake output");
    assert.equal(view.events.map((event) => event.kind).join(","), "RunCreated,RunDispatched,AgentStarted,ModelRequested,ModelCompleted,AgentCompleted,RunCompleted");
    assert.ok(view.temporalReference);
    assert.ok(view.metrics);
    assert.equal((await store.readSnapshot(view.runId)).trajectory?.runId, view.runId);
  });
});

test("reconciliation projects workflow intents once after a control-plane restart", async () => {
  await withService(async (service, store, runner) => {
    const manifest = buildRunManifest(
      {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Restart me" },
        model: { provider: "fake", model: "fake-success" },
      },
      { runId: "restart-run-1" },
    );
    const reference = referenceFor(manifest);
    await store.createRun(manifest);
    await store.appendEvent({ source: "control-plane", sourceSequence: 1, kind: "RunCreated", runId: manifest.runId, occurredAt: manifest.createdAt, payload: {} });
    await store.appendEvent({ source: "control-plane", sourceSequence: 2, kind: "RunDispatched", runId: manifest.runId, occurredAt: manifest.createdAt, payload: {} });
    await store.writeTemporalReference(manifest.runId, reference);
    runner.state = "completed";

    const first = await service.getRun(manifest.runId);
    const second = await service.getRun(manifest.runId);
    const events = await store.readEvents(manifest.runId);

    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(events.filter((event) => event.source === "temporal-workflow").length, 5);
    assert.equal(events.length, 7);
  });
});

test("cancellation is routed to the runner and becomes a terminal result", async () => {
  await withService(async (service, _store, runner) => {
    runner.state = "running";
    const created = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Cancel me" },
      model: { provider: "fake", model: "fake-cancel" },
    });
    const cancelled = await service.cancelRun(created.runId, "stop now");

    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.result?.error?.failureKind, "cancelled");
    assert.equal(cancelled.events.some((event) => event.kind === "RunCancellationRequested"), true);
  });
});

test("missing execution references are explicit and Temporal outages do not fabricate completion", async () => {
  await withService(async (service, store, runner) => {
    const manifest = buildRunManifest(
      {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Missing reference" },
        model: { provider: "fake", model: "fake-success" },
      },
      { runId: "missing-reference-1" },
    );
    await store.createRun(manifest);
    await store.appendEvent({ source: "control-plane", sourceSequence: 1, kind: "RunCreated", runId: manifest.runId, occurredAt: manifest.createdAt, payload: {} });
    const missing = await service.getRun(manifest.runId);
    assert.equal(missing.status, "reconciliation_required");
    assert.equal(missing.result?.error?.failureKind, "reconciliation");

    const unavailableManifest = buildRunManifest(
      {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Outage" },
        model: { provider: "fake", model: "fake-success" },
      },
      { runId: "outage-1" },
    );
    await store.createRun(unavailableManifest);
    await store.appendEvent({ source: "control-plane", sourceSequence: 1, kind: "RunCreated", runId: unavailableManifest.runId, occurredAt: unavailableManifest.createdAt, payload: {} });
    await store.appendEvent({ source: "control-plane", sourceSequence: 2, kind: "RunDispatched", runId: unavailableManifest.runId, occurredAt: unavailableManifest.createdAt, payload: {} });
    await store.writeTemporalReference(unavailableManifest.runId, referenceFor(unavailableManifest));
    runner.unavailable = true;
    const stale = await service.getRun(unavailableManifest.runId);
    assert.equal(stale.status, "queued");
    assert.equal(stale.result, null);
  });
});

function referenceFor(manifest: RunManifest): WorkflowExecutionReference {
  return {
    platform: "temporal",
    namespace: manifest.temporal.namespace,
    taskQueue: manifest.temporal.taskQueue,
    workflowId: `agentlab:${manifest.runId}`,
    workflowRunId: `workflow-run-${manifest.runId}`,
    workflowType: "temporalBaselineWorkflow",
    activityTypes: ["requestModel"],
  };
}

function eventsFor(runId: string, state: FakeRunner["state"]): readonly RunEventIntent[] {
  const base: RunEventIntent[] = [
    event(runId, 1, "AgentStarted"),
    event(runId, 2, "ModelRequested"),
  ];
  if (state === "running") return base;
  if (state === "cancelled") return [...base, event(runId, 3, "AgentCancelled"), event(runId, 4, "RunCancelled")];
  return [...base, event(runId, 3, "ModelCompleted"), event(runId, 4, "AgentCompleted"), event(runId, 5, "RunCompleted")];
}

function event(runId: string, sourceSequence: number, kind: string): RunEventIntent {
  return {
    source: "temporal-workflow",
    sourceSequence,
    kind,
    runId,
    occurredAt: "2026-09-15T08:00:00.000Z",
    payload: {},
  };
}

function resultFor(runId: string, state: Exclude<FakeRunner["state"], "running">): RunResult {
  const status = state === "cancelled" ? "cancelled" : "completed";
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt: "2026-09-15T08:00:00.000Z",
    finishedAt: "2026-09-15T08:00:01.000Z",
    output: status === "completed" ? "fake output" : null,
    error: status === "cancelled" ? { code: "RUN_CANCELLED", message: "cancelled", failureKind: "cancelled", retryable: false } : null,
    attemptCount: 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}
