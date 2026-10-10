import assert from "node:assert/strict";
import test from "node:test";
import { executeCapabilityStep, prepareCapabilityStep } from "../../../src/platforms/vercel-workflows/variants/baseline/execution/capability-steps.js";
import { inputFromManifest } from "../../../src/platforms/vercel-workflows/variants/baseline/contracts.js";

test("expired native step stops before registry lookup or source dispatch", async () => {
  const execution = { schemaVersion: 1 as const, mode: "sustained" as const, deadlineAt: "2020-01-01T00:00:00Z", modelTimeoutMs: 60000 };
  const input = inputFromManifest({ schemaVersion: 1, runId: "expired", createdAt: "2026-10-10T00:00:00Z", serverVersion: "test", platform: "vercel-workflows", variant: "baseline", task: { kind: "prompt", prompt: "task" }, context: { systemInstruction: "instruction" }, model: { provider: "fake", model: "fake" }, platformConfig: {}, execution });
  assert.deepEqual(input.execution, execution);
  assert.equal(input.modelTimeoutMs, 60000);
  const call = { name: "does-not-exist", toolCallId: "original", arguments: {}, round: 1 };
  const prepared = await prepareCapabilityStep(input, call);
  assert.equal(prepared.kind, "failure");
  if (prepared.kind === "failure") assert.equal(prepared.error.code, "TASK_DEADLINE_EXCEEDED");
  const result = await executeCapabilityStep(input, call);
  assert.equal(result.effect?.state, "not_dispatched");
  assert.equal(result.attemptCount, 0);
  assert.equal(result.status, "timed_out");
});
