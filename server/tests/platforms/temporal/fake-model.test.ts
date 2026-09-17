import assert from "node:assert/strict";
import test from "node:test";

import { calculatorTool } from "../../../src/capabilities/tools/calculator.js";
import { FakeModelAdapter } from "../../../src/platforms/temporal/variants/baseline/models/fake.js";
import { OpenRouterModelAdapter } from "../../../src/platforms/temporal/variants/baseline/models/openrouter.js";
import type { ModelRequestInput } from "../../../src/platforms/temporal/variants/baseline/contracts.js";

const input: ModelRequestInput = {
  runId: "run-model-1",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  provider: "fake",
  model: "fake-success",
  attemptId: "attempt-1",
  attemptNumber: 1,
};

test("fake adapter is deterministic and never needs a network request", async () => {
  const adapter = new FakeModelAdapter();
  const first = await adapter.complete(input, new AbortController().signal);
  const second = await adapter.complete(input, new AbortController().signal);

  assert.deepEqual(first, second);
  assert.equal(first.kind, "success");
  if (first.kind === "success") {
    assert.equal(first.output, "Fake response: Say hello.");
  }
});

test("fake adapter distinguishes safe pre-dispatch retry from ambiguous outcome", async () => {
  const adapter = new FakeModelAdapter();
  const retry = await adapter.complete(
    { ...input, model: "fake-pre-dispatch-retry", attemptNumber: 1 },
    new AbortController().signal,
  );
  const retrySuccess = await adapter.complete(
    { ...input, model: "fake-pre-dispatch-retry", attemptNumber: 2 },
    new AbortController().signal,
  );
  const ambiguous = await adapter.complete(
    { ...input, model: "fake-ambiguous" },
    new AbortController().signal,
  );

  assert.equal(retry.kind, "failure");
  assert.equal(retry.kind === "failure" ? retry.failureKind : null, "pre_dispatch");
  assert.equal(retrySuccess.kind, "success");
  assert.equal(ambiguous.kind, "failure");
  assert.equal(ambiguous.kind === "failure" ? ambiguous.requestSent : false, true);
});

test("fake adapter exposes a deterministic context-overflow recovery fixture", async () => {
  const adapter = new FakeModelAdapter();
  const overflow = await adapter.complete({ ...input, model: "fake-context-overflow" }, new AbortController().signal);
  const recovered = await adapter.complete({ ...input, model: "fake-context-overflow", attemptNumber: 2 }, new AbortController().signal);
  const summary = await adapter.complete({ ...input, model: "fake-context-overflow", runId: "session-1:context:2" }, new AbortController().signal);

  assert.equal(overflow.kind, "failure");
  assert.equal(overflow.kind === "failure" ? overflow.code : null, "FAKE_CONTEXT_OVERFLOW");
  assert.equal(recovered.kind, "success");
  assert.equal(summary.kind, "success");
});

test("fake adapter exposes the bounded calculator tool-turn fixture", async () => {
  const adapter = new FakeModelAdapter();
  const first = await adapter.complete({
    ...input,
    model: "fake-tool-call",
    messages: [{ role: "system", content: "Use tools." }, { role: "user", content: "Add 17 and 25." }],
    tools: [calculatorTool.definition],
  }, new AbortController().signal);
  assert.equal(first.kind, "success");
  if (first.kind !== "success") return;
  assert.deepEqual(first.toolCalls, [{
    toolCallId: "call-calculator-1",
    name: "calculator",
    arguments: { operation: "add", left: 17, right: 25 },
  }]);

  const second = await adapter.complete({
    ...input,
    model: "fake-tool-call",
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Add 17 and 25." },
      { role: "assistant", content: null, toolCalls: first.toolCalls },
      { role: "tool", toolCallId: "call-calculator-1", name: "calculator", content: '{"value":42}' },
    ],
    tools: [calculatorTool.definition],
  }, new AbortController().signal);
  assert.equal(second.kind, "success");
  assert.equal(second.kind === "success" ? second.output : null, 'The calculator returned {"value":42}.');
});

test("OpenRouter configuration failure does not expose or send a missing key", async () => {
  let called = false;
  const adapter = new OpenRouterModelAdapter({
    apiKey: " ",
    fetchImplementation: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });

  const result = await adapter.complete({ ...input, provider: "openrouter", model: "openrouter/test" }, new AbortController().signal);

  assert.deepEqual(result, {
    kind: "failure",
    failureKind: "configuration",
    code: "OPENROUTER_API_KEY_MISSING",
    message: "OPENROUTER_API_KEY is required for the OpenRouter adapter.",
    requestSent: false,
  });
  assert.equal(called, false);
});

test("OpenRouter adapter records safe response metadata and keeps the key out of the request body", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(
        JSON.stringify({
          id: "provider-request-1",
          choices: [{ message: { content: "A real-shaped response." } }],
          usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  );

  assert.equal(requestUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal((requestInit?.headers as Record<string, string>).authorization, "Bearer test-openrouter-secret");
  const requestBody = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(requestBody.model, "openai/test-model");
  assert.equal(JSON.stringify(requestBody).includes("test-openrouter-secret"), false);
  assert.deepEqual(result, {
    kind: "success",
    output: "A real-shaped response.",
    providerRequestId: "provider-request-1",
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
  });
});

test("OpenRouter adapter sends tool definitions and preserves tool-call pairing", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "provider-tool-request-1",
        choices: [{ message: {
          content: null,
          tool_calls: [{ id: "call-calculator-1", type: "function", function: { name: "calculator", arguments: '{"operation":"add","left":17,"right":25}' } }],
        } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }), { status: 200 });
    },
  });

  const result = await adapter.complete({
    ...input,
    provider: "openrouter",
    model: "openai/test-model",
    messages: [{ role: "system", content: "Use tools." }, { role: "user", content: "Add 17 and 25." }],
    tools: [calculatorTool.definition],
  }, new AbortController().signal);

  assert.ok(requestBody);
  assert.deepEqual((requestBody.tools as Array<Record<string, unknown>>)?.[0], {
    type: "function",
    function: { name: "calculator", description: calculatorTool.definition.description, parameters: calculatorTool.definition.inputSchema },
  });
  assert.equal(requestBody.tool_choice, "auto");
  assert.deepEqual(result, {
    kind: "success",
    output: null,
    toolCalls: [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 17, right: 25 } }],
    providerRequestId: "provider-tool-request-1",
    usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
  });
});

test("OpenRouter network failure is classified as ambiguous without exposing provider details", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async () => {
      throw new Error("socket failed with test-openrouter-secret");
    },
  });

  const result = await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  );

  assert.deepEqual(result, {
    kind: "failure",
    failureKind: "outcome_unknown",
    code: "OPENROUTER_RESPONSE_UNKNOWN",
    message: "The OpenRouter request was sent but its outcome could not be confirmed.",
    requestSent: true,
  });
  assert.equal(JSON.stringify(result).includes("test-openrouter-secret"), false);
});

test("OpenRouter context errors are classified for one changed-input recovery", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async () => new Response(JSON.stringify({ error: { message: "maximum context length exceeded" } }), { status: 400 }),
  });

  const result = await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  );

  assert.deepEqual(result, {
    kind: "failure",
    failureKind: "provider",
    code: "OPENROUTER_CONTEXT_OVERFLOW",
    message: "OpenRouter rejected the request because its context window was exceeded.",
    requestSent: true,
  });
});

test("OpenRouter adapter rejects an oversized response", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async () => new Response("x".repeat(1_048_577), { status: 200 }),
  });

  const result = await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  );

  assert.deepEqual(result, {
    kind: "failure",
    failureKind: "provider",
    code: "OPENROUTER_RESPONSE_TOO_LARGE",
    message: "OpenRouter returned a response larger than the configured safety limit.",
    requestSent: true,
  });
});

test("OpenRouter adapter rejects oversized assistant output", async () => {
  const adapter = new OpenRouterModelAdapter({
    apiKey: "test-openrouter-secret",
    fetchImplementation: async () => new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(100_001) } }] }), { status: 200 }),
  });

  const result = await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  );

  assert.equal(result.kind, "failure");
  if (result.kind === "failure") assert.equal(result.code, "OPENROUTER_OUTPUT_TOO_LARGE");
});
