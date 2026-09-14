import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(JSON.stringify(requestInit?.body).includes("test-openrouter-secret"), false);
  assert.deepEqual(result, {
    kind: "success",
    output: "A real-shaped response.",
    providerRequestId: "provider-request-1",
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
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
