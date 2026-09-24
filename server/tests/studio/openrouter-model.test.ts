import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenRouterModelAdapter,
  StudioOpenRouterError,
} from "../../src/studio/adapters/openrouter-model.js";

test("Studio OpenRouter adapter serializes the model boundary and records usage", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-secret",
    model: "openai/gpt-test",
    baseUrl: "https://provider.test/v1/",
    fetchImplementation: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "provider-request-1",
        choices: [{ message: { content: "provider answer" } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await adapter.complete({
    model: "ignored-by-adapter-request",
    task: "Answer the task.",
    seed: "seed-1",
    messages: [{
      schemaVersion: 1,
      messageId: "message-1",
      sessionId: "session-1",
      sequence: 1,
      role: "user",
      content: "Hello",
      source: "transcript",
      createdAt: "2026-09-19T00:00:00.000Z",
    }],
  });

  assert.equal(result.output, "provider answer");
  assert.equal(result.providerRequestId, "provider-request-1");
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 4);
  assert.deepEqual(requestBody, {
    model: "openai/gpt-test",
    messages: [{ role: "user", content: "Hello" }],
  });
});

test("Studio OpenRouter adapter classifies provider errors without exposing credentials", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-secret",
    model: "openai/gpt-test",
    baseUrl: "https://provider.test/v1",
    fetchImplementation: async () => new Response("rate limited", { status: 429 }),
  });

  await assert.rejects(
    () => adapter.complete({ model: "openai/gpt-test", task: "task", seed: "seed", messages: [] }),
    (error: unknown) => {
      assert.ok(error instanceof StudioOpenRouterError);
      assert.equal(error.details.code, "OPENROUTER_HTTP_429");
      assert.equal(error.details.retryable, true);
      assert.equal(error.message.includes("test-secret"), false);
      return true;
    },
  );
});

test("Studio OpenRouter adapter classifies provider context overflow as recoverable", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-key",
    model: "openai/gpt-test",
    baseUrl: "https://openrouter.example",
    fetchImplementation: async () => new Response(JSON.stringify({ error: { message: "maximum context length is 4096 tokens" } }), { status: 400 }),
  });

  await assert.rejects(
    () => adapter.complete({ model: "openai/gpt-test", task: "task", seed: "seed", messages: [] }),
    (error: unknown) => error instanceof StudioOpenRouterError
      && error.details.code === "OPENROUTER_CONTEXT_OVERFLOW"
      && error.details.retryable
      && error.details.requestSent,
  );
});

test("Studio OpenRouter adapter rejects an oversized request before dispatch", async () => {
  let dispatched = false;
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-secret",
    model: "openai/gpt-test",
    baseUrl: "https://provider.test/v1",
    fetchImplementation: async () => {
      dispatched = true;
      return new Response("should not be called", { status: 500 });
    },
  });

  await assert.rejects(
    () => adapter.complete({
      model: "openai/gpt-test",
      task: "task",
      seed: "seed",
      messages: [{
        schemaVersion: 1,
        messageId: "large-message",
        sessionId: "session-1",
        sequence: 1,
        role: "user",
        content: "x".repeat(300_000),
        source: "transcript",
        createdAt: "2026-09-19T00:00:00.000Z",
      }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof StudioOpenRouterError);
      assert.equal(error.details.code, "OPENROUTER_REQUEST_TOO_LARGE");
      assert.equal(error.details.requestSent, false);
      return true;
    },
  );
  assert.equal(dispatched, false);
});
