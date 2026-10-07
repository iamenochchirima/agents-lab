import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import type { RunEvalReport } from "../../src/control-plane/domain/eval-report.js";
import type { ContextSnapshot } from "../../src/capabilities/context/contracts.js";
import type { PlatformExecutionReference, RunEventIntent, RunMetrics, RunResult, RunTrajectory } from "../../src/control-plane/domain/types.js";
import {
  CorruptEvidenceError,
  EvidenceConflictError,
  EvidenceLimitError,
  EventOrderingError,
  InvalidRunIdError,
  RunEvidenceStore,
  isAllowlistedEvidenceFile,
} from "../../src/control-plane/application/evidence-store.js";

const manifest = buildRunManifest(
  {
    platform: "temporal",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Explain durable execution." },
    model: { provider: "fake", model: "fake-success" },
  },
  { runId: "run-evidence-1", now: "2026-09-15T08:00:00.000Z" },
);

function intent(source: RunEventIntent["source"], sourceSequence: number, kind: string): RunEventIntent {
  return {
    source,
    sourceSequence,
    kind,
    runId: manifest.runId,
    occurredAt: `2026-09-15T08:00:0${sourceSequence}.000Z`,
    payload: { sourceSequence },
  };
}

async function withStore(run: (store: RunEvidenceStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-evidence-"));
  try {
    const store = new RunEvidenceStore(root);
    await store.createRun(manifest);
    await run(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("retains bounded eval reports idempotently with owning and correlated run evidence", async () => {
  await withStore(async (store) => {
    const secondRunId = "run-evidence-2";
    await store.createRun({ ...manifest, runId: secondRunId });
    const report: RunEvalReport = {
      schemaVersion: 1,
      suiteVersion: "baseline-1",
      graderVersion: "baseline-1",
      caseId: "B03",
      trialId: "trial-1",
      ownerRunId: manifest.runId,
      runIds: [manifest.runId, secondRunId],
      verdict: "pass",
      assertions: [{ id: "context-marker", passed: true, expected: "marker", observed: "marker",
        observationRefs: [{ runId: secondRunId, file: "context.json", pointer: "/messages" }] }],
      observations: [{ request: { role: "user", content: "marker", apiKey: "fake-secret" } }],
      metadata: { revision: null, dirty: true, versions: { node: process.version },
        startedAt: manifest.createdAt, completedAt: manifest.createdAt, trialCount: 1 },
    };
    assert.equal(await store.readEvalReport(manifest.runId), null);
    await store.writeEvalReport(manifest.runId, report);
    await store.writeEvalReport(manifest.runId, report);
    const retained = await store.readEvalReport(manifest.runId);
    assert.deepEqual(retained?.runIds, [manifest.runId, secondRunId]);
    assert.deepEqual(retained?.observations, [{ request: { role: "user", content: "marker", apiKey: "[REDACTED]" } }]);
    assert.deepEqual(JSON.parse(await store.readAllowlistedFile(manifest.runId, "artifacts/eval.json")), retained);
    const originalText = await store.readAllowlistedFile(manifest.runId, "artifacts/eval.json");
    const revision = { ...report, graderVersion: "3", trialId: "regraded-trial" };
    await store.writeEvalReport(manifest.runId, revision, { graderRevision: true });
    await store.writeEvalReport(manifest.runId, revision, { graderRevision: true });
    assert.equal((await store.readEvalReport(manifest.runId, "artifacts/eval-grader-3.json"))?.graderVersion, "3");
    assert.equal(await store.readAllowlistedFile(manifest.runId, "artifacts/eval.json"), originalText);
    assert.equal(isAllowlistedEvidenceFile("artifacts/eval-grader-3.json", manifest.platform), true);
    assert.equal(isAllowlistedEvidenceFile("artifacts/eval-grader-999.json", manifest.platform), false);
    await assert.rejects(store.readEvalReport(manifest.runId, "../config.json" as "artifacts/eval.json"), /Unsupported eval report/);
    await assert.rejects(store.writeEvalReport(manifest.runId, report, { graderRevision: true }), /Only the bounded grader-3/);
    assert.equal(isAllowlistedEvidenceFile("artifacts/eval.json", manifest.platform), true);
    assert.equal(isAllowlistedEvidenceFile("artifacts/other.json", manifest.platform), false);
    await assert.rejects(store.readAllowlistedFile(manifest.runId, "../config.json" as "config.json"), /Unsupported evidence file/);
    await assert.rejects(store.writeEvalReport(secondRunId, report), EvidenceConflictError);
    await assert.rejects(store.writeEvalReport(manifest.runId, { ...report, runIds: [manifest.runId, "missing-run"], assertions: [{ id: "marker", passed: true, expected: "marker", observed: "marker" }] }), /Evidence was not found/);
    await assert.rejects(store.writeEvalReport(manifest.runId, { ...report, trialId: "different-trial" }), EvidenceConflictError);
    await assert.rejects(store.writeEvalReport(manifest.runId, { ...report, schemaVersion: 2 } as unknown as RunEvalReport), /Invalid schema-v1/);
    await assert.rejects(store.writeEvalReport(manifest.runId, { ...report, observations: ["x".repeat(256 * 1024)] }), EvidenceLimitError);
  });
});

test("creates an immutable run record and appends source-ordered events idempotently", async () => {
  await withStore(async (store, root) => {
    const created = await store.appendEvent(intent("control-plane", 1, "RunCreated"));
    const dispatched = await store.appendEvent(intent("control-plane", 2, "RunDispatched"));
    const duplicate = await store.appendEvent(intent("control-plane", 2, "RunDispatched"));
    const platformStarted = await store.appendEvent(intent("temporal-workflow", 1, "AgentStarted"));

    assert.equal(created.eventId, "run-evidence-1:control-plane:1");
    assert.equal(dispatched.recordedSequence, 2);
    assert.deepEqual(duplicate, dispatched);
    assert.equal(platformStarted.recordedSequence, 3);

    const events = await store.readEvents(manifest.runId);
    assert.deepEqual(
      events.map((event) => [event.recordedSequence, event.eventId]),
      [
        [1, "run-evidence-1:control-plane:1"],
        [2, "run-evidence-1:control-plane:2"],
        [3, "run-evidence-1:temporal-workflow:1"],
      ],
    );

    const config = JSON.parse(await readFile(join(root, manifest.runId, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(config.runId, manifest.runId);
    assert.equal("apiKey" in config, false);
  });
});

test("redacts skill bodies from context evidence while retaining safe provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-evidence-skills-"));
  const skillManifest = buildRunManifest(
    {
      platform: "temporal",
      variant: "baseline",
      sessionId: "session-evidence-skills",
      task: { kind: "prompt", prompt: "Summarize research." },
      model: { provider: "fake", model: "fake-success" },
    },
    { runId: "run-evidence-skills", now: "2026-09-15T08:00:00.000Z" },
  );
  try {
    const store = new RunEvidenceStore(root);
    await store.createRun(skillManifest);
    const snapshot: ContextSnapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-evidence-skills",
      sessionId: "session-evidence-skills",
      sessionRevision: 1,
      compactionRevision: 0,
      model: "fake/fake-success",
      messages: [{
        schemaVersion: 1,
        messageId: "skill-research-summary-1.0.0",
        sessionId: "session-evidence-skills",
        sequence: 1,
        role: "developer",
        content: "private skill instructions",
        source: "skills",
        createdAt: "2026-09-15T08:00:00.000Z",
        metadata: { skillId: "research-summary", skillVersion: "1.0.0", skillDigest: "a".repeat(64), authority: "none" },
      }],
      sources: ["skills"],
      budget: {
        contextWindowTokens: 1000,
        inputTokens: 10,
        reservedOutputTokens: 10,
        safetyMarginTokens: 5,
        remainingTokens: 975,
        remainingPercent: 97,
        quality: "estimated",
        tokenizerBasis: "test",
        pressure: "normal",
      },
      compaction: null,
      createdAt: "2026-09-15T08:00:00.000Z",
    };
    await store.writeContextSnapshot(skillManifest.runId, snapshot);
    const stored = JSON.parse(await store.readAllowlistedFile(skillManifest.runId, "context.json")) as ContextSnapshot;
    assert.equal(stored.messages[0]?.content, "[skill context redacted from run evidence]");
    assert.equal(stored.messages[0]?.metadata?.skillDigest, "a".repeat(64));
    assert.equal(JSON.stringify(stored).includes("private skill instructions"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects gaps and conflicting duplicate event identities", async () => {
  await withStore(async (store) => {
    await store.appendEvent(intent("temporal-workflow", 1, "AgentStarted"));

    await assert.rejects(
      store.appendEvent(intent("temporal-workflow", 3, "ModelCompleted")),
      (error: unknown) => error instanceof EventOrderingError,
    );

    await assert.rejects(
      store.appendEvent({ ...intent("temporal-workflow", 1, "DifferentKind"), payload: { changed: true } }),
      (error: unknown) => error instanceof EvidenceConflictError,
    );
  });
});

test("scopes event identity and ordering by platform, run, and attempt", async () => {
  await withStore(async (store) => {
    const attemptTwoStarted = await store.appendEvent({
      ...intent("temporal-workflow", 1, "AgentStarted"),
      platform: "temporal",
      attemptId: "attempt-2",
      payload: { attemptId: "attempt-2", sourceSequence: 1 },
    });
    const attemptOneStarted = await store.appendEvent({
      ...intent("temporal-workflow", 1, "AgentStarted"),
      platform: "temporal",
      attemptId: "attempt-1",
      payload: { attemptId: "attempt-1", sourceSequence: 1 },
    });

    assert.notEqual(attemptTwoStarted.eventId, attemptOneStarted.eventId);
    assert.equal(attemptTwoStarted.platform, "temporal");
    assert.equal(attemptTwoStarted.attemptId, "attempt-2");
    assert.deepEqual(
      await store.appendEvent({
        ...intent("temporal-workflow", 1, "AgentStarted"),
        platform: "temporal",
        attemptId: "attempt-2",
        payload: { attemptId: "attempt-2", sourceSequence: 1 },
      }),
      attemptTwoStarted,
    );

    await assert.rejects(
      store.appendEvent({
        ...intent("temporal-workflow", 3, "ModelCompleted"),
        platform: "temporal",
        attemptId: "attempt-2",
        payload: { attemptId: "attempt-2", sourceSequence: 3 },
      }),
      (error: unknown) => error instanceof EventOrderingError,
    );
    await store.appendEvent({
      ...intent("temporal-workflow", 2, "ModelCompleted"),
      platform: "temporal",
      attemptId: "attempt-2",
      payload: { attemptId: "attempt-2", sourceSequence: 2 },
    });

    await assert.rejects(
      store.appendEvent({
        ...intent("temporal-workflow", 1, "DifferentKind"),
        platform: "temporal",
        attemptId: "attempt-2",
        payload: { attemptId: "attempt-2", sourceSequence: 1, changed: true },
      }),
      (error: unknown) => error instanceof EvidenceConflictError,
    );

    await assert.rejects(
      store.appendEvent({
        ...intent("temporal-workflow", 1, "AgentStarted"),
        platform: "restate",
        attemptId: "attempt-3",
        payload: { attemptId: "attempt-3", sourceSequence: 1 },
      }),
      (error: unknown) => error instanceof EvidenceConflictError,
    );
  });
});

test("writes terminal evidence idempotently and preserves unknown measurements as null", async () => {
  await withStore(async (store) => {
    const result: RunResult = {
      schemaVersion: 1,
      runId: manifest.runId,
      status: "completed",
      startedAt: manifest.createdAt,
      finishedAt: "2026-09-15T08:00:05.000Z",
      output: "The response.",
      error: null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    const trajectory: RunTrajectory = {
      schemaVersion: 1,
      runId: manifest.runId,
      phases: [{ name: "model_request", startedAt: manifest.createdAt, finishedAt: result.finishedAt }],
    };
    const metrics: RunMetrics = {
      schemaVersion: 1,
      runId: manifest.runId,
      status: "completed",
      durationMs: 5000,
      modelCallCount: 1,
      modelAttemptCount: 1,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    };

    await store.writeResult(result);
    await store.writeResult(result);
    await store.writeTrajectory(trajectory);
    await store.writeMetrics(metrics);

    assert.deepEqual((await store.readSnapshot(manifest.runId)).result, result);
    assert.equal((await store.readSnapshot(manifest.runId)).metrics?.costUsd, null);
  });
});

test("allows a provisional reconciliation result to be replaced by confirmed terminal evidence", async () => {
  await withStore(async (store) => {
    const provisional: RunResult = {
      schemaVersion: 1,
      runId: manifest.runId,
      status: "reconciliation_required",
      startedAt: null,
      finishedAt: "2026-09-15T08:00:05.000Z",
      output: null,
      error: { code: "SUBMISSION_UNKNOWN", message: "The submission outcome is not confirmed.", failureKind: "outcome_unknown", retryable: true },
      attemptCount: 0,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    const confirmed: RunResult = {
      ...provisional,
      status: "completed",
      startedAt: "2026-09-15T08:00:01.000Z",
      finishedAt: "2026-09-15T08:00:06.000Z",
      output: "confirmed",
      error: null,
      attemptCount: 1,
    };

    await store.writeResult(provisional);
    await store.writeResult(provisional);
    await store.writeResult(confirmed);
    assert.equal((await store.readSnapshot(manifest.runId)).result?.output, "confirmed");
    await assert.rejects(
      store.writeResult({ ...confirmed, output: "different" }),
      (error: unknown) => error instanceof EvidenceConflictError,
    );
  });
});

test("redacts credential-shaped native fields and rejects oversized evidence", async () => {
  await withStore(async (store, root) => {
    await store.writeExecutionReference(manifest.runId, {
      platform: manifest.platform,
      variant: manifest.variant,
      executionId: "temporal-native-test",
      native: { authorization: "Bearer secret", apiKey: "another-secret", safeValue: "kept" },
    });
    const native = JSON.parse(await readFile(join(root, manifest.runId, "native/temporal.json"), "utf8")) as { native: Record<string, unknown> };
    assert.equal(native.native.authorization, "[REDACTED]");
    assert.equal(native.native.apiKey, "[REDACTED]");
    assert.equal(native.native.safeValue, "kept");
    assert.equal(JSON.stringify(native).includes("secret"), false);

    await assert.rejects(
      store.writeResult({
        schemaVersion: 1,
        runId: manifest.runId,
        status: "completed",
        startedAt: manifest.createdAt,
        finishedAt: "2026-09-15T08:00:05.000Z",
        output: "x".repeat(512 * 1024 + 1),
        error: null,
        attemptCount: 1,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      }),
      (error: unknown) => error instanceof EvidenceLimitError,
    );
  });
});

test("writes bounded operational logs in order without retaining prompts or credentials", async () => {
  await withStore(async (store, root) => {
    const entries = await Promise.all([
      store.appendOperationalLog({
        runId: manifest.runId,
        occurredAt: "2026-09-15T08:00:01.000Z",
        level: "info",
        operation: "run.create",
        requestId: "req-one",
        platform: manifest.platform,
        variant: manifest.variant,
        status: "running",
        nativeStatus: "RUNNING",
        outcome: "running",
        durationMs: 12,
        retryCount: 1,
      }),
      store.appendOperationalLog({
        runId: manifest.runId,
        occurredAt: "2026-09-15T08:00:02.000Z",
        level: "warn",
        operation: "run.reconcile",
        requestId: "req-two",
        platform: manifest.platform,
        variant: manifest.variant,
        status: "reconciliation_required",
        nativeStatus: "UNKNOWN",
        outcome: "stale",
        durationMs: 4,
        code: "RESTATE_SUBMISSION_OUTCOME_UNKNOWN",
      }),
    ]);

    assert.deepEqual(entries.map((entry) => entry.recordedSequence), [1, 2]);
    const contents = await readFile(join(root, manifest.runId, "logs/operations.jsonl"), "utf8");
    const records = contents.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(records.map((record) => record.operation), ["run.create", "run.reconcile"]);
    assert.equal(records[0]?.retryCount, 1);
    assert.equal(contents.includes(manifest.task.prompt), false);
    assert.equal(contents.includes("apiKey"), false);
    assert.equal(contents.includes("secret"), false);
    assert.equal(await store.readAllowlistedFile(manifest.runId, "logs/operations.jsonl"), contents);
  });
});

test("projects capability lifecycle events into safe operational logs", async () => {
  await withStore(async (store, root) => {
    const events = [
      {
        kind: "CapabilityResolutionRecorded",
        payload: {
          profileId: "local-safe",
          decisions: [{ capabilityId: "fixture_lookup", status: "granted" }],
          grants: [{ capabilityId: "fixture_lookup" }],
          prompt: manifest.task.prompt,
          apiKey: "secret",
        },
      },
      {
        kind: "ToolExecutionStarted",
        payload: { toolCallId: "tool-1", toolName: "fixture_lookup", attempt: 1 },
      },
      {
        kind: "ToolExecutionCompleted",
        payload: {
          toolCallId: "tool-1",
          toolName: "fixture_lookup",
          durationMs: 12,
          connection: { requestId: "request-1", status: "completed", providerRequestIds: ["provider-1"] },
        },
      },
      {
        kind: "ModelRetryScheduled",
        payload: { nextAttempt: 2, backoffMs: 10 },
      },
      {
        kind: "TaskSubmissionOutcomeUnknown",
        payload: { code: "SUBMISSION_UNKNOWN", providerRequestId: "provider-2" },
      },
      {
        kind: "OAuthRefreshCompleted",
        payload: { requestId: "oauth-refresh-1", status: "completed" },
      },
    ] as const;

    for (const [index, event] of events.entries()) {
      await store.appendEvent({
        source: "platform-test",
        sourceSequence: index + 1,
        kind: event.kind,
        runId: manifest.runId,
        occurredAt: `2026-09-15T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
        payload: event.payload,
      });
    }

    const contents = await readFile(join(root, manifest.runId, "logs/operations.jsonl"), "utf8");
    const records = contents.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(records.map((record) => record.operation), [
      "capability.resolve",
      "tool.execute",
      "tool.execute",
      "model.retry",
      "connection.unknown",
      "oauth.refresh",
    ]);
    assert.equal(records[2]?.requestId, "request-1");
    assert.equal(records[2]?.providerRequestId, "provider-1");
    assert.equal(records[2]?.durationMs, 12);
    assert.equal(records[3]?.retryCount, 1);
    assert.equal(records[4]?.level, "warn");
    assert.equal(contents.includes(manifest.task.prompt), false);
    assert.equal(contents.includes("secret"), false);
    assert.equal(contents.includes("provider-1"), true);
  });
});

test("reads schema-v1 Temporal native references through the generic execution field", async () => {
  await withStore(async (store, root) => {
    await writeFile(
      join(root, manifest.runId, "native/temporal.json"),
      JSON.stringify({
        platform: "temporal",
        namespace: "default",
        taskQueue: "agentlab-temporal-baseline",
        workflowId: "agentlab:legacy-run",
        workflowRunId: "legacy-workflow-run",
        workflowType: "temporalBaselineWorkflow",
        activityTypes: ["requestModel"],
      }),
    );

    const snapshot = await store.readSnapshot(manifest.runId);
    assert.equal(snapshot.executionReference?.executionId, "agentlab:legacy-run");
    assert.equal(snapshot.executionReference?.native.workflowRunId, "legacy-workflow-run");
  });
});

test("keeps native execution references scoped to their manifest platform and variant", async () => {
  await withStore(async (store) => {
    const reference: PlatformExecutionReference = {
      platform: "restate",
      variant: "baseline",
      executionId: "restate-run-1",
      native: { invocationId: "restate-run-1" },
    };

    await assert.rejects(
      store.writeExecutionReference(manifest.runId, reference),
      (error: unknown) => error instanceof CorruptEvidenceError,
    );
  });
});

test("keeps native references for separate runs in separate platform-scoped files", async () => {
  await withStore(async (store, root) => {
    const restateManifest = buildRunManifest(
      {
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Compare native evidence." },
        model: { provider: "fake", model: "fake-success" },
      },
      { runId: "run-evidence-restate-1", now: "2026-09-15T08:00:00.000Z" },
    );
    await store.createRun(restateManifest);

    await store.writeExecutionReference(manifest.runId, {
      platform: "temporal",
      variant: "baseline",
      executionId: "temporal-run-1",
      native: { workflowId: "temporal-run-1" },
    });
    await store.writeExecutionReference(restateManifest.runId, {
      platform: "restate",
      variant: "baseline",
      executionId: "restate-run-1",
      native: { invocationId: "restate-run-1" },
    });

    assert.equal(JSON.parse(await readFile(join(root, manifest.runId, "native/temporal.json"), "utf8")).executionId, "temporal-run-1");
    assert.equal(JSON.parse(await readFile(join(root, restateManifest.runId, "native/restate.json"), "utf8")).executionId, "restate-run-1");
  });
});

test("reports corrupt JSONL and rejects unsafe run identifiers", async () => {
  await withStore(async (store, root) => {
    await store.appendEvent(intent("control-plane", 1, "RunCreated"));
    await readFile(join(root, manifest.runId, "events.jsonl"), "utf8");
    await appendFile(join(root, manifest.runId, "events.jsonl"), "not-json\n");

    await assert.rejects(
      store.readEvents(manifest.runId),
      (error: unknown) => error instanceof CorruptEvidenceError,
    );

    assert.throws(() => new RunEvidenceStore(root).runDirectory("../escape"), (error: unknown) => error instanceof InvalidRunIdError);
  });
});
