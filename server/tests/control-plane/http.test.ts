import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import { buildControlPlaneServer } from "../../src/control-plane/http/server.js";
import type { OpenRouterCatalogClient } from "../../src/models/openrouter/catalog.js";
import type { PlatformExecutionReference, RunManifest, RunResult } from "../../src/control-plane/domain/types.js";
import type { PlatformRunner, RunnerInspection } from "../../src/control-plane/ports/runner.js";

class HttpRunner implements PlatformRunner {
  readonly platform = "temporal" as const;
  readonly variant = "baseline" as const;
  reachable = true;
  cancelled = false;
  running = false;
  startCalls = 0;

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { profile: "http-test" };
  }

  validate() { return { valid: true, reason: null } as const; }
  async checkConnection() { return { reachable: this.reachable, message: this.reachable ? "ok" : "offline" }; }
  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    this.startCalls += 1;
    return referenceFor(manifest);
  }
  async cancel() { this.cancelled = true; return { accepted: true, alreadyTerminal: false, message: "accepted" }; }
  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = reference.executionId.replace("agentlab:", "");
    const result: RunResult | null = this.cancelled ? {
      schemaVersion: 1, runId, status: "cancelled", startedAt: "2026-09-15T08:00:00.000Z", finishedAt: "2026-09-15T08:00:01.000Z", output: null,
      error: { code: "RUN_CANCELLED", message: "cancelled", failureKind: "cancelled", retryable: false }, attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    } : this.running ? null : {
      schemaVersion: 1, runId, status: "completed", startedAt: "2026-09-15T08:00:00.000Z", finishedAt: "2026-09-15T08:00:01.000Z", output: "hello", error: null, attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    return {
      status: this.cancelled ? "cancelled" : this.running ? "running" : "completed",
      reference,
      eventIntents: [
        { source: "temporal-workflow", sourceSequence: 1, kind: "AgentStarted", runId, occurredAt: "2026-09-15T08:00:00.000Z", payload: {} },
        ...(this.running && !this.cancelled ? [] : [{ source: "temporal-workflow", sourceSequence: 2, kind: this.cancelled ? "RunCancelled" : "RunCompleted", runId, occurredAt: "2026-09-15T08:00:01.000Z", payload: {} }]),
      ],
      result,
      trajectory: { schemaVersion: 1, runId, phases: [] },
      metrics: null,
    };
  }
}

function referenceFor(manifest: RunManifest): PlatformExecutionReference {
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: `agentlab:${manifest.runId}`,
    native: { executionId: `agentlab:${manifest.runId}` },
  };
}

async function withApp(
  run: (app: ReturnType<typeof buildControlPlaneServer>, runner: HttpRunner, root: string) => Promise<void>,
  modelCatalog?: OpenRouterCatalogClient,
  options: { readonly context?: boolean; readonly environment?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-http-"));
  try {
    const runner = new HttpRunner();
    const evidence = new RunEvidenceStore(root);
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: root,
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
      ...options.environment,
    }, "/repo");
    const context = options.context
      ? new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator())
      : undefined;
    const service = new RunService({ config, context, evidence, registry: new PlatformRegistry([runner]) });
    const app = buildControlPlaneServer({ config, service, evidence, registry: new PlatformRegistry([runner]), modelCatalog });
    await app.ready();
    try {
      await run(app, runner, root);
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("HTTP API exposes only safe, searchable OpenRouter model metadata", async () => {
  const modelCatalog: OpenRouterCatalogClient = {
    async list(query = "") {
      return {
        provider: "openrouter",
        defaultModel: "openai/gpt-4o-mini",
        models: [{
          id: query ? "openai/gpt-4o-mini" : "openai/gpt-4o-mini",
          name: "GPT-4o mini",
          description: null,
          contextLength: 128000,
          inputModalities: ["text"],
          outputModalities: ["text"],
          promptPriceUsdPerMillion: 0.15,
          completionPriceUsdPerMillion: 0.6,
          isFree: false,
          supportsTools: true,
        }],
      };
    },
  };

  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/models?q=gpt%204o&limit=1" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      provider: "openrouter",
      defaultModel: "openai/gpt-4o-mini",
      models: [modelCatalogResult()],
    });

    const invalidProvider = await app.inject({ method: "GET", url: "/api/models?provider=fake" });
    assert.equal(invalidProvider.statusCode, 400);
  }, modelCatalog);
});

function modelCatalogResult() {
  return {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    description: null,
    contextLength: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0.15,
    completionPriceUsdPerMillion: 0.6,
    isFree: false,
    supportsTools: true,
  };
}

test("HTTP API accepts a run, exposes events, and reads only safe evidence", async () => {
  await withApp(async (app) => {
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { "x-request-id": "request-test-1" },
      payload: {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Hello" },
        model: { provider: "fake", model: "fake-success" },
        selection: { scenarioId: "research", backendProfileId: "local-temporal-stack" },
      },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.headers["x-request-id"], "request-test-1");
    const run = created.json();
    assert.equal(run.status, "completed");
    assert.deepEqual(run.projection, {
      state: "current",
      observedAt: run.projection.observedAt,
      reason: null,
    });
    assert.deepEqual(run.manifest.selection, { scenarioId: "research", backendProfileId: "local-temporal-stack" });

    const events = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/events?after=2&limit=2` });
    assert.equal(events.statusCode, 200);
    assert.equal(events.json().events[0].recordedSequence, 3);
    assert.equal(events.json().hasMore, false);

    const evidence = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/result.json` });
    assert.equal(evidence.statusCode, 200);
    assert.equal(JSON.parse(evidence.body).output, "hello");

    const native = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/native/temporal.json` });
    assert.equal(native.statusCode, 200);

    const wrongPlatformNative = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/native/restate.json` });
    assert.equal(wrongPlatformNative.statusCode, 400);

    const traversal = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/../config.json` });
    assert.notEqual(traversal.statusCode, 200);
  });
});

test("HTTP API returns structured validation and health responses", async () => {
  await withApp(async (app, runner) => {
    const invalid = await app.inject({ method: "POST", url: "/api/runs", payload: { platform: "temporal" } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "INVALID_REQUEST");

    const invalidIdentifier = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "Temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "invalid identifier" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(invalidIdentifier.statusCode, 400);

    const planned = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: "planned platform" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(planned.statusCode, 503);
    assert.match(planned.json().error.message, /planned/);

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().controlPlane.ready, true);
    assert.equal(health.json().platforms[0].platform, "temporal");

    const readiness = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readiness.statusCode, 200);
    assert.deepEqual(readiness.json(), { status: "ready", controlPlane: { ready: true } });

    runner.reachable = false;
    const degraded = await app.inject({ method: "GET", url: "/health" });
    assert.equal(degraded.statusCode, 503);
    assert.equal(degraded.json().platforms[0].reachable, false);
  });
});

test("HTTP API classifies idempotent replays, concurrent turns, and context limits", async () => {
  await withApp(async (app, runner, root) => {
    const first = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-idempotency",
        clientTurnId: "client-turn-1",
        task: { kind: "prompt", prompt: "Keep this turn" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(first.statusCode, 202);
    const firstRun = first.json();

    const replay = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-idempotency",
        clientTurnId: "client-turn-1",
        task: { kind: "prompt", prompt: "Keep this turn" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, firstRun.runId);
    assert.equal(runner.startCalls, 1);

    const changed = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-idempotency",
        clientTurnId: "client-turn-1",
        task: { kind: "prompt", prompt: "Changed turn" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, "CONTEXT_CONFLICT");

    runner.running = true;
    const active = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-busy",
        clientTurnId: "client-turn-1",
        task: { kind: "prompt", prompt: "Active turn" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(active.statusCode, 202);
    const busy = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-busy",
        clientTurnId: "client-turn-2",
        task: { kind: "prompt", prompt: "Overtake" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.json().error.code, "CONTEXT_BUSY");

    const sessionsBeforeInvalid = await readdir(join(root, "sessions"));
    const invalid = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        clientTurnId: "client-without-session",
        task: { kind: "prompt", prompt: "Must not create a session" },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(await readdir(join(root, "sessions")), sessionsBeforeInvalid);
  }, undefined, { context: true });

  await withApp(async (app, runner) => {
    const limited = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        sessionId: "session-http-limit",
        task: { kind: "prompt", prompt: "x".repeat(500) },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(limited.statusCode, 413);
    assert.equal(limited.json().error.code, "CONTEXT_LIMIT_EXCEEDED");
    assert.equal(runner.startCalls, 0);
  }, undefined, {
    context: true,
    environment: {
      AGENTLAB_CONTEXT_MAX_SESSION_BYTES: "1024",
      AGENTLAB_CONTEXT_MAX_TRANSCRIPT_BYTES: "50000",
    },
  });
});

test("HTTP API exposes selected platform connectivity without aggregate health failure", async () => {
  await withApp(async (app, runner) => {
    const reachable = await app.inject({ method: "GET", url: "/api/platforms/temporal/health" });
    assert.equal(reachable.statusCode, 200);
    assert.deepEqual(reachable.json(), {
      platform: "temporal",
      variant: "baseline",
      reachable: true,
      message: "ok",
    });

    runner.reachable = false;
    const unavailable = await app.inject({ method: "GET", url: "/api/platforms/temporal/health" });
    assert.equal(unavailable.statusCode, 200);
    assert.deepEqual(unavailable.json(), {
      platform: "temporal",
      variant: "baseline",
      reachable: false,
      message: "offline",
    });

    const planned = await app.inject({ method: "GET", url: "/api/platforms/restate/health" });
    assert.equal(planned.statusCode, 200);
    assert.deepEqual(planned.json(), {
      platform: "restate",
      variant: "baseline",
      reachable: false,
      message: "Platform runner is not registered.",
    });
  });
});

test("HTTP API routes cancellation and unknown runs safely", async () => {
  await withApp(async (app, runner) => {
    const created = await app.inject({ method: "POST", url: "/api/runs", payload: { platform: "temporal", variant: "baseline", task: { kind: "prompt", prompt: "Cancel" }, model: { provider: "fake", model: "fake-success" } } });
    const runId = created.json().runId;
    // The fake runner completed immediately; the endpoint remains idempotent.
    const cancelled = await app.inject({ method: "POST", url: `/api/runs/${runId}/cancel`, payload: { reason: "stop" } });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().status, "completed");
    assert.equal(runner.cancelled, false);

    const missing = await app.inject({ method: "GET", url: "/api/runs/does-not-exist" });
    assert.equal(missing.statusCode, 404);
  });
});
