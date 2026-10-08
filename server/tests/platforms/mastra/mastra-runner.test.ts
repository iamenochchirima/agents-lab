import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MastraModelConfig } from "@mastra/core/llm";

import { ContextSessionStore } from "../../../src/capabilities/context/session-store.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createBaselineAgentRuntime } from "../../../src/platforms/mastra/variants/baseline/agent.js";
import { defaultMastraModelFactory } from "../../../src/platforms/mastra/variants/baseline/models/factory.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";
import { MASTRA_AGENT_ID } from "../../../src/platforms/mastra/variants/baseline/config/configuration.js";

test("Mastra baseline validates fake and OpenRouter profiles without exposing secrets", async () => {
  const fakeRunner = new MastraBaselineRunner({ environment: {} });
  const fakeManifest = manifestFor(fakeRunner, "fake-success");

  assert.deepEqual(fakeRunner.validate(fakeManifest), { valid: true, reason: null });
  assert.deepEqual(await fakeRunner.checkConnection(), {
    reachable: true,
    message: "Mastra direct-agent runtime is ready for deterministic fake-model runs.",
  });

  const unavailableOpenRouter = new MastraBaselineRunner({ environment: {} });
  const openRouterManifest = manifestFor(unavailableOpenRouter, "aion-labs/aion-2.0", "openrouter");
  assert.deepEqual(unavailableOpenRouter.validate(openRouterManifest), {
    valid: false,
    reason: "OPENROUTER_API_KEY is required for the Mastra OpenRouter profile.",
  });
  assert.equal(defaultMastraModelFactory({ ...openRouterManifest, model: { provider: "openrouter", model: "aion-labs/aion-2.0" } }), "openrouter/aion-labs/aion-2.0");

  const availableOpenRouter = new MastraBaselineRunner({ environment: { OPENROUTER_API_KEY: "test-secret" } });
  assert.deepEqual(availableOpenRouter.validate(manifestFor(availableOpenRouter, "aion-labs/aion-2.0", "openrouter")), {
    valid: true,
    reason: null,
  });
  assert.equal(JSON.stringify(availableOpenRouter.manifestConfiguration()).includes("test-secret"), false);

  assert.equal(fakeRunner.validate(manifestFor(fakeRunner, "fake-not-supported")).valid, false);
});

test("Mastra registers the baseline agent on a Mastra instance", () => {
  const runner = new MastraBaselineRunner();
  const manifest = manifestFor(runner, "fake-success");

  const runtime = createBaselineAgentRuntime(manifest, (selectedManifest) => createDeterministicFakeModel({
    modelId: selectedManifest.model.model,
    responseText: "Registered Mastra response.",
  }), {
    runId: manifest.runId,
    turnId: `${manifest.runId}:turn:1`,
    signal: new AbortController().signal,
    maxToolCalls: 8,
  });

  assert.equal(runtime.agent, runtime.mastra.getAgent(MASTRA_AGENT_ID));
  assert.equal(runtime.agent.id, MASTRA_AGENT_ID);
});

test("registered Mastra agent exposes native stream output and usage", async () => {
  const runner = new MastraBaselineRunner();
  const manifest = manifestFor(runner, "fake-success", "fake", "mastra-native-stream");
  const runtime = createBaselineAgentRuntime(manifest, (selectedManifest) => createDeterministicFakeModel({
    modelId: selectedManifest.model.model,
    responseText: "Streamed Mastra response.",
  }), {
    runId: manifest.runId,
    turnId: `${manifest.runId}:turn:1`,
    signal: new AbortController().signal,
    maxToolCalls: 8,
  });

  const stream = await runtime.agent.stream(manifest.task.prompt, {
    runId: manifest.runId,
    abortSignal: new AbortController().signal,
  });
  const chunks: Array<{ type: string }> = [];
  for await (const chunk of stream.fullStream) chunks.push({ type: chunk.type });

  assert.equal(await stream.text, "Streamed Mastra response.");
  assert.equal(await stream.finishReason, "stop");
  const usage = await stream.totalUsage;
  assert.equal(usage.inputTokens, 3);
  assert.equal(usage.outputTokens, 4);
  assert.equal(usage.totalTokens, 7);
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
  assert.ok(chunks.some((chunk) => chunk.type === "finish"));
});

test("Mastra runs a real Agent.generate call and duplicate start is idempotent", async () => {
  let modelFactoryCalls = 0;
  const runner = new MastraBaselineRunner({
    modelFactory: (manifest) => {
      modelFactoryCalls += 1;
      return createDeterministicFakeModel({ modelId: manifest.model.model, responseText: "Hello from Mastra." });
    },
  });
  const manifest = manifestFor(runner, "fake-success");

  const firstReference = await runner.start(manifest);
  const secondReference = await runner.start(manifest);
  assert.deepEqual(secondReference, firstReference);
  const inspection = await waitForTerminal(runner, firstReference);
  assert.equal(modelFactoryCalls, 1, "Duplicate admission must execute one native agent after storage preparation");
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "Hello from Mastra.");
  assert.equal(inspection.result?.attemptCount, 1);
  assert.equal(inspection.metrics?.modelCallCount, 1);
  assert.equal(inspection.eventIntents.filter((event) => event.kind === "ModelRequested").length, 1);
  assert.equal(inspection.reference.native.evidenceSchema, "mastra.native.v2");
  assert.equal(inspection.reference.native.nativeStatus, "completed");
  assert.equal(inspection.reference.native.eventCount, inspection.eventIntents.length);
  assert.equal(inspection.reference.native.toolCallCount, 0);
});

test("Mastra Agent.generate sends the selected OpenRouter model and preserves normalized evidence", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  const contextRoot = await mkdtemp(join(tmpdir(), "agentlab-mastra-capability-context-"));
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const selectedModel = "openai/gpt-4o-mini";

  process.env.OPENROUTER_API_KEY = "test-openrouter-secret";
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init);
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    requests.push({ url: request.url, headers: request.headers, body });
    return new Response(JSON.stringify({
      id: "chatcmpl-mastra-test",
      model: selectedModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OpenRouter response through Mastra." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const runner = new MastraBaselineRunner({
      environment: { OPENROUTER_API_KEY: "test-openrouter-secret" },
      contextRoot,
    });
    const baseManifest = manifestFor(runner, selectedModel, "openrouter", "mastra-openrouter-native");
    const sessionId = "mastra-openrouter-capability-context";
    const contextStore = new ContextSessionStore(contextRoot);
    await contextStore.create({
      sessionId,
      platform: "mastra",
      variant: "baseline",
      model: `openrouter/${selectedModel}`,
      systemInstruction: baseManifest.context.systemInstruction,
      contextWindowTokens: 128_000,
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
    });
    const contextTurn = await contextStore.admitTurn(sessionId, baseManifest.runId, baseManifest.task.prompt);
    const manifest: RunManifest = {
      ...baseManifest,
      context: { ...baseManifest.context, sessionId, turnId: contextTurn.turn.turnId },
      capabilities: {
        tools: { enabledNames: [], maxRounds: 8, maxCalls: 8 },
        inventory: {
          schemaVersion: 1,
          revision: "test-capability-revision",
          toolCatalogRevision: "test-tool-catalog-revision",
          profile: { id: "test-profile", version: "1.0.0", name: "Notes profile" },
          sources: [],
          skills: [],
        },
      },
    };
    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);

    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.output, "OpenRouter response through Mastra.");
    assert.deepEqual(inspection.result?.usage, { inputTokens: 7, outputTokens: 5, totalTokens: 12 });
    assert.equal(inspection.metrics?.modelCallCount, 1);
    assert.equal(inspection.reference.native.evidenceSchema, "mastra.native.v2");
    assert.equal(inspection.reference.native.nativeStatus, "completed");
    assert.equal(inspection.reference.native.eventCount, inspection.eventIntents.length);
    assert.equal(reference.native.model, selectedModel);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.endsWith("/chat/completions"), true);
    assert.equal(requests[0]?.body.model, selectedModel);
    const messages = requests[0]?.body.messages as Array<{ role: string; content: unknown }>;
    const systemContents = messages.filter((message) => message.role === "system").flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.map((part) => typeof part === "object" && part !== null && "text" in part ? String(part.text) : "")
        : [String(message.content)],
    );
    assert.ok(systemContents.includes(manifest.context.systemInstruction));
    assert.ok(systemContents.some((content) => content.includes("Configured capability inventory") && content.includes("test-profile@1.0.0")));
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-openrouter-secret");
    assert.equal(JSON.stringify(inspection).includes("test-openrouter-secret"), false);
    assert.equal(JSON.stringify(reference).includes("test-openrouter-secret"), false);
  } finally {
    await rm(contextRoot, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Mastra executes the shared calculator through a native Agent.generate tool loop", async () => {
  const observations: Array<{ runId: string; callId: string; content: string }> = [];
  const runner = new MastraBaselineRunner({
    onToolObservation: (runId, call, result) => observations.push({
      runId, callId: call.toolCallId, content: result.content,
    }),
  });
  const manifest = buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Calculate 17 plus 25." },
      model: { provider: "fake", model: "fake-tool-call" },
      capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 4, maxCalls: 2 } },
    },
    { runId: "mastra-tool-loop", platformConfig: runner.manifestConfiguration() },
  );

  const inspection = await waitForTerminal(runner, await runner.start(manifest));
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, 'The calculator returned {"value":42}.');
  assert.deepEqual(observations, [{
    runId: manifest.runId, callId: "mastra-calculator-1", content: '{"value":42}',
  }]);
  assert.equal(inspection.metrics?.modelCallCount, 2);
  assert.equal(inspection.metrics?.toolCallCount, 1);
  assert.equal(inspection.metrics?.toolAttemptCount, 1);
  assert.deepEqual(
    inspection.eventIntents.filter((event) => event.kind.startsWith("Tool"))
      .map((event) => event.kind),
    ["ToolCallRequested", "ToolCallValidated", "ToolExecutionStarted", "ToolExecutionCompleted"],
  );
});

test("parallel SDK calls share their model round while the model step budget remains enforced", async () => {
  for (const maxRounds of [1, 2]) {
    let requests = 0;
    const rounds: number[] = [];
    const runner = new MastraBaselineRunner({
      onToolObservation: (_runId, call) => rounds.push(call.round),
      modelFactory: () => ({
        specificationVersion: "v2", provider: "agentlab.fake", modelId: "fake-success", supportedUrls: {},
        doStream: async () => { throw new Error("This fixture supports generate only."); },
        doGenerate: async () => {
          const first = requests++ === 0;
          return {
            content: first ? [1, 2].map(value => ({ type: "tool-call", toolCallId: `parallel-${value}`, toolName: "calculator",
              input: JSON.stringify({ operation: "add", left: value, right: 1 }) })) : [{ type: "text", text: "Done." }],
            finishReason: first ? "tool-calls" : "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [],
          };
        },
      } as ReturnType<typeof createDeterministicFakeModel>),
    });
    const manifest = buildRunManifest({
      platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Perform two independent calculations." },
      model: { provider: "fake", model: "fake-success" },
      capabilities: { tools: { enabledNames: ["calculator"], maxCalls: 2, maxRounds } },
    }, { runId: `mastra-parallel-round-${maxRounds}`, platformConfig: runner.manifestConfiguration() });
    const inspection = await waitForTerminal(runner, await runner.start(manifest));
    assert.deepEqual(rounds, [1, 1]);
    assert.equal(inspection.eventIntents.filter(event => event.kind === "ToolExecutionCompleted").length, 2);
    assert.equal(requests, maxRounds);
    assert.equal(inspection.status, maxRounds === 1 ? "failed" : "completed");
    if (maxRounds === 1) assert.equal(inspection.result?.error?.code, "MASTRA_MODEL_ROUND_LIMIT_EXCEEDED");
    else assert.equal(inspection.result?.output, "Done.");
  }
});

test("Mastra enforces requested aggregate call and model-round budgets", async () => {
  for (const scenario of [
    { id: "repeated-tool", tools: ["calculator", "calculator"], maxCalls: 1, maxRounds: 4, code: "MASTRA_TOOL_CALL_LIMIT_EXCEEDED", dispatches: 1, rounds: 3 },
    { id: "mixed-tool", tools: ["calculator", "fixture_lookup"], maxCalls: 1, maxRounds: 4, code: "MASTRA_TOOL_CALL_LIMIT_EXCEEDED", dispatches: 1, rounds: 3 },
    { id: "rounds", tools: ["calculator", "calculator"], maxCalls: 8, maxRounds: 1, code: "MASTRA_MODEL_ROUND_LIMIT_EXCEEDED", dispatches: 1, rounds: 1 },
  ]) {
    let requests = 0;
    const runner = new MastraBaselineRunner({
      modelFactory: () => ({
        specificationVersion: "v2", provider: "agentlab.fake", modelId: "fake-success", supportedUrls: {},
        doStream: async () => { throw new Error("This fixture supports generate only."); },
        doGenerate: async () => {
          const toolName = scenario.tools[requests++];
          return {
            content: toolName ? [{
              type: "tool-call", toolCallId: `budget-${requests}`, toolName,
              input: JSON.stringify(toolName === "calculator" ? { operation: "add", left: 17, right: 25 } : { key: "alpha" }),
            }] : [{ type: "text", text: "Done." }],
            finishReason: toolName ? "tool-calls" : "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [],
          };
        },
      } as ReturnType<typeof createDeterministicFakeModel>),
    });
    const manifest = buildRunManifest({
      platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Exercise limits." },
      model: { provider: "fake", model: "fake-success" },
      capabilities: { tools: { enabledNames: ["calculator", "fixture_lookup"], maxCalls: scenario.maxCalls, maxRounds: scenario.maxRounds } },
    }, { runId: `mastra-budget-${scenario.id}`, platformConfig: runner.manifestConfiguration() });
    const inspection = await waitForTerminal(runner, await runner.start(manifest));
    assert.equal(inspection.status, "failed", scenario.id);
    assert.equal(inspection.result?.error?.code, scenario.code, scenario.id);
    assert.equal(inspection.eventIntents.filter((event) => event.kind === "ToolExecutionStarted").length, scenario.dispatches, scenario.id);
    assert.equal(requests, scenario.rounds, scenario.id);
    if (scenario.maxCalls === 1) {
      assert.equal(inspection.eventIntents.filter((event) =>
        event.kind === "ToolCallRejected" && event.payload.code === "TOOL_CALL_LIMIT_EXCEEDED").length, 1);
    }
  }
});

test("Mastra executes the selected read connection through a native Agent tool", async () => {
  const runner = new MastraBaselineRunner();
  const manifest = buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Read the alpha fixture." },
      model: { provider: "fake", model: "fake-connected-tool" },
      capabilities: { tools: { enabledNames: ["fixture_lookup"], maxRounds: 4, maxCalls: 2 } },
    },
    { runId: "mastra-connected-tool", platformConfig: runner.manifestConfiguration() },
  );

  const inspection = await waitForTerminal(runner, await runner.start(manifest));
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, 'The local fixture returned {"key":"alpha","value":"local fixture alpha"}.');
  assert.equal(inspection.metrics?.modelCallCount, 2);
  assert.equal(inspection.metrics?.toolCallCount, 1);
  assert.deepEqual(
    inspection.eventIntents.filter((event) => event.kind.startsWith("Tool"))
      .map((event) => event.kind),
    ["ToolCallRequested", "ToolCallValidated", "ToolExecutionStarted", "ToolExecutionCompleted"],
  );
  assert.equal(inspection.eventIntents.find((event) => event.kind === "ToolExecutionCompleted")?.payload.toolName, "fixture_lookup");
});

test("Mastra maps provider failure and ambiguous provider outcomes safely", async () => {
  const failedRunner = new MastraBaselineRunner();
  const failed = await waitForTerminal(failedRunner, await failedRunner.start(manifestFor(failedRunner, "fake-provider-failure")));
  assert.equal(failed.status, "failed");
  assert.equal(failed.result?.error?.failureKind, "provider");
  assert.equal(failed.result?.error?.message, "The Mastra model provider rejected the request.");

  const ambiguousRunner = new MastraBaselineRunner();
  const ambiguous = await waitForTerminal(
    ambiguousRunner,
    await ambiguousRunner.start(manifestFor(ambiguousRunner, "fake-ambiguous")),
  );
  assert.equal(ambiguous.status, "failed");
  assert.equal(ambiguous.result?.error?.failureKind, "outcome_unknown");
  assert.equal(ambiguous.result?.error?.code, "MASTRA_OUTCOME_UNKNOWN");
});

test("Mastra cancellation is cooperative and does not claim completion", async () => {
  const runner = new MastraBaselineRunner({ executionTimeoutMs: 1_000 });
  const reference = await runner.start(manifestFor(runner, "fake-slow"));
  const cancellation = await runner.cancel(reference, "stop for test");
  assert.equal(cancellation.accepted, true);

  const inspection = await waitForTerminal(runner, reference);
  assert.equal(inspection.status, "cancelled");
  assert.equal(inspection.result?.output, null);
  assert.equal(inspection.result?.error?.failureKind, "cancelled");
});

test("a replacement runner cannot recover an in-flight process-local call", async () => {
  const original = new MastraBaselineRunner({ executionTimeoutMs: 1_000 });
  const reference = await original.start(manifestFor(original, "fake-slow", "fake", "mastra-process-loss"));
  const replacement = new MastraBaselineRunner();

  await assert.rejects(
    replacement.inspect(reference),
    (error: unknown) => error instanceof Error && error.message.includes("Mastra execution was not found"),
  );
});

function manifestFor(
  runner: MastraBaselineRunner,
  model: string,
  provider: "fake" | "openrouter" = "fake",
  runId = `mastra-test-${model.replaceAll(/[^a-z0-9]+/gi, "-")}`,
): RunManifest {
  return buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Say hello." },
      model: { provider, model },
    },
    {
      runId,
      platformConfig: runner.manifestConfiguration(),
    },
  );
}

async function waitForTerminal(
  runner: MastraBaselineRunner,
  reference: Awaited<ReturnType<MastraBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Mastra test execution did not reach a terminal state.");
}

test("native SDK rejections retain call evidence before any execute callback", async () => {
  for (const toolName of ["calculator", "fixture_write"]) {
    let requests = 0;
    const runner = new MastraBaselineRunner({ modelFactory: () => ({
      specificationVersion: "v2", provider: "agentlab.fake", modelId: "sdk-rejection-probe", supportedUrls: {},
      doGenerate: async () => ({
        content: ++requests === 1 ? [{ type: "tool-call" as const, toolCallId: "sdk-rejected-call", toolName,
          input: JSON.stringify(toolName === "calculator" ? { operation: "add", left: "invalid", right: 25 } : { key: "alpha", value: "forbidden" }) }]
          : [{ type: "text" as const, text: "The rejected action did not execute." }],
        finishReason: requests === 1 ? "tool-calls" as const : "stop" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [],
      }),
    } as unknown as MastraModelConfig) });
    const manifest = manifestFor(runner, "fake-eval-behaviour", "fake", `mastra-sdk-rejection-${toolName}`);
    assert.equal(runner.validate(manifest).valid, true);
    const inspection = await waitForTerminal(runner, await runner.start(manifest));
    assert.equal(inspection.result?.status, "completed");
    assert.equal(inspection.eventIntents.filter(event => event.kind === "ToolExecutionStarted").length, 0);
    const rejected = inspection.eventIntents.find(event => event.kind === "ToolCallRejected");
    assert.equal(rejected?.payload.code, toolName === "calculator" ? "INVALID_ARGUMENTS" : "TOOL_NOT_ENABLED");
    assert.equal(rejected?.payload.nativeBoundary, "mastra-sdk");
  }
});

test("missing provider usage stays unknown while measured zero usage remains zero", async () => {
  for (const measured of [false, true]) {
    const usage = measured ? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } : { inputTokens: null, outputTokens: null, totalTokens: null };
    const runner = new MastraBaselineRunner({ modelFactory: () => ({
      specificationVersion: "v2", provider: "agentlab.fake", modelId: "usage-preservation-probe", supportedUrls: {},
      doGenerate: async () => ({ content: [{ type: "text", text: "Completed." }], finishReason: "stop", usage, warnings: [] }),
    } as unknown as MastraModelConfig) });
    const manifest = manifestFor(runner, "fake-success", "fake", `mastra-usage-${measured}`);
    const inspection = await waitForTerminal(runner, await runner.start(manifest));
    assert.deepEqual(inspection.result?.usage, usage);
    assert.deepEqual(inspection.eventIntents.find(event => event.kind === "ModelCompleted")?.payload.usage, usage);
    assert.deepEqual(inspection.eventIntents.find(event => event.kind === "AgentStepCompleted")?.payload.usage, usage);
  }
});
