import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterRestateModel } from "../../../src/platforms/restate/variants/baseline/models/openrouter.js";
import type { ModelRequest } from "../../../src/platforms/restate/variants/baseline/contracts.js";
import { calculatorTool } from "../../../src/capabilities/tools/calculator.js";
import { FREE_PROVIDER_ROUTING } from "../../../src/models/openrouter/free-model-policy.js";

const input: ModelRequest = {
  runId: "live-test", liveEval: true, provider: "openrouter", model: "google/gemma-4-31b-it:free",
  prompt: "Use calculator for 17 + 25", systemInstruction: "Answer directly", round: 1, attempt: 1,
  messages: [{ role: "system", content: "Answer directly" }, { role: "user", content: "Use calculator for 17 + 25" }],
  tools: [calculatorTool.definition],
};

test("live restate dispatch retains actual mapped request and returned decisions", async () => {
  let sent: Record<string, unknown> | undefined;
  const model = new OpenRouterRestateModel({ apiKey: "test-secret", baseUrl: "https://example.invalid", fetchImpl: async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ id: "provider-request-1", model: "gemma-actual", provider: "provider-actual", choices: [{ message: { content: null, tool_calls: [{ id: "call1", function: { name: "calculator", arguments: '{"operation":"add","left":17,"right":25}' } }] } }] });
  } });
  const result = await model.complete(input, new AbortController().signal);
  assert.equal(result.kind, "success");
  assert.deepEqual(sent?.provider, FREE_PROVIDER_ROUTING);
  assert.equal(sent?.max_tokens, 512);
  assert.deepEqual(result.evalObservation?.providerRequest, sent);
  assert.equal(result.evalObservation?.providerRequestId, "provider-request-1");
  assert.equal(result.evalObservation?.providerModel, "gemma-actual");
  assert.equal(result.evalObservation?.providerName, "provider-actual");
  assert.deepEqual(result.evalObservation?.toolCalls[0]?.arguments, { operation: "add", left: 17, right: 25 });
  assert.ok(!JSON.stringify(result.evalObservation).includes("test-secret"));
  const ordinary = await model.complete({ ...input, liveEval: false }, new AbortController().signal);
  assert.equal(ordinary.evalObservation, undefined);
  assert.equal(sent?.provider, undefined);
});

test("live restate refuses paid models and retains provider failures without retry", async () => {
  let requests = 0;
  const model = new OpenRouterRestateModel({ apiKey: "test-secret", baseUrl: "https://example.invalid", fetchImpl: async () => {
    requests += 1;
    return Response.json({ error: { message: "quota" } }, { status: 429 });
  } });
  const refused = await model.complete({ ...input, model: "paid/model" }, new AbortController().signal);
  assert.equal(refused.kind, "failure");
  assert.equal(requests, 0);
  const failed = await model.complete(input, new AbortController().signal);
  assert.equal(failed.kind, "failure");
  assert.equal(requests, 1);
  assert.equal(failed.evalObservation?.errorCode, "OPENROUTER_HTTP_429");
  assert.equal(failed.evalObservation?.providerRequest?.model, input.model);
});

test("live restate retains safe diagnostics for reasoning-only and successful responses", async () => {
  for (const content of [null, "done"]) {
    const model = new OpenRouterRestateModel({ apiKey: "test-secret", baseUrl: "https://example.invalid", fetchImpl: async () => Response.json({
      id: "provider-budget-1", model: "actual-model", provider: "actual-provider",
      choices: [{ finish_reason: content ? "stop" : "length", message: { content, reasoning: "PRIVATE REASONING", reasoning_details: [{ text: "PRIVATE DETAILS" }] } }],
      usage: { prompt_tokens: 120, completion_tokens: 2048, total_tokens: 2168,
        completion_tokens_details: { reasoning_tokens: 2048 } },
    }) });
    const result = await model.complete(input, new AbortController().signal);
    assert.equal(result.kind, content ? "success" : "failure");
    if (result.kind === "failure") assert.equal(result.code, "OPENROUTER_INVALID_RESPONSE");
    assert.equal(result.evalObservation?.finishReason, content ? "stop" : "length");
    assert.deepEqual(result.evalObservation?.providerUsage, { inputTokens: 120, outputTokens: 2048, totalTokens: 2168, reasoningTokens: 2048 });
    assert.equal(result.evalObservation?.providerRequestId, "provider-budget-1");
    assert.equal(result.evalObservation?.providerModel, "actual-model");
    assert.equal(result.evalObservation?.providerName, "actual-provider");
    assert.ok(!JSON.stringify(result.evalObservation).includes("PRIVATE"));
  }
});
