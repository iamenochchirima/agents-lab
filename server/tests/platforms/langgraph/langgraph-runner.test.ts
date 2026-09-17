import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { LangGraphBaselineRunner } from "../../../src/platforms/langgraph/runner-adapter/langgraph-runner.js";

const manifest = (runner: LangGraphBaselineRunner): RunManifest => ({
  schemaVersion: 1,
  runId: "run-langgraph-test",
  createdAt: "2026-09-15T10:00:00Z",
  serverVersion: "test",
  platform: "langgraph",
  variant: "baseline",
  task: { kind: "prompt", prompt: "Say hello." },
  context: { systemInstruction: "Respond directly." },
  platformConfig: runner.manifestConfiguration(),
  model: { provider: "fake", model: "fake-success" },
});

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("LangGraph runner maps start, inspect, and cancel without leaking native types", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/runs") && init?.method === "POST" && typeof init.body === "string") {
      requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    if (url.endsWith("/health")) {
      return response({
        protocolVersion: 1,
        service: "langgraph",
        serviceVersion: "0.1.0",
        langgraphVersion: "1.2.10",
        pythonVersion: "3.12.3",
        status: "ready",
        checkpointPath: "/tmp/langgraph.sqlite",
        checkpointPathWritable: true,
        message: "ready",
      });
    }
    if (url.endsWith("/v1/runs") && init?.method === "POST") {
      return response({
        protocolVersion: 1,
        executionId: "langgraph:run-langgraph-test",
        runId: "run-langgraph-test",
        threadId: "run-langgraph-test",
        graph: "baseline",
        status: "queued",
        idempotent: false,
      }, { status: 202 });
    }
    if (url.endsWith("/cancel")) {
      return response({
        protocolVersion: 1,
        executionId: "langgraph:run-langgraph-test",
        status: "cancelled",
        accepted: true,
        alreadyTerminal: false,
        message: "Cancellation requested.",
      });
    }
    return response({
      protocolVersion: 1,
      executionId: "langgraph:run-langgraph-test",
      runId: "run-langgraph-test",
      threadId: "run-langgraph-test",
      graph: "baseline",
      status: "completed",
      checkpoint: { checkpointId: "checkpoint-1", step: 1, count: 2, pendingWrites: 0 },
      events: [{
        source: "langgraph-service",
        sourceSequence: 1,
        kind: "RunCompleted",
        runId: "run-langgraph-test",
        occurredAt: "2026-09-15T10:00:01Z",
        payload: { graph: "baseline" },
      }],
      result: {
        status: "completed",
        runId: "run-langgraph-test",
        startedAt: "2026-09-15T10:00:00Z",
        finishedAt: "2026-09-15T10:00:01Z",
        output: "Fake response: Say hello.",
        error: null,
        attemptCount: 1,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      },
      trajectory: { phases: [] },
      metrics: {
        modelCallCount: 1,
        modelAttemptCount: 1,
        checkpointCount: 2,
        durationMs: 1000,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    });
  }) as typeof fetch;

  try {
    const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: "http://127.0.0.1:2024" });
    const runManifest: RunManifest = {
      ...manifest(runner),
      context: { systemInstruction: "Respond directly.", sessionId: "session-langgraph-test", turnId: "turn-1" },
      capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 3, maxCalls: 2 } },
    };
    assert.deepEqual(await runner.checkConnection(), { reachable: true, message: "ready" });
    assert.deepEqual(runner.validate(runManifest), { valid: true, reason: null });

    const reference = await runner.start(runManifest);
    assert.equal(reference.executionId, "langgraph:run-langgraph-test");
    assert.equal(reference.native["threadId"], "run-langgraph-test");
    assert.deepEqual(requestBodies[0]?.context, { sessionId: "session-langgraph-test", turnId: "turn-1" });
    assert.deepEqual(requestBodies[0]?.tools, { enabledNames: ["calculator"], maxRounds: 3, maxCalls: 2 });

    const inspection = await runner.inspect(reference);
    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.output, "Fake response: Say hello.");
    assert.equal(inspection.eventIntents[0]?.source, "langgraph-service");

    const cancellation = await runner.cancel(reference, "test cancellation");
    assert.deepEqual(cancellation, {
      accepted: true,
      alreadyTerminal: false,
      message: "Cancellation requested.",
    });
    assert.deepEqual(requests, [
      "GET http://127.0.0.1:2024/health",
      "POST http://127.0.0.1:2024/v1/runs",
      "GET http://127.0.0.1:2024/v1/runs/langgraph%3Arun-langgraph-test",
      "POST http://127.0.0.1:2024/v1/runs/langgraph%3Arun-langgraph-test/cancel",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LangGraph runner preserves an unknown provider outcome as reconciliation-required", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response({
    protocolVersion: 1,
    executionId: "langgraph:run-unknown",
    runId: "run-unknown",
    threadId: "run-unknown",
    graph: "baseline",
    status: "unknown",
    checkpoint: { checkpointId: null, step: null, count: 0, pendingWrites: 0 },
    events: [],
    result: {
      status: "unknown",
      runId: "run-unknown",
      startedAt: "2026-09-15T10:00:00Z",
      finishedAt: "2026-09-15T10:00:01Z",
      output: null,
      error: {
        code: "LANGGRAPH_OUTCOME_UNKNOWN",
        message: "The outcome could not be established.",
        failureKind: "outcome_unknown",
        retryable: false,
      },
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    },
    trajectory: { phases: [] },
    metrics: {
      modelCallCount: 1,
      modelAttemptCount: 1,
      checkpointCount: 0,
      durationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    },
  })) as typeof fetch;

  try {
    const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: "http://127.0.0.1:2024" });
    const reference = {
      platform: "langgraph",
      variant: "baseline",
      executionId: "langgraph:run-unknown",
      native: {
        serviceUrl: "http://127.0.0.1:2024",
        executionId: "langgraph:run-unknown",
        threadId: "run-unknown",
        graph: "baseline",
        protocolVersion: 1,
      },
    };
    const inspection = await runner.inspect(reference);
    assert.equal(inspection.status, "running");
    assert.equal(inspection.result?.status, "reconciliation_required");
    assert.equal(inspection.result?.error?.failureKind, "reconciliation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LangGraph StateGraph sends the selected OpenRouter model and preserves checkpoint evidence", { skip: process.env.AGENTLAB_RUN_LANGGRAPH_NATIVE_OPENROUTER !== "1" }, async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agentlab-langgraph-native-openrouter-"));
  const provider = await startOpenRouterMock();
  let service: ManagedLangGraphService | null = null;
  try {
    service = await startLangGraphService(stateDirectory, provider.url);
    const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, timeoutMs: 5_000 });
    const selectedModel = "openai/gpt-4o-mini";
    const runManifest: RunManifest = {
      ...manifest(runner),
      runId: "langgraph-openrouter-native",
      task: { kind: "prompt", prompt: "Return one checkpoint sentence." },
      model: { provider: "openrouter", model: selectedModel, contextWindowTokens: 128_000 },
    };

    assert.equal((await runner.checkConnection()).reachable, true);
    const reference = await runner.start(runManifest);
    const inspection = await terminalInspection(runner, reference);
    const nativeResponse = await fetch(`${service.url}/v1/runs/${encodeURIComponent(reference.executionId)}`);
    assert.equal(nativeResponse.ok, true);
    const nativeInspection = await nativeResponse.json() as {
      checkpoint: { checkpointId: string | null; count: number };
      events: Array<{ kind: string; payload: Record<string, unknown> }>;
    };

    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.output, "OpenRouter response through LangGraph.");
    assert.deepEqual(inspection.result?.usage, { inputTokens: 7, outputTokens: 5, totalTokens: 12 });
    assert.equal(inspection.metrics?.modelCallCount, 1);
    assert.equal(inspection.metrics?.inputTokens, 7);
    assert.equal(inspection.metrics?.outputTokens, 5);
    assert.equal(nativeInspection.checkpoint.checkpointId !== null, true);
    assert.equal(nativeInspection.checkpoint.count > 0, true);
    const modelRequest = nativeInspection.events.find((event) => event.kind === "ModelRequested");
    assert.deepEqual(modelRequest?.payload, {
      node: "model",
      round: 1,
      attempt: 1,
      provider: "openrouter",
      model: selectedModel,
      toolCount: 1,
      requestSent: true,
    });
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.body.model, selectedModel);
    assert.equal(provider.requests[0]?.headers.authorization, "Bearer test-openrouter-secret");
    assert.equal(JSON.stringify(inspection).includes("test-openrouter-secret"), false);
    assert.equal(JSON.stringify(nativeInspection).includes("test-openrouter-secret"), false);
  } finally {
    await service?.stop();
    await provider.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

interface OpenRouterMock {
  readonly url: string;
  readonly requests: Array<{ headers: Record<string, string | undefined>; body: Record<string, unknown> }>;
  stop(): Promise<void>;
}

async function startOpenRouterMock(): Promise<OpenRouterMock> {
  const requests: OpenRouterMock["requests"] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push({
      headers: {
        authorization: request.headers.authorization,
        "content-type": request.headers["content-type"],
      },
      body,
    });
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      id: "chatcmpl-langgraph-test",
      model: body.model,
      choices: [{ message: { role: "assistant", content: "OpenRouter response through LangGraph." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OpenRouter mock did not expose a TCP address.");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

interface ManagedLangGraphService {
  readonly url: string;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

async function startLangGraphService(stateDirectory: string, openRouterBaseUrl: string): Promise<ManagedLangGraphService> {
  const port = await freePort();
  const platformRoot = existsSync(join(process.cwd(), "src", "platforms", "langgraph"))
    ? join(process.cwd(), "src", "platforms", "langgraph")
    : join(process.cwd(), "server", "src", "platforms", "langgraph");
  const localPython = join(platformRoot, ".local311", "bin", "python");
  const python = process.env.AGENTLAB_LANGGRAPH_PYTHON ?? (existsSync(localPython) ? localPython : "/usr/bin/python3.12");
  const child = spawn(python, ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: platformRoot,
    env: {
      ...process.env,
      PYTHONPATH: platformRoot,
      AGENTLAB_LANGGRAPH_STATE_DIR: stateDirectory,
      AGENTLAB_LANGGRAPH_PORT: String(port),
      AGENTLAB_OPENROUTER_BASE_URL: openRouterBaseUrl,
      OPENROUTER_API_KEY: "test-openrouter-secret",
    },
    stdio: "pipe",
  });
  let logs = "";
  child.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(child, url, () => logs);
  return {
    url,
    async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      await Promise.race([
        once(child, "exit").then(() => undefined),
        delay(signal === "SIGKILL" ? 2_000 : 5_000),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams, url: string, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`LangGraph service exited before readiness.\n${logs()}`);
    }
    try {
      const health = await fetch(`${url}/health`);
      const body = await health.json() as { status?: string };
      if (health.ok && body.status === "ready") return;
    } catch {
      // The process is still starting. The child exit check handles hard failures.
    }
    await delay(50);
  }
  assert.fail(`LangGraph service did not become ready.\n${logs()}`);
}

async function terminalInspection(
  runner: LangGraphBaselineRunner,
  reference: Awaited<ReturnType<LangGraphBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await delay(25);
  }
  assert.fail(`LangGraph execution did not reach a terminal result: ${reference.executionId}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
