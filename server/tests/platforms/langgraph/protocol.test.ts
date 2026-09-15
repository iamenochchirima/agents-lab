import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHealthResponse,
  parseInspection,
  parseStartResponse,
} from "../../../src/platforms/langgraph/protocol/protocol.js";

test("LangGraph protocol parsing accepts the complete health response", () => {
  const health = parseHealthResponse({
    protocolVersion: 1,
    service: "langgraph",
    serviceVersion: "0.1.0",
    langgraphVersion: "1.2.10",
    pythonVersion: "3.12.3",
    status: "ready",
    checkpointPath: "/tmp/langgraph.sqlite",
    checkpointPathWritable: true,
    message: "LangGraph SQLite service is ready.",
  });

  assert.equal(health.langgraphVersion, "1.2.10");
});

test("LangGraph protocol parsing rejects incompatible or malformed responses", () => {
  assert.throws(
    () => parseStartResponse({ protocolVersion: 2 }),
    /Unsupported LangGraph protocol version/,
  );
  assert.throws(
    () => parseHealthResponse({
      protocolVersion: 1,
      service: "langgraph",
      serviceVersion: "0.1.0",
      langgraphVersion: "1.2.10",
      pythonVersion: "3.12.3",
      status: "ready",
      checkpointPath: "/tmp/langgraph.sqlite",
      checkpointPathWritable: true,
      message: "ready",
      unexpectedSecret: "must be ignored by the parser only if not required",
    }),
    /missing|invalid|Unexpected|LangGraph health response/,
  );
});

test("LangGraph inspection parsing preserves unknown outcomes and native checkpoint data", () => {
  const inspection = parseInspection({
    protocolVersion: 1,
    executionId: "langgraph:run-1",
    runId: "run-1",
    threadId: "run-1",
    graph: "baseline",
    status: "unknown",
    checkpoint: {
      checkpointId: "checkpoint-1",
      step: 1,
      count: 2,
      pendingWrites: 0,
    },
    events: [
      {
        source: "langgraph-service",
        sourceSequence: 1,
        kind: "CheckpointWritten",
        runId: "run-1",
        occurredAt: "2026-09-15T10:00:00Z",
        payload: { checkpointId: "checkpoint-1", step: 1 },
      },
    ],
    result: {
      status: "unknown",
      runId: "run-1",
      startedAt: "2026-09-15T10:00:00Z",
      finishedAt: "2026-09-15T10:00:01Z",
      output: null,
      error: {
        code: "LANGGRAPH_OUTCOME_UNKNOWN",
        message: "The outcome could not be confirmed.",
        failureKind: "outcome_unknown",
        retryable: false,
      },
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    },
    trajectory: { phases: [{ name: "graph", startedAt: "2026-09-15T10:00:00Z", finishedAt: "2026-09-15T10:00:01Z" }] },
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

  assert.equal(inspection.status, "unknown");
  assert.equal(inspection.checkpoint.checkpointId, "checkpoint-1");
  assert.equal(inspection.result?.error?.failureKind, "outcome_unknown");
});
