import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextAssemblyError,
  createContextAssembler,
  parseContextConfig,
} from "../dist/index.js";

const signal = () => new AbortController().signal;
const utf8Bytes = (text) => new TextEncoder().encode(text).byteLength;
const exactByteCounter = {
  count(messages) {
    return {
      value: messages.reduce((total, message) => total + utf8Bytes(message.content), 0),
      basis: "utf8-bytes-v1",
      quality: "exact",
    };
  },
};

function material(sourceId, kind, role, content, sequence = 0, trust = "untrusted", provenance = { sourceKind: `${kind}-fixture` }) {
  return { sourceId, kind, role, content, sequence, trust, provenance };
}

function input(overrides = {}) {
  return {
    scope: { runId: "run-context-test" },
    instructions: [],
    task: material("input-1", "task", "user", "Summarize the report.", 0, "untrusted", { sourceKind: "user-request", receivedAt: "2026-09-25T09:00:00Z" }),
    turns: [],
    memoryCandidates: [],
    toolExchanges: [],
    budget: { contextWindowTokens: 20_000, reservedOutputTokens: 2_000, safetyMarginTokens: 500, tokenizer: "utf8-bytes-v1" },
    ...overrides,
  };
}

function expectedEnvelope(value) {
  const provenance = Object.fromEntries(Object.entries(value.provenance).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify({ kind: value.kind, sourceId: value.sourceId, trust: value.trust, provenance, content: value.content });
}

test("deterministic assembler orders and labels sources and records selection evidence", async () => {
  const instructions = [
    material("policy-z", "instruction", "developer", "Second instruction.", 2, "trusted"),
    material("policy-a", "instruction", "system", "First instruction.", 1, "trusted"),
    material("policy-b", "instruction", "system", "Also first.", 1, "trusted"),
  ];
  const memoryA = material("memory-a", "memory", "user", "The preferred format is a short report.", 1, "untrusted", {
    sourceId: "input-origin-a", sourceKind: "user-message", trust: "untrusted", observedAt: "2026-09-24T09:00:00Z",
  });
  const memoryZ = material("memory-z", "memory", "user", "The report should include a summary.", 1, "trusted", {
    sourceId: "service-origin-z", sourceKind: "service", trust: "trusted",
  });
  const oversized = material("memory-oversized", "memory", "user", "x".repeat(129), 2, "untrusted");
  const task = input().task;
  const baseMessages = [
    ...instructions.slice(1).sort((left, right) => left.sourceId.localeCompare(right.sourceId)).map(({ role, content }) => ({ role, content })),
    { role: "developer", content: instructions[0].content },
    { role: "user", content: expectedEnvelope(task) },
  ];
  const oneCandidateBudget = baseMessages.reduce((total, message) => total + utf8Bytes(message.content), 0)
    + utf8Bytes(expectedEnvelope(memoryA));
  const context = createContextAssembler(parseContextConfig({ maxSourceBytes: 128 }), { tokenCounter: exactByteCounter });
  const request = input({
    instructions,
    task,
    memoryCandidates: [memoryZ, oversized, memoryA],
    budget: { contextWindowTokens: oneCandidateBudget, reservedOutputTokens: 0, safetyMarginTokens: 0, tokenizer: "utf8-bytes-v1" },
  });

  const first = await context.assemble(request, signal());
  const second = await context.assemble(request, signal());
  assert.deepEqual(first, second);
  assert.deepEqual(first.messages.map((message) => message.sourceIds[0]), ["policy-a", "policy-b", "policy-z", "memory-a", "input-1"]);
  assert.deepEqual(first.messages.map((message) => message.role), ["system", "system", "developer", "user", "user"]);
  assert.deepEqual(first.includedSourceIds, ["policy-a", "policy-b", "policy-z", "memory-a", "input-1"]);
  assert.deepEqual(first.omissions, [
    { sourceId: "memory-z", reason: "budget" },
    { sourceId: "memory-oversized", reason: "invalid-source" },
  ]);
  assert.deepEqual(JSON.parse(first.messages[3].content), JSON.parse(expectedEnvelope(memoryA)));
  assert.deepEqual(JSON.parse(first.messages[4].content), JSON.parse(expectedEnvelope(task)));
  assert.equal(first.sourceLedger.find((entry) => entry.sourceId === "input-1").trust, "untrusted");
  assert.deepEqual(first.sourceLedger.find((entry) => entry.sourceId === "input-1").provenance, task.provenance);
  assert.equal(first.tokenCount.basis, "utf8-bytes-v1");
  assert.equal(first.tokenCount.quality, "exact");
});

test("maxMessages and the token budget omit optional Memory but fail when required material cannot fit", async () => {
  const memory = material("memory-1", "memory", "user", "A memory note.", 1);
  const task = input().task;
  const requiredBytes = utf8Bytes(expectedEnvelope(task));
  const request = input({
    memoryCandidates: [memory],
    budget: { contextWindowTokens: requiredBytes, reservedOutputTokens: 0, safetyMarginTokens: 0, tokenizer: "utf8-bytes-v1" },
  });
  const fittingContext = createContextAssembler(parseContextConfig(), { tokenCounter: exactByteCounter });
  const result = await fittingContext.assemble(request, signal());
  assert.deepEqual(result.omissions, [{ sourceId: "memory-1", reason: "budget" }]);

  const messageLimited = createContextAssembler(parseContextConfig({ maxMessages: 1 }), { tokenCounter: exactByteCounter });
  assert.deepEqual((await messageLimited.assemble(request, signal())).omissions, [{ sourceId: "memory-1", reason: "budget" }]);
  await assert.rejects(
    fittingContext.assemble(input({
      instructions: [material("policy-1", "instruction", "system", "Must fit.", 0, "trusted")],
      budget: { contextWindowTokens: requiredBytes, reservedOutputTokens: 0, safetyMarginTokens: 0, tokenizer: "utf8-bytes-v1" },
    }), signal()),
    { code: "BUDGET_EXHAUSTED" },
  );
  await assert.rejects(
    messageLimited.assemble(input({ instructions: [material("policy-1", "instruction", "system", "Must fit.", 0, "trusted")] }), signal()),
    { code: "BUDGET_EXHAUSTED" },
  );
});

test("Planning proposals stay untrusted user data after the task and must fit the required context", async () => {
  const context = createContextAssembler(parseContextConfig(), { tokenCounter: exactByteCounter });
  const proposal = material("planning-1", "planning", "user", "Advisory plan: inspect the report.", 0, "untrusted", {
    sourceKind: "planning-module", moduleId: "planner-fixture", moduleVersion: "0.1.0", trust: "untrusted",
  });
  const result = await context.assemble(input({ planningProposal: proposal }), signal());

  assert.deepEqual(result.messages.map((message) => message.role), ["user", "user"]);
  assert.deepEqual(result.messages.map((message) => message.sourceIds), [["input-1"], ["planning-1"]]);
  assert.deepEqual(JSON.parse(result.messages[1].content), JSON.parse(expectedEnvelope(proposal)));
  assert.deepEqual(result.includedSourceIds, ["input-1", "planning-1"]);
  assert.deepEqual(result.sourceLedger.find((entry) => entry.sourceId === "planning-1"), {
    sourceId: "planning-1",
    kind: "planning",
    role: "user",
    trust: "untrusted",
    provenance: proposal.provenance,
    disposition: { status: "included" },
  });

  const tooFewMessages = createContextAssembler(parseContextConfig({ maxMessages: 1 }), { tokenCounter: exactByteCounter });
  await assert.rejects(tooFewMessages.assemble(input({ planningProposal: proposal }), signal()), { code: "BUDGET_EXHAUSTED" });
  await assert.rejects(context.assemble(input({ planningProposal: { ...proposal, trust: "trusted" } }), signal()), { code: "INVALID_CONTEXT_INPUT" });
});

test("UTF-8 source limit rejects required text and records oversized Memory as invalid-source", async () => {
  const context = createContextAssembler(parseContextConfig({ maxSourceBytes: 4 }), { tokenCounter: exactByteCounter });
  const oversizedMemory = material("memory-wide", "memory", "user", "ééé", 1);
  const result = await context.assemble(input({
    task: material("input-1", "task", "user", "ok"),
    memoryCandidates: [oversizedMemory],
  }), signal());
  assert.deepEqual(result.omissions, [{ sourceId: "memory-wide", reason: "invalid-source" }]);
  await assert.rejects(
    context.assemble(input({ task: material("input-wide", "task", "user", "ééé") }), signal()),
    { code: "INVALID_CONTEXT_INPUT" },
  );
});

test("unknown, invalid, or throwing token counters return the typed unavailable error", async (t) => {
  const invalidCounters = [
    { count: () => ({ value: null, basis: "unknown", quality: "unknown" }) },
    { count: () => ({ value: Number.NaN, basis: "fake", quality: "exact" }) },
    { count: () => ({ value: 10, basis: " ", quality: "exact" }) },
    { count: () => { throw new Error("tokenizer missing"); } },
  ];
  for (const [index, tokenCounter] of invalidCounters.entries()) {
    await t.test(`counter ${index + 1}`, async () => {
      const context = createContextAssembler(parseContextConfig(), { tokenCounter });
      await assert.rejects(context.assemble(input(), signal()), (error) => {
        assert.ok(error instanceof ContextAssemblyError);
        assert.equal(error.code, "TOKEN_COUNT_UNAVAILABLE");
        return true;
      });
    });
  }
});

test("invalid source IDs, duplicates, provenance, trust, and role combinations are rejected", async (t) => {
  const context = createContextAssembler(parseContextConfig(), { tokenCounter: exactByteCounter });
  const cases = [
    ["empty source", input({ task: material(" ", "task", "user", "Text") })],
    ["duplicate source", input({ memoryCandidates: [material("input-1", "memory", "user", "Duplicate.", 1)] })],
    ["untrusted instruction", input({ instructions: [material("policy-1", "instruction", "system", "No.", 0, "untrusted")] })],
    ["instruction in user role", input({ instructions: [material("policy-1", "instruction", "user", "No.", 0, "trusted")] })],
    ["task in developer role", input({ task: material("input-1", "task", "developer", "No.") })],
    ["memory in system role", input({ memoryCandidates: [material("memory-1", "memory", "system", "No.", 1)] })],
    ["trust mismatch", input({ memoryCandidates: [material("memory-1", "memory", "user", "No.", 1, "trusted", { trust: "untrusted" })] })],
    ["malformed provenance", input({ task: { ...input().task, provenance: null } })],
    ["turn with unsupported tool role", input({ turns: [material("turn-1", "turn", "tool", "Earlier.")] })],
    ["unmatched tool result", input({ toolExchanges: [{
      assistant: { ...material("assistant-call-1", "turn", "assistant", "", 1), toolCalls: [{ callId: "call-1", name: "calculator.add", arguments: { left: 2, right: 3 } }] },
      results: [{ ...material("tool-result-1", "tool-result", "tool", "5", 2), name: "calculator.add", toolCallId: "unknown-call" }],
    }] })],
  ];
  for (const [name, request] of cases) {
    await t.test(name, async () => {
      await assert.rejects(context.assemble(request, signal()), (error) => {
        assert.ok(error instanceof ContextAssemblyError);
        assert.ok(["INVALID_CONTEXT_INPUT", "UNSUPPORTED_CONTEXT_MATERIAL"].includes(error.code));
        return true;
      });
    });
  }
});

test("structured tool exchanges preserve the assistant call and correlated result as separate model messages", async () => {
  const context = createContextAssembler(parseContextConfig(), { tokenCounter: exactByteCounter });
  const exchange = {
    assistant: {
      ...material("assistant-call-1", "turn", "assistant", "", 1, "untrusted", { sourceKind: "model-response", callId: "call-1" }),
      toolCalls: [{ callId: "call-1", name: "calculator.add", arguments: { left: 19, right: 23 } }],
    },
    results: [{
      ...material("tool-result-1", "tool-result", "tool", "{\"sum\":42}", 2, "untrusted", { sourceKind: "execution-environment", operationId: "call-1" }),
      name: "calculator.add",
      toolCallId: "call-1",
    }],
  };
  const result = await context.assemble(input({ toolExchanges: [exchange] }), signal());
  const assistantMessage = result.messages.find((message) => message.role === "assistant");
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.deepEqual(assistantMessage, {
    role: "assistant",
    content: null,
    toolCalls: [{ callId: "call-1", name: "calculator.add", arguments: { left: 19, right: 23 } }],
    sourceIds: ["assistant-call-1"],
  });
  assert.deepEqual(toolMessage, {
    role: "tool",
    content: "{\"sum\":42}",
    name: "calculator.add",
    toolCallId: "call-1",
    sourceIds: ["tool-result-1"],
  });
  assert.deepEqual(result.messages.map((message) => message.role), ["user", "assistant", "tool"]);
  assert.deepEqual(result.includedSourceIds, ["input-1", "assistant-call-1", "tool-result-1"]);
  assert.equal(result.sourceLedger.find((entry) => entry.sourceId === "assistant-call-1").disposition.status, "included");
  assert.equal(result.sourceLedger.find((entry) => entry.sourceId === "tool-result-1").disposition.status, "included");
});

test("cancellation before work or during counting returns no partial result", async () => {
  const ordinary = createContextAssembler(parseContextConfig(), { tokenCounter: exactByteCounter });
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(ordinary.assemble(input(), alreadyCancelled.signal), { name: "AbortError" });

  const duringCount = new AbortController();
  const cancellingCounter = {
    count(messages) {
      duringCount.abort();
      return { value: messages.length, basis: "messages-v1", quality: "estimated" };
    },
  };
  const cancelledAssembler = createContextAssembler(parseContextConfig(), { tokenCounter: cancellingCounter });
  await assert.rejects(cancelledAssembler.assemble(input(), duringCount.signal), { name: "AbortError" });

  const cancelledWhileOverBudget = new AbortController();
  const abortingOverBudgetCounter = {
    count() {
      cancelledWhileOverBudget.abort();
      return { value: 100, basis: "messages-v1", quality: "estimated" };
    },
  };
  const overBudgetAssembler = createContextAssembler(parseContextConfig(), { tokenCounter: abortingOverBudgetCounter });
  await assert.rejects(overBudgetAssembler.assemble(input({
    budget: { contextWindowTokens: 1, reservedOutputTokens: 0, safetyMarginTokens: 0, tokenizer: "messages-v1" },
  }), cancelledWhileOverBudget.signal), { name: "AbortError" });
});
