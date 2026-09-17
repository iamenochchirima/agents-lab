import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import { buildControlPlaneServer } from "../../src/control-plane/http/server.js";
import { createStudioModule } from "../../src/studio/index.js";
import type { StudioComparisonRequest } from "../../src/studio/index.js";

test("Studio runs a controlled context comparison through the existing server", async () => {
  await withStudioApp(async (app, studioRoot) => {
    const created = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      headers: { "x-idempotency-key": "context-comparison-1" },
      payload: comparisonRequest(),
    });

    assert.equal(created.statusCode, 202);
    const comparison = created.json();
    assert.equal(comparison.status, "completed");
    assert.equal(comparison.trials.length, 2);
    assert.equal(comparison.trials[0].manifest.strategy.id, "full-history");
    assert.equal(comparison.trials[0].context.retainedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[0].result.output, "The support agent should use English for this account.");
    assert.equal(comparison.trials[1].manifest.strategy.id, "sliding-window");
    assert.equal(comparison.trials[1].context.omittedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[1].result.output, "The required account preference was not present in the model context.");
    assert.equal(
      comparison.trials[0].manifest.fixedControlFingerprint,
      comparison.trials[1].manifest.fixedControlFingerprint,
    );
    assert.notEqual(comparison.trials[0].manifest.strategy.id, comparison.trials[1].manifest.strategy.id);
    assert.notDeepEqual(comparison.trials[0].manifest.strategy, comparison.trials[1].manifest.strategy);
    assert.equal(comparison.metrics.totalTokens, null);

    const events = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/events?after=0&limit=50`,
    });
    assert.equal(events.statusCode, 200);
    assert.deepEqual(
      events.json().events.map((event: { kind: string }) => event.kind),
      [
        "ComparisonCreated",
        "ComparisonStarted",
        "TrialCreated",
        "ContextAssembled",
        "ModelRequested",
        "ModelCompleted",
        "TrialCompleted",
        "TrialCreated",
        "ContextAssembled",
        "ModelRequested",
        "ModelCompleted",
        "TrialCompleted",
        "ComparisonCompleted",
      ],
    );

    const evidence = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[0].manifest.trialId}/context.json`,
    });
    assert.equal(evidence.statusCode, 200);
    assert.equal(JSON.parse(evidence.body).strategyId, "full-history");

    const config = await readFile(join(studioRoot, comparison.manifest.comparisonId, "config.json"), "utf8");
    assert.equal(JSON.parse(config).fixedEnvelope.model, "context-replay-v1");
    assert.deepEqual(await readDirectoryOrEmpty(join(studioRoot, "..", "platform-runs")), []);
  });
});

test("Studio can execute a three-strategy Context comparison through the same server", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-three-way", true),
    });

    assert.equal(response.statusCode, 202);
    const comparison = response.json();
    assert.equal(comparison.status, "completed");
    assert.deepEqual(
      comparison.trials.map((trial: { manifest: { strategy: { id: string } } }) => trial.manifest.strategy.id),
      ["full-history", "sliding-window", "relevance-ranked"],
    );
    assert.equal(comparison.trials[2].context.retainedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[2].result.output, "The support agent should use English for this account.");
  });
});

test("Studio catalog exposes all harness areas without claiming planned implementations", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/studio/catalog" });
    assert.equal(response.statusCode, 200);
    const catalog = response.json();
    assert.equal(catalog.components.length, 11);
    assert.equal(catalog.components[0].id, "input-perception");
    assert.equal(catalog.components[1].id, "context-management");
    assert.equal(catalog.components[1].status, "available");
    assert.deepEqual(catalog.components[1].strategies.map((strategy: { id: string }) => strategy.id), ["full-history", "sliding-window", "relevance-ranked"]);
    assert.equal(catalog.components[3].id, "memory");
    assert.equal(catalog.components[3].status, "planned");
    assert.deepEqual(catalog.components[3].strategies, []);
    assert.equal(JSON.stringify(catalog).includes("expectedAnswer"), false);
    assert.equal(JSON.stringify(catalog).includes("context-fact-language"), false);
  });
});

test("Studio idempotency returns the original comparison and rejects a changed request", async () => {
  await withStudioApp(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-2"),
    });
    assert.equal(first.statusCode, 202);
    const firstComparison = first.json();

    const repeated = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-2"),
    });
    assert.equal(repeated.statusCode, 202);
    assert.equal(repeated.json().manifest.comparisonId, firstComparison.manifest.comparisonId);

    const changed = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: {
        ...comparisonRequest("context-comparison-2"),
        seed: "different-seed",
      },
    });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, "STUDIO_CONFLICT");

    const distinct = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-3"),
    });
    assert.equal(distinct.statusCode, 202);
    assert.notEqual(distinct.json().manifest.comparisonId, firstComparison.manifest.comparisonId);
  });
});

test("Studio rejects unsupported strategies and does not create a comparison", async () => {
  await withStudioApp(async (app, studioRoot) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: {
        ...comparisonRequest("context-comparison-invalid"),
        experiment: {
          ...comparisonRequest("context-comparison-invalid").experiment,
          subject: {
            component: "context-management",
            strategies: [
              { id: "unknown-strategy", version: "1", parameters: {} },
              { id: "sliding-window", version: "1", parameters: {} },
            ],
          },
        },
      },
    });
    assert.equal(response.statusCode, 400);
    const entries = await readDirectoryOrEmpty(studioRoot);
    assert.deepEqual(entries, []);
  });
});

function comparisonRequest(idempotencyKey = "context-comparison-1", includeRelevance = false): StudioComparisonRequest {
  const strategies: StudioComparisonRequest["experiment"]["subject"]["strategies"][number][] = [
    { id: "full-history", version: "1", parameters: {} },
    { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
  ];
  if (includeRelevance) strategies.push({ id: "relevance-ranked", version: "1", parameters: { maxMessages: "4" } });
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-context-retention",
      version: "1",
      scenario: { id: "context-old-important-fact", version: "1" },
      subject: {
        component: "context-management",
        strategies,
      },
    },
    seed: "seed-1",
    idempotencyKey,
  };
}

async function readDirectoryOrEmpty(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function withStudioApp(run: (app: ReturnType<typeof buildControlPlaneServer>, studioRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-"));
  const studioRoot = join(root, "studio-runs");
  try {
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: join(root, "platform-runs"),
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
      AGENTLAB_STUDIO_RUN_ROOT: studioRoot,
    }, "/repo");
    const evidence = new RunEvidenceStore(config.runsRoot);
    const registry = new PlatformRegistry([]);
    const service = new RunService({ config, evidence, registry });
    const app = buildControlPlaneServer({ config, service, evidence, registry });
    createStudioModule(config.studioRunsRoot).register(app);
    await app.ready();
    try {
      await run(app, studioRoot);
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
