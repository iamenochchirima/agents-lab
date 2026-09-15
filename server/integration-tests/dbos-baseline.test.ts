import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { DbosBaselineRunner } from "../src/platforms/dbos/runner-adapter/dbos-runner.js";

const enabled = process.env.AGENTLAB_RUN_DBOS_INTEGRATION === "1";

test(
  "real DBOS service completes a PostgreSQL-backed workflow and projects evidence",
  {
    skip: enabled ? false : "Set AGENTLAB_RUN_DBOS_INTEGRATION=1 with PostgreSQL and the DBOS service running.",
  },
  async () => {
    const runner = new DbosBaselineRunner();
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);

    const manifest = buildRunManifest(
      {
        platform: "dbos",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Produce one short PostgreSQL-backed sentence." },
        model: { provider: "fake", model: "fake-success" },
      },
      { platformConfig: runner.manifestConfiguration() },
    );
    assert.equal(runner.validate(manifest).valid, true);

    const runRoot = await mkdtemp(join(tmpdir(), "agentlab-dbos-integration-"));
    try {
      const evidence = new RunEvidenceStore(runRoot);
      await evidence.createRun(manifest);
      const reference = await runner.start(manifest);
      await evidence.writeExecutionReference(manifest.runId, reference);

      let inspection = await runner.inspect(reference);
      for (let attempt = 0; attempt < 80 && !inspection.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        inspection = await runner.inspect(inspection.reference);
      }

      assert.equal(inspection.result?.status, "completed");
      assert.equal(inspection.result?.output, "Fake response: Produce one short PostgreSQL-backed sentence.");
      for (const event of inspection.eventIntents) await evidence.appendEvent(event);
      await evidence.writeExecutionReference(manifest.runId, inspection.reference);
      await evidence.writeResult(inspection.result!);
      await evidence.writeTrajectory(inspection.trajectory!);
      await evidence.writeMetrics(inspection.metrics!);

      const snapshot = await evidence.readSnapshot(manifest.runId);
      assert.equal(snapshot.executionReference?.native.nativeStatus, "SUCCESS");
      assert.equal(snapshot.result?.status, "completed");
      assert.equal(JSON.stringify(snapshot.executionReference).includes("postgres:postgres"), false);
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  },
);
