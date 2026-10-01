import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { createRunId, createSessionId, createTurnId } from "@agent-harness-lab/agent-protocol";
import { createContextAssembler } from "@agent-harness-lab/module-context";
import { createSingleTurnControl } from "@agent-harness-lab/module-control";
import { CALCULATOR_CAPABILITY, createCalculatorExecutionEnvironment } from "@agent-harness-lab/module-execution-environment";
import { createTextInputNormalizer } from "@agent-harness-lab/module-input";
import { createInMemorySession } from "@agent-harness-lab/module-memory";
import { createSingleStepResponsePlanner } from "@agent-harness-lab/module-planning";
import { createTextOutputActions } from "@agent-harness-lab/module-output-actions";
import { createAllowlistSafetyModule } from "@agent-harness-lab/module-safety";
import { createCalculatorAddToolUse } from "@agent-harness-lab/module-tool-use";
import { TextTurnExecutionError, runTextTurn } from "../dist/index.js";

const task = "Calculate 19 + 23 with the calculator tool.";
const toolCall = { callId: "calculator-add-1", name: "calculator.add", arguments: { left: 19, right: 23 } };

function fixtureModel(proposedCall = toolCall) {
  let index = 0;
  const requests = [];
  const identity = { id: "test-scripted-model", version: "0.1.0" };
  return {
    requests,
    identity,
    async generate(request, signal) {
      requests.push(request);
      if (signal.aborted) return { outcome: "failed", failure: { category: "cancelled", message: "cancelled", retryable: false, dispatchOutcome: "not-sent" } };
      index += 1;
      const response = index === 1
        ? { text: null, toolCalls: [proposedCall], finishReason: "tool_calls" }
        : { text: "19 + 23 = 42.", toolCalls: [], finishReason: "stop" };
      return {
        outcome: "completed",
        response: {
          provider: { provider: "fixture", model: "test-scripted-model", adapter: identity },
          ...response,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null, basis: "unknown" },
        },
      };
    },
  };
}

function testEnvironment(invocations) {
  const environment = createCalculatorExecutionEnvironment({ allowedCapabilities: [CALCULATOR_CAPABILITY] });
  return {
    identity: environment.identity,
    describe: () => environment.describe(),
    async openSession(request, signal) {
      const opened = await environment.openSession(request, signal);
      if (opened.outcome === "failed") return opened;
      const session = opened.session;
      return {
        outcome: "opened",
        session: {
          sessionId: session.sessionId,
          scope: session.scope,
          capabilities: session.capabilities,
          async invoke(request, signal) {
            invocations.push(request);
            return session.invoke(request, signal);
          },
          close: () => session.close(),
        },
      };
    },
  };
}

function modules({ model = fixtureModel(), planner = createSingleStepResponsePlanner(), safety, context: contextOverride, environment: environmentOverride, invocations = [], maxModelCalls = 2 } = {}) {
  const baselineContext = createContextAssembler({ maxMessages: 100, maxSourceBytes: 16_000, minAvailableInputTokens: 1 }, {
    tokenCounter: { count: (messages) => ({ value: messages.reduce((total, message) => total + JSON.stringify(message).length, 0), basis: "test-json-bytes", quality: "estimated" }) },
  });
  const context = contextOverride ?? baselineContext;
  return {
    invocations,
    model,
    selected: {
      input: createTextInputNormalizer({ maxTextBytes: 16_000, maxAttachments: 0 }),
      context,
      planning: planner,
      control: createSingleTurnControl({ maxModelCalls, maxToolCalls: 1 }),
      model,
      createOutputActions: (sink) => createTextOutputActions({}, { sink }),
      createToolUse: (executor) => createCalculatorAddToolUse({ maxArgumentBytes: 1_024, maxResultBytes: 4_096, timeoutMs: 2_000 }, executor),
      safety: safety ?? createAllowlistSafetyModule({ defaultDecision: "deny", maxCheckpointBytes: 16_384, allowedToolCapabilities: [CALCULATOR_CAPABILITY], allowedOutputActionKinds: ["text-response"], allowedMemoryWriteKinds: ["episode"] }),
      environment: environmentOverride ?? testEnvironment(invocations),
    },
  };
}

async function run(selected, { signal = new AbortController().signal, observability, outputSink } = {}) {
  const runId = randomUUID();
  const turnId = randomUUID();
  const memory = createInMemorySession({ ownerId: "kernel-test", sessionId: createSessionId(randomUUID()) }, { maxRecords: 10, maxContentBytes: 2_000, maxRecallResults: 5 });
  try {
    return await runTextTurn({
      scope: { runId: createRunId(runId), sessionId: memory.scope.sessionId, turnId: createTurnId(turnId) },
      text: task,
      source: { sourceId: `input:${turnId}`, kind: "user", trust: "untrusted", receivedAt: "2026-09-25T10:00:00.000Z" },
      memory,
      priorTurns: [],
      rememberUserMessage: false,
      outputSink: outputSink ?? { async deliver({ proposal }) { return { actionId: proposal.actionId, status: "committed", receipt: { captured: true } }; } },
      ...(observability ? { observability } : {}),
      signal,
      idempotencyKey: `test:${runId}`,
    }, selected);
  } finally {
    await memory.close();
  }
}

test("kernel keeps the structured tool exchange, Safety decision, receipt, and both model requests", async () => {
  const harness = modules();
  const result = await run(harness.selected);
  assert.equal(result.finalText, "19 + 23 = 42.");
  assert.equal(result.planning.proposal.steps[0].kind, "respond");
  assert.equal(result.planning.input.context.some((message) => message.content.includes(task)), true);
  assert.equal(result.modelRequests.length, 2);
  assert.equal(result.contextRequests.length, 2);
  assert.equal(harness.invocations.length, 1);
  assert.equal(harness.invocations[0].operation, "add");
  assert.deepEqual(harness.invocations[0].input, { left: 19, right: 23 });
  const secondMessages = harness.model.requests[1].messages;
  assert.deepEqual(secondMessages.map((message) => message.role), ["system", "user", "user", "assistant", "tool"]);
  assert.equal(secondMessages[1].content.includes(task), true);
  assert.match(secondMessages[2].content, /Advisory Planning proposal/);
  assert.match(harness.model.requests[0].messages[2].content, /single-step-response-planner/);
  const assistant = secondMessages.find((message) => message.role === "assistant");
  const tool = secondMessages.find((message) => message.role === "tool");
  assert.equal(assistant.toolCalls[0].callId, tool.toolCallId);
  assert.equal(assistant.toolCalls[0].name, tool.name);
  assert.deepEqual(JSON.parse(tool.content), { sum: 42 });
  assert.equal(result.runEvidence.find((entry) => entry.kind === "safety-evaluation").result.decision.decision, "allow");
  assert.equal(result.runEvidence.find((entry) => entry.kind === "output-action-receipt").receipt.status, "committed");
  assert.equal(result.runEvidence.find((entry) => entry.kind === "environment-session-close").receipt.outcome, "closed");
});

test("a contract-conforming Context replacement runs without changing other modules", async () => {
  const baselineContext = createContextAssembler({ maxMessages: 100, maxSourceBytes: 16_000, minAvailableInputTokens: 1 }, {
    tokenCounter: { count: (messages) => ({ value: messages.length, basis: "test-count", quality: "exact" }) },
  });
  let calls = 0;
  const replacement = {
    identity: { id: "test-context-replacement", version: "1.0.0" },
    async assemble(input, signal) {
      calls += 1;
      return baselineContext.assemble(input, signal);
    },
  };
  const harness = modules({ context: replacement });
  const result = await run(harness.selected);
  assert.equal(calls, result.modelRequests.length + 1);
  assert.equal(result.moduleIdentities.context.id, "test-context-replacement");
  assert.equal(result.moduleIdentities.control.id, "bounded-single-turn-control");
  assert.equal(result.modelRequests.length, 2);
  assert.equal(harness.invocations.length, 1);
});

test("kernel assigns ordered module-sourced events and flushes recorder evidence", async () => {
  const observed = [];
  const recorder = {
    identity: { id: "test-jsonl-recorder", version: "1.0.0" },
    async append(input) {
      observed.push(input);
      return { status: "accepted", eventId: input.event.eventId, sequence: input.event.sequence, persistence: "buffered" };
    },
    async flush() {
      return { status: "durable", durableThroughSequence: observed.at(-1)?.event.sequence ?? null, pendingEvents: 0 };
    },
  };
  const harness = modules();
  const result = await run(harness.selected, { observability: recorder });
  assert.equal(result.observability.status, "durable");
  assert.ok(observed.at(-1).event.kind === "run.completed");
  assert.ok(observed.every((item, index) => item.event.sequence === index));
  assert.ok(observed.some((item) => item.event.kind === "effect.environment-invocation"
    && item.event.source.id === harness.selected.environment.identity.id));
  assert.ok(observed.some((item) => item.event.kind === "context.assembled"
    && item.event.source.id === "deterministic-context-assembler"));
});

test("recorder uncertainty is surfaced without changing model completion", async () => {
  const recorder = {
    identity: { id: "uncertain-recorder", version: "1.0.0" },
    async append(input) {
      return { status: "uncertain", eventId: input.event.eventId, sequence: input.event.sequence, persistence: "unknown" };
    },
    async flush() {
      return { status: "unknown", durableThroughSequence: null, pendingEvents: 1, failure: { code: "WRITE_UNKNOWN", message: "Acknowledgement lost.", retryable: true } };
    },
  };
  const harness = modules();
  const result = await run(harness.selected, { observability: recorder });
  assert.equal(result.finalText, "19 + 23 = 42.");
  assert.equal(result.observability.status, "unknown");
  assert.equal(result.observability.appendReceipts[0].status, "uncertain");
});

test("rejected or uncertain output delivery is not reported as a completed turn", async (t) => {
  for (const status of ["rejected", "uncertain"]) {
    await t.test(status, async () => {
      const harness = modules();
      const sink = {
        async deliver({ proposal }) {
          return status === "rejected"
            ? { actionId: proposal.actionId, status, reason: "Response capture rejected the proposal." }
            : { actionId: proposal.actionId, status, reason: "The host acknowledgement was lost.", receipt: { dispatch: "unknown" } };
        },
      };
      await assert.rejects(run(harness.selected, { outputSink: sink }), (error) => {
        assert.ok(error instanceof TextTurnExecutionError);
        assert.notEqual(error.evidence.control?.termination, "model-finished");
        assert.equal(error.evidence.runEvidence.find((entry) => entry.kind === "output-action-receipt").receipt.status, status);
        return true;
      });
    });
  }
});

test("kernel asks Planning once using initial model-visible Context and includes its proposal on every model call", async () => {
  const observedInputs = [];
  const planner = {
    identity: { id: "recording-planner", version: "0.1.0" },
    async propose(input) {
      observedInputs.push(input);
      return createSingleStepResponsePlanner().propose(input, new AbortController().signal);
    },
  };
  const harness = modules({ planner });
  const result = await run(harness.selected);

  assert.equal(observedInputs.length, 1);
  assert.equal(observedInputs[0].observations.length, 0);
  assert.ok(observedInputs[0].context.some((message) => message.content.includes(task)));
  assert.deepEqual(result.planning.input, observedInputs[0]);
  assert.equal(harness.model.requests.length, 2);
  for (const request of harness.model.requests) {
    const planningMessage = request.messages.find((message) => message.role === "user" && message.content.includes("Advisory Planning proposal"));
    assert.ok(planningMessage);
    assert.match(planningMessage.content, /advisory/i);
    assert.match(planningMessage.content, /recording-planner/);
  }
  for (const context of result.contextRequests) {
    assert.equal(context.sourceLedger.find((item) => item.sourceId === "studio-planning-proposal").disposition.status, "included");
  }
});

test("malformed Planning output fails before Model or tool side effects and is preserved as partial evidence", async () => {
  const planner = {
    identity: { id: "malformed-planner", version: "0.1.0" },
    async propose(input) {
      return {
        planId: "bad-plan",
        summary: "Invalid plan",
        steps: [{ stepId: "duplicate", kind: "respond", description: "First." }, { stepId: "duplicate", kind: "tool", description: "Second." }],
        completionCondition: "Stop.",
        assumptions: [],
        evidence: { sourceIdsConsidered: input.context.flatMap((message) => message.sourceIds) },
      };
    },
  };
  const harness = modules({ planner });
  await assert.rejects(run(harness.selected), (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.match(error.message, /malformed or oversized step/);
    assert.equal(error.evidence.modelRequests.length, 0);
    assert.equal(error.evidence.planning, undefined);
    return true;
  });
  assert.equal(harness.model.requests.length, 0);
  assert.equal(harness.invocations.length, 0);
});

test("Planning cancellation prevents Model calls", async () => {
  const controller = new AbortController();
  const observed = [];
  const recorder = {
    identity: { id: "cancel-recorder", version: "1.0.0" },
    async append(input) {
      observed.push(input.event);
      return { status: "accepted", eventId: input.event.eventId, sequence: input.event.sequence, persistence: "buffered" };
    },
    async flush() {
      return { status: "durable", durableThroughSequence: observed.at(-1)?.sequence ?? null, pendingEvents: 0 };
    },
  };
  const planner = {
    identity: { id: "blocking-planner", version: "0.1.0" },
    async propose(_input, signal) {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      const error = new Error("planning cancelled");
      error.name = "AbortError";
      throw error;
    },
  };
  const harness = modules({ planner });
  const pending = run(harness.selected, { signal: controller.signal, observability: recorder });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.equal(error.observability.status, "durable");
    return true;
  });
  assert.equal(observed.at(-1).kind, "run.failed");
  assert.equal(observed.at(-1).payload.status, "cancelled");
  assert.equal(harness.model.requests.length, 0);
  assert.equal(harness.invocations.length, 0);
});

test("environment cleanup failure is retained after the completed tool and output evidence", async () => {
  const environment = testEnvironment([]);
  const failingCleanupEnvironment = {
    identity: environment.identity,
    describe: () => environment.describe(),
    async openSession(request, signal) {
      const opened = await environment.openSession(request, signal);
      if (opened.outcome === "failed") return opened;
      return {
        outcome: "opened",
        session: {
          ...opened.session,
          async close() {
            throw new Error("injected environment cleanup failure");
          },
        },
      };
    },
  };
  const harness = modules({ environment: failingCleanupEnvironment });
  await assert.rejects(run(harness.selected), (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.match(error.message, /injected environment cleanup failure/);
    assert.ok(error.evidence.runEvidence.some((item) => item.kind === "environment-session-close-failed"));
    assert.ok(error.evidence.runEvidence.some((item) => item.kind === "environment-invocation"));
    assert.equal(error.evidence.runEvidence.find((item) => item.kind === "output-action-receipt").receipt.status, "committed");
    return true;
  });
});

test("Safety denial is recorded and prevents environment invocation", async () => {
  const harness = modules({ safety: createAllowlistSafetyModule() });
  await assert.rejects(run(harness.selected), (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.equal(error.evidence.contextRequests.length, 1);
    assert.equal(error.evidence.modelRequests.length, 1);
    assert.equal(error.evidence.runEvidence.find((entry) => entry.kind === "safety-evaluation").result.decision.decision, "deny");
    assert.ok(error.evidence.runEvidence.some((entry) => entry.kind === "environment-session-close"));
    return true;
  });
  assert.equal(harness.invocations.length, 0);
});

test("invalid and unknown calls are rejected by Tool Use before Safety or environment", async (t) => {
  const cases = [
    ["invalid arguments", { ...toolCall, arguments: { left: "19", right: 23 } }, "INVALID_ARGUMENTS"],
    ["unknown name", { ...toolCall, name: "calculator.multiply" }, "UNKNOWN_TOOL"],
  ];
  for (const [name, proposedCall, expectedCode] of cases) {
    await t.test(name, async () => {
      const harness = modules({ model: fixtureModel(proposedCall) });
      await assert.rejects(run(harness.selected), (error) => {
        assert.ok(error instanceof TextTurnExecutionError);
        const validation = error.evidence.runEvidence.find((entry) => entry.kind === "tool-validation");
        assert.equal(validation.result.accepted, false);
        assert.equal(validation.result.code, expectedCode);
        return true;
      });
      assert.equal(harness.invocations.length, 0);
    });
  }
});

test("Safety unavailability fails closed before environment invocation", async () => {
  const safety = {
    identity: { id: "unavailable-safety", version: "0.1.0" },
    async evaluate({ checkpoint }) { return { status: "unavailable", checkpointId: checkpoint.checkpointId, code: "POLICY_OFFLINE", message: "Policy store unavailable." }; },
  };
  const harness = modules({ safety });
  await assert.rejects(run(harness.selected), (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.equal(error.evidence.runEvidence.find((entry) => entry.kind === "safety-evaluation").result.status, "unavailable");
    return true;
  });
  assert.equal(harness.invocations.length, 0);
});

test("model-call limit preserves request evidence and prevents tool execution", async () => {
  const harness = modules({ maxModelCalls: 1 });
  await assert.rejects(run(harness.selected), (error) => {
    assert.ok(error instanceof TextTurnExecutionError);
    assert.equal(error.evidence.modelRequests.length, 1);
    assert.equal(error.evidence.runEvidence.some((entry) => entry.kind === "tool-validation"), false);
    return true;
  });
  assert.equal(harness.invocations.length, 0);
});

test("cancellation during Safety does not invoke the environment", async () => {
  const controller = new AbortController();
  const safety = {
    identity: { id: "cancellable-safety", version: "0.1.0" },
    async evaluate({ checkpoint }, signal) {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return { status: "evaluated", decision: { checkpointId: checkpoint.checkpointId, decisionId: "cancelled-test", decision: "allow", reasonCode: "TEST", explanation: "Test cancellation." } };
    },
  };
  const harness = modules({ safety });
  const pending = run(harness.selected, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error instanceof TextTurnExecutionError);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.invocations.length, 0);
});
