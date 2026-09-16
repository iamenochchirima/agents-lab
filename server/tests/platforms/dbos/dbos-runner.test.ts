import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { dirname, join } from "node:path";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { loadDbosConfig } from "../../../src/platforms/dbos/config.js";
import { DbosBaselineRunner, requestHashForManifest } from "../../../src/platforms/dbos/runner-adapter/dbos-runner.js";
import { loadDbosSdk } from "../../../src/platforms/dbos/sdk.js";
import { dbosBaselineWorkflow } from "../../../src/platforms/dbos/variants/baseline/workflow.js";
import type { DbosWorkflowInput, DbosWorkflowResult } from "../../../src/platforms/dbos/variants/baseline/contracts.js";

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

test("DBOS workflow executes the selected OpenRouter model through its step boundary", async () => {
  const { DBOS } = loadDbosSdk();
  const { getFunctionRegistration, runWithTopContext } = dbosTestHooks();
  const previousRunStep = DBOS.runStep;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousBaseUrl = process.env.AGENTLAB_OPENROUTER_BASE_URL;
  const previousFetch = globalThis.fetch;
  const stepNames: string[] = [];
  let requestBody: Record<string, unknown> | null = null;

  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.AGENTLAB_OPENROUTER_BASE_URL = "https://openrouter.example/v1";
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), "https://openrouter.example/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "dbos-openrouter-provider-id",
      choices: [{ message: { content: "hello from DBOS OpenRouter" } }],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    }), { status: 200 });
  }) as typeof fetch;

  DBOS.runStep = async <T>(callback: () => T | Promise<T>, config: { readonly name?: string } = {}): Promise<T> => {
    stepNames.push(config.name ?? "anonymous");
    return callback();
  };

  try {
    const registration = getFunctionRegistration(dbosBaselineWorkflow);
    const registeredWorkflow = registration?.registeredFunction;
    if (!registeredWorkflow) throw new Error("DBOS workflow registration did not expose its native function.");
    const result = await runWithTopContext({
      workflowId: "dbos-native-openrouter-test",
      curWFFunctionId: 0,
      request: { id: "dbos-native-openrouter-test" },
      stepStatus: { stepID: 1, currentAttempt: 1, timeoutSignal: new AbortController().signal },
    }, () => registeredWorkflow(workflowInput("dbos-native-openrouter-test")));

    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.deepEqual(stepNames, ["model.request", "run.timestamp", "run.timestamp"]);
    assert.equal(result.status, "completed");
    assert.equal(result.output, "hello from DBOS OpenRouter");
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 7, totalTokens: 12 });
    assert.equal(result.metrics.modelCallCount, 1);
    assert.equal(result.metrics.modelAttemptCount, 1);
    assert.deepEqual(result.eventIntents.find((event) => event.kind === "ModelRequested")?.payload, {
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
      step: "model.request",
    });
    assert.deepEqual(result.trajectory.phases.map((phase) => phase.name), ["dbos_workflow", "model_request_step"]);
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    DBOS.runStep = previousRunStep;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL;
    else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBaseUrl;
  }
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

function dbosTestHooks(): {
  readonly getFunctionRegistration: (target: unknown) => {
    readonly registeredFunction?: (input: DbosWorkflowInput) => Promise<DbosWorkflowResult>;
  } | undefined;
  readonly runWithTopContext: <T>(context: Record<string, unknown>, callback: () => Promise<T>) => Promise<T>;
} {
  const require = createRequire(import.meta.url);
  const platformDirectory = new URL("../../../src/platforms/dbos/", import.meta.url).pathname;
  const packageEntry = require.resolve("@dbos-inc/dbos-sdk", { paths: [platformDirectory] });
  const packageRoot = dirname(packageEntry);
  return {
    ...require(join(packageRoot, "decorators.js")) as {
      readonly getFunctionRegistration: (target: unknown) => {
        readonly registeredFunction?: (input: DbosWorkflowInput) => Promise<DbosWorkflowResult>;
      } | undefined;
    },
    ...require(join(packageRoot, "context.js")) as {
      readonly runWithTopContext: <T>(context: Record<string, unknown>, callback: () => Promise<T>) => Promise<T>;
    },
  };
}

function workflowInput(runId: string): DbosWorkflowInput {
  return {
    runId,
    prompt: "Say hello from a DBOS workflow.",
    systemInstruction: "Respond directly.",
    model: { provider: "openrouter", model: "cohere/north-mini-code:free" },
    requestHash: "b".repeat(64),
    startedAt: "2026-09-16T12:00:00.000Z",
    modelStepTimeoutMs: 1_000,
    modelStepMaxAttempts: 1,
  };
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
