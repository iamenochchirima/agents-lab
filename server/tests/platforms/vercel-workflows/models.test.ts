import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOpenRouterModel,
  VERCEL_OPENROUTER_MAX_RESPONSE_BYTES,
} from "../../../src/platforms/vercel-workflows/variants/baseline/models/openrouter.js";
import type { VercelWorkflowModelRequest } from "../../../src/platforms/vercel-workflows/variants/baseline/contracts.js";

const request: VercelWorkflowModelRequest = {
  runId: "vercel-model-test",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  model: { provider: "openrouter", model: "openai/test-model" },
  modelTimeoutMs: 1_000,
  attempt: 2,
};

test("Vercel Workflows OpenRouter model parses a normal bounded JSON response", async () => {
  const result = await completeOpenRouterModel(request, {
    apiKey: "test-secret",
    baseUrl: "https://openrouter.example/v1",
    fetchImplementation: async (url, init) => {
      assert.equal(url, "https://openrouter.example/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
      return new Response(JSON.stringify({
        id: "provider-id",
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }), { status: 200 });
    },
  });

  assert.deepEqual(result, {
    kind: "success",
    output: "hello",
    providerRequestId: "provider-id",
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  });
});

test("Vercel Workflows OpenRouter model rejects an oversized response without retaining it", async () => {
  const marker = "vercel-oversized-provider-response";
  const body = JSON.stringify({
    choices: [{ message: { content: `${marker}${"x".repeat(VERCEL_OPENROUTER_MAX_RESPONSE_BYTES)}` } }],
  });
  const encodedBody = new TextEncoder().encode(body);
  let bodyCancelled = false;

  const result = await completeOpenRouterModel(request, {
    apiKey: "test-secret",
    baseUrl: "https://openrouter.example/v1",
    fetchImplementation: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encodedBody);
      },
      cancel() {
        bodyCancelled = true;
      },
    }), { status: 200 }),
  });

  assert.deepEqual(result, {
    kind: "failure",
    requestSent: true,
    error: {
      code: "OPENROUTER_RESPONSE_TOO_LARGE",
      message: "OpenRouter response exceeded the configured response limit.",
      failureKind: "provider",
      retryable: false,
    },
  });
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(bodyCancelled, true);
});
