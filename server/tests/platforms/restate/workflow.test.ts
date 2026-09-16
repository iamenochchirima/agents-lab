import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CharacterTokenEstimator, ContextSessionStore } from "../../../src/capabilities/context/index.js";
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

test("the workflow executes the selected OpenRouter model and records normalized evidence", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousBaseUrl = process.env.AGENTLAB_OPENROUTER_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.AGENTLAB_OPENROUTER_BASE_URL = "https://openrouter.example/v1";
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), "https://openrouter.example/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    return new Response(JSON.stringify({
      id: "restate-openrouter-provider-id",
      choices: [{ message: { content: "hello from Restate OpenRouter" } }],
      usage: { prompt_tokens: 8, completion_tokens: 9, total_tokens: 17 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await runWorkflow("cohere/north-mini-code:free", {
      provider: "openrouter",
      maxRounds: 1,
    });

    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.equal(result.status, "completed");
    assert.equal(result.output, "hello from Restate OpenRouter");
    assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 9, totalTokens: 17 });
    assert.equal(result.metrics.modelCallCount, 1);
    assert.deepEqual(result.eventIntents.find((event) => event.kind === "ModelRequested")?.payload, {
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
      attempt: 1,
      round: 1,
      toolCount: 1,
    });
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL;
    else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBaseUrl;
  }
});

test("the workflow aggregates reported usage across OpenRouter model calls", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousBaseUrl = process.env.AGENTLAB_OPENROUTER_BASE_URL;
  const previousFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  let providerCall = 0;
  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.AGENTLAB_OPENROUTER_BASE_URL = "https://openrouter.example/v1";
  globalThis.fetch = (async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    providerCall += 1;
    const body = providerCall === 1
      ? {
          id: "restate-openrouter-tool-request",
          choices: [{ message: {
            content: null,
            tool_calls: [{
              id: "call-calculator-1",
              type: "function",
              function: { name: "calculator", arguments: '{"operation":"add","left":20,"right":22}' },
            }],
          } }],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }
      : {
          id: "restate-openrouter-final-request",
          choices: [{ message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await runWorkflow("cohere/north-mini-code:free", {
      provider: "openrouter",
      maxRounds: 2,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.output, "done");
    assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 7, totalTokens: 25 });
    assert.equal(result.metrics.modelCallCount, 2);
    assert.deepEqual(requestBodies.map((body) => body.model), [
      "cohere/north-mini-code:free",
      "cohere/north-mini-code:free",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL;
    else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBaseUrl;
  }
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

test("the workflow prepares the canonical context snapshot before its model request", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "agentlab-restate-context-"));
  const sessionId = "restate-context-workflow";
  const runId = "restate-context-workflow-run";
  const store = new ContextSessionStore(rootDirectory);
  try {
    await store.create({
      sessionId,
      platform: "restate",
      variant: "baseline",
      model: "fake-context",
      systemInstruction: "Remember context safely.",
      contextWindowTokens: 2_048,
      reservedOutputTokens: 256,
      safetyMarginTokens: 128,
      compactionThresholdPercent: 20,
      now: "2026-09-16T12:00:00.000Z",
    });
    const admitted = await store.admitTurn(sessionId, runId, "Remember conformance-4318.", "2026-09-16T12:00:01.000Z", "turn-1");
    const result = await runWorkflow("fake-context", {
      prompt: "Remember conformance-4318.",
      runId,
      tools: { enabledNames: [], maxRounds: 2, maxCalls: 3 },
      context: { rootDirectory, sessionId, turnId: admitted.turn.turnId },
    });

    assert.equal(result.status, "completed");
    assert.equal(result.output, "Stored the test value.");
    assert.deepEqual(result.eventIntents.filter((event) => event.kind === "ContextPreparationStarted" || event.kind === "ContextPrepared").map((event) => event.kind), [
      "ContextPreparationStarted",
      "ContextPrepared",
    ]);
    const prepared = result.eventIntents.find((event) => event.kind === "ContextPrepared");
    assert.equal(prepared?.payload.sessionId, sessionId);
    assert.equal(prepared?.payload.turnId, admitted.turn.turnId);
    assert.equal(prepared?.payload.quality, "estimated");
    const snapshot = await store.latestSnapshot(sessionId);
    assert.equal(snapshot?.snapshotId, prepared?.payload.snapshotId);
    assert.deepEqual(snapshot?.messages.map((message) => message.role), ["system", "user"]);
    assert.equal((await store.readTurn(sessionId, admitted.turn.turnId))?.contextSnapshotId, snapshot?.snapshotId);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("the workflow reuses completed named actions during deterministic journal replay", async () => {
  const actionCache = new Map<string, unknown>();
  const firstExecutions: string[] = [];
  const first = await runWorkflow("fake-tool-call", { executionNames: firstExecutions, actionCache });
  const replayExecutions: string[] = [];
  const replay = await runWorkflow("fake-tool-call", { executionNames: replayExecutions, actionCache });

  assert.equal(first.status, "completed");
  assert.equal(replay.status, "completed");
  assert.equal(replay.output, first.output);
  assert.equal(replay.metrics.modelCallCount, first.metrics.modelCallCount);
  assert.equal(replay.metrics.toolCallCount, first.metrics.toolCallCount);
  assert.deepEqual(firstExecutions, [
    "model.request.1.attempt.1",
    "tool.execute.1.1.call-calculator-1",
    "model.request.2.attempt.1",
  ]);
  assert.deepEqual(replayExecutions, []);
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
  options: {
    readonly provider?: "fake" | "openrouter";
    readonly prompt?: string;
    readonly runId?: string;
    readonly maxRounds?: number;
    readonly maxCalls?: number;
    readonly tools?: RestateWorkflowInput["tools"];
    readonly context?: RestateWorkflowInput["context"];
    readonly executionNames?: string[];
    readonly actionCache?: Map<string, unknown>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<RestateWorkflowResult> {
  let timestamp = Date.parse("2026-09-16T12:00:00.000Z");
  const signal = options.signal ?? new AbortController().signal;
  const context = {
    key: "agentlab:in-process",
    request: () => ({ id: "invocation-in-process", attemptCompletedSignal: signal }),
    date: { toJSON: async () => new Date(timestamp += 1).toISOString() },
    set: (_name: string, _value: unknown) => undefined,
    run: async <T>(name: string, action: () => Promise<T> | T): Promise<T> => {
      if (options.actionCache?.has(name)) return options.actionCache.get(name) as T;
      options.executionNames?.push(name);
      const result = await action();
      options.actionCache?.set(name, result);
      return result;
    },
  };
  const input: RestateWorkflowInput = {
    runId: options.runId ?? "workflow-in-process",
    prompt: options.prompt ?? "calculate twenty plus twenty-two.",
    systemInstruction: "Use tools when appropriate.",
    model: { provider: options.provider ?? "fake", model },
    tools: options.tools ?? { enabledNames: ["calculator"], maxRounds: options.maxRounds ?? 6, maxCalls: options.maxCalls ?? 8 },
    ...(options.context === undefined ? {} : { context: options.context }),
  };
  return workflowRun(context, input);
}
