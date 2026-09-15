import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import type { PlatformExecutionReference, RunManifest, RunResult } from "../../src/control-plane/domain/types.js";
import type { PlatformRunner, RunnerInspection } from "../../src/control-plane/ports/runner.js";

class InMemoryRestateRunner implements PlatformRunner {
  readonly platform = "restate" as const;
  readonly variant = "baseline" as const;
  outcome: "completed" | "failed" = "completed";

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return { profile: "in-memory-restate-test" };
  }

  validate(manifest: RunManifest) {
    return manifest.platform === this.platform && manifest.variant === this.variant
      ? { valid: true, reason: null }
      : { valid: false, reason: "Unexpected platform selection." };
  }

  async checkConnection() {
    return { reachable: true, message: "In-memory runner is ready." };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    return {
      platform: this.platform,
      variant: this.variant,
      executionId: `memory:${manifest.runId}`,
      native: { handler: "baseline", invocationId: manifest.runId },
    };
  }

  async cancel(_reference: PlatformExecutionReference) {
    return { accepted: false, alreadyTerminal: true, message: "The in-memory run is already terminal." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = reference.executionId.replace("memory:", "");
    const failed = this.outcome === "failed";
    const result: RunResult = {
      schemaVersion: 1,
      runId,
      status: this.outcome,
      startedAt: "2026-09-15T08:00:00.000Z",
      finishedAt: "2026-09-15T08:00:01.000Z",
      output: failed ? null : "restate test output",
      error: failed
        ? { code: "RESTATE_TEST_FAILURE", message: "in-memory failure", failureKind: "provider", retryable: false }
        : null,
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    return {
      status: this.outcome,
      reference,
      eventIntents: [
        { source: "restate-handler", sourceSequence: 1, kind: "AgentStarted", runId, occurredAt: "2026-09-15T08:00:00.000Z", payload: {} },
        { source: "restate-handler", sourceSequence: 2, kind: failed ? "RunFailed" : "RunCompleted", runId, occurredAt: result.finishedAt, payload: {} },
      ],
      result,
      trajectory: { schemaVersion: 1, runId, phases: [] },
      metrics: null,
    };
  }
}

test("a non-Temporal runner uses the common service and native evidence seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-runner-contract-"));
  try {
    const runner = new InMemoryRestateRunner();
    const evidence = new RunEvidenceStore(root);
    const config = loadServerConfig({ AGENTLAB_RUN_ROOT: root }, "/repo");
    const service = new RunService({ config, evidence, registry: new PlatformRegistry([runner]) });

    const run = await service.createRun({
      platform: "restate",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Use the common runner seam." },
      model: { provider: "fake", model: "fake-success" },
    });

    assert.equal(run.status, "completed");
    assert.equal(run.result?.output, "restate test output");
    assert.equal(run.executionReference?.platform, "restate");
    assert.equal(run.manifest.platformConfig.profile, "in-memory-restate-test");

    const native = JSON.parse(await readFile(join(root, run.runId, "native/restate.json"), "utf8")) as PlatformExecutionReference;
    assert.equal(native.executionId, `memory:${run.runId}`);
    await assert.rejects(access(join(root, run.runId, "native/temporal.json")));

    runner.outcome = "failed";
    const failedRun = await service.createRun({
      platform: "restate",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Exercise the failure path." },
      model: { provider: "fake", model: "fake-success" },
    });
    assert.equal(failedRun.status, "failed");
    assert.equal(failedRun.result?.error?.code, "RESTATE_TEST_FAILURE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
