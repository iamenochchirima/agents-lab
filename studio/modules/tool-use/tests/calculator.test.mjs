import assert from "node:assert/strict";
import test from "node:test";

import {
  createCalculatorAddRegistration,
  createCalculatorAddToolUse,
  createComputerClickRegistration,
  createToolUseModule,
  ToolUseError,
} from "../dist/index.js";

const scope = {
  runId: "tool-use-run",
  turnId: "tool-use-turn",
};

function completedReceipt(output = { sum: 3 }) {
  return {
    status: "completed",
    output,
    error: null,
    durationMs: 1,
    attemptCount: 1,
  };
}

function acceptedCall(toolUse, arguments_ = { left: 1, right: 2 }) {
  const result = toolUse.validate({ callId: "call-1", name: "calculator.add", arguments: arguments_ });
  assert.equal(result.accepted, true);
  return result.call;
}

test("calculator.add is listed with its capability and strictly validates left/right numbers", () => {
  const toolUse = createCalculatorAddToolUse({}, { execute: async () => completedReceipt() });
  assert.deepEqual(toolUse.definitions(), [createCalculatorAddRegistration().definition]);
  assert.deepEqual(toolUse.definitions()[0].capability, {
    id: "calculator",
    version: "1.0.0",
    kind: "pure",
    operations: ["add"],
  });
  assert.equal(toolUse.definitions()[0].capabilityOperation, "add");

  const accepted = toolUse.validate({ callId: "call-1", name: "calculator.add", arguments: { left: 1, right: 2 } });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.call.arguments, { left: 1, right: 2 });
  assert.equal(Object.isFrozen(accepted.call.arguments), true);

  for (const arguments_ of [
    { left: 1, right: 2, extra: 3 },
    { left: 1 },
    { left: "1", right: 2 },
    { a: 1, b: 2 },
  ]) {
    const result = toolUse.validate({ callId: "call-2", name: "calculator.add", arguments: arguments_ });
    assert.equal(result.accepted, false);
    assert.equal(result.code, "INVALID_ARGUMENTS");
  }

  for (const arguments_ of [{ left: Number.NaN, right: 2 }, null, [1, 2]]) {
    const result = toolUse.validate({ callId: "call-2", name: "calculator.add", arguments: arguments_ });
    assert.equal(result.accepted, false);
    assert.equal(result.code, "INVALID_ARGUMENTS");
    assert.equal(result.message, "Tool arguments must be a finite JSON object.");
  }

  assert.equal(toolUse.validate({ callId: "", name: "calculator.add", arguments: { left: 1, right: 2 } }).code, "INVALID_CALL");
  assert.equal(toolUse.validate({ callId: "call-3", name: "calculator.subtract", arguments: { left: 1, right: 2 } }).code, "UNKNOWN_TOOL");
});

test("argument byte limit is applied before registration validation", () => {
  const toolUse = createCalculatorAddToolUse({ maxArgumentBytes: 8 }, { execute: async () => completedReceipt() });
  const result = toolUse.validate({ callId: "call-1", name: "calculator.add", arguments: { left: 12345, right: 67890 } });

  assert.equal(result.accepted, false);
  assert.equal(result.code, "ARGUMENTS_TOO_LARGE");
  assert.match(result.message, /limit is 8/);
});

test("dispatch passes the scoped normalized call and returns a validated receipt", async () => {
  let received;
  const toolUse = createCalculatorAddToolUse({}, {
    async execute(input, signal) {
      received = { input, signal };
      return completedReceipt();
    },
  });
  const call = acceptedCall(toolUse);
  const signal = new AbortController().signal;
  const result = await toolUse.dispatch(call, scope, signal);

  assert.equal(received.input.scope, scope);
  assert.equal(received.input.call.definition.name, "calculator.add");
  assert.deepEqual(received.input.call.arguments, { left: 1, right: 2 });
  assert.equal(received.signal.aborted, false);
  assert.deepEqual(result, completedReceipt());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.output), true);
});

test("dispatch refuses forged validated calls before invoking the executor", async () => {
  let calls = 0;
  const toolUse = createCalculatorAddToolUse({}, { execute: async () => { calls += 1; return completedReceipt(); } });
  const call = acceptedCall(toolUse);

  await assert.rejects(
    toolUse.dispatch({ ...call, definition: { ...call.definition, version: "different" } }, scope, new AbortController().signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_EXECUTION_FAILED",
  );
  assert.equal(calls, 0);
});

test("malformed or oversized executor receipts surface as unknown outcomes", async () => {
  const malformed = createCalculatorAddToolUse({}, {
    execute: async () => ({ ...completedReceipt(), attemptCount: 0 }),
  });
  await assert.rejects(
    malformed.dispatch(acceptedCall(malformed), scope, new AbortController().signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_OUTCOME_UNKNOWN",
  );

  const oversized = createCalculatorAddToolUse({ maxResultBytes: 12 }, {
    execute: async () => completedReceipt(),
  });
  await assert.rejects(
    oversized.dispatch(acceptedCall(oversized), scope, new AbortController().signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_OUTCOME_UNKNOWN" && /limit was exceeded/.test(error.message),
  );
});

test("executor failures after dispatch are treated as unknown outcomes", async () => {
  const toolUse = createCalculatorAddToolUse({}, {
    async execute() { throw new Error("connection lost after dispatch"); },
  });

  await assert.rejects(
    toolUse.dispatch(acceptedCall(toolUse), scope, new AbortController().signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_OUTCOME_UNKNOWN" && /connection lost/.test(error.message),
  );
});

test("pre-cancelled dispatch never calls the executor", async () => {
  let calls = 0;
  const toolUse = createCalculatorAddToolUse({}, { execute: async () => { calls += 1; return completedReceipt(); } });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    toolUse.dispatch(acceptedCall(toolUse), scope, controller.signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_USE_CANCELLED",
  );
  assert.equal(calls, 0);
});

test("in-flight cancellation aborts the executor and reports an unknown outcome", async () => {
  let signalSeen;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const toolUse = createCalculatorAddToolUse({}, {
    execute(_input, signal) {
      signalSeen = signal;
      markStarted();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = toolUse.dispatch(acceptedCall(toolUse), scope, controller.signal);
  await started;
  controller.abort();

  await assert.rejects(pending, (error) => error instanceof ToolUseError && error.code === "TOOL_OUTCOME_UNKNOWN");
  assert.equal(signalSeen.aborted, true);
});

test("timeout aborts the executor and reports possible side-effect uncertainty", async () => {
  let signalSeen;
  const toolUse = createCalculatorAddToolUse({ timeoutMs: 5 }, {
    execute(_input, signal) {
      signalSeen = signal;
      return new Promise(() => {});
    },
  });

  await assert.rejects(
    toolUse.dispatch(acceptedCall(toolUse), scope, new AbortController().signal),
    (error) => error instanceof ToolUseError && error.code === "TOOL_TIMEOUT" && /outcome may be unknown/.test(error.message),
  );
  assert.equal(signalSeen.aborted, true);
});

test("generic factory accepts the public calculator registration and rejects duplicates", () => {
  const registration = createCalculatorAddRegistration();
  const executor = { execute: async () => completedReceipt() };
  assert.equal(createToolUseModule({}, { registrations: [registration], executor }).definitions()[0].name, "calculator.add");
  assert.throws(() => createToolUseModule({}, { registrations: [registration, registration], executor }), /registered more than once/);
});

test("computer.click validates one target and declares the scoped environment capability", () => {
  const registration = createComputerClickRegistration();
  const toolUse = createToolUseModule({}, {
    registrations: [registration],
    executor: { execute: async () => ({ ...completedReceipt(), output: { status: "completed" } }) },
  });
  assert.deepEqual(toolUse.definitions()[0].capability, {
    id: "computer", version: "1.0.0", kind: "computer", operations: ["observe", "click"],
  });
  const accepted = toolUse.validate({ callId: "click-1", name: "computer.click", arguments: { target: "say-hello" } });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.call.arguments, { target: "say-hello" });
  assert.equal(toolUse.validate({ callId: "click-2", name: "computer.click", arguments: { target: "say-hello", extra: true } }).accepted, false);
  assert.equal(toolUse.validate({ callId: "click-3", name: "computer.click", arguments: { target: "" } }).accepted, false);
});

test("a declared capability requires an explicit matching operation", () => {
  const registration = createCalculatorAddRegistration();
  const executor = { execute: async () => completedReceipt() };
  const incomplete = {
    ...registration,
    definition: { ...registration.definition, capabilityOperation: undefined },
  };
  const mismatched = {
    ...registration,
    definition: { ...registration.definition, capabilityOperation: "subtract" },
  };

  assert.throws(() => createToolUseModule({}, { registrations: [incomplete], executor }), /complete capability operation/);
  assert.throws(() => createToolUseModule({}, { registrations: [mismatched], executor }), /must appear in the capability descriptor/);
});
