import assert from "node:assert/strict";
import test from "node:test";

import {
  OutputActionsError,
  createTextOutputActions,
  parseOutputActionsConfig,
} from "../dist/index.js";

const scope = { runId: "run-output-actions-test", turnId: "turn-1" };
const request = (text = "Hello from the agent.") => ({ actionId: "response-1", kind: "text-response", payload: { text } });
const signal = () => new AbortController().signal;

function harness(options = {}) {
  const calls = [];
  const sink = options.sink ?? {
    async deliver(input, passedSignal) {
      calls.push({ input, signal: passedSignal });
      return {
        actionId: input.proposal.actionId,
        status: "committed",
        receipt: { sink: "fixture-chat", delivered: true },
      };
    },
  };
  return {
    output: createTextOutputActions(options.config ?? {}, { sink }),
    calls,
  };
}

test("prepares a bounded response without calling the sink", async () => {
  const { output, calls } = harness();
  const proposal = await output.prepare({ scope, action: request() }, signal());

  assert.equal(output.identity.id, "text-output-actions");
  assert.equal(output.identity.version, "0.1.0");
  assert.deepEqual(proposal.payload, { text: "Hello from the agent." });
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.summary, "Deliver final text to the host response sink.");
  assert.deepEqual(proposal.evidence, { payloadBytes: Buffer.byteLength(JSON.stringify({ text: "Hello from the agent." })) });
  assert.equal(calls.length, 0);
  assert.ok(Object.isFrozen(proposal));
  assert.ok(Object.isFrozen(proposal.payload));
});

test("validates action kind, text payload, scope, and serialized payload size", async (t) => {
  const { output, calls } = harness({ config: { maxPayloadBytes: 32 } });
  const cases = [
    ["wrong kind", { scope, action: { ...request(), kind: "file-write" } }, "INVALID_OUTPUT_ACTION_INPUT"],
    ["empty text", { scope, action: request(" \n ") }, "INVALID_OUTPUT_ACTION_INPUT"],
    ["extra payload field", { scope, action: { ...request(), payload: { text: "ok", extra: true } } }, "INVALID_OUTPUT_ACTION_INPUT"],
    ["malformed scope", { scope: { runId: " " }, action: request() }, "INVALID_OUTPUT_ACTION_INPUT"],
  ];
  for (const [name, prepareInput, code] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        output.prepare(prepareInput, signal()),
        (error) => error instanceof OutputActionsError && error.code === code,
      );
    });
  }
  await assert.rejects(
    output.prepare({ scope, action: request("é".repeat(40)) }, signal()),
    (error) => error instanceof OutputActionsError && error.code === "OUTPUT_ACTION_TOO_LARGE",
  );
  assert.equal(calls.length, 0);
});

test("requires an idempotency key before beginning delivery", async () => {
  const { output, calls } = harness();
  const proposal = await output.prepare({ scope, action: request() }, signal());
  await assert.rejects(
    output.deliver({ scope, proposal }, signal()),
    (error) => error instanceof OutputActionsError && error.code === "INVALID_OUTPUT_ACTION_INPUT",
  );
  assert.equal(calls.length, 0);
});

test("passes the approved proposal and idempotency key to the host sink", async () => {
  const { output, calls } = harness();
  const proposal = await output.prepare({ scope, action: request() }, signal());
  const result = await output.deliver({ scope, proposal, idempotencyKey: "response-key-1" }, signal());

  assert.deepEqual(result, {
    actionId: "response-1",
    status: "committed",
    receipt: { sink: "fixture-chat", delivered: true },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, { scope, proposal, idempotencyKey: "response-key-1" });
});

test("preserves sink rejection and uncertain receipts", async (t) => {
  const outcomes = [
    { actionId: "response-1", status: "rejected", reason: "Destination refused output." },
    { actionId: "response-1", status: "uncertain", reason: "Acknowledgement was lost." },
  ];
  for (const expected of outcomes) {
    await t.test(expected.status, async () => {
      const { output } = harness({ sink: { deliver: async () => expected } });
      const proposal = await output.prepare({ scope, action: request() }, signal());
      assert.deepEqual(await output.deliver({ scope, proposal, idempotencyKey: "response-key-1" }, signal()), expected);
    });
  }
});

test("maps sink exceptions and mismatched receipts to uncertain outcomes", async (t) => {
  const cases = [
    ["rejection after dispatch", { deliver: async () => { throw new Error("ack channel closed"); } }],
    ["wrong action ID", { deliver: async () => ({ actionId: "different-action", status: "committed", receipt: {} }) }],
  ];
  for (const [name, sink] of cases) {
    await t.test(name, async () => {
      const { output } = harness({ sink });
      const proposal = await output.prepare({ scope, action: request() }, signal());
      const result = await output.deliver({ scope, proposal, idempotencyKey: "response-key-1" }, signal());
      assert.equal(result.actionId, proposal.actionId);
      assert.equal(result.status, "uncertain");
    });
  }
});

test("passes repeated idempotency keys to the sink, which owns duplicate suppression", async () => {
  const receipts = new Map();
  let sideEffects = 0;
  const sink = {
    async deliver({ proposal, idempotencyKey }) {
      if (receipts.has(idempotencyKey)) return receipts.get(idempotencyKey);
      sideEffects += 1;
      const receipt = { actionId: proposal.actionId, status: "committed", receipt: { sequence: sideEffects } };
      receipts.set(idempotencyKey, receipt);
      return receipt;
    },
  };
  const { output } = harness({ sink });
  const proposal = await output.prepare({ scope, action: request() }, signal());
  const first = await output.deliver({ scope, proposal, idempotencyKey: "same-key" }, signal());
  const repeated = await output.deliver({ scope, proposal, idempotencyKey: "same-key" }, signal());

  assert.deepEqual(repeated, first);
  assert.equal(sideEffects, 1);
});

test("cancellation before sink call is retry-safe; cancellation after dispatch is uncertain", async () => {
  let beforeCalls = 0;
  const beforeHarness = harness({ sink: { deliver: async () => { beforeCalls += 1; return {}; } } });
  const proposal = await beforeHarness.output.prepare({ scope, action: request() }, signal());
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    beforeHarness.output.deliver({ scope, proposal, idempotencyKey: "response-key-1" }, before.signal),
    (error) => error instanceof OutputActionsError && error.code === "OUTPUT_ACTION_CANCELLED",
  );
  assert.equal(beforeCalls, 0);

  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  let afterCalls = 0;
  const afterHarness = harness({ sink: { deliver: async () => {
    afterCalls += 1;
    notifyStarted();
    return new Promise(() => {});
  } } });
  const afterProposal = await afterHarness.output.prepare({ scope, action: request() }, signal());
  const after = new AbortController();
  const pending = afterHarness.output.deliver({ scope, proposal: afterProposal, idempotencyKey: "response-key-1" }, after.signal);
  await started;
  after.abort();
  const result = await pending;
  assert.equal(result.status, "uncertain");
  assert.match(result.reason, /may have accepted/);
  assert.equal(afterCalls, 1);
});

test("validates host receipt payloads and supports optional idempotency configuration", async () => {
  assert.equal(parseOutputActionsConfig({ requireIdempotencyKey: false }).requireIdempotencyKey, false);
  const { output } = harness({
    config: { requireIdempotencyKey: false },
    sink: { deliver: async () => ({ actionId: "response-1", status: "committed", receipt: Number.NaN }) },
  });
  const proposal = await output.prepare({ scope, action: request() }, signal());
  const result = await output.deliver({ scope, proposal }, signal());
  assert.equal(result.status, "uncertain");
});
