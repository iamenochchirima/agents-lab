import assert from "node:assert/strict";
import test from "node:test";

import {
  completeOpenRouterModel,
  DBOS_OPENROUTER_MAX_RESPONSE_BYTES,
} from "../../../src/platforms/dbos/variants/baseline/models/openrouter.js";
import type { DbosModelRequest } from "../../../src/platforms/dbos/variants/baseline/contracts.js";

const request: DbosModelRequest = {
  runId: "dbos-model-test",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  provider: "openrouter",
  model: "openai/test-model",
  attempt: 2,
};

test("DBOS OpenRouter model parses a normal bounded JSON response", async () => {
  const result = await completeOpenRouterModel(
    request,
    "test-secret",
    "https://openrouter.example/v1",
    {
      fetchImplementation: async (url, init) => {
        assert.equal(url, "https://openrouter.example/v1/chat/completions");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
        return new Response(JSON.stringify({
          id: "provider-id",
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }), { status: 200 });
      },
    },
  );

  assert.deepEqual(result, {
    kind: "success",
    output: "hello",
    providerRequestId: "provider-id",
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    attemptCount: 2,
  });
});

test("DBOS OpenRouter model rejects an oversized response without retaining it", async () => {
  const marker = "dbos-oversized-provider-response";
  const body = JSON.stringify({
    choices: [{ message: { content: `${marker}${"x".repeat(DBOS_OPENROUTER_MAX_RESPONSE_BYTES)}` } }],
  });
  let bodyCancelled = false;
  const encodedBody = new TextEncoder().encode(body);

  const result = await completeOpenRouterModel(
    request,
    "test-secret",
    "https://openrouter.example/v1",
    {
      fetchImplementation: async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(encodedBody);
        },
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
      }),
    },
  );

  assert.deepEqual(result, {
    kind: "failure",
    code: "OPENROUTER_RESPONSE_TOO_LARGE",
    message: "OpenRouter response exceeded the configured response limit.",
    failureKind: "provider",
    retryable: false,
    requestSent: true,
    attemptCount: 2,
  });
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(bodyCancelled, true);
});
