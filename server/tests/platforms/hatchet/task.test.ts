import assert from "node:assert/strict";
import test from "node:test";

import { loadHatchetConfig } from "../../../src/platforms/hatchet/config.js";
import {
  executeHatchetTask,
  HatchetRetryableTaskError,
} from "../../../src/platforms/hatchet/variants/baseline/execution/task.js";
import type { HatchetPromptInput } from "../../../src/platforms/hatchet/variants/baseline/contracts.js";

const config = loadHatchetConfig();
const input: HatchetPromptInput = {
  runId: "hatchet-task-test",
  prompt: "Return one deterministic sentence.",
  systemInstruction: "Respond directly.",
  model: { provider: "fake", model: "fake-success" },
};

function context(retryCount: number) {
  return {
    retryCount: () => retryCount,
    taskRunExternalId: () => `task-attempt-${retryCount}`,
    abortController: new AbortController(),
    rethrowIfCancelled: () => undefined,
  } as never;
}

test("Hatchet task returns normalized result, trajectory, metrics, and ordered intents", async () => {
  const output = await executeHatchetTask(
    input,
    context(0),
    config,
    () => new Date("2026-09-15T10:00:00.000Z"),
  );

  assert.equal(output.result.status, "completed");
  assert.equal(
    output.result.output,
    "Fake response: Return one deterministic sentence.",
  );
  assert.equal(output.metrics.modelCallCount, 1);
  assert.deepEqual(
    output.eventIntents.map((event) => event.sourceSequence),
    [1, 2, 3, 4],
  );
  assert.equal(output.trajectory.phases.length, 2);
});

test("Hatchet task leaves safe pre-dispatch failure to Hatchet retries", async () => {
  await assert.rejects(
    () =>
      executeHatchetTask(
        {
          ...input,
          model: { provider: "fake", model: "fake-pre-dispatch-retry" },
        },
        context(0),
        config,
      ),
    (error: unknown) =>
      error instanceof HatchetRetryableTaskError &&
      error.code === "FAKE_PRE_DISPATCH",
  );

  const recovered = await executeHatchetTask(
    { ...input, model: { provider: "fake", model: "fake-pre-dispatch-retry" } },
    context(1),
    config,
  );
  assert.equal(recovered.result.status, "completed");
  assert.equal(recovered.result.attemptCount, 2);
});
