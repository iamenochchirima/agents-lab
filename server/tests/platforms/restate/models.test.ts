import assert from "node:assert/strict";
import test from "node:test";

import { createRestateModel } from "../../../src/platforms/restate/variants/baseline/models/factory.js";
import { FakeRestateModel } from "../../../src/platforms/restate/variants/baseline/models/fake.js";
import { OpenRouterRestateModel } from "../../../src/platforms/restate/variants/baseline/models/openrouter.js";
import { calculatorTool } from "../../../src/capabilities/tools/calculator.js";
import type { ModelRequest } from "../../../src/platforms/restate/variants/baseline/contracts.js";

const input: ModelRequest = {
  runId: "restate-model-test",
  prompt: "Say hello.",
  systemInstruction: "Respond directly.",
  provider: "fake",
  model: "fake-success",
  round: 1,
  attempt: 1,
  messages: [
    { role: "system", content: "Respond directly." },
    { role: "user", content: "Say hello." },
  ],
  tools: [],
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

  const retrySuccess = await model.complete({ ...input, model: "fake-pre-dispatch-retry-once", attempt: 2 }, new AbortController().signal);
  assert.equal(retrySuccess.kind, "success");
});

test("the fake tool fixture requires the tool result before returning final text", async () => {
  const model = new FakeRestateModel();
  const toolInput: ModelRequest = {
    ...input,
    model: "fake-tool-call",
    tools: [calculatorTool.definition],
  };

  const toolCall = await model.complete(toolInput, new AbortController().signal);
  assert.deepEqual(toolCall, {
    kind: "success",
    output: null,
    toolCalls: [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 17, right: 25 } }],
    providerRequestId: null,
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  });

  const final = await model.complete({
    ...toolInput,
    messages: [
      ...toolInput.messages,
      { role: "assistant", content: null, toolCalls: toolCall.kind === "success" ? toolCall.toolCalls : [] },
      { role: "tool", toolCallId: "call-calculator-1", name: "calculator", content: '{"value":42}' },
    ],
  }, new AbortController().signal);
  assert.equal(final.kind, "success");
  if (final.kind === "success") assert.equal(final.output, 'The calculator returned {"value":42}.');
});

test("fake tool fixtures make malformed, unknown, duplicate, and looping responses reproducible", async () => {
  const model = new FakeRestateModel();
  const fixture = (name: string, round = 1) => model.complete({ ...input, model: name, round }, new AbortController().signal);

  const malformed = await fixture("fake-tool-malformed");
  assert.equal(malformed.kind, "success");
  assert.equal(malformed.kind === "success" ? malformed.toolCalls[0]?.name : null, "calculator");
  assert.deepEqual(malformed.kind === "success" ? malformed.toolCalls[0]?.arguments : null, { operation: "add", left: 20 });

  const unknown = await fixture("fake-tool-unknown");
  assert.equal(unknown.kind, "success");
  assert.equal(unknown.kind === "success" ? unknown.toolCalls[0]?.name : null, "unknown_tool");

  const duplicate = await fixture("fake-tool-duplicate");
  assert.equal(duplicate.kind, "success");
  assert.equal(duplicate.kind === "success" ? duplicate.toolCalls.length : 0, 2);
  assert.equal(duplicate.kind === "success" ? duplicate.toolCalls[0]?.toolCallId : null, duplicate.kind === "success" ? duplicate.toolCalls[1]?.toolCallId : null);

  const loop = await fixture("fake-tool-loop", 4);
  assert.equal(loop.kind, "success");
  assert.equal(loop.kind === "success" ? loop.toolCalls[0]?.toolCallId : null, "call-loop-4");
});

test("a cancelled fake delay is reported as cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await new FakeRestateModel().complete({ ...input, model: "fake-delay" }, controller.signal);

  assert.equal(result.kind, "failure");
  assert.equal(result.kind === "failure" ? result.failureKind : null, "cancelled");
});

test("the delayed tool fixture pauses only the continuation model request", async () => {
  const controller = new AbortController();
  const model = new FakeRestateModel();
  const promise = model.complete({
    ...input,
    model: "fake-tool-call-delay",
    messages: [
      ...input.messages,
      { role: "assistant", content: null, toolCalls: [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 20, right: 22 } }] },
      { role: "tool", toolCallId: "call-calculator-1", name: "calculator", content: '{"value":42}' },
    ],
  }, controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await promise;

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

  const requestBody = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(requestBody.model, "openai/test-model");
  assert.equal(JSON.stringify(requestBody).includes("test-openrouter-secret"), false);
  assert.deepEqual(result, {
    kind: "success",
    output: "A real-shaped response.",
    toolCalls: [],
    providerRequestId: "provider-request-1",
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
  });
});

test("OpenRouter adapter sends tool definitions and preserves tool-call pairing", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const model = new OpenRouterRestateModel({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "provider-tool-request-1",
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-calculator-1",
              type: "function",
              function: { name: "calculator", arguments: '{"operation":"add","left":20,"right":22}' },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await model.complete({ ...input, provider: "openrouter", model: "openai/test-model", tools: [calculatorTool.definition] }, new AbortController().signal);

  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.output, null);
    assert.deepEqual(result.toolCalls, [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 20, right: 22 } }]);
  }
  const sentBody = requestBody as unknown as Record<string, unknown>;
  assert.deepEqual(sentBody.tool_choice, "auto");
  assert.deepEqual(sentBody.tools, [{
    type: "function",
    function: {
      name: "calculator",
      description: calculatorTool.definition.description,
      parameters: calculatorTool.definition.inputSchema,
    },
  }]);

  let continuationBody: Record<string, unknown> | null = null;
  const continuation = new OpenRouterRestateModel({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl: async (_url, init) => {
      continuationBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "provider-final-request-1",
        choices: [{ message: { content: "The answer is 42." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await continuation.complete({
    ...input,
    provider: "openrouter",
    model: "openai/test-model",
    round: 2,
    attempt: 1,
    messages: [
      ...input.messages,
      { role: "assistant", content: null, toolCalls: [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 20, right: 22 } }] },
      { role: "tool", toolCallId: "call-calculator-1", name: "calculator", content: '{"value":42}' },
    ],
    tools: [calculatorTool.definition],
  }, new AbortController().signal);
  const sentContinuationBody = continuationBody as unknown as Record<string, unknown>;
  assert.deepEqual((sentContinuationBody.messages as Array<Record<string, unknown>>).slice(-2), [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-calculator-1", type: "function", function: { name: "calculator", arguments: '{"operation":"add","left":20,"right":22}' } }],
    },
    { role: "tool", tool_call_id: "call-calculator-1", name: "calculator", content: '{"value":42}' },
  ]);
});

test("OpenRouter adapter rejects oversized provider response and tool payloads", async () => {
  const complete = (body: BodyInit): Promise<Awaited<ReturnType<OpenRouterRestateModel["complete"]>>> => new OpenRouterRestateModel({
    apiKey: "test-openrouter-secret",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  }).complete({ ...input, provider: "openrouter", model: "openai/test-model", tools: [calculatorTool.definition] }, new AbortController().signal);

  const oversizedResponse = await complete("x".repeat(2 * 1024 * 1024 + 1));
  assert.equal(oversizedResponse.kind, "failure");
  assert.equal(oversizedResponse.kind === "failure" ? oversizedResponse.code : null, "OPENROUTER_RESPONSE_TOO_LARGE");

  const oversizedText = await complete(JSON.stringify({ choices: [{ message: { content: "x".repeat(128 * 1024 + 1) } }] }));
  assert.equal(oversizedText.kind, "failure");
  assert.equal(oversizedText.kind === "failure" ? oversizedText.code : null, "OPENROUTER_OUTPUT_TOO_LARGE");

  const oversizedArguments = await complete(JSON.stringify({ choices: [{ message: {
    content: null,
    tool_calls: [{ id: "call-too-large", type: "function", function: { name: "calculator", arguments: JSON.stringify({ operation: "add", left: "x".repeat(600), right: 1 }) } }],
  } }] }));
  assert.equal(oversizedArguments.kind, "failure");
  assert.equal(oversizedArguments.kind === "failure" ? oversizedArguments.code : null, "OPENROUTER_TOOL_PAYLOAD_TOO_LARGE");

  const oversizedProviderId = await complete(JSON.stringify({
    id: "x".repeat(257),
    choices: [{ message: { content: "bounded" } }],
  }));
  assert.equal(oversizedProviderId.kind, "failure");
  assert.equal(oversizedProviderId.kind === "failure" ? oversizedProviderId.code : null, "OPENROUTER_PROVIDER_ID_TOO_LARGE");
});
