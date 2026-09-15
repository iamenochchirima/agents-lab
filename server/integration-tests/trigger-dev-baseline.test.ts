import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { TriggerDevBaselineRunner } from "../src/platforms/trigger-dev/runner-adapter/trigger-dev-runner.js";

test(
  "real Trigger.dev local task produces inspectable Lab evidence",
  {
    skip: process.env.AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION === "1"
      ? false
      : "Set AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION=1 with Trigger.dev server and trigger.dev dev running.",
  },
  async () => {
    const runner = TriggerDevBaselineRunner.fromEnvironment();
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);
    const manifest = buildRunManifest({
      platform: "trigger-dev",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Produce one short deterministic sentence." },
      model: { provider: "fake", model: "fake-success" },
    }, { platformConfig: runner.manifestConfiguration() });
    const validation = runner.validate(manifest);
    assert.equal(validation.valid, true, validation.reason ?? "Trigger.dev manifest was rejected.");

    const runRoot = await mkdtemp(join(tmpdir(), "agentlab-trigger-dev-"));
    try {
      const evidence = new RunEvidenceStore(runRoot);
      await evidence.createRun(manifest);
      const reference = await runner.start(manifest);
      await evidence.writeExecutionReference(manifest.runId, reference);

      let inspection = await runner.inspect(reference);
      for (let attempt = 0; attempt < 60 && !inspection.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        inspection = await runner.inspect(inspection.reference);
      }

      assert.equal(inspection.result?.status, "completed");
      assert.equal(inspection.result?.output, "Fake response: Produce one short deterministic sentence.");
      for (const event of inspection.eventIntents) await evidence.appendEvent(event);
      await evidence.writeResult(inspection.result!);
      await evidence.writeTrajectory(inspection.trajectory!);
      await evidence.writeMetrics(inspection.metrics!);

      const snapshot = await evidence.readSnapshot(manifest.runId);
      assert.equal(snapshot.result?.status, "completed");
      assert.equal(snapshot.executionReference?.native.apiUrl, runner.manifestConfiguration().apiUrl);
      assert.equal(JSON.stringify(snapshot.executionReference).includes("TRIGGER_SECRET_KEY"), false);
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  },
);
