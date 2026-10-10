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
  let requestBody: Record<string, unknown> | null = null;
  const result = await completeOpenRouterModel(request, {
    apiKey: "test-secret",
    baseUrl: "https://openrouter.example/v1",
    fetchImplementation: async (url, init) => {
      assert.equal(url, "https://openrouter.example/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
  assert.equal((requestBody as Record<string, unknown> | null)?.model, "openai/test-model");
  assert.equal((requestBody as Record<string, unknown> | null)?.provider, undefined);
  assert.equal((requestBody as Record<string, unknown> | null)?.max_tokens, undefined);
  assert.equal(JSON.stringify(requestBody).includes("test-secret"), false);
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

test("native model projects an unfamiliar exact schema and paired results", async () => {
  const schema = { type: "object", properties: { record: { type: "object", properties: { priority: { enum: ["low", "high"] } }, required: ["priority"], additionalProperties: false } }, required: ["record"], additionalProperties: false };
  const result = await completeOpenRouterModel({ ...request, round: 2,
    toolDefinitions: [{ schemaVersion: 1, name: "novel_save", description: "Save fixture", inputSchema: schema, riskClass: "write", executionKind: "connection", limits: { maxArgumentBytes: 1024, maxResultBytes: 1024, timeoutMs: 1000 } }],
    messages: [{ role: "assistant", content: null, toolCalls: [{ toolCallId: "original", name: "novel_save", arguments: { record: { priority: "high" } }, round: 1 }] },
      { role: "tool", toolCallId: "original", name: "novel_save", content: '{"saved":true}' }],
  }, { apiKey: "fake-key", baseUrl: "https://fixture.example", fetchImplementation: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools[0].function.parameters, schema);
    assert.equal(body.messages[0].tool_calls[0].id, "original");
    assert.equal(body.messages[1].tool_call_id, "original");
    assert.equal(body.messages[1].content, '{"saved":true}');
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "follow-up", type: "function", function: { name: "novel_save", arguments: '{"record":{"priority":"low"}}' } }] } }] }));
  } });
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.deepEqual(result.toolCalls, [{ toolCallId: "follow-up", name: "novel_save", arguments: { record: { priority: "low" } }, round: 2 }]);
});

test("live eval transports retain exact free model, zero price ceilings and experiment allowance", async () => {
  const { DEFAULT_FREE_MODEL, FREE_PROVIDER_ROUTING } = await import("../../../src/models/openrouter/free-model-policy.js");
  const { inputFromManifest } = await import("../../../src/platforms/vercel-workflows/variants/baseline/contracts.js");
  for (const experimentId of ["agent-harness-live", "agent-capabilities-live"] as const) {
    const admitted = inputFromManifest({ schemaVersion: 1, runId: request.runId, createdAt: "2026-10-10T00:00:00Z", serverVersion: "test",
      platform: "vercel-workflows", variant: "baseline", task: { kind: "prompt", prompt: request.prompt },
      context: { systemInstruction: request.systemInstruction }, model: { provider: "openrouter", model: DEFAULT_FREE_MODEL },
      selection: { experimentId }, platformConfig: { modelTimeoutMs: request.modelTimeoutMs } });
    assert.equal(admitted.liveEval, true);
    assert.equal(admitted.liveEvalExperiment, experimentId);
    let sends = 0;
    const result = await completeOpenRouterModel({ ...admitted, attempt: 1 }, { apiKey: "fixture", baseUrl: "https://fixture.example", fetchImplementation: async (_url, init) => {
      sends++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, DEFAULT_FREE_MODEL);
      assert.deepEqual(body.provider, FREE_PROVIDER_ROUTING);
      assert.equal(body.max_tokens, experimentId === "agent-harness-live" ? 512 : 2048);
      assert.equal(body.models, undefined);
      assert.equal(body.route, undefined);
      return new Response(JSON.stringify({ choices: [{ message: { content: "observed" } }] }));
    } });
    assert.equal(sends, 1);
    assert.equal(result.kind, "success");
  }
});

test("live eval rejects unapproved IDs and unknown experiments before transport", async () => {
  const { DEFAULT_FREE_MODEL } = await import("../../../src/models/openrouter/free-model-policy.js");
  let sends = 0;
  for (const [model, experiment] of [["openai/paid", "agent-capabilities-live"], ["openrouter/free", "agent-harness-live"], ["unapproved/model:free", "agent-capabilities-live"], [DEFAULT_FREE_MODEL, "unknown-eval"]]) {
    const result = await completeOpenRouterModel({ ...request, liveEval: true,
      liveEvalExperiment: experiment as VercelWorkflowModelRequest["liveEvalExperiment"], model: { provider: "openrouter", model } },
    { apiKey: "fixture", baseUrl: "https://fixture.example", fetchImplementation: async () => { sends++; throw new Error("must not send"); } });
    assert.equal(result.kind, "failure");
    if (result.kind === "failure") {
      assert.equal(result.requestSent, false);
      assert.equal(result.error.code, "LIVE_EVAL_FREE_MODEL_REQUIRED");
      assert.equal(result.error.retryable, false);
    }
  }
  assert.equal(sends, 0);
});
