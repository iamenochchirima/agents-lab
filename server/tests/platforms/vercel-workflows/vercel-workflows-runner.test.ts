import assert from "node:assert/strict";
import test from "node:test";

import type { RunManifest } from "../../../src/control-plane/domain/types.js";
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
