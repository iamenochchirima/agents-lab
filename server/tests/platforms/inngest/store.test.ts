import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { InngestRunConflictError, InngestRunStore } from "../../../src/platforms/inngest/variants/baseline/store.js";

const input = {
  runId: "run-inngest-store",
  prompt: "Return a short sentence.",
  systemInstruction: "You are a deterministic test agent.",
  provider: "fake" as const,
  model: "fake-success",
};

test("Inngest store persists lifecycle and is idempotent across reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-store-"));
  try {
    const store = new InngestRunStore(directory, () => new Date("2026-09-15T12:00:00.000Z"));
    await store.load();
    await store.admit(input);
    await store.markDispatched(input.runId, { eventId: "evt-1", outcome: "accepted" });
    await store.markStarted(input.runId, "fn-run-1", 0);
    await store.markModelRequested(input.runId, 0);
    await store.markModelCompleted(input.runId, 0, null);
    const finished = await store.finish(input.runId, "completed", {
      output: "done",
      error: null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    });
    const duplicate = await store.finish(input.runId, "completed", {
      output: "done",
      error: null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    });

    assert.equal(finished.result?.status, "completed");
    assert.equal(duplicate.result?.output, "done");
    assert.deepEqual(finished.events.map((event) => event.sourceSequence), [1, 2, 3, 4]);
    assert.equal(finished.metrics?.modelCallCount, 1);

    const reloaded = new InngestRunStore(directory);
    await reloaded.load();
    const persisted = await reloaded.get(input.runId);
    assert.equal(persisted?.result?.output, "done");
    assert.equal(persisted?.functionRunId, "fn-run-1");
    assert.equal(persisted?.requestHash?.length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Inngest store rejects a reused run ID with different request input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-conflict-"));
  try {
    const store = new InngestRunStore(directory);
    await store.load();
    await store.admit(input);

    await assert.rejects(
      store.admit({ ...input, prompt: "A different prompt." }),
      (error: unknown) => error instanceof InngestRunConflictError && /different request input/.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Inngest store records cancellation requests without fabricating a terminal result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-cancel-"));
  try {
    const store = new InngestRunStore(directory);
    await store.load();
    await store.admit(input);
    const updated = await store.requestCancellation(input.runId, "cancel-evt-1");
    assert.equal(updated.status, "queued");
    assert.equal(updated.cancellationRequested, true);
    assert.equal(updated.result, null);
    assert.equal(updated.events.at(-1)?.kind, "RunCancellationRequested");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Inngest store counts step retries from observed model requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-retry-count-"));
  try {
    const store = new InngestRunStore(directory);
    await store.load();
    await store.admit(input);
    await store.markStarted(input.runId, "fn-run-1", 0);
    const updated = await store.markModelRequested(input.runId, 1);

    assert.equal(updated.attemptCount, 2);
    assert.equal(updated.events.at(-1)?.payload.attempt, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
