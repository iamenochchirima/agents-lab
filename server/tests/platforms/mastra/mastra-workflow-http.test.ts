import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../../../src/capabilities/context/index.js";
import { loadServerConfig } from "../../../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../../src/control-plane/application/run-service.js";
import { buildControlPlaneServer } from "../../../src/control-plane/http/server.js";
import { MastraWorkflowRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-workflow-runner.js";

test("Mastra workflow suspend and resume work through the HTTP server boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-http-"));
  const config = loadServerConfig({
    AGENTLAB_RUN_ROOT: join(root, "runs"),
    AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
  }, root);
  const runner = new MastraWorkflowRunner({
    storagePath: join(root, "workflow.db"),
    contextRoot: config.contextRoot,
  });
  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({
    config,
    context: new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator()),
    evidence,
    registry,
  });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "mastra",
        variant: "workflow",
        task: { kind: "prompt", prompt: "[approval] Publish the prepared post." },
        model: { provider: "fake", model: "fake-success", contextWindowTokens: 128_000 },
      },
    });
    assert.equal(created.statusCode, 202);
    const createdRun = created.json<{ runId: string; status: string }>();
    assert.equal(createdRun.status, "suspended", JSON.stringify(created.json()));

    const invalidResume = await app.inject({
      method: "POST",
      url: `/api/runs/${createdRun.runId}/resume`,
      payload: { approved: "yes" },
    });
    assert.equal(invalidResume.statusCode, 400);

    const resumed = await app.inject({
      method: "POST",
      url: `/api/runs/${createdRun.runId}/resume`,
      payload: { approved: true },
    });
    assert.equal(resumed.statusCode, 200);

    const completed = await waitForCompletion(app, createdRun.runId);
    assert.equal(completed.status, "completed");
    assert.ok(completed.result);
    assert.equal(completed.result.output, "Deterministic Mastra response.");
    assert.ok(completed.events.some((event) => event.kind === "RunResumeRequested"));

    const native = await app.inject({ method: "GET", url: `/api/runs/${createdRun.runId}/evidence/native/mastra.json` });
    assert.equal(native.statusCode, 200);
    assert.equal(native.json().native.nativeStatus, "success");
  } finally {
    await app.close();
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow storage failure is visible through server readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-health-"));
  const storageDirectory = join(root, "workflow-storage-directory");
  await mkdir(storageDirectory);
  const config = loadServerConfig({
    AGENTLAB_RUN_ROOT: join(root, "runs"),
    AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
  }, root);
  const runner = new MastraWorkflowRunner({
    storagePath: storageDirectory,
    contextRoot: config.contextRoot,
  });
  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({ config, evidence, registry });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 503);
    assert.equal(health.json<{ status: string }>().status, "degraded");
    assert.match(health.body, /Mastra workflow storage is unavailable/i);

    const selected = await app.inject({ method: "GET", url: "/api/platforms/mastra/health?variant=workflow" });
    assert.equal(selected.statusCode, 200);
    assert.equal(selected.json<{ reachable: boolean }>().reachable, false);
  } finally {
    await app.close();
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow continues two turns from the shared Lab context session", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-context-"));
  const config = loadServerConfig({
    AGENTLAB_RUN_ROOT: join(root, "runs"),
    AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
    AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
  }, root);
  const runner = new MastraWorkflowRunner({
    storagePath: join(root, "workflow.db"),
    contextRoot: config.contextRoot,
  });
  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({
    config,
    context: new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator()),
    evidence,
    registry,
  });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const firstCreated = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "mastra",
        variant: "workflow",
        sessionId: "mastra-workflow-context-session",
        clientTurnId: "turn-1",
        task: { kind: "prompt", prompt: "Remember conformance-4318." },
        model: { provider: "fake", model: "fake-context", contextWindowTokens: 16_384 },
      },
    });
    assert.equal(firstCreated.statusCode, 202, firstCreated.body);
    const firstRun = firstCreated.json<{ runId: string }>();
    const first = await waitForCompletion(app, firstRun.runId);
    assert.equal(first.result?.output, "Stored the test value.");

    const secondCreated = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "mastra",
        variant: "workflow",
        sessionId: "mastra-workflow-context-session",
        clientTurnId: "turn-2",
        task: { kind: "prompt", prompt: "What value did I ask you to remember?" },
        model: { provider: "fake", model: "fake-context", contextWindowTokens: 16_384 },
      },
    });
    assert.equal(secondCreated.statusCode, 202, secondCreated.body);
    const secondRun = secondCreated.json<{ runId: string }>();
    const second = await waitForCompletion(app, secondRun.runId);
    assert.equal(second.result?.output, "conformance-4318");
    assert.equal(second.events.some((event) => event.kind === "ContextPrepared"), true);
  } finally {
    await app.close();
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow compacts an oversized shared context before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-compaction-"));
  const config = loadServerConfig({
    AGENTLAB_RUN_ROOT: join(root, "runs"),
    AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
    AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
  }, root);
  const contextStore = new ContextSessionStore(config.contextRoot, config.context);
  await contextStore.create({
    sessionId: "mastra-workflow-compaction-session",
    platform: "mastra",
    variant: "workflow",
    model: "fake/fake-context",
    systemInstruction: "You are the Agent Harness Lab baseline agent. Answer the user's prompt directly and concisely.",
    contextWindowTokens: 7_000,
    reservedOutputTokens: 4_096,
    safetyMarginTokens: 1_024,
    compactionThresholdPercent: 20,
    recentMessageGroups: 2,
  });
  const seeded = await contextStore.admitTurn(
    "mastra-workflow-compaction-session",
    "mastra-workflow-compaction-seed",
    `Historical request ${"x".repeat(9_000)}`,
  );
  await contextStore.settleTurn("mastra-workflow-compaction-session", seeded.turn.turnId, {
    status: "completed",
    output: `Historical response ${"y".repeat(9_000)}`,
  });

  const runner = new MastraWorkflowRunner({
    storagePath: join(root, "workflow.db"),
    contextRoot: config.contextRoot,
  });
  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({
    config,
    context: new ContextService(contextStore, new CharacterTokenEstimator()),
    evidence,
    registry,
  });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "mastra",
        variant: "workflow",
        sessionId: "mastra-workflow-compaction-session",
        task: { kind: "prompt", prompt: "Answer after context compaction." },
        model: { provider: "fake", model: "fake-context", contextWindowTokens: 7_000 },
      },
    });
    assert.equal(created.statusCode, 202, created.body);
    const createdRun = created.json<{ runId: string }>();
    const completed = await waitForCompletion(app, createdRun.runId);
    assert.equal(completed.status, "completed");
    assert.ok(completed.events.some((event) => event.kind === "ContextPrepared" && event.payload.compacted === true));

    const run = await app.inject({ method: "GET", url: `/api/runs/${createdRun.runId}` });
    assert.equal(run.statusCode, 200);
    const snapshot = await contextStore.latestSnapshot("mastra-workflow-compaction-session");
    assert.ok(snapshot);
    assert.notEqual(snapshot.budget.pressure, "exhausted");
    assert.ok(snapshot.budget.remainingPercent !== null);
  } finally {
    await app.close();
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

interface HttpRunView {
  readonly status: string;
  readonly result: { readonly output: string | null } | null;
  readonly events: readonly { readonly kind: string }[];
}

async function waitForCompletion(app: ReturnType<typeof buildControlPlaneServer>, runId: string): Promise<HttpRunView & { readonly result: { readonly output: string | null } }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    assert.equal(response.statusCode, 200);
    const run = response.json<HttpRunView>();
    if (run.status === "completed" && run.result) return run as HttpRunView & { readonly result: { readonly output: string | null } };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Mastra workflow did not complete through the HTTP server.");
}
