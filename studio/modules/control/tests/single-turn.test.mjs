import assert from "node:assert/strict";
import test from "node:test";

import { ControlPortError, createSingleTurnControl } from "../dist/index.js";

const scope = { runId: "run-control-test" };
const call = { callId: "call-1", name: "calculator.add", arguments: { left: 19, right: 23 } };

function makePorts({ toolResult = { callId: "call-1", outcome: "completed", output: { sum: 42 } } } = {}) {
  const state = { modelCalls: 0, executedCalls: 0, observations: [] };
  const ports = {
    async prepareModelTurn() {
      return { model: { provider: "fixture", name: "calculator-scenario" }, messages: [], parameters: {} };
    },
    async generate() {
      state.modelCalls += 1;
      if (state.modelCalls === 1) return { text: null, toolCalls: [call], finishReason: "tool_calls" };
      return { text: "19 + 23 = 42.", toolCalls: [], finishReason: "stop" };
    },
    async executeTool({ call: proposed }) {
      state.executedCalls += 1;
      assert.equal(proposed.callId, call.callId);
      return toolResult;
    },
    async recordObservation({ observation }) { state.observations.push(observation); },
    async deliverFinal({ text }) { return { outcome: "committed", receipt: { text } }; },
  };
  return { ports, state };
}

test("serial control records a completed tool result before preparing the next model call", async () => {
  const { ports, state } = makePorts();
  const control = createSingleTurnControl({ maxModelCalls: 2, maxToolCalls: 1 });
  const result = await control.run({ scope, task: { prompt: "Calculate 19 + 23." } }, ports, new AbortController().signal);

  assert.equal(result.termination, "model-finished");
  assert.equal(result.modelCalls, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(state.executedCalls, 1);
  assert.deepEqual(state.observations.map(({ kind }) => kind), ["model-response", "tool-result", "model-response", "delivery-result"]);
});

test("a rejected tool receipt is recorded and stops before a second model call", async () => {
  const { ports, state } = makePorts({ toolResult: {
    callId: "call-1", outcome: "rejected", failure: { code: "SAFETY_DENIED", message: "Denied by policy.", retryable: false },
  } });
  const control = createSingleTurnControl({ maxModelCalls: 2, maxToolCalls: 1 });

  await assert.rejects(
    control.run({ scope, task: { prompt: "Calculate 19 + 23." } }, ports, new AbortController().signal),
    (error) => error instanceof ControlPortError && error.kind === "invalid-transition" && /was rejected/.test(error.message),
  );
  assert.equal(state.modelCalls, 1);
  assert.equal(state.executedCalls, 1);
  assert.deepEqual(state.observations.map(({ kind }) => kind), ["model-response", "tool-result"]);
});

test("a tool request on the last model call is rejected before execution", async () => {
  const { ports, state } = makePorts();
  const control = createSingleTurnControl({ maxModelCalls: 1, maxToolCalls: 1 });

  await assert.rejects(
    control.run({ scope, task: { prompt: "Calculate 19 + 23." } }, ports, new AbortController().signal),
    (error) => error instanceof ControlPortError && error.kind === "budget-exhausted",
  );
  assert.equal(state.modelCalls, 1);
  assert.equal(state.executedCalls, 0);
  assert.deepEqual(state.observations.map(({ kind }) => kind), ["model-response"]);
});
