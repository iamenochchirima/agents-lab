import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import type { RunView } from "../../src/control-plane/application/run-service.js";
import { exerciseBehaviourProjection, inspectBehaviourIntegrity, normalizeBehaviourObservation } from "../../src/evals/behaviour-evidence.js";

test("projection and integrity receipts reflect retained duplicate rejection and ambiguous usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "behaviour-evidence-"));
  try {
    const evidence = new RunEvidenceStore(root);
    const manifest = buildRunManifest({ platform: "temporal", variant: "baseline", task: { kind: "prompt", prompt: "Synthetic integrity task." }, model: { provider: "fake", model: "fake-success" } }, { runId: "integrity-actual" });
    await evidence.createRun(manifest);
    const initialConfigs = new Map([[manifest.runId, await evidence.readAllowlistedFile(manifest.runId, "config.json")]]);
    const projection = await exerciseBehaviourProjection(evidence, manifest.runId);
    assert.deepEqual(projection, { inputCount: 4, uniqueActions: 2, expectedActions: 2, duplicateCount: 1, outOfOrderCount: 1 });
    await assert.rejects(() => exerciseBehaviourProjection(evidence, manifest.runId), /already exercised/);
    await evidence.writeResult({ schemaVersion: 1, runId: manifest.runId, status: "reconciliation_required", startedAt: null, finishedAt: new Date().toISOString(), output: null, error: { code: "UNKNOWN", message: "Unknown native outcome", failureKind: "outcome_unknown", retryable: false }, attemptCount: 0, usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
    await evidence.appendEvent({ runId: manifest.runId, source: "eval-credential-control", sourceSequence: 1, kind: "EvalCredentialControl", occurredAt: new Date().toISOString(), payload: { apiKey: "fixture-secret-sentinel" } });
    const snapshot = await evidence.readSnapshot(manifest.runId);
    assert.equal(snapshot.events.at(-1)?.payload.apiKey, "[REDACTED]", "the actual evidence writer must sanitize the synthetic credential");
    const view = { runId: manifest.runId, manifest: snapshot.manifest, status: "reconciliation_required", result: snapshot.result, events: snapshot.events } as RunView;
    const [integrity] = await inspectBehaviourIntegrity(evidence, [view], initialConfigs, ["fixture-secret-sentinel"]);
    assert.ok(Object.entries(integrity).filter(([key]) => key !== "runId").every(([, value]) => value === true));
    assert.equal(normalizeBehaviourObservation([view]).runs[0].status, "reconciliation-required");
    const [changedConfig] = await inspectBehaviourIntegrity(evidence, [view], new Map([[view.runId, "different configuration"]]));
    assert.equal(changedConfig.configImmutable, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
