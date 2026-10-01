import assert from "node:assert/strict";
import test from "node:test";

import {
  CALCULATOR_SCENARIO_TASK,
  COMPUTER_SCENARIO_TASK,
  REFERENCE_MODEL_IDENTITY,
  createReferenceModelInterface,
} from "../dist/index.js";

function request(task, messages = []) {
  return {
    scope: { runId: "model-fixture-run", sessionId: "model-fixture-session", turnId: "model-fixture-turn" },
    model: { provider: "replay", name: REFERENCE_MODEL_IDENTITY.id, revision: REFERENCE_MODEL_IDENTITY.version },
    messages: [
      { role: "system", content: "Fixture request." },
      { role: "user", content: JSON.stringify({ kind: "task", content: task }) },
      ...messages,
    ],
    tools: [
      { name: "calculator.add", description: "Add two integers.", parameters: { type: "object" } },
      { name: "computer.click", description: "Click a controlled element.", parameters: { type: "object" } },
    ],
    parameters: {},
  };
}

test("reference model uses Replay for ordinary text and keeps one adapter identity", async () => {
  const model = createReferenceModelInterface({ maxOutputTokens: 512, maxAttempts: 1, requestTimeoutMs: 1_000 });
  const result = await model.generate(request("Summarize the model request."), new AbortController().signal);
  assert.equal(result.outcome, "completed");
  assert.match(result.response.text, /Deterministic replay/);
  assert.deepEqual(result.response.provider.adapter, REFERENCE_MODEL_IDENTITY);
  assert.deepEqual(result.response.toolCalls, []);
});

test("reference model routes exact calculator task through a correlated fixed tool round trip", async () => {
  const model = createReferenceModelInterface({ maxOutputTokens: 512, maxAttempts: 1, requestTimeoutMs: 1_000 });
  const first = await model.generate(request(CALCULATOR_SCENARIO_TASK), new AbortController().signal);
  assert.equal(first.outcome, "completed");
  assert.deepEqual(first.response.toolCalls[0].arguments, { left: 19, right: 23 });
  const continuation = request(CALCULATOR_SCENARIO_TASK, [
    { role: "assistant", content: null, toolCalls: first.response.toolCalls },
    { role: "tool", name: "calculator.add", toolCallId: first.response.toolCalls[0].callId, content: JSON.stringify({ sum: 42 }) },
  ]);
  const second = await model.generate(continuation, new AbortController().signal);
  assert.equal(second.outcome, "completed");
  assert.equal(second.response.text, "19 + 23 = 42.");
  assert.deepEqual(second.response.provider.adapter, REFERENCE_MODEL_IDENTITY);
});

test("reference model routes the controlled computer task to its fixed click fixture", async () => {
  const model = createReferenceModelInterface({ maxOutputTokens: 512, maxAttempts: 1, requestTimeoutMs: 1_000 });
  const result = await model.generate(request(COMPUTER_SCENARIO_TASK), new AbortController().signal);
  assert.equal(result.outcome, "completed");
  assert.deepEqual(result.response.toolCalls[0], {
    callId: "computer-click-1",
    name: "computer.click",
    arguments: { target: "say-hello" },
  });
  assert.deepEqual(result.response.provider.adapter, REFERENCE_MODEL_IDENTITY);
});
