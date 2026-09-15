import assert from "node:assert/strict";
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
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
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
    const runManifest = manifest(runner);
    assert.deepEqual(await runner.checkConnection(), { reachable: true, message: "ready" });
    assert.deepEqual(runner.validate(runManifest), { valid: true, reason: null });

    const reference = await runner.start(runManifest);
    assert.equal(reference.executionId, "langgraph:run-langgraph-test");
    assert.equal(reference.native["threadId"], "run-langgraph-test");

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
