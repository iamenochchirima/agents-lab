import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { loadHatchetConfig } from "../../../src/platforms/hatchet/config.js";
import {
  HatchetBaselineRunner,
  type HatchetRunnerClientLike,
  type HatchetTaskLike,
} from "../../../src/platforms/hatchet/runner-adapter/hatchet-runner.js";
import type {
  HatchetRunDetails,
  HatchetTaskOutput,
} from "../../../src/platforms/hatchet/variants/baseline/contracts.js";

const config = loadHatchetConfig({ HATCHET_CLIENT_TOKEN: "test-token" });

function manifestFor(
  runner: HatchetBaselineRunner,
  runId: string,
  model = "fake-success",
): RunManifest {
  return buildRunManifest(
    {
      platform: "hatchet",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Return one deterministic sentence." },
      model: { provider: "fake", model },
    },
    {
      runId,
      platformConfig: runner.manifestConfiguration(),
      serverVersion: "test",
    },
  );
}

class FakeTask implements HatchetTaskLike {
  readonly calls: Array<{ input: unknown; options: unknown }> = [];
  constructor(
    private readonly behavior: () => Promise<{
      readonly getWorkflowRunId: () => Promise<string>;
    }>,
  ) {}

  async runNoWait(input: unknown, options?: unknown) {
    this.calls.push({ input, options });
    return this.behavior();
  }
}

class FakeClient implements HatchetRunnerClientLike {
  readonly runs = {
    get: async (runId: string): Promise<HatchetRunDetails> => {
      const details = this.detailsById.get(runId);
      if (!details) throw new Error(`run not found: ${runId}`);
      return details;
    },
    get_status: async (runId: string): Promise<string> =>
      this.statusErrors.has(runId)
        ? Promise.reject(this.statusErrors.get(runId))
        : (this.statusById.get(runId) ?? "RUNNING"),
    list: async (): Promise<{ readonly rows: readonly any[] }> => ({
      rows: [...this.listRows],
    }),
    cancel: async ({
      ids,
    }: {
      readonly ids: readonly string[];
    }): Promise<void> => {
      this.cancelledIds.push(...ids);
    },
  };
  readonly workers = { list: async () => ({ rows: this.workerRows }) };
  readonly tenant = { get: async () => ({ id: config.tenantId }) };
  readonly detailsById = new Map<string, HatchetRunDetails>();
  readonly statusById = new Map<string, string>();
  readonly statusErrors = new Map<string, Error>();
  readonly listRows: any[] = [];
  readonly workerRows: any[] = [];
  readonly cancelledIds: string[] = [];
}

function runner(
  task: HatchetTaskLike,
  client = new FakeClient(),
  runnerConfig = config,
): HatchetBaselineRunner {
  return HatchetBaselineRunner.fromClient({
    config: runnerConfig,
    client,
    task,
  });
}

function successfulOutput(runId: string): HatchetTaskOutput {
  const timestamp = "2026-09-15T10:00:00.000Z";
  return {
    schemaVersion: 1,
    runId,
    result: {
      schemaVersion: 1,
      runId,
      status: "completed",
      startedAt: timestamp,
      finishedAt: timestamp,
      output: "safe result",
      error: null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    },
    trajectory: { schemaVersion: 1, runId, phases: [] },
    metrics: {
      schemaVersion: 1,
      runId,
      status: "completed",
      durationMs: 0,
      modelCallCount: 1,
      modelAttemptCount: 1,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    },
    eventIntents: [
      {
        source: "hatchet-task",
        sourceSequence: 1,
        kind: "AgentCompleted",
        runId,
        occurredAt: timestamp,
        payload: {},
      },
    ],
  };
}

test("runner starts one idempotent task and records the Hatchet run identity", async () => {
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-1",
  }));
  const instance = runner(task);
  const reference = await instance.start(
    manifestFor(instance, "hatchet-start-test"),
  );

  assert.equal(reference.executionId, "hatchet:hatchet-start-test");
  assert.equal(reference.native.workflowRunId, "workflow-run-1");
  assert.equal(reference.native.submissionOutcome, "accepted");
  assert.deepEqual(task.calls[0]?.options, {
    additionalMetadata: { agentlabRunId: "hatchet-start-test" },
  });
  assert.equal(JSON.stringify(reference).includes("test-token"), false);
});

test("runner maps an idempotency collision to the existing run instead of starting again", async () => {
  const task = new FakeTask(async () => {
    throw Object.assign(new Error("duplicate"), {
      name: "IdempotencyCollisionError",
      existingRunExternalId: "existing-run-1",
    });
  });
  const instance = runner(task);
  const reference = await instance.start(
    manifestFor(instance, "hatchet-duplicate-test"),
  );

  assert.equal(reference.executionId, "hatchet:hatchet-duplicate-test");
  assert.equal(reference.native.submissionOutcome, "already_accepted");
  assert.equal(reference.native.acknowledgement, "confirmed");
});

test("runner preserves a lost start acknowledgement for later reconciliation", async () => {
  const client = new FakeClient();
  const task = new FakeTask(async () => {
    throw new TypeError("socket closed after Hatchet accepted the task");
  });
  const instance = runner(task, client);
  const reference = await instance.start(
    manifestFor(instance, "hatchet-unknown-test"),
  );
  const inspection = await instance.inspect(reference);

  assert.equal(reference.native.submissionOutcome, "unknown");
  assert.equal(reference.executionId, "hatchet:hatchet-unknown-test");
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
  assert.equal(
    inspection.eventIntents[0]?.kind,
    "HatchetSubmissionOutcomeUnknown",
  );
});

test("runner maps native events and task output without copying model output into native evidence", async () => {
  const client = new FakeClient();
  const runId = "hatchet-inspect-test";
  const output = successfulOutput(runId);
  client.detailsById.set("workflow-run-2", {
    run: {
      status: "COMPLETED",
      startedAt: "2026-09-15T10:00:00.000Z",
      finishedAt: "2026-09-15T10:00:00.000Z",
      output,
    },
    taskEvents: [
      { id: 8, timestamp: "2026-09-15T09:59:59.000Z", eventType: "CREATED" },
      {
        id: 11,
        timestamp: "2026-09-15T10:00:00.000Z",
        eventType: "FINISHED",
        workerId: "worker-1",
        retryCount: 0,
        attempt: 1,
      },
    ],
    tasks: [
      {
        taskExternalId: "task-2",
        status: "COMPLETED",
        retryCount: 0,
        attempt: 1,
        output,
      },
    ],
  });
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-2",
  }));
  const instance = runner(task, client);
  const inspection = await instance.inspect(
    await instance.start(manifestFor(instance, runId)),
  );

  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "safe result");
  assert.deepEqual(
    inspection.eventIntents
      .filter((event) => event.source === "hatchet")
      .map((event) => event.sourceSequence),
    [1, 2],
  );
  assert.equal(inspection.reference.native.workerId, "worker-1");
  assert.equal(inspection.reference.native.retryCount, 0);
  assert.equal(
    JSON.stringify(inspection.reference.native).includes("safe result"),
    false,
  );
});

test("runner requires an active worker and cancels only non-terminal runs", async () => {
  const client = new FakeClient();
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-3",
  }));
  const instance = runner(task, client);
  assert.equal((await instance.checkConnection()).reachable, false);
  client.workerRows.push({
    name: config.workerName,
    status: "ACTIVE",
    actions: [config.taskName],
  });
  assert.equal((await instance.checkConnection()).reachable, true);

  client.statusById.set("workflow-run-3", "RUNNING");
  const reference = await instance.start(
    manifestFor(instance, "hatchet-cancel-test"),
  );
  const cancellation = await instance.cancel(reference, "stop this run");
  assert.deepEqual(cancellation, {
    accepted: true,
    alreadyTerminal: false,
    message: "Hatchet accepted the cancellation request.",
  });
  assert.deepEqual(client.cancelledIds, ["workflow-run-3"]);
});

test("runner cancels an acknowledged run when the status projection briefly returns 404", async () => {
  const client = new FakeClient();
  client.statusErrors.set("workflow-run-status-lag", new Error("run not found"));
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-status-lag",
  }));
  const instance = runner(task, client);
  const reference = await instance.start(
    manifestFor(instance, "hatchet-cancel-status-lag-test"),
  );

  const cancellation = await instance.cancel(reference, "status projection lag");

  assert.equal(cancellation.accepted, true);
  assert.deepEqual(client.cancelledIds, ["workflow-run-status-lag"]);
});

test("runner distinguishes an unavailable service from an unavailable worker", async () => {
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-unavailable",
  }));
  const unavailable = HatchetBaselineRunner.unavailable(
    config,
    "Hatchet API is unavailable.",
  );
  assert.deepEqual(await unavailable.checkConnection(), {
    reachable: false,
    message: "Hatchet API is unavailable.",
  });
  await assert.rejects(
    () =>
      unavailable.start(
        manifestFor(unavailable, "hatchet-service-unavailable"),
      ),
    /Hatchet API is unavailable/,
  );

  const workerUnavailable = runner(task, new FakeClient());
  assert.deepEqual(await workerUnavailable.checkConnection(), {
    reachable: false,
    message:
      "Hatchet API is reachable, but no active worker advertises the baseline task.",
  });
});

test("runner synthesizes a timeout failure when Hatchet has no task output", async () => {
  const client = new FakeClient();
  client.detailsById.set("workflow-run-4", {
    run: { status: "FAILED", errorMessage: "execution deadline exceeded" },
    taskEvents: [
      { id: 1, timestamp: "2026-09-15T10:00:00.000Z", eventType: "TIMED_OUT" },
    ],
    tasks: [
      { taskExternalId: "task-4", status: "FAILED", retryCount: 2, attempt: 3 },
    ],
  });
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-4",
  }));
  const instance = runner(task, client);
  const inspection = await instance.inspect(
    await instance.start(manifestFor(instance, "hatchet-timeout-test")),
  );

  assert.equal(inspection.result?.status, "failed");
  assert.equal(inspection.result?.error?.failureKind, "timeout");
  assert.equal(inspection.result?.attemptCount, 3);
});

test("runner keeps a failed attempt queued while Hatchet has retries remaining", async () => {
  const client = new FakeClient();
  client.detailsById.set("workflow-run-retry", {
    run: {
      status: "FAILED",
      startedAt: "2026-09-15T10:00:00.000Z",
      finishedAt: "2026-09-15T10:00:01.000Z",
    },
    taskEvents: [
      {
        id: 1,
        timestamp: "2026-09-15T10:00:01.000Z",
        eventType: "FAILED",
        retryCount: 0,
      },
    ],
    tasks: [
      {
        taskExternalId: "task-retry",
        status: "FAILED",
        retryCount: 0,
        attempt: 1,
        errorMessage: "transient task failure",
      },
    ],
  });
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-retry",
  }));
  const instance = runner(task, client);
  const inspection = await instance.inspect(
    await instance.start(manifestFor(instance, "hatchet-retry-projection-test")),
  );

  assert.equal(inspection.status, "queued");
  assert.equal(inspection.result, null);
});

test("runner detects timeout from a failed projection without a timeout event", async () => {
  const client = new FakeClient();
  client.detailsById.set("workflow-run-timeout-projection", {
    run: {
      status: "FAILED",
      startedAt: "2026-09-15T10:00:00.000Z",
      finishedAt: "2026-09-15T10:00:05.000Z",
    },
    taskEvents: [{ id: 1, timestamp: "2026-09-15T10:00:05.000Z", eventType: "FAILED" }],
    tasks: [{ taskExternalId: "task-timeout", status: "FAILED", retryCount: 2, attempt: 3 }],
  });
  const task = new FakeTask(async () => ({
    getWorkflowRunId: async () => "workflow-run-timeout-projection",
  }));
  const instance = runner(
    task,
    client,
    loadHatchetConfig({
      HATCHET_CLIENT_TOKEN: "test-token",
      AGENTLAB_HATCHET_EXECUTION_TIMEOUT_MS: "5000",
      AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS: "10000",
    }),
  );
  const inspection = await instance.inspect(
    await instance.start(manifestFor(instance, "hatchet-timeout-projection-test")),
  );

  assert.equal(inspection.result?.error?.failureKind, "timeout");
  assert.equal(inspection.result?.error?.code, "HATCHET_RUN_TIMED_OUT");
});
