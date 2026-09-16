import assert from "node:assert/strict";
import test from "node:test";

import { executeTriggerBaselineTask } from "../../../src/platforms/trigger-dev/variants/baseline/execution/task.js";

test("Trigger.dev task executes the selected OpenRouter model and returns normalized evidence", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousBaseUrl = process.env.AGENTLAB_OPENROUTER_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.AGENTLAB_OPENROUTER_BASE_URL = "https://openrouter.example/v1";
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), "https://openrouter.example/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    return new Response(JSON.stringify({
      id: "trigger-openrouter-task-provider-id",
      choices: [{ message: { content: "hello from the Trigger task" } }],
      usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const output = await executeTriggerBaselineTask(
      {
        runId: "trigger-openrouter-task",
        prompt: "Say hello.",
        systemInstruction: "Respond directly.",
        model: { provider: "openrouter", model: "cohere/north-mini-code:free" },
      },
      { ctx: { attempt: { number: 1 } }, signal: new AbortController().signal },
    );

    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.equal(output.output, "hello from the Trigger task");
    assert.deepEqual(output.usage, { inputTokens: 6, outputTokens: 7, totalTokens: 13 });
    assert.equal(output.metrics.modelCallCount, 1);
    assert.deepEqual(output.eventIntents.map((event) => event.kind), [
      "TaskStarted",
      "ModelRequested",
      "ModelCompleted",
      "TaskCompleted",
    ]);
    assert.deepEqual(output.eventIntents[1]?.payload, {
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
    });
    assert.deepEqual(output.trajectory.phases.map((phase) => phase.name), [
      "trigger.task",
      "model.openrouter",
    ]);
    assert.equal(JSON.stringify(output).includes("test-secret"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL;
    else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBaseUrl;
  }
});
