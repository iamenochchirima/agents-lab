import test from "node:test";
import assert from "node:assert/strict";

import { completeFakeModel, InngestPreDispatchRetryError } from "../../../src/platforms/inngest/variants/baseline/models/fake.js";
import { completeOpenRouterModel } from "../../../src/platforms/inngest/variants/baseline/models/openrouter.js";

const request = {
  runId: "run-model",
  prompt: "Say hello.",
  systemInstruction: "Be concise.",
  provider: "fake" as const,
  model: "fake-success",
  attempt: 0,
};

test("fake model is deterministic and has explicit failure modes", async () => {
  const success = await completeFakeModel(request);
  assert.deepEqual(success, {
    kind: "success",
    output: "Fake response: Say hello.",
    providerRequestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  });
  const failure = await completeFakeModel({ ...request, model: "fake-failure" });
  assert.equal(failure.kind, "failure");
  assert.equal(failure.failureKind, "provider");
  await assert.rejects(() => completeFakeModel({ ...request, model: "fake-retry" }), (error: unknown) => error instanceof InngestPreDispatchRetryError);
  const retry = await completeFakeModel({ ...request, model: "fake-retry", attempt: 1 });
  assert.equal(retry.kind, "success");
});

test("OpenRouter model does not expose provider response details", async () => {
  const response = await completeOpenRouterModel(
    { ...request, provider: "openrouter", model: "openai/gpt-4o-mini" },
    {
      apiKey: "test-secret",
      baseUrl: "https://openrouter.example/v1",
      fetchImplementation: async (url, init) => {
        assert.equal(url, "https://openrouter.example/v1/chat/completions");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
        return new Response(JSON.stringify({ id: "provider-id", choices: [{ message: { content: "hello" } },], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { status: 200 });
      },
    },
  );
  assert.deepEqual(response, {
    kind: "success",
    output: "hello",
    providerRequestId: "provider-id",
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  });
});
