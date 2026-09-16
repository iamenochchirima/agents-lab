import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { loadTriggerDevConfig, type TriggerDevConfig } from "../../../src/platforms/trigger-dev/config.js";
import {
  TriggerDevBaselineRunner,
  type TriggerApi,
  type TriggerRunRecord,
  type TriggerRunHandle,
  type TriggerTriggerOptions,
} from "../../../src/platforms/trigger-dev/runner-adapter/trigger-dev-runner.js";
import type { TriggerPromptPayload, TriggerTaskOutput } from "../../../src/platforms/trigger-dev/variants/baseline/contracts.js";

const config = loadTriggerDevConfig({
  TRIGGER_API_URL: "http://127.0.0.1:3040",
  TRIGGER_SECRET_KEY: "tr_dev_test_secret",
  TRIGGER_PROJECT_REF: "proj_test",
});

test("Trigger.dev configuration is safe to place in a manifest", () => {
  const runner = new TriggerDevBaselineRunner({ config, client: fakeClient() });
  const manifestConfiguration = runner.manifestConfiguration();
  assert.equal(manifestConfiguration.apiUrl, "http://127.0.0.1:3040");
  assert.equal(manifestConfiguration.secretConfigured, true);
  assert.equal(JSON.stringify(manifestConfiguration).includes("tr_dev_test_secret"), false);
  assert.equal(JSON.stringify(manifestConfiguration).includes("test_secret"), false);
});

test("Trigger.dev runner uses the Lab run ID as a stable idempotency key", async () => {
  const calls: Array<{ taskIdentifier: string; payload: TriggerPromptPayload; options: TriggerTriggerOptions }> = [];
  const client = fakeClient({
    trigger: async (taskIdentifier, payload, options) => {
      calls.push({ taskIdentifier, payload, options });
      return { id: "run_trigger_123", isCached: calls.length > 1 };
    },
  });
  const runner = new TriggerDevBaselineRunner({ config, client });
  const manifest = manifestFor(runner, "run-idempotency");

  const first = await runner.start(manifest);
  const second = await runner.start(manifest);

  assert.equal(first.executionId, "run_trigger_123");
  assert.deepEqual(second, { ...first, native: { ...first.native, submissionOutcome: "already_accepted" } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.options, {
    idempotencyKey: "run-idempotency",
    idempotencyKeyTTL: "1h",
    maxAttempts: 2,
  });
  assert.equal(calls[0]?.payload.runId, "run-idempotency");
  assert.equal(calls[1]?.options.idempotencyKey, calls[0]?.options.idempotencyKey);
});

test("an ambiguous admission retries the same key and reconciles a lost acknowledgement", async () => {
  let attempts = 0;
  const client = fakeClient({
    trigger: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("socket closed after Trigger accepted the request");
      return { id: "run_trigger_reconciled", isCached: true };
    },
  });
  const runner = new TriggerDevBaselineRunner({ config, client });

  const reference = await runner.start(manifestFor(runner, "run-lost-ack"));

  assert.equal(attempts, 2);
  assert.equal(reference.executionId, "run_trigger_reconciled");
  assert.equal(reference.native.submissionOutcome, "already_accepted");
  assert.equal(reference.native.idempotencyKey, "run-lost-ack");
});

test("an unresolved ambiguous admission becomes reconciliation-required evidence", async () => {
  const client = fakeClient({
    trigger: async () => {
      throw new Error("network unavailable");
    },
  });
  const runner = new TriggerDevBaselineRunner({ config, client });
  const reference = await runner.start(manifestFor(runner, "run-unknown-admission"));

  const inspection = await runner.inspect(reference);

  assert.equal(reference.native.submissionOutcome, "unknown");
  assert.equal(inspection.status, "failed");
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
  assert.equal(inspection.eventIntents[0]?.kind, "TaskSubmissionOutcomeUnknown");
});

test("Trigger.dev statuses and task output map to normalized inspection", async () => {
  const output = taskOutput("run-status", "Fake response: hello");
  const records: Record<string, TriggerRunRecord> = {
    queued: record("run-status", "QUEUED"),
    running: record("run-status", "EXECUTING", { startedAt: "2026-09-15T08:00:01.000Z" }),
    completed: record("run-status", "COMPLETED", { output, startedAt: output.startedAt, finishedAt: output.finishedAt, attemptCount: 1 }),
    cancelled: record("run-status", "CANCELED", { startedAt: "2026-09-15T08:00:01.000Z", finishedAt: "2026-09-15T08:00:02.000Z" }),
    timedOut: record("run-status", "TIMED_OUT", { startedAt: "2026-09-15T08:00:01.000Z", finishedAt: "2026-09-15T08:00:02.000Z" }),
  };

  for (const [name, run] of Object.entries(records)) {
    const runner = new TriggerDevBaselineRunner({
      config,
      client: fakeClient({ retrieve: async () => run }),
    });
    const reference = referenceFor(runner, "run-status");
    const inspection = await runner.inspect(reference);

    if (name === "queued") assert.equal(inspection.status, "queued");
    if (name === "running") assert.equal(inspection.status, "running");
    if (name === "completed") {
      assert.equal(inspection.status, "completed");
      assert.equal(inspection.result?.status, "completed");
      assert.equal(inspection.result?.output, "Fake response: hello");
      assert.equal(inspection.metrics?.modelCallCount, 1);
    }
    if (name === "cancelled") {
      assert.equal(inspection.status, "cancelled");
      assert.equal(inspection.result?.error?.failureKind, "cancelled");
    }
    if (name === "timedOut") {
      assert.equal(inspection.status, "failed");
      assert.equal(inspection.result?.status, "failed");
      assert.equal(inspection.result?.error?.failureKind, "timeout");
    }
  }
});

test("cancellation is routed to a live Trigger run and is idempotent after terminal state", async () => {
  let current: TriggerRunRecord = record("run-cancel", "EXECUTING", { startedAt: "2026-09-15T08:00:01.000Z" });
  let cancelCalls = 0;
  const runner = new TriggerDevBaselineRunner({
    config,
    client: fakeClient({
      retrieve: async () => current,
      cancel: async () => {
        cancelCalls += 1;
        current = record("run-cancel", "CANCELED", { finishedAt: "2026-09-15T08:00:02.000Z" });
      },
    }),
  });
  const reference = referenceFor(runner, "run-cancel");

  assert.deepEqual(await runner.cancel(reference, "stop now"), {
    accepted: true,
    alreadyTerminal: false,
    message: "Trigger.dev cancellation requested: stop now",
  });
  assert.equal(cancelCalls, 1);
  assert.equal((await runner.cancel(reference, "stop again")).alreadyTerminal, true);
  assert.equal(cancelCalls, 1);
});

test("availability distinguishes an authenticated API from an unavailable server", async () => {
  const reachable = new TriggerDevBaselineRunner({
    config,
    client: fakeClient({ retrieve: async () => { throw httpError(404, "not found"); } }),
  });
  assert.deepEqual(await reachable.checkConnection(), { reachable: true, message: "Trigger.dev API is reachable." });

  const unavailable = new TriggerDevBaselineRunner({
    config,
    client: fakeClient({ retrieve: async () => { throw httpError(503, "unavailable"); } }),
  });
  assert.deepEqual(await unavailable.checkConnection(), { reachable: false, message: "Trigger.dev API returned HTTP 503." });
});

test("validation accepts OpenRouter when the task has a provider key", () => {
  const runner = new TriggerDevBaselineRunner({
    config: loadTriggerDevConfig({
      TRIGGER_API_URL: "http://127.0.0.1:3040",
      TRIGGER_SECRET_KEY: "tr_dev_test_secret",
      TRIGGER_PROJECT_REF: "proj_test",
      OPENROUTER_API_KEY: "openrouter_test_secret",
    }),
    client: fakeClient(),
  });
  const manifest = buildRunManifest({
    platform: "trigger-dev",
    variant: "baseline",
    task: { kind: "prompt", prompt: "hello" },
    model: { provider: "openrouter", model: "openai/gpt-4o-mini" },
  }, { runId: "run-openrouter", platformConfig: runner.manifestConfiguration() });
  assert.deepEqual(runner.validate(manifest), { valid: true, reason: null });
});

test("validation rejects OpenRouter when the task process has no provider key", () => {
  const runner = new TriggerDevBaselineRunner({ config, client: fakeClient() });
  const manifest = buildRunManifest({
    platform: "trigger-dev",
    variant: "baseline",
    task: { kind: "prompt", prompt: "hello" },
    model: { provider: "openrouter", model: "openai/gpt-4o-mini" },
  }, { runId: "run-openrouter-missing-key", platformConfig: runner.manifestConfiguration() });

  assert.deepEqual(runner.validate(manifest), {
    valid: false,
    reason: "OPENROUTER_API_KEY is required for the Trigger.dev OpenRouter task.",
  });
});

function manifestFor(runner: TriggerDevBaselineRunner, runId: string) {
  return buildRunManifest({
    platform: "trigger-dev",
    variant: "baseline",
    task: { kind: "prompt", prompt: "hello" },
    model: { provider: "fake", model: "fake-success" },
  }, { runId, platformConfig: runner.manifestConfiguration() });
}

function referenceFor(runner: TriggerDevBaselineRunner, runId: string) {
  return {
    platform: "trigger-dev",
    variant: "baseline",
    executionId: "run_trigger_123",
    native: {
      schemaVersion: 1,
      taskIdentifier: runner.manifestConfiguration().taskIdentifier,
      triggerRunId: "run_trigger_123",
      idempotencyKey: runId,
      idempotencyKeyScope: "global",
      submissionOutcome: "accepted",
      apiUrl: "http://127.0.0.1:3040",
      nativeStatus: "QUEUED",
      attemptCount: null,
      startedAt: null,
      finishedAt: null,
    },
  } as const;
}

function fakeClient(overrides: Partial<{
  trigger: TriggerApi["tasks"]["trigger"];
  retrieve: TriggerApi["runs"]["retrieve"];
  cancel: TriggerApi["runs"]["cancel"];
}> = {}): TriggerApi {
  return {
    tasks: {
      trigger: overrides.trigger ?? (async () => ({ id: "run_trigger_123" })),
    },
    runs: {
      retrieve: overrides.retrieve ?? (async (id) => record(id, "QUEUED")),
      cancel: overrides.cancel ?? (async () => undefined),
    },
  };
}

function record(id: string, status: TriggerRunRecord["status"], overrides: Partial<TriggerRunRecord> = {}): TriggerRunRecord {
  return {
    id,
    status,
    taskIdentifier: "agentlab-trigger-dev-baseline",
    createdAt: "2026-09-15T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:02.000Z",
    ...overrides,
  };
}

function taskOutput(runId: string, output: string): TriggerTaskOutput {
  return {
    schemaVersion: 1,
    runId,
    output,
    startedAt: "2026-09-15T08:00:01.000Z",
    finishedAt: "2026-09-15T08:00:02.000Z",
    attemptCount: 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    eventIntents: [
      { source: "trigger-dev-task", sourceSequence: 1, kind: "TaskStarted", runId, occurredAt: "2026-09-15T08:00:01.000Z", payload: {} },
      { source: "trigger-dev-task", sourceSequence: 2, kind: "ModelRequested", runId, occurredAt: "2026-09-15T08:00:01.000Z", payload: {} },
    ],
    trajectory: { schemaVersion: 1, runId, phases: [] },
    metrics: { schemaVersion: 1, runId, status: "completed", durationMs: 1_000, modelCallCount: 1, modelAttemptCount: 1, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
  };
}

function httpError(status: number, message: string): Error & { status: number } {
  const error = Object.assign(new Error(message), { status });
  return error;
}
