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
  "real DBOS service covers PostgreSQL-backed lifecycle paths and projects evidence",
  {
    skip: enabled ? false : "Set AGENTLAB_RUN_DBOS_INTEGRATION=1 with PostgreSQL and the DBOS service running.",
  },
  async () => {
    const runner = new DbosBaselineRunner();
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);

    const suffix = Date.now();
    const successManifest = manifestFor(runner, `integration-success-${suffix}`, "fake-success", "Produce one short PostgreSQL-backed sentence.");
    const success = await runAndWait(runner, successManifest);
    assert.equal(success.result?.status, "completed");
    assert.equal(success.result?.output, "Fake response: Produce one short PostgreSQL-backed sentence.");
    assert.equal(success.reference.native.nativeStatus, "SUCCESS");
    await writeEvidence(successManifest, success);

    const failure = await runAndWait(
      runner,
      manifestFor(runner, `integration-failure-${suffix}`, "fake-failure", "Fail deterministically."),
    );
    assert.equal(failure.result?.status, "failed");
    assert.equal(failure.result?.error?.code, "FAKE_MODEL_FAILURE");
    assert.equal(failure.reference.native.nativeStatus, "SUCCESS");

    const retry = await runAndWait(
      runner,
      manifestFor(runner, `integration-retry-${suffix}`, "fake-pre-dispatch-retry", "Retry once before completing."),
    );
    assert.equal(retry.result?.status, "completed");
    assert.equal(retry.result?.output, "Fake response: Retry once before completing.");
    assert.equal(retry.result?.attemptCount, 2);
    assert.equal(retry.reference.native.nativeStatus, "SUCCESS");
    assert.ok((retry.reference.native.steps as readonly { readonly completed: boolean }[] | undefined)?.some((step) => step.completed));

    const duplicateManifest = manifestFor(runner, `integration-duplicate-${suffix}`, "fake-success", "Start once.");
    const first = await runner.start(duplicateManifest);
    const duplicate = await runner.start(duplicateManifest);
    assert.equal(first.executionId, duplicate.executionId);
    assert.equal(duplicate.native.submissionOutcome, "already_exists");
    await waitForTerminal(runner, duplicate);

    await assert.rejects(
      runner.start(manifestFor(runner, duplicateManifest.runId, "fake-success", "A different request.")),
      /different request/,
    );

    const restartManifest = manifestFor(runner, `integration-restart-${suffix}`, "fake-timeout", "Survive an adapter restart.");
    const inFlight = await runner.start(restartManifest);
    const restartedRunner = new DbosBaselineRunner();
    const resumed = await waitForTerminal(restartedRunner, inFlight);
    assert.equal(resumed.result?.status, "completed");
    assert.equal(resumed.reference.executionId, inFlight.executionId);

    const cancellationManifest = manifestFor(runner, `integration-cancel-${suffix}`, "fake-timeout", "Cancel before completion.");
    const cancellationReference = await runner.start(cancellationManifest);
    const cancellation = await runner.cancel(cancellationReference, "integration cancellation");
    assert.equal(cancellation.accepted, true);
    const cancelled = await waitForTerminal(runner, cancellationReference);
    assert.equal(cancelled.result?.status, "cancelled");
    assert.equal(cancelled.reference.native.nativeStatus, "CANCELLED");
  },
);

function manifestFor(runner: DbosBaselineRunner, runId: string, model: string, prompt: string) {
  return buildRunManifest(
    {
      platform: "dbos",
      variant: "baseline",
      task: { kind: "prompt", prompt },
      model: { provider: "fake", model },
    },
    { runId, platformConfig: runner.manifestConfiguration() },
  );
}

async function runAndWait(runner: DbosBaselineRunner, manifest: ReturnType<typeof manifestFor>) {
  const reference = await runner.start(manifest);
  return waitForTerminal(runner, reference);
}

async function waitForTerminal(runner: DbosBaselineRunner, reference: Awaited<ReturnType<DbosBaselineRunner["start"]>>) {
  let inspection = await runner.inspect(reference);
  for (let attempt = 0; attempt < 80 && !inspection.result; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    inspection = await runner.inspect(inspection.reference);
  }
  if (!inspection.result) throw new Error(`Timed out waiting for DBOS execution ${inspection.reference.executionId}.`);
  return inspection;
}

async function writeEvidence(
  manifest: ReturnType<typeof manifestFor>,
  inspection: Awaited<ReturnType<DbosBaselineRunner["inspect"]>>,
): Promise<void> {
  const runRoot = await mkdtemp(join(tmpdir(), "agentlab-dbos-integration-evidence-"));
  try {
    const evidence = new RunEvidenceStore(runRoot);
    await evidence.createRun(manifest);
    await evidence.writeExecutionReference(manifest.runId, inspection.reference);
    for (const event of inspection.eventIntents) await evidence.appendEvent(event);
    await evidence.writeResult(inspection.result!);
    await evidence.writeTrajectory(inspection.trajectory!);
    await evidence.writeMetrics(inspection.metrics!);

    const snapshot = await evidence.readSnapshot(manifest.runId);
    assert.equal(snapshot.result?.status, "completed");
    assert.equal(snapshot.executionReference?.native.nativeStatus, "SUCCESS");
    assert.equal(JSON.stringify(snapshot.executionReference).includes("postgres:postgres"), false);
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
}
