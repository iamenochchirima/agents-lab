import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRunId, createSessionId, createTurnId } from "@agent-harness-lab/agent-protocol";
import { createScopedComputerUse } from "@agent-harness-lab/module-computer-use";
import { createContextAssembler } from "@agent-harness-lab/module-context";
import { createSingleTurnControl } from "@agent-harness-lab/module-control";
import { COMPUTER_FIXTURE_CAPABILITY, createControlledReferenceExecutionEnvironment } from "@agent-harness-lab/module-execution-environment";
import { createTextInputNormalizer } from "@agent-harness-lab/module-input";
import { createInMemorySession } from "@agent-harness-lab/module-memory";
import { createJsonlObservability } from "@agent-harness-lab/module-observability";
import { createTextOutputActions } from "@agent-harness-lab/module-output-actions";
import { createSingleStepResponsePlanner } from "@agent-harness-lab/module-planning";
import { createAllowlistSafetyModule } from "@agent-harness-lab/module-safety";
import { createComputerClickRegistration, createCalculatorAddRegistration, createToolUseModule } from "@agent-harness-lab/module-tool-use";
import { COMPUTER_SCENARIO_TASK, createReferenceModelInterface } from "@agent-harness-lab/module-model-interface";
import { TextTurnExecutionError, runTextTurn } from "../dist/index.js";

async function runComputer({ denyComputer = false, loseClickAcknowledgement = false } = {}) {
  const invocations = [];
  const baseEnvironment = createControlledReferenceExecutionEnvironment({
    operationTimeoutMs: 1_000,
    allowedCapabilities: [{ id: "calculator", version: "1.0.0", kind: "pure", operations: ["add"] }, COMPUTER_FIXTURE_CAPABILITY],
  });
  const environment = {
    identity: baseEnvironment.identity,
    describe: () => baseEnvironment.describe(),
    async openSession(request, signal) {
      const opened = await baseEnvironment.openSession(request, signal);
      if (opened.outcome === "failed") return opened;
      const session = opened.session;
      return {
        outcome: "opened",
        session: {
          sessionId: session.sessionId,
          scope: session.scope,
          capabilities: session.capabilities,
          async invoke(invocation, invocationSignal) {
            invocations.push(invocation);
            if (loseClickAcknowledgement && invocation.operation === "click") {
              return {
                outcome: "uncertain",
                operationId: invocation.operationId,
                failure: { code: "FIXTURE_ACK_LOST", message: "The controlled click acknowledgement was lost.", retryable: false },
              };
            }
            return session.invoke(invocation, invocationSignal);
          },
          close: () => session.close(),
        },
      };
    },
  };
  const memory = createInMemorySession({ ownerId: "computer-kernel-test", sessionId: createSessionId(randomUUID()) }, {
    maxRecords: 10,
    maxContentBytes: 2_000,
    maxRecallResults: 5,
  });
  const recorderRoot = await mkdtemp(join(tmpdir(), `studio-computer-kernel-${randomUUID()}-`));
  const runId = randomUUID();
  const runScope = { runId: createRunId(runId), sessionId: memory.scope.sessionId, turnId: createTurnId(randomUUID()) };
  const context = createContextAssembler({ maxMessages: 100, maxSourceBytes: 16_000, minAvailableInputTokens: 1 }, {
    tokenCounter: { count: (messages) => ({ value: messages.length, basis: "test-count", quality: "exact" }) },
  });
  const outputSink = { async deliver({ proposal }) { return { actionId: proposal.actionId, status: "committed", receipt: { accepted: true } }; } };
  const toolUseConfig = { maxArgumentBytes: 1_024, maxResultBytes: 4_096, timeoutMs: 1_000 };
  const modules = {
    input: createTextInputNormalizer({ maxTextBytes: 16_000, maxAttachments: 0 }),
    context,
    planning: createSingleStepResponsePlanner(),
    control: createSingleTurnControl({ maxModelCalls: 2, maxToolCalls: 1 }),
    model: createReferenceModelInterface({ maxOutputTokens: 512, maxAttempts: 1, requestTimeoutMs: 1_000 }),
    createOutputActions: (sink) => createTextOutputActions({}, { sink }),
    createComputerUse: (environmentCapability) => createScopedComputerUse({}, {
      environment: environmentCapability,
      verify: ({ before, after }) => {
        const changed = after !== null && JSON.stringify(before.content) !== JSON.stringify(after.content);
        return { status: changed ? "verified" : "not-verified", evidence: changed ? "Fixture state changed." : "Fixture state did not change." };
      },
    }),
    createToolUse: (executor) => createToolUseModule(toolUseConfig, {
      registrations: [createCalculatorAddRegistration(), createComputerClickRegistration()],
      executor,
    }),
    safety: createAllowlistSafetyModule({
      defaultDecision: "deny",
      maxCheckpointBytes: 16_384,
      allowedToolCapabilities: [{ id: "calculator", version: "1.0.0", kind: "pure", operations: ["add"] }],
      allowedEnvironmentCapabilities: denyComputer ? [] : [COMPUTER_FIXTURE_CAPABILITY],
      allowedOutputActionKinds: ["text-response"],
      allowedMemoryWriteKinds: ["episode"],
    }),
    environment,
  };

  try {
    const observability = createJsonlObservability({ maxBufferedBytes: 1_000_000, maxEventBytes: 256_000, maxStoredBytes: 1_000_000 }, { rootDirectory: recorderRoot, scope: runScope });
    const result = await runTextTurn({
      scope: runScope,
      text: COMPUTER_SCENARIO_TASK,
      source: { sourceId: `input:${runScope.turnId}`, kind: "user", trust: "untrusted", receivedAt: new Date().toISOString() },
      memory,
      priorTurns: [],
      rememberUserMessage: false,
      outputSink,
      observability,
      signal: new AbortController().signal,
      idempotencyKey: `computer:${runId}`,
    }, modules);
    return { result, invocations, recorderRoot, runId };
  } catch (error) {
    return { error, invocations, recorderRoot, runId };
  } finally {
    await memory.close();
  }
}

test("computer tool action passes Safety, Computer Use, and the scoped Environment", async () => {
  const outcome = await runComputer();
  const { result, invocations } = outcome;
  try {
  assert.equal(result.finalText, "I clicked the Say hello button; the page now says hello.");
  assert.equal(result.control.toolCalls, 1);
  const action = result.runEvidence.find((entry) => entry.kind === "computer-action");
  assert.equal(action.result.receipt.status, "completed");
  assert.equal(action.result.verification.status, "verified");
  assert.deepEqual(invocations.map((item) => item.operation), ["observe", "click", "observe"]);
  assert.equal(result.observability.status, "durable");
  } finally {
    await rm(outcome.recorderRoot, { recursive: true, force: true });
  }
});

test("computer Safety denial is retained and stops before Environment invocation", async () => {
  const outcome = await runComputer({ denyComputer: true });
  const { error, invocations } = outcome;
  try {
  assert.ok(error instanceof TextTurnExecutionError);
  assert.equal(error.evidence.runEvidence.find((entry) => entry.kind === "safety-evaluation").result.decision.decision, "deny");
  assert.equal(invocations.length, 0);
  assert.equal(error.observability.status, "durable");
  } finally {
    await rm(outcome.recorderRoot, { recursive: true, force: true });
  }
});

test("uncertain click acknowledgement remains unknown and is persisted", async () => {
  const outcome = await runComputer({ loseClickAcknowledgement: true });
  const { error, invocations } = outcome;
  try {
  assert.ok(error instanceof TextTurnExecutionError);
  assert.equal(invocations.map((item) => item.operation).join(","), "observe,click,observe");
  const action = error.evidence.runEvidence.find((entry) => entry.kind === "computer-action");
  assert.equal(action.result.receipt.status, "unknown");
  assert.equal(error.observability.status, "durable");
  } finally {
    await rm(outcome.recorderRoot, { recursive: true, force: true });
  }
});
