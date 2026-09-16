import assert from "node:assert/strict";
import test from "node:test";

import {
  completeTriggerOpenRouterModel,
  TRIGGER_OPENROUTER_MAX_OUTPUT_BYTES,
  TRIGGER_OPENROUTER_MAX_RESPONSE_BYTES,
} from "../../../src/platforms/trigger-dev/variants/baseline/execution/openrouter.js";
import type { TriggerPromptPayload } from "../../../src/platforms/trigger-dev/variants/baseline/contracts.js";

const payload: TriggerPromptPayload = {
  runId: "run-trigger-model",
  prompt: "hello",
  systemInstruction: "You are concise.",
  model: { provider: "openrouter", model: "openai/gpt-4o-mini" },
};

test("Trigger OpenRouter task sends the selected model and returns usage", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-secret";
  try {
    let requestBody: Record<string, unknown> | null = null;
    const result = await completeTriggerOpenRouterModel(
      payload,
      new AbortController().signal,
      async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "gen-trigger-test",
          choices: [{ message: { content: "hello from OpenRouter" } }],
          usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
        }), { status: 200 });
      },
    );

    assert.deepEqual(requestBody, {
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "hello" },
      ],
    });
    assert.deepEqual(result, {
      output: "hello from OpenRouter",
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Trigger OpenRouter task fails before dispatch when the key is missing", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await assert.rejects(
      completeTriggerOpenRouterModel(payload, new AbortController().signal, async () => {
        throw new Error("must not be called");
      }),
      (error: unknown) => error instanceof Error && error.name === "TRIGGER_OPENROUTER_NOT_CONFIGURED",
    );
  } finally {
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Trigger OpenRouter task does not dispatch an already-cancelled request", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-secret";
  const controller = new AbortController();
  controller.abort();
  let fetchCalls = 0;
  try {
    await assert.rejects(
      completeTriggerOpenRouterModel(payload, controller.signal, async () => {
        fetchCalls += 1;
        throw new Error("must not be called");
      }),
      (error: unknown) => error instanceof Error
        && error.name === "TRIGGER_OPENROUTER_CANCELLED"
        && error.message.includes("before dispatch"),
    );
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Trigger OpenRouter task bounds the provider response body", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-secret";
  let bodyCancelled = false;
  try {
    await assert.rejects(
      completeTriggerOpenRouterModel(payload, new AbortController().signal, async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(`{\"choices\":[{\"message\":{\"content\":\"${"x".repeat(TRIGGER_OPENROUTER_MAX_RESPONSE_BYTES)}\"}}]}`));
        },
        cancel() {
          bodyCancelled = true;
        },
      }), { status: 200 })),
      (error: unknown) => error instanceof Error
        && error.name === "TRIGGER_OPENROUTER_RESPONSE_TOO_LARGE",
    );
    assert.equal(bodyCancelled, true);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Trigger OpenRouter task bounds assistant output", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-secret";
  try {
    await assert.rejects(
      completeTriggerOpenRouterModel(payload, new AbortController().signal, async () => new Response(JSON.stringify({
        choices: [{ message: { content: "x".repeat(TRIGGER_OPENROUTER_MAX_OUTPUT_BYTES + 1) } }],
      }), { status: 200 })),
      (error: unknown) => error instanceof Error
        && error.name === "TRIGGER_OPENROUTER_OUTPUT_TOO_LARGE",
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
