import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../../src/capabilities/context/index.js";
import { createDefaultCapabilityCatalog } from "../../src/capabilities/catalog.js";
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

class ComparisonHttpRunner implements PlatformRunner {
  readonly variant = "baseline" as const;
  startCalls = 0;

  constructor(
    readonly platform: "temporal" | "restate",
    readonly outcome: "completed" | "failed",
  ) {}

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { profile: `comparison-${this.platform}` };
  }

  validate(manifest: RunManifest) {
    return manifest.platform === this.platform && manifest.variant === this.variant
      ? { valid: true, reason: null }
      : { valid: false, reason: "Unexpected comparison runner selection." };
  }

  async checkConnection() {
    return { reachable: true, message: `${this.platform} comparison fixture is ready.` };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    this.startCalls += 1;
    return referenceFor(manifest);
  }

  async cancel() {
    return { accepted: false, alreadyTerminal: true, message: "The comparison fixture is already terminal." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = reference.executionId.replace("agentlab:", "");
    const failed = this.outcome === "failed";
    const result: RunResult = {
      schemaVersion: 1,
      runId,
      status: this.outcome,
      startedAt: "2026-09-20T08:00:00.000Z",
      finishedAt: "2026-09-20T08:00:01.000Z",
      output: failed ? null : `${this.platform} comparison output`,
      error: failed
        ? { code: `${this.platform.toUpperCase()}_COMPARISON_FAILURE`, message: `${this.platform} fixture failed.`, failureKind: "provider", retryable: false }
        : null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    return {
      status: this.outcome,
      reference,
      eventIntents: [
        { source: `${this.platform}-fixture`, sourceSequence: 1, kind: "AgentStarted", runId, occurredAt: "2026-09-20T08:00:00.000Z", payload: {} },
        { source: `${this.platform}-fixture`, sourceSequence: 2, kind: failed ? "RunFailed" : "RunCompleted", runId, occurredAt: result.finishedAt, payload: {} },
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
    const capabilities = createDefaultCapabilityCatalog();
    const registry = new PlatformRegistry([runner]);
    const service = new RunService({ config, context, evidence, registry, capabilities });
    const app = buildControlPlaneServer({ config, service, evidence, registry, modelCatalog, capabilities });
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

test("HTTP API exposes server-owned capability profiles without secrets", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/capabilities" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.profiles.map((profile: { id: string }) => profile.id), ["local-safe", "local-write-approved"]);
    assert.equal(JSON.stringify(body).includes("accessToken"), false);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });
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
        comparisonId: "comparison-http-1",
        capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 } },
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
    assert.equal(run.manifest.comparisonId, "comparison-http-1");
    assert.deepEqual(run.manifest.capabilities, { tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 } });

    const events = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/events?after=2&limit=2` });
    assert.equal(events.statusCode, 200);
    assert.equal(events.json().events[0].recordedSequence, 3);
    assert.equal(events.json().hasMore, false);

    const evidence = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/result.json` });
    assert.equal(evidence.statusCode, 200);
    assert.equal(JSON.parse(evidence.body).output, "hello");

    const capabilities = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/capabilities.json` });
    assert.equal(capabilities.statusCode, 200);

    const native = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/native/temporal.json` });
    assert.equal(native.statusCode, 200);

    const logs = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/logs/operations.jsonl` });
    assert.equal(logs.statusCode, 200);
    assert.equal(logs.headers["content-type"], "application/x-ndjson; charset=utf-8");
    assert.equal(JSON.parse(logs.body).requestId, "request-test-1");
    assert.equal(logs.body.includes("Hello"), false);

    const wrongPlatformNative = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/native/restate.json` });
    assert.equal(wrongPlatformNative.statusCode, 400);

    const traversal = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/../config.json` });
    assert.notEqual(traversal.statusCode, 200);
  });
});

test("a selected capability profile is resolved before dispatch and retained as redacted evidence", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Read the local fixture." },
        model: { provider: "fake", model: "fake-success" },
        capabilities: { profileId: "local-safe" },
      },
    });
    assert.equal(response.statusCode, 202);
    const run = response.json();
    assert.equal(run.manifest.capabilities.profileId, "local-safe");
    assert.deepEqual(run.manifest.capabilities.tools.enabledNames, ["calculator", "fixture_lookup"]);
    assert.deepEqual(run.manifest.capabilities.resolution.grants.map((grant: { manifest: { id: string } }) => grant.manifest.id), ["calculator", "fixture_lookup"]);
    const evidence = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/capabilities.json` });
    assert.equal(evidence.statusCode, 200);
    assert.equal(evidence.body.includes("accessToken"), false);

    const events = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/events?after=0&limit=20` });
    assert.equal(events.statusCode, 200);
    const resolution = events.json().events.find((event: { kind: string }) => event.kind === "CapabilityResolutionRecorded");
    assert.deepEqual(resolution?.payload.grants.map((grant: { capabilityId: string; connectionRef: string | null }) => [grant.capabilityId, grant.connectionRef]), [
      ["calculator", null],
      ["fixture_lookup", "conn_local_fixture"],
    ]);
    assert.equal(resolution?.payload.decisions.length, 2);

    const logs = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/logs/operations.jsonl` });
    assert.equal(logs.statusCode, 200);
    assert.match(logs.body, /capability\.resolve/);

    const metrics = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/evidence/metrics.json` });
    assert.equal(metrics.statusCode, 200);
    assert.equal(metrics.json().approvalDecisionCount, 2);
  });
});

test("HTTP retains an explicit write approval in the immutable run manifest", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Use the approved local write fixture." },
        model: { provider: "fake", model: "fake-success" },
        capabilities: {
          profileId: "local-write-approved",
          tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 },
          approvals: [{
            schemaVersion: 1,
            decisionId: "approval_fixture_write_http",
            capabilityId: "fixture_write",
            version: "1.0.0",
            allowedOperations: ["write"],
            connectionRef: "conn_local_fixture",
            decision: "approved",
            decidedAt: "2026-09-20T00:00:00.000Z",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }],
        },
      },
    });
    assert.equal(response.statusCode, 202);
    const run = response.json();
    assert.deepEqual(run.manifest.capabilities.tools.enabledNames, ["calculator", "fixture_lookup", "fixture_write"]);
    assert.deepEqual(run.manifest.capabilities.tools.approvedNames, ["fixture_write"]);
    assert.equal(run.manifest.capabilities.resolution.decisions.find((decision: { capabilityId: string }) => decision.capabilityId === "fixture_write").status, "granted");
    assert.equal(run.manifest.capabilities.approvals[0].decision, "approved");
  });
});

test("comparison members retain one correlation ID and independent run sessions", async () => {
  await withApp(async (app) => {
    const createMember = (prompt: string) => app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "temporal",
        variant: "baseline",
        comparisonId: "comparison-http-members",
        task: { kind: "prompt", prompt },
        model: { provider: "fake", model: "fake-success" },
      },
    });

    const [firstResponse, secondResponse] = await Promise.all([
      createMember("First comparison member."),
      createMember("Second comparison member."),
    ]);
    assert.equal(firstResponse.statusCode, 202);
    assert.equal(secondResponse.statusCode, 202);

    const first = firstResponse.json();
    const second = secondResponse.json();
    assert.equal(first.manifest.comparisonId, "comparison-http-members");
    assert.equal(second.manifest.comparisonId, "comparison-http-members");
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.manifest.context.sessionId, second.manifest.context.sessionId);
  }, undefined, { context: true });
});

test("comparison members keep terminal outcomes and evidence independent", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-http-comparison-"));
  try {
    const completedRunner = new ComparisonHttpRunner("temporal", "completed");
    const failedRunner = new ComparisonHttpRunner("restate", "failed");
    const evidence = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const registry = new PlatformRegistry([completedRunner, failedRunner]);
    const service = new RunService({ config, evidence, registry });
    const app = buildControlPlaneServer({ config, service, evidence, registry });
    await app.ready();

    try {
      const createMember = (platform: string) => app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          platform,
          variant: "baseline",
          comparisonId: "comparison-http-partial",
          task: { kind: "prompt", prompt: "Use the same deterministic comparison task." },
          model: { provider: "fake", model: "fake-success" },
        },
      });

      const [completedResponse, failedResponse] = await Promise.all([
        createMember("temporal"),
        createMember("restate"),
      ]);
      assert.equal(completedResponse.statusCode, 202);
      assert.equal(failedResponse.statusCode, 202);

      const completed = completedResponse.json();
      const failed = failedResponse.json();
      assert.equal(completed.status, "completed");
      assert.equal(failed.status, "failed");
      assert.equal(completed.manifest.comparisonId, failed.manifest.comparisonId);
      assert.deepEqual(completed.manifest.task, failed.manifest.task);
      assert.deepEqual(completed.manifest.model, failed.manifest.model);
      assert.equal(completed.manifest.platformConfig.profile, "comparison-temporal");
      assert.equal(failed.manifest.platformConfig.profile, "comparison-restate");
      assert.notEqual(completed.runId, failed.runId);
      assert.notEqual(completed.executionReference.executionId, failed.executionReference.executionId);
      assert.equal(completed.result.output, "temporal comparison output");
      assert.equal(failed.result.output, null);
      assert.equal(failed.result.error.code, "RESTATE_COMPARISON_FAILURE");
      assert.equal(completedRunner.startCalls, 1);
      assert.equal(failedRunner.startCalls, 1);

      const completedEvents = await readFile(join(root, completed.runId, "events.jsonl"), "utf8");
      const failedEvents = await readFile(join(root, failed.runId, "events.jsonl"), "utf8");
      assert.match(completedEvents, /RunCompleted/);
      assert.doesNotMatch(completedEvents, /RunFailed/);
      assert.match(failedEvents, /RunFailed/);
      assert.doesNotMatch(failedEvents, /RunCompleted/);

      const completedNative = await readFile(join(root, completed.runId, "native/temporal.json"), "utf8");
      const failedNative = await readFile(join(root, failed.runId, "native/restate.json"), "utf8");
      assert.match(completedNative, /agentlab:/);
      assert.match(failedNative, /agentlab:/);
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
