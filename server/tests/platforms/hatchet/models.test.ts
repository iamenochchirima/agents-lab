import assert from "node:assert/strict";
import test from "node:test";

import { FakeHatchetModelAdapter } from "../../../src/platforms/hatchet/variants/baseline/models/fake.js";
import { OpenRouterHatchetModelAdapter } from "../../../src/platforms/hatchet/variants/baseline/models/openrouter.js";
import type { HatchetModelRequestInput } from "../../../src/platforms/hatchet/variants/baseline/contracts.js";

const input: HatchetModelRequestInput = {
  runId: "hatchet-model-test",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  provider: "fake",
  model: "fake-success",
  attemptId: "attempt-1",
  attemptNumber: 1,
};

test("Hatchet fake model remains deterministic and exposes retry intent", async () => {
  const adapter = new FakeHatchetModelAdapter();
  const first = await adapter.complete(input, new AbortController().signal);
  const second = await adapter.complete(input, new AbortController().signal);
  const retry = await adapter.complete(
    { ...input, model: "fake-pre-dispatch-retry" },
    new AbortController().signal,
  );

  assert.deepEqual(first, second);
  assert.equal(first.kind, "success");
  assert.equal(
    first.kind === "success" ? first.output : null,
    "Fake response: Say hello.",
  );
  assert.equal(retry.kind, "failure");
  assert.equal(
    retry.kind === "failure" ? retry.failureKind : null,
    "pre_dispatch",
  );
});

test("OpenRouter network ambiguity contains no provider secret", async () => {
  const adapter = new OpenRouterHatchetModelAdapter({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
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
    message:
      "The OpenRouter request was sent but its outcome could not be confirmed.",
    requestSent: true,
  });
  assert.equal(
    JSON.stringify(result).includes("test-openrouter-secret"),
    false,
  );
});

test("OpenRouter adapter parses a successful response and usage", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const adapter = new OpenRouterHatchetModelAdapter({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImplementation: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "hatchet-provider-id",
        choices: [{ message: { content: "hello from OpenRouter" } }],
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      }), { status: 200 });
    },
  });

  assert.deepEqual(await adapter.complete(
    { ...input, provider: "openrouter", model: "openai/test-model" },
    new AbortController().signal,
  ), {
    kind: "success",
    output: "hello from OpenRouter",
    providerRequestId: "hatchet-provider-id",
    usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
  });
  assert.equal((requestBody as Record<string, unknown> | null)?.model, "openai/test-model");
  assert.equal(JSON.stringify(requestBody).includes("test-openrouter-secret"), false);
});

test("OpenRouter adapter rejects an oversized response", async () => {
  const adapter = new OpenRouterHatchetModelAdapter({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
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
