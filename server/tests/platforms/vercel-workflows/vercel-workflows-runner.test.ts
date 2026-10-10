import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunEvidenceStore } from "../../../src/control-plane/application/evidence-store.js";

import type { RunManifest, RunEventIntent } from "../../../src/control-plane/domain/types.js";
import {
  VERCEL_WORKFLOW_NAME,
  VERCEL_WORKFLOWS_PLATFORM,
  VERCEL_WORKFLOWS_VARIANT,
  loadVercelWorkflowsConfig,
} from "../../../src/platforms/vercel-workflows/config.js";
import { VercelWorkflowsBaselineRunner } from "../../../src/platforms/vercel-workflows/runner-adapter/vercel-workflows-runner.js";

const manifest: RunManifest = {
  schemaVersion: 1,
  runId: "run-vercel-workflow-1",
  createdAt: "2026-09-15T10:00:00.000Z",
  serverVersion: "test",
  platform: VERCEL_WORKFLOWS_PLATFORM,
  variant: VERCEL_WORKFLOWS_VARIANT,
  task: { kind: "prompt", prompt: "hello" },
  context: { systemInstruction: "be concise" },
  platformConfig: { workflowName: VERCEL_WORKFLOW_NAME, modelTimeoutMs: 1_000 },
  model: { provider: "fake", model: "fake" },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("runner preserves native Workflow identity on admission and inspection", async () => {
  const calls: string[] = [];
  const runner = new VercelWorkflowsBaselineRunner({
    config: loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: "http://workflow.test" }),
    fetchImplementation: async (url) => {
      const href = url.toString();
      calls.push(href);
      if (href.endsWith("/runs/admit")) return response({ workflowId: "workflow/native", workflowRunId: "wrun_1", submissionOutcome: "accepted", acknowledgement: "confirmed", status: "pending" }, 202);
      if (href.endsWith("/runs/wrun_1")) return response({
        workflowId: "workflow/native",
        workflowRunId: "wrun_1",
        workflowName: VERCEL_WORKFLOW_NAME,
        status: "completed",
        createdAt: manifest.createdAt,
        startedAt: manifest.createdAt,
        completedAt: "2026-09-15T10:00:01.000Z",
        result: {
          schemaVersion: 1,
          runId: manifest.runId,
          status: "completed",
          startedAt: manifest.createdAt,
          finishedAt: "2026-09-15T10:00:01.000Z",
          output: "done",
          error: null,
          attemptCount: 1,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
          eventIntents: [],
          trajectory: { schemaVersion: 1, runId: manifest.runId, phases: [] },
          metrics: { schemaVersion: 1, runId: manifest.runId, status: "completed", durationMs: 1_000, modelCallCount: 1, modelAttemptCount: 1, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
          native: { workflowName: VERCEL_WORKFLOW_NAME, stepNames: ["executeModelStep"] },
        },
        error: null,
      });
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  const reference = await runner.start(manifest);
  assert.equal(reference.executionId, "vercel-workflows:run-vercel-workflow-1");
  assert.equal(reference.native.workflowRunId, "wrun_1");
  assert.equal(reference.native.sdk, "workflow");
  assert.equal("openRouterApiKey" in reference.native, false);

  const inspection = await runner.inspect(reference);
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.reference.executionId, "vercel-workflows:run-vercel-workflow-1");
  assert.equal(inspection.reference.native.workflowRunId, "wrun_1");
  assert.equal(inspection.result?.output, "done");
  assert.deepEqual(calls, ["http://workflow.test/runs/admit", "http://workflow.test/runs/wrun_1"]);
});

test("runner represents a lost admission acknowledgement as reconciliation-required", async () => {
  const runner = new VercelWorkflowsBaselineRunner({
    config: loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: "http://workflow.test" }),
    fetchImplementation: async () => { throw new TypeError("fetch failed"); },
  });

  const reference = await runner.start(manifest);
  assert.equal(reference.native.submissionOutcome, "unknown");
  const inspection = await runner.inspect(reference);
  assert.equal(inspection.status, "failed");
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
});

test("runner rejects an OpenRouter manifest when the service has no key", () => {
  const runner = new VercelWorkflowsBaselineRunner({ config: loadVercelWorkflowsConfig({}) });
  const invalid = { ...manifest, model: { provider: "openrouter", model: "openai/gpt-4o-mini" } } satisfies RunManifest;
  assert.equal(runner.validate(invalid).valid, false);
});

// A native Workflow can finish normally by returning a failed agent result.
// Native execution status must remain visible without making the Lab run green.
test("runner preserves unsuccessful agent results from a completed native workflow", async () => {
  for (const status of ["failed", "cancelled", "reconciliation_required"] as const) {
    const error = { code: "PROVIDER_TRANSPORT_UNKNOWN", message: "Provider response was not confirmed.", retryable: false, failureKind: "outcome_unknown" };
    const runner = new VercelWorkflowsBaselineRunner({
      config: loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: "http://workflow.test" }),
      fetchImplementation: async url => url.toString().endsWith("/runs/admit")
        ? response({ workflowId: "workflow/native", workflowRunId: "wrun_1", submissionOutcome: "accepted", acknowledgement: "confirmed", status: "pending" }, 202)
        : response({ workflowId: "workflow/native", workflowRunId: "wrun_1", status: "completed", result: {
          schemaVersion: 1, runId: manifest.runId, status, output: null, error,
          startedAt: manifest.createdAt, finishedAt: manifest.createdAt, attemptCount: 1,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        } }),
    });
    const inspection = await runner.inspect(await runner.start(manifest));
    assert.equal(inspection.status, status === "cancelled" ? "cancelled" : "failed");
    assert.equal(inspection.result?.status, status);
    assert.deepEqual(inspection.result?.error, error);
    assert.equal(inspection.reference.native.nativeStatus, "completed");
  }
});

test("completed native history exceeding the result bound persists in separate evidence lanes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vercel-result-lanes-"));
  const eventIntents: RunEventIntent[] = Array.from({ length: 157 }, (_, index) => ({
    runId: manifest.runId, source: "vercel-workflow", sourceSequence: index + 1,
    occurredAt: manifest.createdAt, kind: "EvalModelObserved",
    payload: { providerRequest: { messages: [{ content: "x".repeat(4 * 1024) }] } },
  }));
  const nativeResult = {
    schemaVersion: 1, runId: manifest.runId, status: "completed",
    startedAt: manifest.createdAt, finishedAt: manifest.createdAt,
    output: "done", error: null, attemptCount: 4,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null }, eventIntents,
    trajectory: { schemaVersion: 1, runId: manifest.runId, phases: [] },
    metrics: { schemaVersion: 1, runId: manifest.runId, status: "completed", durationMs: 0,
      modelCallCount: 4, modelAttemptCount: 4, inputTokens: null, outputTokens: null,
      totalTokens: null, costUsd: null },
    native: { workflowName: VERCEL_WORKFLOW_NAME, stepNames: ["executeModelStep"] },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(nativeResult)) > 512 * 1024);
  const runner = new VercelWorkflowsBaselineRunner({
    config: loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: "http://workflow.test" }),
    fetchImplementation: async (url) => url.toString().endsWith("/runs/admit")
      ? response({ workflowId: "workflow/native", workflowRunId: "wrun_large", submissionOutcome: "accepted", acknowledgement: "confirmed", status: "pending" }, 202)
      : response({ workflowId: "workflow/native", workflowRunId: "wrun_large", status: "completed", result: nativeResult }),
  });
  try {
    const store = new RunEvidenceStore(root);
    await store.createRun(manifest);
    const inspection = await runner.inspect(await runner.start(manifest));
    assert.ok(inspection.result && inspection.trajectory && inspection.metrics);
    assert.ok(Buffer.byteLength(JSON.stringify(inspection.result)) < 512 * 1024);
    assert.equal(inspection.eventIntents.length, 157);
    await store.writeExecutionReference(manifest.runId, inspection.reference);
    for (const event of inspection.eventIntents) await store.appendEvent(event);
    await store.writeTrajectory(inspection.trajectory);
    await store.writeMetrics(inspection.metrics);
    await store.writeResult(inspection.result);
    const retained = await store.readSnapshot(manifest.runId);
    assert.equal(retained.result?.status, "completed");
    assert.equal(retained.result?.output, "done");
    assert.equal("eventIntents" in retained.result!, false);
    assert.deepEqual(retained.events.map(event => event.payload), eventIntents.map(event => event.payload));
    assert.deepEqual(retained.trajectory, nativeResult.trajectory);
    assert.deepEqual(retained.metrics, nativeResult.metrics);
    assert.deepEqual(retained.executionReference?.native.resultMetadata, nativeResult.native);
  } finally { await rm(root, { recursive: true, force: true }); }
});
