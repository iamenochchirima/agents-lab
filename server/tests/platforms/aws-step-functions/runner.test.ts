import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { AwsStepFunctionsBaselineRunner } from "../../../src/platforms/aws-step-functions/runner-adapter/aws-step-functions-runner.js";
import { loadAwsStepFunctionsConfig } from "../../../src/platforms/aws-step-functions/config.js";

const manifest: RunManifest = buildRunManifest({
  platform: "aws-step-functions",
  variant: "baseline",
  task: { kind: "prompt", prompt: "runner prompt" },
  model: { provider: "fake", model: "fake-success" },
}, {
  runId: "run-aws-runner",
  serverVersion: "test",
  platformConfig: {},
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("runner retains a stable Lab identity while exposing native execution identity", async () => {
  const config = loadAwsStepFunctionsConfig({ AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_URL: "http://step-functions.test" });
  const runner = new AwsStepFunctionsBaselineRunner({
    config,
    fetchImplementation: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/runs/admit") return response({ stateMachineArn: "sm-arn", activityArn: "activity-arn", executionName: "agentlab-run-aws-runner" });
      if (path.endsWith("/dispatch")) return response({ stateMachineArn: "sm-arn", activityArn: "activity-arn", executionName: "agentlab-run-aws-runner", executionArn: "native-execution-arn", submissionOutcome: "accepted", acknowledgement: "confirmed" });
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  const reference = await runner.start({ ...manifest, platformConfig: runner.manifestConfiguration() });
  assert.equal(reference.executionId, "aws-step-functions:run-aws-runner");
  assert.equal(reference.native.executionName, "agentlab-run-aws-runner");
  assert.equal(reference.native.executionArn, "native-execution-arn");
  assert.notEqual(reference.executionId, reference.native.executionName);
  assert.notEqual(reference.executionId, reference.native.executionArn);
});

test("runner preserves reconciliation_required result after lost dispatch acknowledgement", async () => {
  const config = loadAwsStepFunctionsConfig({ AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_URL: "http://step-functions.test" });
  const runner = new AwsStepFunctionsBaselineRunner({
    config,
    fetchImplementation: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/runs/admit") return response({ stateMachineArn: "sm-arn", activityArn: "activity-arn", executionName: "agentlab-run-aws-runner" });
      if (path.endsWith("/dispatch")) return response({ message: "start acknowledgement unknown" }, 503);
      if (path.endsWith("/runs/run-aws-runner")) return response({
        runId: "run-aws-runner",
        status: "reconciliation_required",
        reference: {
          platform: "aws-step-functions",
          variant: "baseline",
          executionId: "aws-step-functions:run-aws-runner",
          native: { schemaVersion: 1, profile: "local", region: "us-east-1", endpointUrl: "http://127.0.0.1:8083", stateMachineName: "AgentLabAwsStepFunctionsBaseline", stateMachineArn: "sm-arn", activityName: "AgentLabAwsStepFunctionsModel", activityArn: "activity-arn", executionName: "agentlab-run-aws-runner", executionArn: null, nativeStatus: "UNKNOWN", submissionOutcome: "unknown", acknowledgement: "unknown" },
        },
        eventIntents: [],
        result: { schemaVersion: 1, runId: "run-aws-runner", status: "reconciliation_required", startedAt: null, finishedAt: "2026-09-15T10:00:00.000Z", output: null, error: { code: "StepFunctionsOutcomeUnknown", message: "unknown", failureKind: "outcome_unknown", retryable: true }, attemptCount: 0, usage: { inputTokens: null, outputTokens: null, totalTokens: null } },
        trajectory: { schemaVersion: 1, runId: "run-aws-runner", phases: [] },
        metrics: { schemaVersion: 1, runId: "run-aws-runner", status: "reconciliation_required", durationMs: null, modelCallCount: 0, modelAttemptCount: 0, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
      });
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  const reference = await runner.start({ ...manifest, platformConfig: runner.manifestConfiguration() });
  assert.equal(reference.native.submissionOutcome, "unknown");
  const inspection = await runner.inspect(reference);
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
  assert.equal(inspection.result?.output, null);
});

test("runner preserves reconciliation_required result when inspection transport is also unavailable", async () => {
  const config = loadAwsStepFunctionsConfig({ AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_URL: "http://step-functions.test" });
  const runner = new AwsStepFunctionsBaselineRunner({
    config,
    fetchImplementation: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/runs/admit") return response({ stateMachineArn: "sm-arn", activityArn: "activity-arn", executionName: "agentlab-run-aws-runner" });
      if (path.endsWith("/dispatch")) return response({ message: "start acknowledgement unknown" }, 503);
      throw new TypeError("fetch failed while inspecting the native execution");
    },
  });
  const reference = await runner.start({ ...manifest, platformConfig: runner.manifestConfiguration() });
  const inspection = await runner.inspect(reference);
  assert.equal(inspection.result?.status, "reconciliation_required");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
  assert.equal(inspection.eventIntents[0]?.kind, "RunSubmissionOutcomeUnknown");
  assert.equal(inspection.reference.native.executionArn, null);
});
