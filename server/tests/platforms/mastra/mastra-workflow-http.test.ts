import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
