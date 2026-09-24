import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StudioEvidenceStore } from "../../src/studio/adapters/evidence-store.js";
import {
  StudioComparisonService,
  StudioInjectedCrashError,
  type StudioFailureInjector,
} from "../../src/studio/application/comparison-service.js";
import type { StudioComparisonRequest, StudioMemoryStore, StudioModelAdapter } from "../../src/studio/index.js";
import { StudioContextOverflowError, StudioMemoryCancellationError } from "../../src/studio/index.js";
import { FixtureMemoryStore } from "../../src/studio/runtime/baseline-components.js";
import { ReplayEnvironmentAssembler } from "../../src/studio/runtime/environment.js";

test("an interrupted comparison is exposed as recovery_required without a fabricated parent result", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-recovery-"));
  try {
    let comparisonId: string | undefined;
    const failureInjector: StudioFailureInjector = {
      inject(point, id) {
        comparisonId = id;
        if (point === "between-trials") throw new StudioInjectedCrashError(point);
      },
    };
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      failureInjector,
    });

    await assert.rejects(() => service.create(comparisonRequest("recovery-1")), StudioInjectedCrashError);
    assert.ok(comparisonId);
    const projection = await new StudioComparisonService({ evidence: new StudioEvidenceStore(root) }).inspect(comparisonId);
    assert.equal(projection.status, "recovery_required");
    assert.equal(projection.result, null);
    assert.equal(projection.trials.length, 1);
    assert.equal(projection.trials[0].result?.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interruption before configuration and during publication remains explicit", async () => {
  for (const point of ["before-comparison-write", "during-evidence-publication"] as const) {
    const root = await mkdtemp(join(tmpdir(), `agentlab-studio-${point}-`));
    try {
      let comparisonId: string | undefined;
      const failureInjector: StudioFailureInjector = {
        inject(injectedPoint, id) {
          comparisonId = id;
          if (injectedPoint === point) throw new StudioInjectedCrashError(injectedPoint);
        },
      };
      const service = new StudioComparisonService({
        evidence: new StudioEvidenceStore(root),
        failureInjector,
      });

      await assert.rejects(() => service.create(comparisonRequest(`failure-${point}`)), StudioInjectedCrashError);
      assert.ok(comparisonId);
      const restarted = new StudioComparisonService({ evidence: new StudioEvidenceStore(root) });
      if (point === "before-comparison-write") {
        await assert.rejects(() => restarted.inspect(comparisonId!), /Studio comparison was not found/);
      } else {
        const projection = await restarted.inspect(comparisonId);
        assert.equal(projection.status, "recovery_required");
        assert.equal(projection.result, null);
        assert.equal(projection.trials.length, 2);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("runtime interruptions before a turn and before model dispatch remain recoverable", async () => {
  for (const point of ["before-turn", "before-model"] as const) {
    const root = await mkdtemp(join(tmpdir(), `agentlab-studio-${point}-`));
    try {
      let comparisonId: string | undefined;
      const failureInjector: StudioFailureInjector = {
        inject(injectedPoint, id) {
          comparisonId = id;
          if (injectedPoint === point) throw new StudioInjectedCrashError(injectedPoint);
        },
      };
      const service = new StudioComparisonService({
        evidence: new StudioEvidenceStore(root),
        failureInjector,
      });

      await assert.rejects(() => service.create(comparisonRequest(`runtime-${point}`)), StudioInjectedCrashError);
      assert.ok(comparisonId);
      const projection = await new StudioComparisonService({ evidence: new StudioEvidenceStore(root) }).inspect(comparisonId);
      assert.equal(projection.status, "recovery_required");
      assert.equal(projection.result, null);
      assert.equal(projection.trials.length, 1);
      assert.equal(projection.trials[0].result, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("an intermediate multi-turn interruption preserves completed turn evidence only", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-multiturn-recovery-"));
  try {
    let comparisonId: string | undefined;
    let turnStarts = 0;
    const failureInjector: StudioFailureInjector = {
      inject(point, id) {
        comparisonId = id;
        if (point === "before-turn" && turnStarts++ === 1) throw new StudioInjectedCrashError(point);
      },
    };
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      failureInjector,
      memoryFactory: () => new FixtureMemoryStore(() => "2026-09-20T00:00:00.000Z"),
    });

    await assert.rejects(() => service.create(multiturnMemoryRequest("multiturn-recovery-1")), StudioInjectedCrashError);
    assert.ok(comparisonId);
    const projection = await new StudioComparisonService({ evidence: new StudioEvidenceStore(root) }).inspect(comparisonId);
    assert.equal(projection.status, "recovery_required");
    assert.equal(projection.result, null);
    assert.equal(projection.trials.length, 1);
    assert.equal(projection.trials[0].result, null);
    assert.deepEqual(projection.trials[0].turns.map((turn) => turn.turnId), ["turn-01-learn"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-turn cancellation preserves completed turns and cancels only the in-flight trial", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-multiturn-cancel-"));
  try {
    let markSecondTurn!: () => void;
    const secondTurnStarted = new Promise<void>((resolve) => { markSecondTurn = resolve; });
    let calls = 0;
    const model: StudioModelAdapter = {
      provider: "replay",
      model: "multiturn-cancellation-test-model",
      async complete(request, signal) {
        calls += 1;
        if (calls === 2) {
          markSecondTurn();
          await new Promise<void>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("cancelled", "AbortError"));
              return;
            }
            signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
          });
        }
        return { output: request.expectedAnswer ?? "completed", inputTokens: null, outputTokens: null };
      },
    };
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      model,
      memoryFactory: () => new FixtureMemoryStore(() => "2026-09-20T00:00:00.000Z"),
    });
    const pending = service.create(multiturnMemoryRequest("multiturn-cancel-1"));
    await secondTurnStarted;
    const comparisonId = (await readdir(root, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name !== "idempotency")?.name;
    assert.ok(comparisonId);
    const cancelled = await service.cancel(comparisonId, "stop after the first turn");
    const completed = await pending;

    assert.equal(cancelled.status, "cancelled");
    assert.equal(completed.status, "cancelled");
    assert.equal(cancelled.trials.length, 1);
    assert.equal(cancelled.trials[0].result?.status, "cancelled");
    assert.deepEqual(cancelled.trials[0].turns.map((turn) => turn.turnId), ["turn-01-learn"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an abort before turn dispatch prevents Memory retrieval", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-before-memory-read-cancel-"));
  let reads = 0;
  try {
    const failureInjector: StudioFailureInjector = {
      inject(point) {
        if (point === "before-turn") throw new DOMException("cancelled before retrieval", "AbortError");
      },
    };
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      failureInjector,
      memoryFactory: () => ({
        adapterId: "counting-memory",
        adapterVersion: "1",
        scope: "semantic",
        async read() {
          reads += 1;
          return emptyMemoryRead();
        },
        async write() {
          return emptyMemoryWrite();
        },
        async consolidate() {
          return emptyMemoryConsolidation();
        },
      }),
    });

    const cancelled = await service.create(multiturnMemoryRequest("multiturn-before-memory-read-cancel-1"));

    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.trials[0]?.result?.status, "cancelled");
    assert.deepEqual(cancelled.trials[0]?.turns, []);
    assert.equal(reads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation during a model call leaves only the in-flight trial cancelled", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-cancel-"));
  try {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const model: StudioModelAdapter = {
      provider: "replay",
      model: "blocking-test-model",
      async complete(_request, signal) {
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("cancelled", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
        });
        return { output: "unreachable", inputTokens: null, outputTokens: null };
      },
    };
    const service = new StudioComparisonService({ evidence: new StudioEvidenceStore(root), model });
    const pending = service.create(comparisonRequest("cancel-1"));
    await started;

    const comparisonId = (await readdir(root, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name !== "idempotency")?.name;
    assert.ok(comparisonId);
    const cancelled = await service.cancel(comparisonId, "stop this comparison");
    const created = await pending;

    assert.equal(cancelled.status, "cancelled");
    assert.equal(created.status, "cancelled");
    assert.equal(cancelled.trials.length, 1);
    assert.equal(cancelled.trials[0].result?.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider Context overflow gets one changed-input recovery and preserves the recovery evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-context-overflow-"));
  try {
    let calls = 0;
    const model: StudioModelAdapter = {
      provider: "replay",
      model: "overflow-recovery-test-model",
      async complete(request) {
        calls += 1;
        if (calls === 1) throw new StudioContextOverflowError();
        return { output: request.expectedAnswer ?? "completed", inputTokens: null, outputTokens: null };
      },
    };
    const service = new StudioComparisonService({ evidence: new StudioEvidenceStore(root), model });
    const completed = await service.create(comparisonRequest("context-overflow-recovery-1"));

    assert.equal(completed.status, "completed");
    assert.equal(calls, 3);
    assert.equal(completed.metrics?.modelCallCount, 3);
    assert.equal(completed.trials[0]?.turns[0]?.metrics.modelCalls, 2);
    assert.equal(completed.trials[0]?.context?.research?.compaction.trigger, "provider-overflow");
    assert.equal(completed.events.filter((event) => event.kind === "ContextOverflowRecovery").length, 1);
    assert.equal(completed.events.some((event) => event.kind === "ModelCompleted"), true);
    assert.equal(completed.trials[0]?.context?.research?.compaction.summaryMessageId !== null, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unrecoverable provider Context overflow fails without fabricating a model or turn result", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-context-overflow-failed-"));
  try {
    const model: StudioModelAdapter = {
      provider: "replay",
      model: "overflow-failure-test-model",
      async complete() {
        throw new StudioContextOverflowError("provider limit remains exceeded after the bounded recovery attempt");
      },
    };
    const service = new StudioComparisonService({ evidence: new StudioEvidenceStore(root), model });
    const failed = await service.create(comparisonRequest("context-overflow-failure-1"));

    assert.equal(failed.status, "failed");
    assert.equal(failed.trials[0]?.result?.status, "failed");
    assert.equal(failed.trials[0]?.turns.length, 0);
    assert.equal(failed.events.filter((event) => event.kind === "ContextOverflowRecovery").length, 1);
    assert.equal(failed.events.some((event) => event.kind === "ModelCompleted"), false);
    assert.equal(failed.metrics?.completedTurnCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an over-limit Context comparison fails before model dispatch without fabricated evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-context-over-limit-"));
  try {
    const replayEnvironment = new ReplayEnvironmentAssembler();
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      environment: {
        assemble(manifest, scenario) {
          return { ...replayEnvironment.assemble(manifest, scenario), contextWindowTokens: 40 };
        },
      },
    });
    const failed = await service.create(comparisonRequest("context-over-limit-1"));

    assert.equal(failed.status, "failed");
    assert.equal(failed.trials[0]?.result?.status, "failed");
    assert.equal(failed.trials[0]?.turns.length, 0);
    assert.equal(failed.events.some((event) => event.kind === "ModelRequested"), false);
    assert.equal(failed.metrics?.completedTurnCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation during Memory retrieval leaves no fabricated turn evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-memory-read-cancel-"));
  try {
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      memoryFactory: () => blockingMemoryStore("read", markReadStarted),
    });
    const pending = service.create(multiturnMemoryRequest("multiturn-memory-read-cancel-1"));
    await readStarted;

    const comparisonId = await findComparisonId(root);
    const cancelled = await service.cancel(comparisonId, "stop during Memory retrieval");
    const completed = await pending;

    assert.equal(cancelled.status, "cancelled");
    assert.equal(completed.status, "cancelled");
    assert.equal(cancelled.trials[0]?.result?.status, "cancelled");
    assert.deepEqual(cancelled.trials[0]?.turns, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation during Memory persistence leaves prior turns intact and the current turn incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-memory-write-cancel-"));
  try {
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      memoryFactory: () => blockingMemoryStore("write", markWriteStarted),
    });
    const pending = service.create(multiturnMemoryRequest("multiturn-memory-write-cancel-1"));
    await writeStarted;

    const comparisonId = await findComparisonId(root);
    const cancelled = await service.cancel(comparisonId, "stop during Memory persistence");
    const completed = await pending;

    assert.equal(cancelled.status, "cancelled");
    assert.equal(completed.status, "cancelled");
    assert.equal(cancelled.trials[0]?.result?.status, "cancelled");
    assert.deepEqual(cancelled.trials[0]?.turns, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory persistence cancellation is classified in the result and event stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-memory-cancellation-evidence-"));
  try {
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      memoryFactory: () => ({
        adapterId: "cancellation-memory",
        adapterVersion: "1",
        scope: "semantic" as const,
        async read() {
          return emptyMemoryRead();
        },
        async write() {
          throw new StudioMemoryCancellationError(
            "after-persistence",
            true,
            "applied",
            "Memory persistence completed but cancellation was observed before acknowledgement.",
          );
        },
        async consolidate() {
          return emptyMemoryConsolidation();
        },
      }),
    });

    const cancelled = await service.create(multiturnMemoryRequest("memory-cancellation-evidence-1"));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.result?.error?.code, "STUDIO_CANCELLED");
    assert.deepEqual(cancelled.result?.error?.details, {
      memoryCancellationPhase: "after-persistence",
      memoryPersistenceOutcome: "applied",
      memoryPersisted: true,
    });
    const cancellationEvent = cancelled.events.find((event) => event.kind === "MemoryPersistenceCancelled");
    assert.deepEqual(cancellationEvent?.payload, {
      trialId: cancelled.trials[0]?.manifest.trialId,
      turnId: "turn-01-learn",
      adapterId: "cancellation-memory",
      adapterVersion: "1",
      phase: "after-persistence",
      persisted: true,
      persistenceOutcome: "applied",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an injected clock makes multi-turn metrics deterministic across independent runs", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "agentlab-studio-deterministic-metrics-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "agentlab-studio-deterministic-metrics-b-"));
  const fixedNow = "2026-09-20T00:00:00.000Z";
  try {
    const createService = (root: string) => new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      now: () => fixedNow,
      memoryFactory: () => new FixtureMemoryStore(() => fixedNow),
    });
    const first = await createService(firstRoot).create(multiturnMemoryRequest("multiturn-deterministic-metrics-1"));
    const second = await createService(secondRoot).create(multiturnMemoryRequest("multiturn-deterministic-metrics-2"));

    const comparableMetrics = (projection: Awaited<ReturnType<StudioComparisonService["create"]>>) => {
      const { comparisonId: _comparisonId, ...metrics } = projection.metrics!;
      return metrics;
    };
    assert.deepEqual(comparableMetrics(first), comparableMetrics(second));
    assert.deepEqual(
      first.trials.map((trial) => trial.turns.map((turn) => turn.metrics)),
      second.trials.map((trial) => trial.turns.map((turn) => turn.metrics)),
    );
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

function comparisonRequest(idempotencyKey: string): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-context-retention",
      version: "1",
      scenario: { id: "context-old-important-fact", version: "1" },
      subject: {
        component: "context-management",
        strategies: [
          { id: "full-history", version: "1", parameters: {} },
          { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
        ],
      },
    },
    seed: "seed-1",
    idempotencyKey,
  };
}

function multiturnMemoryRequest(idempotencyKey: string): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-memory-multiturn",
      version: "1",
      scenario: { id: "memory-learn-then-recall", version: "1" },
      subject: {
        component: "memory",
        strategies: [
          { id: "no-memory", version: "1", parameters: {} },
          { id: "semantic-keyed-facts", version: "1", parameters: {} },
        ],
      },
    },
    seed: "seed-multiturn-recovery",
    idempotencyKey,
  };
}

function blockingMemoryStore(stage: "read" | "write", markStarted: () => void): StudioMemoryStore {
  return {
    adapterId: "blocking-memory",
    adapterVersion: "1",
    scope: "semantic",
    async read(input) {
      if (stage === "read") {
        markStarted();
        await waitForAbort(input.signal);
      }
      return emptyMemoryRead();
    },
    async write(input) {
      if (stage === "write") {
        markStarted();
        await waitForAbort(input.signal);
      }
      return emptyMemoryWrite();
    },
    async consolidate() {
      return emptyMemoryConsolidation();
    },
  };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("cancelled", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  });
}

function emptyMemoryRead() {
  return {
    stateRevision: 0,
    stateRecovered: false,
    queryTerms: [],
    candidates: [],
    records: [],
    retrievedRecordIds: [],
    omittedRecordIds: [],
  };
}

function emptyMemoryWrite() {
  return {
    stateRevision: 0,
    decisions: [],
    writtenRecordIds: [],
    updatedRecordIds: [],
    discardedRecordIds: [],
    expiredRecordIds: [],
    activeRecordIds: [],
    scopes: ["semantic"] as const,
  };
}

function emptyMemoryConsolidation() {
  return {
    stateRevision: 0,
    decisions: [],
    expiredRecordIds: [],
    activeRecordIds: [],
    scopes: ["semantic"] as const,
  };
}

async function findComparisonId(root: string): Promise<string> {
  const comparisonId = (await readdir(root, { withFileTypes: true }))
    .find((entry) => entry.isDirectory() && entry.name !== "idempotency")?.name;
  assert.ok(comparisonId);
  return comparisonId;
}
