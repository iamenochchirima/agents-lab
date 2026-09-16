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

test("Hatchet task sends the selected OpenRouter model through the task boundary", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), "https://openrouter.example/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    return new Response(JSON.stringify({
      id: "hatchet-openrouter-provider-id",
      choices: [{ message: { content: "hello from the selected model" } }],
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const output = await executeHatchetTask(
      {
        ...input,
        model: { provider: "openrouter", model: "cohere/north-mini-code:free" },
      },
      context(0),
      loadHatchetConfig({
        OPENROUTER_API_KEY: "test-secret",
        AGENTLAB_OPENROUTER_BASE_URL: "https://openrouter.example/v1",
      }),
      () => new Date("2026-09-15T10:00:00.000Z"),
    );

    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.equal(output.result.status, "completed");
    assert.equal(output.result.output, "hello from the selected model");
    assert.deepEqual(output.result.usage, { inputTokens: 4, outputTokens: 5, totalTokens: 9 });
    assert.deepEqual(output.eventIntents[1]?.payload, {
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
      attemptNumber: 1,
    });
    assert.equal(JSON.stringify(output).includes("test-secret"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
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
