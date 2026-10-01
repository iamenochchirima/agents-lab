import assert from "node:assert/strict";
import test from "node:test";

import { createRunId, createTurnId } from "../../../agent-protocol/dist/index.js";
import { createAllowlistSafetyModule } from "../dist/index.js";

const scope = { runId: createRunId("run-calculator-1"), turnId: createTurnId("turn-1") };
const calculatorCapability = {
  id: "calculator",
  version: "1.0.0",
  kind: "pure",
  operations: ["add"],
};
const allowCalculatorAdd = { allowedToolCapabilities: [calculatorCapability] };

function calculatorCheckpoint(overrides = {}) {
  return {
    checkpointId: "checkpoint-1",
    kind: "tool-call",
    action: { callId: "call-1", name: "calculator.add", capabilityOperation: "add", arguments: { left: 20, right: 22 } },
    capability: calculatorCapability,
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

test("default allowlist denies a calculator call until its capability is explicitly configured", async () => {
  const safety = createAllowlistSafetyModule();
  const result = await safety.evaluate({ scope, checkpoint: calculatorCheckpoint() }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "TOOL_NOT_ALLOWLISTED");
  assert.equal(result.decision.checkpointId, "checkpoint-1");
});

test("an explicit calculator.add rule allows only the matching declared tool capability", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const result = await safety.evaluate({ scope, checkpoint: calculatorCheckpoint() }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "allow");
  assert.equal(result.decision.reasonCode, "ALLOWLIST_MATCH");
  assert.match(result.decision.decisionId, /^safety:16:run-calculator-1:12:checkpoint-1$/);
  assert.equal(result.decision.decisionId, (await safety.evaluate({ scope, checkpoint: calculatorCheckpoint() }, signal())).decision.decisionId);
});

test("a different tool name remains denied even when the capability is present", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const checkpoint = calculatorCheckpoint({
    action: { callId: "call-2", name: "calculator.subtract", capabilityOperation: "subtract", arguments: { left: 20, right: 2 } },
    capability: { ...calculatorCapability, operations: ["add", "subtract"] },
  });
  const result = await safety.evaluate({ scope, checkpoint }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "TOOL_NOT_ALLOWLISTED");
});

test("a declared capability mismatch blocks an otherwise allowlisted tool name", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const result = await safety.evaluate({
    scope,
    checkpoint: calculatorCheckpoint({ capability: { ...calculatorCapability, operations: ["subtract"] } }),
  }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "TOOL_CAPABILITY_MISMATCH");
});

test("the allow rule is pinned to the configured capability version", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const result = await safety.evaluate({
    scope,
    checkpoint: calculatorCheckpoint({ capability: { ...calculatorCapability, version: "2.0.0" } }),
  }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "TOOL_NOT_ALLOWLISTED");
});

test("environment and Memory checkpoints are denied unless their separate grants exist", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const environment = await safety.evaluate({ scope, checkpoint: calculatorCheckpoint({ kind: "environment-operation" }) }, signal());
  assert.equal(environment.status, "evaluated");
  assert.equal(environment.decision.decision, "deny");
  assert.equal(environment.decision.reasonCode, "ENVIRONMENT_CAPABILITY_MISMATCH");
  assert.equal(environment.decision.approvalRequest, undefined);

  const memory = await safety.evaluate({ scope, checkpoint: {
    checkpointId: "memory-1", kind: "memory-write",
    action: { actionId: "episode-1", kind: "episode", sourceKind: "user", trust: "untrusted", contentBytes: 12 },
  } }, signal());
  assert.equal(memory.status, "evaluated");
  assert.equal(memory.decision.decision, "deny");
  assert.equal(memory.decision.reasonCode, "MEMORY_WRITE_NOT_ALLOWLISTED");
  assert.equal(memory.decision.approvalRequest, undefined);
});

test("Memory observations require an exact configured observation-kind grant", async () => {
  const checkpoint = {
    checkpointId: "memory-1", kind: "memory-write",
    action: { actionId: "episode-1", kind: "episode", sourceKind: "user", trust: "untrusted", contentBytes: 12 },
  };
  const allowed = await createAllowlistSafetyModule({ allowedMemoryWriteKinds: ["episode"] })
    .evaluate({ scope, checkpoint }, signal());
  assert.equal(allowed.decision.decision, "allow");
});

test("output action kinds require an exact explicit allowlist entry", async () => {
  const checkpoint = {
    checkpointId: "output-1",
    kind: "output-action",
    action: { actionId: "response-1", kind: "text-response", payload: { text: "hello" } },
  };
  const denied = await createAllowlistSafetyModule().evaluate({ scope, checkpoint }, signal());
  assert.equal(denied.decision.decision, "deny");
  assert.equal(denied.decision.reasonCode, "OUTPUT_ACTION_NOT_ALLOWLISTED");

  const allowed = await createAllowlistSafetyModule({ allowedOutputActionKinds: ["text-response"] })
    .evaluate({ scope, checkpoint }, signal());
  assert.equal(allowed.decision.decision, "allow");
  assert.equal(allowed.decision.reasonCode, "ALLOWLIST_MATCH");
});

test("environment operations require a separate exact non-pure capability grant", async () => {
  const capability = { id: "computer", version: "1.0.0", kind: "computer", operations: ["observe", "click"] };
  const checkpoint = {
    checkpointId: "computer-click-1",
    kind: "environment-operation",
    capability,
    action: { callId: "call-click-1", name: "computer.click", capabilityOperation: "click", arguments: { target: "button-1" } },
  };
  const denied = await createAllowlistSafetyModule().evaluate({ scope, checkpoint }, signal());
  assert.equal(denied.decision.decision, "deny");
  assert.equal(denied.decision.reasonCode, "ENVIRONMENT_OPERATION_NOT_ALLOWLISTED");

  const allowed = await createAllowlistSafetyModule({ allowedEnvironmentCapabilities: [capability] })
    .evaluate({ scope, checkpoint }, signal());
  assert.equal(allowed.decision.decision, "allow");
});

test("invalid tool-call shapes are denied without echoing action content", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const result = await safety.evaluate({
    scope,
    checkpoint: calculatorCheckpoint({
      action: { name: "calculator.add", callId: "", capabilityOperation: "add", arguments: { secret: "sensitive fixture" } },
    }),
  }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "INVALID_TOOL_CALL_ACTION");
  assert.equal(result.decision.explanation.includes("sensitive fixture"), false);
});

test("oversized and unrecognized checkpoints return unavailable instead of permission", async () => {
  const smallLimit = createAllowlistSafetyModule({ maxCheckpointBytes: 64, ...allowCalculatorAdd });
  const oversized = await smallLimit.evaluate({
    scope,
    checkpoint: calculatorCheckpoint({ evidence: { diagnostic: "x".repeat(100) } }),
  }, signal());
  assert.deepEqual(oversized, {
    status: "unavailable",
    checkpointId: "checkpoint-1",
    code: "CHECKPOINT_TOO_LARGE",
    message: "The checkpoint exceeds the configured Safety size limit.",
  });

  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const unknown = await safety.evaluate({ scope, checkpoint: calculatorCheckpoint({ kind: "unlisted-kind" }) }, signal());
  assert.equal(unknown.status, "unavailable");
  assert.equal(unknown.code, "INVALID_CHECKPOINT");

  const cyclicAction = { callId: "call-1", name: "calculator.add", capabilityOperation: "add", arguments: {} };
  cyclicAction.arguments.self = cyclicAction;
  const cyclic = await safety.evaluate({ scope, checkpoint: calculatorCheckpoint({ action: cyclicAction }) }, signal());
  assert.equal(cyclic.status, "unavailable");
  assert.equal(cyclic.code, "INVALID_CHECKPOINT");
});

test("an inconsistent canonical name and explicit capability operation is denied", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const result = await safety.evaluate({
    scope,
    checkpoint: calculatorCheckpoint({
      action: { callId: "call-3", name: "calculator.subtract", capabilityOperation: "add", arguments: { left: 20, right: 2 } },
    }),
  }, signal());

  assert.equal(result.status, "evaluated");
  assert.equal(result.decision.decision, "deny");
  assert.equal(result.decision.reasonCode, "TOOL_CAPABILITY_MISMATCH");
});

test("cancellation rejects evaluation and non-deny fallback settings are rejected", async () => {
  const safety = createAllowlistSafetyModule(allowCalculatorAdd);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(safety.evaluate({ scope, checkpoint: calculatorCheckpoint() }, controller.signal), { name: "AbortError" });
  assert.throws(() => createAllowlistSafetyModule({ defaultDecision: "allow", ...allowCalculatorAdd }), /requires defaultDecision to remain deny/);
  assert.throws(() => createAllowlistSafetyModule({ defaultDecision: "approval-required" }), /requires defaultDecision to remain deny/);
});
