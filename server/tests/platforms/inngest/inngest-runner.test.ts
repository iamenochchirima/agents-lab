import test from "node:test";
import assert from "node:assert/strict";

import { InngestBaselineRunner } from "../../../src/platforms/inngest/runner-adapter/inngest-runner.js";
import { loadInngestConfig } from "../../../src/platforms/inngest/config.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";

function manifest(): RunManifest {
  return {
    schemaVersion: 1,
    runId: "run-runner",
    createdAt: "2026-09-15T12:00:00.000Z",
    serverVersion: "test",
    platform: "inngest",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Return a sentence." },
    context: { systemInstruction: "Be concise." },
    platformConfig: {
      functionId: "agentlab-baseline",
      eventName: "agentlab/run.requested",
    },
    model: { provider: "fake", model: "fake-success" },
  };
}

test("runner starts and inspects an Inngest run through the platform service", async () => {
  const responses = new Map<string, unknown>([
    ["POST /runs/admit", { runId: "run-runner" }],
    ["POST /runs/run-runner/dispatch", {
      eventId: "evt-1",
      submissionOutcome: "accepted",
      acknowledgement: "confirmed",
      dispatchErrorCode: null,
    }],
    ["GET /runs/run-runner", {
      runId: "run-runner",
      status: "completed",
      eventId: "evt-1",
      functionRunId: "fn-run-1",
      submissionOutcome: "accepted",
      cancellationRequested: false,
      attemptCount: 1,
      events: [{ key: "done", source: "inngest", sourceSequence: 1, kind: "RunCompleted", runId: "run-runner", occurredAt: "2026-09-15T12:00:01.000Z", payload: {} }],
      result: { schemaVersion: 1, runId: "run-runner", status: "completed", startedAt: "2026-09-15T12:00:00.000Z", finishedAt: "2026-09-15T12:00:01.000Z", output: "done", error: null, attemptCount: 1, usage: { inputTokens: null, outputTokens: null, totalTokens: null } },
      trajectory: { schemaVersion: 1, runId: "run-runner", phases: [] },
      metrics: { schemaVersion: 1, runId: "run-runner", status: "completed", durationMs: 1000, modelCallCount: 1, modelAttemptCount: 1, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
    }],
  ]);
  const fetchImplementation: typeof fetch = async (url, init) => {
    const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url : url.url);
    const key = `${init?.method ?? "GET"} ${parsed.pathname}`;
    if (key === "GET /health") return new Response(JSON.stringify({ status: "ready", devServer: { reachable: true, message: "ok" } }), { status: 200 });
    return new Response(JSON.stringify(responses.get(key) ?? {}), { status: 200 });
  };
  const runner = new InngestBaselineRunner({
    config: loadInngestConfig({ AGENTLAB_INNGEST_SERVICE_URL: "http://127.0.0.1:9091", AGENTLAB_INNGEST_DEV_SERVER_URL: "http://127.0.0.1:8288" }),
    fetchImplementation,
  });
  const reference = await runner.start(manifest());
  const inspection = await runner.inspect(reference);
  assert.equal(reference.native.eventId, "evt-1");
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "done");
  assert.equal(inspection.eventIntents[0].kind, "RunCompleted");
});

test("runner keeps an unknown reference when service acknowledgement is lost", async () => {
  const fetchImplementation: typeof fetch = async () => {
    throw new Error("service unavailable");
  };
  const runner = new InngestBaselineRunner({
    config: loadInngestConfig(),
    fetchImplementation,
  });
  const reference = await runner.start(manifest());
  assert.equal(reference.executionId, "inngest:run-runner");
  assert.equal(reference.native.submissionOutcome, "unknown");
  assert.equal(reference.native.acknowledgement, "unknown");
});
