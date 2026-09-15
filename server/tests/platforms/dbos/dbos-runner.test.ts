import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { loadDbosConfig } from "../../../src/platforms/dbos/config.js";
import { DbosBaselineRunner, requestHashForManifest } from "../../../src/platforms/dbos/runner-adapter/dbos-runner.js";

const config = loadDbosConfig({
  AGENTLAB_DBOS_SYSTEM_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/agentlab_dbos",
  AGENTLAB_DBOS_PORT: "9091",
});

test("DBOS runner produces a stable request hash and safe identity", async () => {
  const runner = new DbosBaselineRunner({ config, serviceUrl: "http://127.0.0.1:9091", fetchImplementation: fetcher({
    "GET http://127.0.0.1:9091/health": jsonResponse({ status: "ready" }),
    "POST http://127.0.0.1:9091/workflows": jsonResponse({
      workflowId: "dbos:dbos-unit-run",
      submissionOutcome: "accepted",
      status: "PENDING",
      workflowName: "AgentLabDbosBaseline",
    }, 202),
  }) });
  const manifest = manifestFor(runner, "dbos-unit-run", "fake-success");

  assert.equal((await runner.checkConnection()).reachable, true);
  assert.equal(requestHashForManifest(manifest), requestHashForManifest(manifest));
  const reference = await runner.start(manifest);

  assert.equal(reference.executionId, "dbos:dbos-unit-run");
  assert.equal(reference.native.workflowId, "dbos:dbos-unit-run");
  assert.equal(reference.native.submissionOutcome, "accepted");
  assert.equal(JSON.stringify(reference).includes("postgres"), false);
});

test("DBOS runner maps status and preserves native step metadata without model output", async () => {
  const runner = new DbosBaselineRunner({ config, serviceUrl: "http://127.0.0.1:9091", fetchImplementation: fetcher({
    "GET http://127.0.0.1:9091/workflows/dbos%3Adbos-inspect-run": jsonResponse({
      workflowId: "dbos:dbos-inspect-run",
      status: "SUCCESS",
      updatedAt: 1_700_000_000_000,
      input: null,
      steps: [{
        functionId: 1,
        name: "model.request",
        completed: true,
        startedAt: "2026-09-15T10:00:00.000Z",
        completedAt: "2026-09-15T10:00:00.100Z",
        errorName: null,
      }],
      result: {
        schemaVersion: 1,
        runId: "dbos-inspect-run",
        status: "completed",
        startedAt: "2026-09-15T10:00:00.000Z",
        finishedAt: "2026-09-15T10:00:00.100Z",
        output: "safe common result",
        error: null,
        attemptCount: 1,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        eventIntents: [],
        trajectory: { schemaVersion: 1, runId: "dbos-inspect-run", phases: [] },
        metrics: {
          schemaVersion: 1,
          runId: "dbos-inspect-run",
          status: "completed",
          durationMs: 100,
          modelCallCount: 1,
          modelAttemptCount: 1,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
        },
      },
      error: null,
    }),
  }) });
  const reference = {
    platform: "dbos",
    variant: "baseline",
    executionId: "dbos:dbos-inspect-run",
    native: {
      workflowId: "dbos:dbos-inspect-run",
      requestHash: "a".repeat(64),
      submissionOutcome: "accepted",
      nativeStatus: "PENDING",
    },
  };

  const inspection = await runner.inspect(reference);
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "safe common result");
  assert.equal(inspection.reference.native.nativeStatus, "SUCCESS");
  assert.equal(inspection.reference.native.terminalStatus, "SUCCESS");
  const steps = inspection.reference.native.steps as readonly { readonly name: string }[] | undefined;
  assert.equal(steps?.[0]?.name, "model.request");
  assert.equal(JSON.stringify(inspection.reference.native).includes("safe common result"), false);
});

test("an ambiguous DBOS start returns a stable reference for later reconciliation", async () => {
  const runner = new DbosBaselineRunner({
    config,
    serviceUrl: "http://127.0.0.1:9091",
    fetchImplementation: async () => { throw new Error("socket closed after DBOS accepted the request"); },
  });
  const reference = await runner.start(manifestFor(runner, "dbos-ambiguous-run", "fake-success"));
  assert.equal(reference.native.submissionOutcome, "unknown");
  assert.equal(reference.executionId, "dbos:dbos-ambiguous-run");
});

test("DBOS cancellation reports an accepted asynchronous request", async () => {
  const runner = new DbosBaselineRunner({ config, serviceUrl: "http://127.0.0.1:9091", fetchImplementation: fetcher({
    "POST http://127.0.0.1:9091/workflows/dbos%3Adbos-cancel-run?cancel=1": jsonResponse({ accepted: true, alreadyTerminal: false, status: "CANCELLED" }, 202),
  }) });
  const cancellation = await runner.cancel({
    platform: "dbos",
    variant: "baseline",
    executionId: "dbos:dbos-cancel-run",
    native: { workflowId: "dbos:dbos-cancel-run" },
  }, "test cancellation");
  assert.deepEqual(cancellation, {
    accepted: true,
    alreadyTerminal: false,
    message: "DBOS accepted cancellation at the workflow boundary.",
  });
});

function manifestFor(runner: DbosBaselineRunner, runId: string, model: string) {
  return buildRunManifest({
    platform: "dbos",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Return one deterministic sentence." },
    model: { provider: "fake", model },
  }, { runId, platformConfig: runner.manifestConfiguration(), serverVersion: "test" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetcher(responses: Record<string, Response>): typeof fetch {
  return async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const key = `${method} ${String(input)}`;
    const response = responses[key] ?? responses[`GET ${String(input)}`];
    if (!response) throw new Error(`No fake response for ${key}`);
    return response.clone();
  };
}
