import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityCatalog, DEFAULT_CAPABILITY_MANIFESTS, DEFAULT_CAPABILITY_PROFILES } from "../../src/capabilities/catalog.js";
import type { UntrustedSkillContextText } from "../../src/capabilities/skills/contracts.js";
import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../../src/capabilities/context/index.js";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunResult,
} from "../../src/control-plane/domain/types.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService, RunnerConnectionUnavailableError } from "../../src/control-plane/application/run-service.js";
import { ContextSessionBusyError, ContextSessionConflictError } from "../../src/capabilities/context/session-store.js";
import type { ModelMetadataResolver } from "../../src/control-plane/ports/model-metadata.js";
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
  state: "running" | "completed" | "failed" | "cancelled" = "completed";
  unavailable = false;
  unavailableOnFirstInspection = false;
  missingExecution = false;
  startCalls = 0;

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { profile: "test" };
  }

  validate(_manifest: RunManifest): RunnerValidationResult {
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    return { reachable: !this.unavailable, message: this.unavailable ? "unavailable" : "reachable" };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    this.startCalls += 1;
    return referenceFor(manifest);
  }

  async cancel(_reference: PlatformExecutionReference, _reason: string): Promise<RunnerCancellationResult> {
    this.state = "cancelled";
    return { accepted: true, alreadyTerminal: false, message: "accepted" };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    if (this.missingExecution) {
      throw new Error("Temporal execution was not found.");
    }
    if (this.unavailable || this.unavailableOnFirstInspection) {
      throw new Error("Temporal unavailable");
    }

    const runId = reference.executionId.replace("agentlab:", "");
    const events = eventsFor(runId, this.state);
    const result = this.state === "running" ? null : resultFor(runId, this.state);
    return {
      status: this.state,
      reference: { ...reference, native: { ...reference.native, workflowStatus: this.state } },
      eventIntents: events,
      result,
      trajectory: result ? { schemaVersion: 1, runId: result.runId, phases: [] } : null,
      metrics: null,
    };
  }
}

class EvidenceOutageStore extends RunEvidenceStore {
  failResultWrites = false;

  override async writeResult(result: RunResult): Promise<void> {
    if (this.failResultWrites) {
      throw Object.assign(new Error("evidence disk is unavailable"), { code: "EIO" });
    }
    return super.writeResult(result);
  }
}

class ReferenceOutageStore extends RunEvidenceStore {
  failReferenceWrites = false;

  override async writeExecutionReference(runId: string, reference: PlatformExecutionReference): Promise<void> {
    if (this.failReferenceWrites) {
      throw Object.assign(new Error("native evidence disk is unavailable"), { code: "EIO" });
    }
    return super.writeExecutionReference(runId, reference);
  }
}

class RecoveringRestateRunner implements PlatformRunner {
  readonly platform = "restate" as const;
  readonly variant = "baseline" as const;
  visible = false;

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { serviceName: "AgentLabRestateBaseline", workflowHandler: "run" };
  }

  validate(_manifest: RunManifest): RunnerValidationResult {
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    return { reachable: true, message: "reachable" };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    return {
      platform: manifest.platform,
      variant: manifest.variant,
      executionId: `agentlab:${manifest.runId}`,
      native: { submissionOutcome: "unknown", workflowKey: `agentlab:${manifest.runId}` },
    };
  }

  async cancel(_reference: PlatformExecutionReference, _reason: string): Promise<RunnerCancellationResult> {
    return { accepted: false, alreadyTerminal: false, message: "not used" };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = reference.executionId.replace("agentlab:", "");
    if (!this.visible) {
      return {
        status: "failed",
        reference,
        eventIntents: [{
          source: "restate-runner",
          sourceSequence: 1,
          kind: "RunSubmissionOutcomeUnknown",
          runId,
          occurredAt: "2026-09-16T10:00:00.000Z",
          payload: { code: "RESTATE_INGRESS_UNKNOWN" },
        }],
        result: {
          schemaVersion: 1,
          runId,
          status: "reconciliation_required",
          startedAt: null,
          finishedAt: "2026-09-16T10:00:00.000Z",
          output: null,
          error: { code: "RESTATE_SUBMISSION_OUTCOME_UNKNOWN", message: "unknown", failureKind: "outcome_unknown", retryable: true },
          attemptCount: 0,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        },
        trajectory: { schemaVersion: 1, runId, phases: [] },
        metrics: { schemaVersion: 1, runId, status: "reconciliation_required", durationMs: null, modelCallCount: 0, modelAttemptCount: 0, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
      };
    }

    const completed = resultFor(runId, "completed");
    return {
      status: "completed",
      reference: { ...reference, native: { ...reference.native, submissionOutcome: "accepted" } },
      eventIntents: [event(runId, 1, "RunCompleted", "restate-workflow")],
      result: completed,
      trajectory: { schemaVersion: 1, runId, phases: [{ name: "model_request", startedAt: completed.startedAt!, finishedAt: completed.finishedAt }] },
      metrics: { ...calculateTestMetrics(completed), modelCallCount: 1, modelAttemptCount: 1 },
    };
  }
}

class ContextOverflowRunner implements PlatformRunner {
  readonly platform = "langgraph" as const;
  readonly variant = "baseline" as const;
  recoveryCalls = 0;

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { serviceUrl: "http://langgraph.test", protocolVersion: 1, contextRoot: "sessions" };
  }

  validate(_manifest: RunManifest): RunnerValidationResult {
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    return { reachable: true, message: "reachable" };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    return this.reference(manifest.runId, manifest.runId, "langgraph-service");
  }

  async recoverContextOverflow(manifest: RunManifest): Promise<PlatformExecutionReference> {
    this.recoveryCalls += 1;
    return this.reference("context-recovery", manifest.runId, "langgraph-context-recovery");
  }

  async cancel(_reference: PlatformExecutionReference, _reason: string): Promise<RunnerCancellationResult> {
    return { accepted: false, alreadyTerminal: true, message: "not used" };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = String(reference.native.labRunId);
    const recovered = reference.executionId === "langgraph:context-recovery";
    const result: RunResult = recovered
      ? {
          schemaVersion: 1,
          runId,
          status: "completed",
          startedAt: "2026-09-20T00:00:00.000Z",
          finishedAt: "2026-09-20T00:00:01.000Z",
          output: "recovered output",
          error: null,
          attemptCount: 1,
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        }
      : {
          schemaVersion: 1,
          runId,
          status: "failed",
          startedAt: "2026-09-20T00:00:00.000Z",
          finishedAt: "2026-09-20T00:00:01.000Z",
          output: null,
          error: {
            code: "LANGGRAPH_CONTEXT_OVERFLOW",
            message: "The provider context window was exceeded.",
            failureKind: "provider",
            retryable: false,
          },
          attemptCount: 1,
          usage: { inputTokens: 1_200, outputTokens: null, totalTokens: null },
        };
    const source = String(reference.native.eventSource);
    return {
      status: recovered ? "completed" : "failed",
      reference,
      eventIntents: [event(runId, 1, recovered ? "RunCompleted" : "ModelFailed", source)],
      result,
      trajectory: { schemaVersion: 1, runId, phases: [] },
      metrics: calculateTestMetrics(result),
    };
  }

  private reference(executionId: string, labRunId: string, eventSource: string): PlatformExecutionReference {
    return {
      platform: this.platform,
      variant: this.variant,
      executionId: `langgraph:${executionId}`,
      native: {
        serviceOrigin: "http://langgraph.test",
        executionId: `langgraph:${executionId}`,
        labRunId,
        eventSource,
        threadId: `thread-${labRunId}`,
        graph: "baseline",
        protocolVersion: 1,
      },
    };
  }
}

async function withService(
  run: (service: RunService, store: RunEvidenceStore, runner: FakeRunner, root: string) => Promise<void>,
  options: { readonly allowOpenRouter?: boolean; readonly modelMetadata?: ModelMetadataResolver; readonly capabilities?: CapabilityCatalog } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-run-service-"));
  try {
    const runner = new FakeRunner();
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
      ...(options.allowOpenRouter ? { AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake,openrouter" } : {}),
    }, "/repo");
    const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
    const service = new RunService({ config, context, evidence: store, modelMetadata: options.modelMetadata, capabilities: options.capabilities, registry: new PlatformRegistry([runner]) });
    await run(service, store, runner, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("client turn keys replay one durable run and reject a changed prompt", async () => {
  await withService(async (service, _store, runner) => {
    const request = {
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-client-replay",
      clientTurnId: "client-turn-1",
      task: { kind: "prompt" as const, prompt: "Retry this safely" },
      model: { provider: "fake", model: "fake-success" },
    };

    const first = await service.createRun(request);
    const replay = await service.createRun({ ...request, task: { kind: "prompt", prompt: "Retry this safely" } });

    assert.equal(replay.runId, first.runId);
    assert.equal(runner.startCalls, 1);
    await assert.rejects(
      () => service.createRun({ ...request, task: { kind: "prompt", prompt: "A different prompt" } }),
      ContextSessionConflictError,
    );
  });
});

test("concurrent duplicate client turns create one run and one user message", async () => {
  await withService(async (service, _store, runner) => {
    runner.state = "running";
    const request = {
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-concurrent-replay",
      clientTurnId: "client-turn-concurrent-1",
      task: { kind: "prompt" as const, prompt: "Admit this turn once" },
      model: { provider: "fake", model: "fake-success" },
    };

    const [first, second] = await Promise.all([service.createRun(request), service.createRun(request)]);

    assert.equal(first.runId, second.runId);
    assert.equal(runner.startCalls, 1);
  });
});

test("a different client turn cannot overtake an active session turn", async () => {
  await withService(async (service, _store, runner) => {
    runner.state = "running";
    const first = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-client-busy",
      clientTurnId: "client-turn-1",
      task: { kind: "prompt", prompt: "Keep this running" },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(first.status, "running");

    await assert.rejects(
      () => service.createRun({
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-client-busy",
        clientTurnId: "client-turn-2",
        task: { kind: "prompt", prompt: "Do not overtake" },
        model: { provider: "fake", model: "fake-success" },
      }),
      ContextSessionBusyError,
    );

    const replay = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-client-busy",
      clientTurnId: "client-turn-1",
      task: { kind: "prompt", prompt: "Keep this running" },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(replay.runId, first.runId);
    assert.equal(runner.startCalls, 1);
  });
});

test("a new turn after terminal failure preserves the failed turn", async () => {
  await withService(async (service, store, runner) => {
    runner.state = "failed";
    const first = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-after-failure",
      clientTurnId: "client-turn-failed",
      task: { kind: "prompt", prompt: "Fail this turn" },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(first.status, "failed");

    runner.state = "completed";
    const second = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-after-failure",
      clientTurnId: "client-turn-after-failure",
      task: { kind: "prompt", prompt: "Start a new turn" },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.notEqual(second.runId, first.runId);
    assert.equal(first.result?.error?.failureKind, "provider");
    assert.equal(second.status, "completed");
    assert.equal((await store.readSnapshot(first.runId)).result?.status, "failed");
    assert.equal((await store.readSnapshot(second.runId)).result?.status, "completed");
  });
});

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
    assert.ok(view.executionReference);
    assert.ok(view.metrics);
    assert.equal((await store.readSnapshot(view.runId)).trajectory?.runId, view.runId);
  });
});

test("projects native running state without an AgentStarted event and preserves it during outage", async () => {
  await withService(async (service, _store, runner) => {
    runner.state = "running";
    const originalInspect = runner.inspect.bind(runner);
    runner.inspect = async reference => {
      const observed = await originalInspect(reference);
      return { ...observed, eventIntents: observed.eventIntents.map(event => event.kind === "AgentStarted"
        ? { ...event, kind: "PlatformExecutionStarted" } : event) };
    };
    const view = await service.createRun({ platform: "temporal", variant: "baseline",
      task: { kind: "prompt", prompt: "Native running projection" }, model: { provider: "fake", model: "fake-success" } });
    assert.equal(view.status, "running");
    assert.equal(view.result, null);
    runner.unavailable = true;
    const stale = await service.getRun(view.runId);
    assert.equal(stale.status, "running");
    assert.equal(stale.projection.state, "stale");
    assert.equal(runner.startCalls, 1);
  });
});

test("new agent instructions activate relevant skills without rewriting retained session controls", async () => {
  await withService(async (service, _store, _runner, root) => {
    const sessions = new ContextSessionStore(join(root, "sessions"));
    const legacy = "You are the Agent Harness Lab baseline agent. Answer the user's prompt directly and concisely.";
    await sessions.create({ sessionId: "legacy-controls", platform: "temporal", variant: "baseline", model: "fake/fake-success",
      systemInstruction: legacy, contextWindowTokens: null, reservedOutputTokens: 4096, safetyMarginTokens: 1024,
      compactionThresholdPercent: 20, recentMessageGroups: 2 });
    const request = { platform: "temporal", variant: "baseline", task: {kind: "prompt" as const, prompt: "Continue"}, model: {provider: "fake" as const, model: "fake-success"} };
    const retained = await service.createRun({...request, sessionId: "legacy-controls"});
    assert.equal(retained.manifest.context.systemInstruction, legacy);
    assert.equal((await sessions.read("legacy-controls")).systemInstruction, legacy);
    const fresh = await service.createRun(request);
    assert.match(fresh.manifest.context.systemInstruction, /load that skill before acting/);
    assert.match(fresh.manifest.context.systemInstruction, /does not grant tools or permissions/);
  });
});

test("freezes server-resolved model context metadata in the run manifest", async () => {
  await withService(async (service) => {
    const view = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Use the resolved model metadata." },
      model: { provider: "openrouter", model: "openai/example", contextWindowTokens: 1 },
    });

    assert.equal(view.manifest.model.contextWindowTokens, 128_000);
  }, {
    allowOpenRouter: true,
    modelMetadata: {
      async resolve() {
        return { contextWindowTokens: 128_000 };
      },
    },
  });
});

test("reconciliation projects workflow intents once after a server restart", async () => {
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
    await store.writeExecutionReference(manifest.runId, reference);
    runner.state = "completed";

    const first = await service.getRun(manifest.runId);
    const second = await service.getRun(manifest.runId);
    const events = await store.readEvents(manifest.runId);

    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(first.executionReference?.native.workflowStatus, "completed");
    assert.equal(second.executionReference?.native.workflowStatus, "completed");
    assert.equal(events.filter((event) => event.source === "temporal-workflow").length, 5);
    assert.equal(events.length, 7);
  });
});

test("reconciliation replaces a provisional Restate outcome when the workflow becomes visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-restate-recovery-"));
  try {
    const runner = new RecoveringRestateRunner();
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const service = new RunService({ config, evidence: store, registry: new PlatformRegistry([runner]) });

    const provisional = await service.createRun({
      platform: "restate",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Recover this submission." },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(provisional.status, "reconciliation_required");
    assert.equal(provisional.result?.error?.failureKind, "outcome_unknown");
    assert.equal(provisional.metrics, null);

    runner.visible = true;
    const recovered = await service.getRun(provisional.runId);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result?.output, "fake output");
    assert.equal(recovered.trajectory?.phases.length, 1);
    assert.equal(recovered.metrics?.modelCallCount, 1);
    assert.deepEqual((await store.readEvents(provisional.runId)).map((item) => item.kind), [
      "RunCreated",
      "RunDispatched",
      "RunSubmissionOutcomeUnknown",
      "RunCompleted",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider context overflow performs one bounded recovery dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-langgraph-overflow-recovery-"));
  try {
    const runner = new ContextOverflowRunner();
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
    }, "/repo");
    const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
    const service = new RunService({ config, context, evidence: store, registry: new PlatformRegistry([runner]) });

    const view = await service.createRun({
      platform: "langgraph",
      variant: "baseline",
      sessionId: "langgraph-overflow-session",
      clientTurnId: "langgraph-overflow-turn",
      task: { kind: "prompt", prompt: "Compact and retry this turn." },
      model: { provider: "fake", model: "fake-context" },
    });

    assert.equal(view.status, "completed");
    assert.equal(view.result?.output, "recovered output");
    assert.equal(runner.recoveryCalls, 1);
    assert.equal(view.executionReference?.executionId, "langgraph:context-recovery");
    assert.deepEqual((await store.readEvents(view.runId)).map((item) => item.kind), [
      "RunCreated",
      "RunDispatched",
      "ModelFailed",
      "ContextRecoveryRequested",
      "ContextRecoveryDispatched",
      "RunCompleted",
    ]);
    const events = await store.readEvents(view.runId);
    assert.deepEqual(events.filter((item) => item.source === "langgraph-service").map((item) => item.sourceSequence), [1]);
    assert.deepEqual(events.filter((item) => item.source === "langgraph-context-recovery").map((item) => item.sourceSequence), [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("admits a Restate baseline turn with the shared session contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-restate-context-admission-"));
  try {
    const runner = new RecoveringRestateRunner();
    runner.visible = true;
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
    }, "/repo");
    const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
    const service = new RunService({ config, context, evidence: store, registry: new PlatformRegistry([runner]) });

    const view = await service.createRun({
      platform: "restate",
      variant: "baseline",
      sessionId: "restate-admission-session",
      clientTurnId: "client-turn-1",
      task: { kind: "prompt", prompt: "Continue this Restate session." },
      model: { provider: "fake", model: "fake-success" },
      capabilities: { tools: { enabledNames: [], maxRounds: 2, maxCalls: 3 } },
    });

    assert.equal(view.manifest.context.sessionId, "restate-admission-session");
    assert.equal(view.manifest.context.clientTurnId, "client-turn-1");
    assert.equal(view.manifest.capabilities?.tools.enabledNames.length, 0);
    assert.equal(view.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an immediate post-dispatch outage returns the durable queued projection", async () => {
  await withService(async (service, store, runner) => {
    runner.unavailableOnFirstInspection = true;
    const view = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Keep the accepted run visible." },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.equal(view.status, "queued");
    assert.equal(view.result, null);
    assert.equal(view.executionReference?.executionId, `agentlab:${view.runId}`);
    assert.deepEqual((await store.readEvents(view.runId)).map((item) => item.kind), ["RunCreated", "RunDispatched"]);
    assert.equal(view.projection.state, "stale");
  });
});

test("an accepted dispatch with an unretained reference is not reported as dispatch failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-reference-outage-"));
  try {
    const runner = new FakeRunner();
    runner.state = "running";
    const store = new ReferenceOutageStore(root);
    store.failReferenceWrites = true;
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const service = new RunService({ config, evidence: store, registry: new PlatformRegistry([runner]) });

    const accepted = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Keep the accepted execution honest." },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.equal(accepted.status, "queued");
    assert.equal(accepted.result, null);
    assert.equal(accepted.executionReference, null);
    assert.equal(accepted.projection.state, "stale");
    assert.match(accepted.projection.reason ?? "", /execution reference could not be retained/);
    assert.equal(accepted.events.some((event) => event.kind === "RunFailed"), false);

    store.failReferenceWrites = false;
    const reconciled = await service.getRun(accepted.runId);
    assert.equal(reconciled.status, "reconciliation_required");
    assert.equal(reconciled.result?.error?.failureKind, "reconciliation");
    const provisionalSnapshot = await store.readSnapshot(accepted.runId);
    assert.equal(provisionalSnapshot.metrics, null, "unresolved execution must not fabricate terminal metrics");
    assert.equal(provisionalSnapshot.trajectory, null, "unresolved execution must not freeze an empty trajectory");

    // A recovered native identity reconciles the accepted execution instead of
    // treating the provisional missing-reference result as a permanent terminal.
    const manifest = await store.readManifest(accepted.runId);
    await store.writeExecutionReference(accepted.runId, referenceFor(manifest));
    runner.state = "completed";
    const restarted = new RunService({ config, evidence: store, registry: new PlatformRegistry([runner]) });
    const completed = await restarted.getRun(accepted.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result?.status, "completed");
    assert.equal(completed.executionReference?.executionId, `agentlab:${accepted.runId}`);
    assert.equal(runner.startCalls, 1, "reconciliation must inspect the accepted execution without redispatch");
    const completedSnapshot = await store.readSnapshot(accepted.runId);
    assert.equal(completedSnapshot.result?.status, "completed");
    assert.equal(completedSnapshot.metrics?.status, "completed");
    assert.notEqual(completedSnapshot.trajectory, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an evidence projection outage preserves the last known view and reconciles later", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-evidence-outage-"));
  try {
    const runner = new FakeRunner();
    runner.state = "running";
    runner.unavailableOnFirstInspection = true;
    const store = new EvidenceOutageStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const service = new RunService({ config, evidence: store, registry: new PlatformRegistry([runner]) });

    const created = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Preserve the projection." },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(created.status, "queued");
    assert.equal(created.projection.state, "stale");

    runner.unavailableOnFirstInspection = false;
    runner.state = "completed";
    store.failResultWrites = true;
    const stale = await service.getRun(created.runId);
    assert.equal(stale.status, "queued");
    assert.equal(stale.result, null);
    assert.equal(stale.projection.state, "stale");
    assert.match(stale.projection.reason ?? "", /evidence is temporarily unavailable/);

    store.failResultWrites = false;
    const recovered = await service.getRun(created.runId);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.projection.state, "current");
    assert.equal(recovered.result?.output, "fake output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    await store.writeExecutionReference(unavailableManifest.runId, referenceFor(unavailableManifest));
    runner.unavailable = true;
    const stale = await service.getRun(unavailableManifest.runId);
    assert.equal(stale.status, "queued");
    assert.equal(stale.result, null);
  });
});

test("a retained execution that disappears becomes reconciliation-required", async () => {
  await withService(async (service, _store, runner) => {
    runner.missingExecution = true;
    const run = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "The retained execution disappeared." },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.equal(run.status, "reconciliation_required");
    assert.equal(run.result?.error?.failureKind, "reconciliation");
    assert.equal(run.events.some((event) => event.kind === "RunReconciliationRequired"), true);
    const repeated = await service.getRun(run.runId);
    assert.deepEqual(repeated.result, run.result);
    assert.equal(repeated.status, "reconciliation_required");
  });
});

function referenceFor(manifest: RunManifest): PlatformExecutionReference {
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: `agentlab:${manifest.runId}`,
    native: {
      workflowId: `agentlab:${manifest.runId}`,
      workflowRunId: `workflow-run-${manifest.runId}`,
      workflowType: "testRunner",
    },
  };
}

function eventsFor(runId: string, state: FakeRunner["state"]): readonly RunEventIntent[] {
  const base: RunEventIntent[] = [
    event(runId, 1, "AgentStarted"),
    event(runId, 2, "ModelRequested"),
  ];
  if (state === "running") return base;
  if (state === "cancelled") return [...base, event(runId, 3, "AgentCancelled"), event(runId, 4, "RunCancelled")];
  if (state === "failed") return [...base, event(runId, 3, "ModelFailed"), event(runId, 4, "RunFailed")];
  return [...base, event(runId, 3, "ModelCompleted"), event(runId, 4, "AgentCompleted"), event(runId, 5, "RunCompleted")];
}

function event(runId: string, sourceSequence: number, kind: string, source = "temporal-workflow"): RunEventIntent {
  return {
    source,
    sourceSequence,
    kind,
    runId,
    occurredAt: "2026-09-15T08:00:00.000Z",
    payload: {},
  };
}

function resultFor(runId: string, state: Exclude<FakeRunner["state"], "running">): RunResult {
  const status = state === "cancelled" ? "cancelled" : state === "failed" ? "failed" : "completed";
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt: "2026-09-15T08:00:00.000Z",
    finishedAt: "2026-09-15T08:00:01.000Z",
    output: status === "completed" ? "fake output" : null,
    error: status === "cancelled"
      ? { code: "RUN_CANCELLED", message: "cancelled", failureKind: "cancelled", retryable: false }
      : status === "failed"
        ? { code: "MODEL_FAILED", message: "model failed", failureKind: "provider", retryable: false }
        : null,
    attemptCount: 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function calculateTestMetrics(result: RunResult) {
  return {
    schemaVersion: 1 as const,
    runId: result.runId,
    status: result.status,
    durationMs: 1,
    modelCallCount: 0,
    modelAttemptCount: result.attemptCount,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
    costUsd: null,
  };
}


test("unavailable native readiness rejects new admission while offline canonical replay remains valid", async () => {
  await withService(async (service, store, runner, root) => {
    const request = { platform: "temporal", variant: "baseline", sessionId: "readiness-session", clientTurnId: "readiness-turn", task: { kind: "prompt" as const, prompt: "Keep canonical identity." }, model: { provider: "fake", model: "fake-success" } };
    runner.unavailable = true;
    await assert.rejects(() => service.createRun(request), RunnerConnectionUnavailableError);
    assert.equal(runner.startCalls, 0);
    assert.deepEqual(await readdir(root), [], "readiness denial must not admit run evidence or context state");
    runner.unavailable = false;
    const admitted = await service.createRun(request);
    runner.unavailable = true;
    const replay = await service.createRun(request);
    assert.equal(replay.runId, admitted.runId);
    assert.equal(replay.status, "completed");
    assert.equal(runner.startCalls, 1);
    await assert.rejects(() => service.createRun({ ...request, task: { kind: "prompt", prompt: "Conflicting content." } }), ContextSessionConflictError);
    assert.equal(runner.startCalls, 1);
    assert.equal((await store.readSnapshot(admitted.runId)).result?.status, "completed");
  });
});


function requestedSkillCatalog() {
  const skill: UntrustedSkillContextText = {
    kind: "skill-context", trust: "untrusted", authority: "none", grants: [],
    skillId: "procedures.evidence-report", skillVersion: "1.0.0", digest: "a".repeat(64),
    content: "Read the source, cite evidence, and distinguish observed facts from assumptions.",
  };
  const profile = {
    ...DEFAULT_CAPABILITY_PROFILES[0], id: "explicit-skill-test", grants: [], skillIds: [],
    supportedVariants: ["temporal/baseline"],
    availableSkills: [{ id: "procedures:evidence-report", name: "evidence-report", version: skill.skillVersion, description: "Prepare an evidence report.", digest: skill.digest }],
  };
  const capabilities = new CapabilityCatalog(DEFAULT_CAPABILITY_MANIFESTS, [profile], undefined, undefined, {
    skillResolver: async ids => ids.map(id => {
      assert.equal(id, "procedures:evidence-report");
      return skill;
    }),
  });
  return { capabilities, skill };
}

test("explicit skill selection rejects profile boundary violations before admitting a turn", async () => {
  const { capabilities } = requestedSkillCatalog();
  await withService(async (service, _store, runner, root) => {
    const request = {
      platform: "temporal", variant: "baseline", sessionId: "session-rejected-skill",
      task: { kind: "prompt" as const, prompt: "Use the reporting procedure." },
      model: { provider: "fake", model: "fake-success" },
      capabilities: { profileId: "explicit-skill-test", requestedSkillIds: ["procedures:evidence-report"], tools: { enabledNames: [], maxRounds: 4, maxCalls: 8 } },
    };
    await assert.rejects(service.createRun({ ...request, capabilities: { ...request.capabilities, requestedSkillIds: ["other:private-skill"] } }), /not available in the selected capability profile/);
    await assert.rejects(service.createRun({ ...request, capabilities: { ...request.capabilities, profileId: undefined } }), /requires a capability profile/);
    await assert.rejects(service.createRun({ ...request, platform: "mastra" }), /not supported by this platform variant/);
    assert.equal(runner.startCalls, 0);
    await assert.rejects(readdir(join(root, "sessions")), { code: "ENOENT" });
  }, { capabilities });
});

test("explicit skill admission persists untrusted user context without widening tool grants", async () => {
  const { capabilities, skill } = requestedSkillCatalog();
  await withService(async (service, _store, runner, root) => {
    runner.state = "running";
    const run = await service.createRun({
      platform: "temporal", variant: "baseline", sessionId: "session-explicit-skill",
      task: { kind: "prompt", prompt: "Prepare a report using the selected procedure." },
      model: { provider: "fake", model: "fake-success", contextWindowTokens: 8192 },
      capabilities: { profileId: "explicit-skill-test", requestedSkillIds: ["procedures:evidence-report"], tools: { enabledNames: [], maxRounds: 4, maxCalls: 8 } },
    });
    assert.equal(runner.startCalls, 1);
    assert.ok(run.manifest.capabilities);
    assert.deepEqual(run.manifest.capabilities.tools.enabledNames, []);
    // Reopening the store proves this selection is retained, rather than only
    // injected into an in-memory request for the first model call.
    const sessions = new ContextSessionStore(join(root, "sessions"));
    const session = await sessions.read("session-explicit-skill");
    assert.deepEqual(session.activeSkillContexts, [skill]);
    assert.deepEqual(session.skillContexts, []);
    const context = new ContextService(sessions, new CharacterTokenEstimator());
    const prepared = await context.prepareTurn(session.sessionId, run.manifest.context.turnId!, { summarize: async () => { throw new Error("This small context must not require compaction."); } });
    const messages = prepared.snapshot.messages.filter(message => message.source === "skills");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].metadata?.authority, "none");
    assert.equal(messages[0].content, skill.content);
  }, { capabilities });
});
