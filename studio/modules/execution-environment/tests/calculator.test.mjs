import assert from "node:assert/strict";
import test from "node:test";

import { createRunId } from "../../../agent-protocol/dist/index.js";
import { CALCULATOR_CAPABILITY, COMPUTER_FIXTURE_CAPABILITY, createCalculatorExecutionEnvironment } from "../dist/index.js";

const scope = { runId: createRunId("calculator-test-run") };
const grant = {
  id: CALCULATOR_CAPABILITY.id,
  version: CALCULATOR_CAPABILITY.version,
  operations: ["add"],
};

function environment() {
  return createCalculatorExecutionEnvironment({ allowedCapabilities: [CALCULATOR_CAPABILITY] });
}

async function open(env = environment(), requestedCapabilities = [grant], signal = new AbortController().signal) {
  return env.openSession({ scope, requestedCapabilities }, signal);
}

function invocation(overrides = {}) {
  return {
    operationId: "op-1",
    capabilityId: CALCULATOR_CAPABILITY.id,
    capabilityVersion: CALCULATOR_CAPABILITY.version,
    operation: "add",
    input: { left: 19, right: 23 },
    ...overrides,
  };
}

test("environment describes only the pure calculator capability", () => {
  const descriptor = environment().describe();
  assert.deepEqual(descriptor.capabilities, [CALCULATOR_CAPABILITY, COMPUTER_FIXTURE_CAPABILITY]);
  assert.equal(descriptor.capabilities[0].kind, "pure");
  assert.deepEqual(descriptor.capabilities[0].operations, ["add"]);
});

test("controlled computer capability observes and changes only its per-session fixture page", async () => {
  const computerGrant = {
    id: COMPUTER_FIXTURE_CAPABILITY.id,
    version: COMPUTER_FIXTURE_CAPABILITY.version,
    operations: ["observe", "click"],
  };
  const env = createCalculatorExecutionEnvironment({ allowedCapabilities: [COMPUTER_FIXTURE_CAPABILITY] });
  const opened = await open(env, [computerGrant]);
  assert.equal(opened.outcome, "opened");
  const session = opened.session;
  assert.deepEqual(session.capabilities, [COMPUTER_FIXTURE_CAPABILITY]);

  const before = await session.invoke({
    operationId: "computer-observe-before", capabilityId: "computer", capabilityVersion: "1.0.0",
    operation: "observe", input: {},
  }, new AbortController().signal);
  assert.equal(before.outcome, "completed");
  assert.equal(before.output.kind, "accessibility-tree");
  assert.equal(before.output.content.elements[0].text, "Click to reveal a greeting.");

  const click = await session.invoke({
    operationId: "computer-click-1", capabilityId: "computer", capabilityVersion: "1.0.0",
    operation: "click", input: { target: "say-hello" }, idempotencyKey: "computer-click-key-1",
  }, new AbortController().signal);
  assert.equal(click.outcome, "completed");
  assert.equal(click.output.status, "completed");
  const duplicate = await session.invoke({
    operationId: "computer-click-2", capabilityId: "computer", capabilityVersion: "1.0.0",
    operation: "click", input: { target: "say-hello" }, idempotencyKey: "computer-click-key-1",
  }, new AbortController().signal);
  assert.equal(duplicate.outcome, "completed");
  assert.equal(duplicate.output.detail, click.output.detail);

  const after = await session.invoke({
    operationId: "computer-observe-after", capabilityId: "computer", capabilityVersion: "1.0.0",
    operation: "observe", input: {},
  }, new AbortController().signal);
  assert.equal(after.outcome, "completed");
  assert.equal(after.output.content.elements[0].text, "Hello from the controlled page.");
  await session.close();

  const freshSession = await open(env, [computerGrant]);
  assert.equal(freshSession.outcome, "opened");
  const fresh = await freshSession.session.invoke({
    operationId: "computer-observe-fresh", capabilityId: "computer", capabilityVersion: "1.0.0",
    operation: "observe", input: {},
  }, new AbortController().signal);
  assert.equal(fresh.output.content.elements[0].text, "Click to reveal a greeting.");
});

test("session grants require both configured allowlist and requested capability", async () => {
  const denied = await open(createCalculatorExecutionEnvironment());
  assert.equal(denied.outcome, "failed");
  assert.equal(denied.resourceState, "not-created");
  assert.equal(denied.failure.code, "CAPABILITY_NOT_ALLOWED");

  const unsupported = await open(environment(), [{ ...grant, operations: ["subtract"] }]);
  assert.equal(unsupported.outcome, "failed");
  assert.equal(unsupported.failure.code, "UNSUPPORTED_OPERATION");

  const opened = await open();
  assert.equal(opened.outcome, "opened");
  assert.deepEqual(opened.session.capabilities, [CALCULATOR_CAPABILITY]);
});

test("granted calculator.add returns a deterministic pure sum", async () => {
  const opened = await open();
  assert.equal(opened.outcome, "opened");
  const first = await opened.session.invoke(invocation(), new AbortController().signal);
  const duplicate = await opened.session.invoke(invocation(), new AbortController().signal);

  assert.deepEqual(first, { outcome: "completed", operationId: "op-1", output: { sum: 42 } });
  assert.deepEqual(duplicate, first);
});

test("invocation cannot use an ungranted or unsupported operation", async () => {
  const opened = await open(environment(), []);
  assert.equal(opened.outcome, "opened");
  const receipt = await opened.session.invoke(invocation(), new AbortController().signal);
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.failure.code, "CAPABILITY_NOT_GRANTED");

  const granted = await open();
  const invalidOperation = await granted.session.invoke(invocation({ operation: "subtract" }), new AbortController().signal);
  assert.equal(invalidOperation.outcome, "rejected");
  assert.equal(invalidOperation.failure.code, "INVALID_INVOCATION");
});

test("addition rejects malformed operands and non-finite results", async () => {
  const opened = await open();
  const extraField = await opened.session.invoke(invocation({ input: { left: 1, right: 2, extra: 3 } }), new AbortController().signal);
  const stringOperand = await opened.session.invoke(invocation({ operationId: "op-2", input: { left: "1", right: 2 } }), new AbortController().signal);
  const overflow = await opened.session.invoke(invocation({ operationId: "op-3", input: { left: Number.MAX_VALUE, right: Number.MAX_VALUE } }), new AbortController().signal);

  assert.equal(extraField.outcome, "rejected");
  assert.equal(extraField.failure.code, "INVALID_ARGUMENTS");
  assert.equal(stringOperand.outcome, "rejected");
  assert.equal(stringOperand.failure.code, "INVALID_ARGUMENTS");
  assert.equal(overflow.outcome, "rejected");
  assert.equal(overflow.failure.code, "RESULT_OUT_OF_RANGE");
});

test("cancellation and close prevent later invocations", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelledOpen = await open(environment(), [grant], controller.signal);
  assert.equal(cancelledOpen.outcome, "failed");
  assert.equal(cancelledOpen.failure.code, "CANCELLED");

  const opened = await open();
  const cancelledInvoke = await opened.session.invoke(invocation(), controller.signal);
  assert.equal(cancelledInvoke.outcome, "rejected");
  assert.equal(cancelledInvoke.failure.code, "CANCELLED");
  assert.deepEqual(await opened.session.close(), { outcome: "closed" });
  assert.deepEqual(await opened.session.close(), { outcome: "already-closed" });
  const afterClose = await opened.session.invoke(invocation(), new AbortController().signal);
  assert.equal(afterClose.outcome, "rejected");
  assert.equal(afterClose.failure.code, "SESSION_CLOSED");
});

test("operation and idempotency identifiers cannot be reused for different inputs", async () => {
  const opened = await open();
  await opened.session.invoke(invocation(), new AbortController().signal);
  const operationIdReuse = await opened.session.invoke(invocation({ input: { left: 20, right: 22 } }), new AbortController().signal);
  assert.equal(operationIdReuse.outcome, "rejected");
  assert.equal(operationIdReuse.failure.code, "OPERATION_ID_REUSED");

  const withKey = await opened.session.invoke(invocation({ operationId: "op-key-1", idempotencyKey: "key-1" }), new AbortController().signal);
  const repeatKey = await opened.session.invoke(invocation({ operationId: "op-key-2", idempotencyKey: "key-1" }), new AbortController().signal);
  const changedKey = await opened.session.invoke(invocation({ operationId: "op-key-3", idempotencyKey: "key-1", input: { left: 20, right: 22 } }), new AbortController().signal);
  assert.equal(withKey.outcome, "completed");
  assert.deepEqual(repeatKey, { outcome: "completed", operationId: "op-key-2", output: { sum: 42 } });
  assert.equal(changedKey.outcome, "rejected");
  assert.equal(changedKey.failure.code, "IDEMPOTENCY_KEY_REUSED");
});
