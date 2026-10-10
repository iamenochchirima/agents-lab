import assert from "node:assert/strict";
import test from "node:test";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import { remainingExecutionMs, executionDeadlineReached } from "../../src/capabilities/execution/policy.js";
const request = { platform: "temporal", variant: "baseline", task: { kind: "prompt" as const, prompt: "Inspect records" }, model: { provider: "fake", model: "fake-success" } };
test("sustained admission retains a fixed deadline and rejects invalid budgets without changing legacy runs", () => {
  const at = "2026-10-10T12:00:00.000Z";
  assert.equal(buildRunManifest(request, { now: at }).execution, undefined);
  const manifest = buildRunManifest({ ...request, execution: { mode: "sustained", maxDurationMs: 60_000 } }, { now: at });
  const restored = JSON.parse(JSON.stringify(manifest));
  assert.equal(restored.execution.deadlineAt, "2026-10-10T12:01:00.000Z");
  assert.equal(remainingExecutionMs(restored.execution, Date.parse(at) + 40_000), 20_000);
  assert.equal(executionDeadlineReached(restored.execution, Date.parse(at) + 60_000), true);
  assert.equal(remainingExecutionMs({ ...restored.execution, deadlineAt: "bad" }, Date.parse(at)), 0);
  for (const execution of [{ mode: "sustained", maxDurationMs: -1 }, { mode: "sustained", modelTimeoutMs: Infinity }, { mode: "sustained", deadlineAt: at }]) {
    assert.throws(() => buildRunManifest({ ...request, execution } as never, { now: at }), /execution/);
  }
});
