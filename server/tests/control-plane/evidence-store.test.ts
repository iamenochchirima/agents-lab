import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import type { PlatformExecutionReference, RunEventIntent, RunMetrics, RunResult, RunTrajectory } from "../../src/control-plane/domain/types.js";
import {
  CorruptEvidenceError,
  EvidenceConflictError,
  EventOrderingError,
  InvalidRunIdError,
  RunEvidenceStore,
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
