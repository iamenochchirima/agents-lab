import assert from "node:assert/strict";
import test from "node:test";

import { createRestateModel } from "../../../src/platforms/restate/variants/baseline/models/factory.js";
import { FakeRestateModel } from "../../../src/platforms/restate/variants/baseline/models/fake.js";
import { OpenRouterRestateModel } from "../../../src/platforms/restate/variants/baseline/models/openrouter.js";
import type { ModelRequest } from "../../../src/platforms/restate/variants/baseline/contracts.js";

const input: ModelRequest = {
  runId: "restate-model-test",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  provider: "fake",
  model: "fake-success",
};

test("the Restate fake model is deterministic and rejects unknown fixture names", async () => {
  const model = new FakeRestateModel();
  const first = await model.complete(input, new AbortController().signal);
  const second = await model.complete(input, new AbortController().signal);

  assert.deepEqual(first, second);
  assert.equal(first.kind, "success");
  if (first.kind === "success") assert.equal(first.output, "Fake response: Say hello.");

  const unknown = await model.complete({ ...input, model: "fake-not-supported" }, new AbortController().signal);
  assert.deepEqual(unknown, {
    kind: "failure",
    code: "UNKNOWN_FAKE_MODEL",
    message: "Unknown fake model: fake-not-supported",
    failureKind: "configuration",
    retryable: false,
    requestSent: false,
  });
});

test("the Restate fake model distinguishes safe retry from ambiguous outcome", async () => {
  const model = new FakeRestateModel();
  const retry = await model.complete({ ...input, model: "fake-pre-dispatch-retry" }, new AbortController().signal);
  const unknown = await model.complete({ ...input, model: "fake-unknown" }, new AbortController().signal);

  assert.equal(retry.kind, "failure");
  assert.equal(retry.kind === "failure" ? retry.failureKind : null, "pre_dispatch");
  assert.equal(retry.kind === "failure" ? retry.retryable : false, true);
  assert.equal(unknown.kind, "failure");
  assert.equal(unknown.kind === "failure" ? unknown.failureKind : null, "outcome_unknown");
  assert.equal(unknown.kind === "failure" ? unknown.requestSent : false, true);
});

test("a cancelled fake delay is reported as cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await new FakeRestateModel().complete({ ...input, model: "fake-delay" }, controller.signal);

  assert.equal(result.kind, "failure");
  assert.equal(result.kind === "failure" ? result.failureKind : null, "cancelled");
});

test("missing OpenRouter configuration becomes a safe model failure", async () => {
  const model = createRestateModel("openrouter", "openai/test-model", {
    openRouterApiKey: null,
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
  });

  assert.deepEqual(await model.complete({ ...input, provider: "openrouter", model: "openai/test-model" }, new AbortController().signal), {
    kind: "failure",
    code: "OPENROUTER_API_KEY_MISSING",
    message: "OPENROUTER_API_KEY is required for the OpenRouter adapter.",
    failureKind: "configuration",
    retryable: false,
    requestSent: false,
  });
});

test("OpenRouter adapter preserves safe usage metadata and does not put the key in the body", async () => {
  let requestInit: RequestInit | undefined;
  const model = new OpenRouterRestateModel({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl: async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({
        id: "provider-request-1",
        choices: [{ message: { content: "A real-shaped response." } }],
        usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await model.complete({ ...input, provider: "openrouter", model: "openai/test-model" }, new AbortController().signal);

  assert.equal(JSON.stringify(requestInit?.body).includes("test-openrouter-secret"), false);
  assert.deepEqual(result, {
    kind: "success",
    output: "A real-shaped response.",
    providerRequestId: "provider-request-1",
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
  });
});
