import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { loadRestateConfig, safeManifestConfiguration } from "../../../src/platforms/restate/config.js";
import {
  RestateBaselineRunner,
  type RestateIngress,
  type RestateWorkflowClient,
  type RestateWorkflowSubmission,
  mapNativeStatus,
  workflowKeyForRun,
} from "../../../src/platforms/restate/runner-adapter/restate-runner.js";
import type { RestateWorkflowResult } from "../../../src/platforms/restate/variants/baseline/contracts.js";

class FakeWorkflowClient implements RestateWorkflowClient {
  constructor(
    private readonly submission: RestateWorkflowSubmission = { invocationId: "inv-1", status: "Accepted", attachable: true },
    private readonly output: { readonly ready: boolean; readonly result?: RestateWorkflowResult } = { ready: false },
    private readonly outputError?: unknown,
  ) {}

  async workflowSubmit(): Promise<RestateWorkflowSubmission> {
    return this.submission;
  }

  async workflowOutput(): Promise<{ readonly ready: boolean; readonly result?: RestateWorkflowResult }> {
    if (this.outputError) throw this.outputError;
    return this.output;
  }
}

class FakeIngress implements RestateIngress {
  readonly keys: string[] = [];
  constructor(private readonly client: RestateWorkflowClient) {}

  workflowClient(definition: { readonly name: string }, key: string): RestateWorkflowClient {
    assert.equal(definition.name, "AgentLabRestateBaseline");
    this.keys.push(key);
    return this.client;
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function manifestFor(runner: RestateBaselineRunner, runId = "restate-runner-test", model = "fake-success", provider: "fake" | "openrouter" = "fake"): RunManifest {
  return buildRunManifest({
    platform: "restate",
    variant: "baseline",
    task: { kind: "prompt", prompt: "runner test prompt" },
    model: { provider, model },
  }, { runId, platformConfig: runner.manifestConfiguration() });
}

function resultFor(runId: string): RestateWorkflowResult {
  const occurredAt = "2026-09-15T10:00:00.000Z";
  const eventIntents = [
    { source: "restate-workflow", sourceSequence: 1, kind: "RunCompleted", runId, occurredAt, payload: {} },
  ];
  return {
    schemaVersion: 1,
    runId,
    status: "completed",
    startedAt: occurredAt,
    finishedAt: occurredAt,
    output: "done",
    error: null,
    attemptCount: 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    eventIntents,
    trajectory: { schemaVersion: 1, runId, phases: [] },
    metrics: { schemaVersion: 1, runId, status: "completed", durationMs: 0, modelCallCount: 1, modelAttemptCount: 1, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
  };
}

test("workflow keys are deterministic and native statuses remain honest", () => {
  assert.equal(workflowKeyForRun("run-123"), "agentlab:run-123");
  assert.throws(() => workflowKeyForRun("bad key"));
  assert.equal(mapNativeStatus("pending"), "queued");
  assert.equal(mapNativeStatus("backing-off"), "running");
  assert.equal(mapNativeStatus("completed"), "completed");
  assert.equal(mapNativeStatus("completed", "failure"), "failed");
  assert.equal(mapNativeStatus("canceled"), "cancelled");
  assert.equal(mapNativeStatus("killed"), "failed");
});

test("runner submits through the Restate workflow boundary with a stable key", async () => {
  const config = loadRestateConfig();
  const ingress = new FakeIngress(new FakeWorkflowClient());
  const runner = RestateBaselineRunner.fromOptions({ config, ingress });
  const manifest = manifestFor(runner);

  assert.deepEqual(runner.validate(manifest), { valid: true, reason: null });
  const reference = await runner.start(manifest);

  assert.equal(reference.executionId, "agentlab:restate-runner-test");
  assert.equal(reference.native.submissionOutcome, "accepted");
  assert.equal(reference.native.invocationId, "inv-1");
  assert.deepEqual(ingress.keys, ["agentlab:restate-runner-test"]);
  assert.equal(JSON.stringify(reference).includes("OPENROUTER"), false);
});

test("runner maps a durable workflow result into the common inspection seam", async () => {
  const config = loadRestateConfig();
  const runId = "restate-result-test";
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient({ invocationId: "inv-2", status: "Accepted", attachable: true }, { ready: true, result: resultFor(runId) })),
  });
  const inspection = await runner.inspect(await runner.start(manifestFor(runner, runId)));

  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "done");
  assert.equal(inspection.metrics?.modelCallCount, 1);
  assert.equal(inspection.eventIntents[0]?.kind, "RunCompleted");
});

test("runner projects native cancellation when Restate stops before workflow output", async () => {
  const config = loadRestateConfig();
  const runId = "restate-native-cancelled-test";
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient()),
    fetchImplementation: async (url) => String(url).endsWith("/query")
      ? response({ rows: [{ id: "inv-cancelled", status: "cancelled", retry_count: 0, modified_at: "2026-09-16T12:00:00.000Z" }] })
      : response({}, 200),
  });

  const inspection = await runner.inspect(await runner.start(manifestFor(runner, runId)));

  assert.equal(inspection.status, "cancelled");
  assert.equal(inspection.result?.status, "cancelled");
  assert.equal(inspection.result?.error?.failureKind, "cancelled");
  assert.deepEqual(inspection.eventIntents.map((event) => event.kind), ["AgentCancelled", "RunCancelled"]);
  assert.equal(inspection.eventIntents.at(-1)?.occurredAt, "2026-09-16T12:00:00.000Z");
  assert.equal(inspection.metrics?.status, "cancelled");
});

test("runner preserves cancellation when Restate exposes it as a terminal output error", async () => {
  const config = loadRestateConfig();
  const runId = "restate-terminal-cancelled-test";
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient(
      { invocationId: "inv-terminal-cancelled", status: "Accepted", attachable: true },
      { ready: false },
      Object.assign(new Error('Request failed: 409 {"message":"Cancelled"}'), {
        status: 409,
        responseText: '{"code":409,"message":"Cancelled","source":"invocation"}',
      }),
    )),
    fetchImplementation: async (url) => String(url).endsWith("/query")
      ? response({ rows: [{ id: "inv-terminal-cancelled", status: "completed", completion_result: "failure", retry_count: null, modified_at: "2026-09-16T12:01:00.000Z" }] })
      : response({}, 200),
  });

  const inspection = await runner.inspect(await runner.start(manifestFor(runner, runId)));

  assert.equal(inspection.status, "cancelled");
  assert.equal(inspection.result?.error?.code, "RESTATE_INVOCATION_CANCELLED");
  assert.equal(inspection.result?.finishedAt, "2026-09-16T12:01:00.000Z");
  assert.equal(inspection.eventIntents.at(-1)?.kind, "RunCancelled");
});

test("runner does not treat an accepted but missing workflow as terminal success", async () => {
  const config = loadRestateConfig();
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient()),
    fetchImplementation: async () => response({ columns: ["id", "status"], rows: [] }),
  });
  const reference = await runner.start(manifestFor(runner, "restate-missing-workflow-test"));

  await assert.rejects(() => runner.inspect(reference), /execution was not found/);
});

test("runner preserves an ambiguous submission as reconciliation-required", async () => {
  const config = loadRestateConfig();
  const ingress: RestateIngress = {
    workflowClient: () => ({
      workflowSubmit: async () => { throw Object.assign(new Error("gateway timeout"), { status: 503 }); },
      workflowOutput: async () => ({ ready: false }),
    }),
  };
  const calls: string[] = [];
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress,
    fetchImplementation: async (url) => {
      calls.push(String(url));
      return response({ columns: ["id", "status", "retry_count", "modified_at"], rows: [] });
    },
  });
  const reference = await runner.start(manifestFor(runner, "restate-ambiguous-test"));
  const inspection = await runner.inspect(reference);
  const repeatedInspection = await runner.inspect(reference);

  assert.equal(reference.native.submissionOutcome, "unknown");
  assert.equal(typeof reference.native.unknownSince, "string");
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
  assert.deepEqual(repeatedInspection.result, inspection.result);
  assert.deepEqual(repeatedInspection.eventIntents, inspection.eventIntents);
  assert.ok(calls.some((url) => url.endsWith("/query")));
});

test("runner rejects definite ingress errors and accepts asynchronous cancellation", async () => {
  const config = loadRestateConfig();
  const rejectionRunner = RestateBaselineRunner.fromOptions({
    config,
    ingress: { workflowClient: () => ({ workflowSubmit: async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, workflowOutput: async () => ({ ready: false }) }) },
  });
  await assert.rejects(() => rejectionRunner.start(manifestFor(rejectionRunner, "restate-rejected-test")), /rejected workflow submission/);

  const cancellationCalls: Array<{ url: string; init?: RequestInit }> = [];
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient()),
    fetchImplementation: async (url, init) => {
      cancellationCalls.push({ url: String(url), init });
      if (String(url).endsWith("/query")) {
        return response({ rows: [{ id: "inv-cancel", status: "running", retry_count: 0, modified_at: null }] });
      }
      return response({}, 202);
    },
  });
  const reference = await runner.start(manifestFor(runner, "restate-cancel-test"));
  const cancellation = await runner.cancel(reference, "stop this run\nwithout leaking headers");

  assert.deepEqual(cancellation, { accepted: true, alreadyTerminal: false, message: "Restate accepted the cancellation request; terminal state is asynchronous." });
  const cancelRequest = cancellationCalls.find((call) => call.url.endsWith("/cancel"));
  assert.equal(cancelRequest?.init?.method, "PATCH");
  assert.equal((cancelRequest?.init?.headers as Record<string, string>)?.["x-agentlab-reason"], "stop this run without leaking headers");
});

test("runner reports a healthy Restate server separately from service registration", async () => {
  const config = loadRestateConfig();
  const runner = RestateBaselineRunner.fromOptions({
    config,
    ingress: new FakeIngress(new FakeWorkflowClient()),
    fetchImplementation: async (url) => String(url).endsWith("/health")
      ? response({})
      : response({ deployments: [{ services: [{ name: config.serviceName }] }] }),
  });

  assert.deepEqual(await runner.checkConnection(), {
    reachable: true,
    message: `Restate and ${config.serviceName} are reachable.`,
  });
});

test("manifest configuration remains safe when OpenRouter is enabled", () => {
  const config = loadRestateConfig({ OPENROUTER_API_KEY: "secret-value" });
  const runner = RestateBaselineRunner.fromOptions({ config, ingress: null });
  assert.deepEqual(runner.manifestConfiguration(), safeManifestConfiguration(config));
  assert.equal(JSON.stringify(runner.manifestConfiguration()).includes("secret-value"), false);
});
