import assert from "node:assert/strict";
import test from "node:test";

import { calculatorTool, ToolRegistrationError, ToolRegistry } from "../../src/capabilities/tools/index.js";

function registry(): ToolRegistry {
  const value = new ToolRegistry({ enabledNames: ["calculator"] });
  value.register(calculatorTool);
  return value;
}

function call(argumentsValue: Record<string, unknown>, name = "calculator", toolCallId = "call-1", round = 1) {
  return { toolCallId, name, arguments: argumentsValue, round } as const;
}

test("the registry exposes only explicitly enabled tools and allows pure calculator calls", () => {
  const value = registry();

  assert.deepEqual(value.definitions().map((definition) => definition.name), ["calculator"]);
  assert.deepEqual(value.authorize(call({ operation: "add", left: 2, right: 3 })), {
    allowed: true,
    code: "TOOL_ALLOWED",
    message: "Tool is enabled for this run.",
  });
  assert.equal(value.authorize(call({}, "shell")).allowed, false);
});

test("the registry denies enabled tools whose risk class is not allowed by this slice", () => {
  const value = new ToolRegistry({ enabledNames: ["write-tool"] });
  value.register({
    ...calculatorTool,
    definition: {
      ...calculatorTool.definition,
      name: "write-tool",
      riskClass: "write",
    },
  });

  assert.deepEqual(value.authorize(call({}, "write-tool")), {
    allowed: false,
    code: "TOOL_RISK_NOT_ALLOWED",
    message: "Tool risk class is not allowed in this slice: write-tool",
  });
});

test("the registry rejects duplicate configuration and invalid registrations", () => {
  assert.throws(() => new ToolRegistry({ enabledNames: ["calculator", "calculator"] }), ToolRegistrationError);
  const value = new ToolRegistry({ enabledNames: ["custom"] });
  assert.throws(() => value.register({
    ...calculatorTool,
    definition: { ...calculatorTool.definition, name: "custom", schemaVersion: 2 as unknown as 1 },
  }), ToolRegistrationError);
  assert.throws(() => value.register({
    ...calculatorTool,
    definition: { ...calculatorTool.definition, name: "custom", inputSchema: [] as unknown as Record<string, unknown> },
  }), ToolRegistrationError);
});

test("calculator validation normalizes valid input and rejects unsafe input before execution", () => {
  const value = registry();
  const valid = value.validateCall(call({ operation: "add", left: 2, right: 3 }));
  assert.equal(valid.accepted, true);
  if (valid.accepted) assert.deepEqual(valid.call.arguments, { operation: "add", left: 2, right: 3 });

  for (const invalid of [
    { operation: "power", left: 2, right: 3 },
    { operation: "divide", left: 2, right: 0 },
    { operation: "add", left: Number.NaN, right: 3 },
    { operation: "add", left: 2, right: 3, ignored: true },
  ]) {
    const result = value.validateCall(call(invalid));
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.code, "INVALID_ARGUMENTS");
  }

  const oversized = value.validateCall(call({ operation: "add", left: "x".repeat(600), right: 3 }));
  assert.equal(oversized.accepted, false);
  if (!oversized.accepted) assert.equal(oversized.code, "ARGUMENTS_TOO_LARGE");
});

test("unknown tools, duplicate-looking IDs, and invalid rounds are rejected", () => {
  const value = registry();

  const unknown = value.validateCall(call({}, "unknown-tool"));
  const badId = value.validateCall(call({}, "calculator", "bad id"));
  const badRound = value.validateCall(call({}, "calculator", "call-1", 0));
  assert.equal(unknown.accepted, false);
  assert.equal(badId.accepted, false);
  assert.equal(badRound.accepted, false);
  if (!unknown.accepted) assert.equal(unknown.code, "UNKNOWN_TOOL");
  if (!badId.accepted) assert.equal(badId.code, "INVALID_CALL_ID");
  if (!badRound.accepted) assert.equal(badRound.code, "INVALID_ROUND");
});

test("calculator execution returns a bounded serializable result", async () => {
  const value = registry();
  const validation = value.validateCall(call({ operation: "multiply", left: 6, right: 7 }));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const result = await value.execute(validation, {
    runId: "run-1",
    turnId: "turn-1",
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, {
    status: "completed",
    content: JSON.stringify({ value: 42 }),
    error: null,
    durationMs: result.durationMs,
    attemptCount: 1,
  });
  assert.ok(result.durationMs >= 0);
});

test("tool execution rejects an oversized result at the execution boundary", async () => {
  const value = new ToolRegistry({ enabledNames: ["large-output"] });
  value.register({
    ...calculatorTool,
    definition: {
      ...calculatorTool.definition,
      name: "large-output",
      limits: { ...calculatorTool.definition.limits, maxResultBytes: 4 },
    },
    execute: async () => "12345",
  });
  const validation = value.validateCall(call({ operation: "add", left: 1, right: 1 }, "large-output", "call-large-output-1"));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const result = await value.execute(validation, {
    runId: "run-1",
    turnId: "turn-1",
    signal: new AbortController().signal,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_RESULT_TOO_LARGE");
});

test("tool execution reports a timeout as a classified result", async () => {
  const delayed = {
    definition: { ...calculatorTool.definition, name: "delayed", limits: { maxArgumentBytes: 64, maxResultBytes: 64, timeoutMs: 5 } },
    validateArguments: () => ({}),
    execute: async (_argumentsValue: Readonly<Record<string, unknown>>, context: { readonly signal: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        context.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
      return "done";
    },
  };
  const value = new ToolRegistry({ enabledNames: ["delayed"] });
  value.register(delayed);
  const validation = value.validateCall(call({}, "delayed", "call-delayed-1"));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const result = await value.execute(validation, {
    runId: "run-1",
    turnId: "turn-1",
    signal: new AbortController().signal,
  });
  assert.equal(result.status, "timed_out");
  assert.equal(result.error?.code, "TOOL_TIMEOUT");
});

test("tool execution distinguishes cancellation before start from a deadline", async () => {
  const value = registry();
  const validation = value.validateCall(call({ operation: "add", left: 1, right: 1 }, "calculator", "call-cancelled-1"));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const controller = new AbortController();
  controller.abort();
  const result = await value.execute(validation, {
    runId: "run-1",
    turnId: "turn-1",
    signal: controller.signal,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "TOOL_CANCELLED");
});

test("tool execution propagates an active cancellation signal", async () => {
  const value = new ToolRegistry({ enabledNames: ["cancellable"] });
  value.register({
    ...calculatorTool,
    definition: {
      ...calculatorTool.definition,
      name: "cancellable",
      limits: { ...calculatorTool.definition.limits, timeoutMs: 100 },
    },
    execute: async (_argumentsValue, context) => await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve("late"), 1_000);
      context.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
  });
  const validation = value.validateCall(call({ operation: "add", left: 1, right: 1 }, "cancellable", "call-cancellable-1"));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const controller = new AbortController();
  const execution = value.execute(validation, { runId: "run-1", turnId: "turn-1", signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  const result = await execution;
  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "TOOL_CANCELLED");
});

test("tool execution bounds implementation error text before returning it", async () => {
  const value = new ToolRegistry({ enabledNames: ["error-tool"] });
  value.register({
    ...calculatorTool,
    definition: { ...calculatorTool.definition, name: "error-tool" },
    execute: async () => { throw new Error("x".repeat(10_000)); },
  });
  const validation = value.validateCall(call({ operation: "add", left: 1, right: 1 }, "error-tool", "call-error-tool-1"));
  assert.equal(validation.accepted, true);
  if (!validation.accepted) return;

  const result = await value.execute(validation, {
    runId: "run-1",
    turnId: "turn-1",
    signal: new AbortController().signal,
  });
  assert.equal(result.status, "failed");
  assert.ok(Buffer.byteLength(result.error?.message ?? "", "utf8") <= 512);
  assert.ok(Buffer.byteLength(result.content, "utf8") <= 512);
});
