import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { buildControlPlaneServer } from "../src/control-plane/http/server.js";
import { MastraBaselineRunner } from "../src/platforms/mastra/runner-adapter/mastra-runner.js";

test("Mastra baseline projects a deterministic Agent.generate run through the common evidence path", async () => {
  await withTemporaryRunRoot(async (root) => {
    const runner = new MastraBaselineRunner();
    const store = new RunEvidenceStore(root);
    const service = new RunService({
      config: loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo"),
      evidence: store,
      registry: new PlatformRegistry([runner]),
    });

    const created = await service.createRun({
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Say hello from the Mastra baseline." },
      model: { provider: "fake", model: "fake-success" },
    });
    const completed = await waitForCompletion(service, created.runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result?.output, "Deterministic Mastra response.");
    assert.equal(completed.executionReference?.native.processScoped, true);

    const native = JSON.parse(await readFile(join(root, completed.runId, "native/mastra.json"), "utf8")) as Record<string, unknown>;
    const nativeReference = native.native as Record<string, unknown>;
    assert.equal(nativeReference.operation, "agent.generate");
    assert.equal(nativeReference.storage, "none");
    assert.equal(JSON.stringify(native).includes("OPENROUTER_API_KEY"), false);

    for (const file of ["config.json", "events.jsonl", "trajectory.json", "metrics.json", "result.json", "native/mastra.json"]) {
      await access(join(root, completed.runId, file));
    }
  });
});

test("Mastra process loss becomes reconciliation_required instead of a fabricated result", async () => {
  await withTemporaryRunRoot(async (root) => {
    const originalRunner = new MastraBaselineRunner({ executionTimeoutMs: 1_000 });
    const store = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const firstService = new RunService({
      config,
      evidence: store,
      registry: new PlatformRegistry([originalRunner]),
    });

    const created = await firstService.createRun({
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "This run will be lost." },
      model: { provider: "fake", model: "fake-slow" },
    });

    const replacementService = new RunService({
      config,
      evidence: store,
      registry: new PlatformRegistry([new MastraBaselineRunner()]),
    });
    const reconciled = await replacementService.getRun(created.runId);
    assert.equal(reconciled.status, "reconciliation_required");
    assert.equal(reconciled.result?.error?.failureKind, "reconciliation");
    assert.equal(reconciled.result?.output, null);
  });
});

test("Mastra baseline runs through the generic HTTP API without Temporal", async () => {
  await withTemporaryRunRoot(async (root) => {
    const runner = new MastraBaselineRunner({ environment: {} });
    const evidence = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root, AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake" }, "/repo");
    const registry = new PlatformRegistry([runner]);
    const service = new RunService({ config, evidence, registry });
    const app = buildControlPlaneServer({ config, service, evidence, registry });

    try {
      await app.ready();
      const created = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          platform: "mastra",
          variant: "baseline",
          task: { kind: "prompt", prompt: "Return one generic API sentence." },
          model: { provider: "fake", model: "fake-success" },
        },
      });
      assert.equal(created.statusCode, 202, created.body);
      const run = created.json();
      assert.equal(run.status, "completed");
      assert.equal(run.result.output, "Deterministic Mastra response.");
      assert.equal(run.executionReference.executionId, `mastra:${run.runId}`);

      for (const file of ["config.json", "events.jsonl", "trajectory.json", "metrics.json", "result.json", "native/mastra.json"]) {
        const response = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}/evidence/${file}` });
        assert.equal(response.statusCode, 200, `${file}: ${response.body}`);
      }
    } finally {
      await app.close();
    }
  });
});

test("an unavailable OpenRouter profile is rejected before dispatch", async () => {
  const runner = new MastraBaselineRunner({ environment: {} });
  const manifest = buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Do not call a provider." },
      model: { provider: "openrouter", model: "aion-labs/aion-2.0" },
    },
    { platformConfig: runner.manifestConfiguration(), runId: "mastra-openrouter-unavailable" },
  );
  assert.equal(runner.validate(manifest).valid, false);
  await assert.rejects(runner.start(manifest), /OPENROUTER_API_KEY/);
});

async function waitForCompletion(service: RunService, runId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = await service.getRun(runId);
    if (view.result) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Mastra integration run did not reach a terminal state.");
}

async function withTemporaryRunRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
