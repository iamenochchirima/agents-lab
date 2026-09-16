import assert from "node:assert/strict";
import test from "node:test";

import { baselineWorkflow } from "../../../src/platforms/restate/variants/baseline/workflow.js";
import type { RestateWorkflowInput, RestateWorkflowResult } from "../../../src/platforms/restate/variants/baseline/contracts.js";

const workflowRun = (baselineWorkflow as unknown as {
  readonly workflow: {
    readonly run: (context: unknown, input: RestateWorkflowInput) => Promise<RestateWorkflowResult>;
  };
}).workflow.run;

test("the in-process workflow seam completes text-only runs without tool activity", async () => {
  const result = await runWorkflow("fake-success");

  assert.equal(result.status, "completed");
  assert.equal(result.output, "Fake response: calculate twenty plus twenty-two.");
  assert.equal(result.metrics.modelCallCount, 1);
  assert.equal(result.metrics.toolCallCount, 0);
  assert.equal(result.eventIntents.some((event) => event.kind.startsWith("Tool")), false);
});

test("the workflow executes a calculator call durably before requesting the final answer", async () => {
  const executionNames: string[] = [];
  const result = await runWorkflow("fake-tool-call", { executionNames });

  assert.equal(result.status, "completed");
  assert.equal(result.output, 'The calculator returned {"value":42}.');
  assert.equal(result.metrics.modelCallCount, 2);
  assert.equal(result.metrics.toolCallCount, 1);
  assert.equal(result.metrics.toolAttemptCount, 1);
  assert.equal(JSON.stringify(result.eventIntents).includes('"left":20'), false);
  assert.equal(result.eventIntents.find((event) => event.kind === "ContextUsageObserved")?.payload.quality, "exact");
  assert.deepEqual(executionNames, ["model.request.1.attempt.1", "tool.execute.1.1.call-calculator-1", "model.request.2.attempt.1"]);
  assert.deepEqual(result.eventIntents.filter((event) => event.kind.startsWith("Tool")).map((event) => event.kind), [
    "ToolCallRequested",
    "ToolCallValidated",
    "ToolExecutionStarted",
    "ToolExecutionCompleted",
  ]);
});

test("the workflow records a safe pre-dispatch retry as a separate durable model attempt", async () => {
  const result = await runWorkflow("fake-pre-dispatch-retry-once");

  assert.equal(result.status, "completed");
  assert.equal(result.metrics.modelCallCount, 1);
  assert.equal(result.metrics.modelAttemptCount, 2);
  assert.equal(result.attemptCount, 2);
  assert.deepEqual(
    result.eventIntents.filter((event) => event.kind === "ModelRequested").map((event) => event.payload.attempt),
    [1, 2],
  );
  assert.equal(result.eventIntents.filter((event) => event.kind === "ModelRetryScheduled").length, 1);
});

test("the workflow stops after the configured pre-dispatch retry budget", async () => {
  const result = await runWorkflow("fake-pre-dispatch-retry");

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "FAKE_PRE_DISPATCH_RETRY");
  assert.equal(result.metrics.modelCallCount, 1);
  assert.equal(result.metrics.modelAttemptCount, 3);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.eventIntents.filter((event) => event.kind === "ModelRequested").length, 3);
  assert.equal(result.eventIntents.filter((event) => event.kind === "ModelRetryScheduled").length, 2);
});

test("the workflow fails closed for duplicate provider call IDs", async () => {
  const result = await runWorkflow("fake-tool-duplicate");

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "INVALID_TOOL_CALL_RESPONSE");
  assert.equal(result.metrics.toolAttemptCount, 0);
  assert.equal(result.eventIntents.some((event) => event.kind === "ToolExecutionCompleted"), false);
});

test("the workflow stops a looping model at the configured round limit", async () => {
  const result = await runWorkflow("fake-tool-loop", { maxRounds: 2 });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_ROUND_LIMIT_EXCEEDED");
  assert.equal(result.metrics.modelCallCount, 2);
  assert.equal(result.metrics.toolCallCount, 2);
  assert.equal(result.metrics.toolAttemptCount, 2);
});

test("the workflow stops additional calls at the configured call limit", async () => {
  const result = await runWorkflow("fake-tool-loop", { maxRounds: 6, maxCalls: 1 });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TOOL_CALL_LIMIT_EXCEEDED");
  assert.equal(result.metrics.toolCallCount, 2);
  assert.equal(result.metrics.toolAttemptCount, 1);
  assert.equal(result.eventIntents.some((event) => event.kind === "ToolExecutionStarted" && event.payload.toolCallId === "call-loop-2"), false);
});

test("the workflow returns bounded tool errors for malformed and unknown calls", async () => {
  for (const model of ["fake-tool-malformed", "fake-tool-unknown"]) {
    const result = await runWorkflow(model, { maxRounds: 1 });
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "TOOL_ROUND_LIMIT_EXCEEDED");
    assert.equal(result.eventIntents.some((event) => event.kind === "ToolCallRejected"), true);
    assert.equal(result.eventIntents.some((event) => event.kind === "ToolExecutionStarted"), false);
  }
});

test("the workflow reports cancellation before a model step starts", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runWorkflow("fake-success", { signal: controller.signal });

  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "MODEL_CANCELLED");
  assert.equal(result.eventIntents.at(-1)?.kind, "RunCancelled");
});

async function runWorkflow(
  model: string,
  options: { readonly maxRounds?: number; readonly maxCalls?: number; readonly executionNames?: string[]; readonly signal?: AbortSignal } = {},
): Promise<RestateWorkflowResult> {
  let timestamp = Date.parse("2026-09-16T12:00:00.000Z");
  const signal = options.signal ?? new AbortController().signal;
  const context = {
    key: "agentlab:in-process",
    request: () => ({ id: "invocation-in-process", attemptCompletedSignal: signal }),
    date: { toJSON: async () => new Date(timestamp += 1).toISOString() },
    set: (_name: string, _value: unknown) => undefined,
    run: async <T>(name: string, action: () => Promise<T> | T): Promise<T> => {
      options.executionNames?.push(name);
      return action();
    },
  };
  const input: RestateWorkflowInput = {
    runId: "workflow-in-process",
    prompt: "calculate twenty plus twenty-two.",
    systemInstruction: "Use tools when appropriate.",
    model: { provider: "fake", model },
    tools: { enabledNames: ["calculator"], maxRounds: options.maxRounds ?? 6, maxCalls: options.maxCalls ?? 8 },
  };
  return workflowRun(context, input);
}
