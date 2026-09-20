import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StudioEvidenceConflictError, StudioCorruptEvidenceError, StudioEvidenceStore } from "../../src/studio/adapters/evidence-store.js";
import { buildStudioManifest } from "../../src/studio/domain/manifest.js";
import { resolveStudioCatalog } from "../../src/studio/catalog.js";
import type { StudioComparisonRequest, StudioTurnEvidence } from "../../src/studio/domain/types.js";

test("Studio evidence is ordered, idempotent, and detects conflicting duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-evidence-"));
  try {
    const request: StudioComparisonRequest = {
      system: { id: "neutral-agent", version: "1" },
      environment: { id: "deterministic-replay", version: "1" },
      experiment: {
        id: "compare-context-retention",
        version: "1",
        scenario: { id: "context-old-important-fact", version: "1" },
        subject: {
          component: "context-management" as const,
          strategies: [
            { id: "full-history", version: "1", parameters: {} },
            { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
          ],
        },
      },
      seed: "seed-1",
      idempotencyKey: "evidence-test-1",
    };
    const manifest = buildStudioManifest(request, resolveStudioCatalog(request), {
      comparisonId: "comparison-1",
      now: "2026-09-16T12:00:00.000Z",
    });
    const store = new StudioEvidenceStore(root);
    await store.createComparison(manifest);

    const first = await store.appendEvent("comparison-1", {
      source: "test",
      sourceSequence: 1,
      kind: "Started",
      occurredAt: "2026-09-16T12:00:01.000Z",
      payload: { value: "one" },
    });
    const duplicate = await store.appendEvent("comparison-1", {
      source: "test",
      sourceSequence: 1,
      kind: "Started",
      occurredAt: "2026-09-16T12:00:01.000Z",
      payload: { value: "one" },
    });
    assert.deepEqual(duplicate, first);
    await assert.rejects(
      () => store.appendEvent("comparison-1", {
        source: "test",
        sourceSequence: 1,
        kind: "Started",
        occurredAt: "2026-09-16T12:00:01.000Z",
        payload: { value: "changed" },
      }),
      (error: unknown) => error instanceof StudioEvidenceConflictError,
    );

    const events = await store.readEvents("comparison-1");
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(await readFile(join(root, "comparison-1", "events.jsonl"), "utf8")).recordedSequence, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio evidence reports corrupt event records instead of projecting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-corrupt-"));
  try {
    const store = new StudioEvidenceStore(root);
    const request: StudioComparisonRequest = {
      system: { id: "neutral-agent", version: "1" },
      environment: { id: "deterministic-replay", version: "1" },
      experiment: {
        id: "compare-context-retention",
        version: "1",
        scenario: { id: "context-old-important-fact", version: "1" },
        subject: {
          component: "context-management" as const,
          strategies: [
            { id: "full-history", version: "1", parameters: {} },
            { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
          ],
        },
      },
      seed: "seed-1",
      idempotencyKey: "evidence-test-2",
    };
    await store.createComparison(buildStudioManifest(request, resolveStudioCatalog(request), { comparisonId: "comparison-2" }));
    await writeFile(join(root, "comparison-2", "events.jsonl"), "not-json\n", "utf8");

    await assert.rejects(
      () => store.readEvents("comparison-2"),
      (error: unknown) => error instanceof StudioCorruptEvidenceError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio turn evidence is idempotent, projected, and path-allowlisted", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-turn-evidence-"));
  try {
    const request: StudioComparisonRequest = {
      system: { id: "neutral-agent", version: "1" },
      environment: { id: "deterministic-replay", version: "1" },
      experiment: {
        id: "compare-memory-multiturn",
        version: "1",
        scenario: { id: "memory-learn-then-recall", version: "1" },
        subject: {
          component: "memory" as const,
          strategies: [
            { id: "no-memory", version: "1", parameters: {} },
            { id: "semantic-keyed-facts", version: "1", parameters: {} },
          ],
        },
      },
      seed: "seed-turn-evidence",
      idempotencyKey: "turn-evidence-test",
    };
    const manifest = buildStudioManifest(request, resolveStudioCatalog(request), {
      comparisonId: "comparison-turn-evidence",
      now: "2026-09-16T12:00:00.000Z",
    });
    const store = new StudioEvidenceStore(root);
    await store.createComparison(manifest);
    await store.writeTrialManifest({
      schemaVersion: 1,
      trialId: "trial-1",
      comparisonId: "comparison-turn-evidence",
      ordinal: 0,
      strategy: { id: "semantic-keyed-facts", version: "1", parameters: {} },
      fixedControlFingerprint: "fingerprint-1",
    });

    const evidence = makeTurnEvidence();
    await store.writeTurnEvidence(evidence);
    await store.writeTurnEvidence(evidence);

    const allowlistedPath = "trials/trial-1/turns/turn-1.json";
    const persisted = JSON.parse(await store.readAllowlistedFile("comparison-turn-evidence", allowlistedPath)) as StudioTurnEvidence;
    assert.deepEqual(persisted, evidence);

    const snapshot = await store.readSnapshot("comparison-turn-evidence");
    assert.deepEqual(snapshot.trials[0]?.turns, [evidence]);

    await assert.rejects(
      () => store.writeTurnEvidence({ ...evidence, task: "changed task" }),
      (error: unknown) => error instanceof StudioEvidenceConflictError,
    );

    for (const unsafePath of [
      "../events.jsonl",
      "trials/trial-1/../../events.jsonl",
      "trials/trial-1/turns/turn-1.txt",
      "trials/trial-1/private.json",
    ]) {
      await assert.rejects(
        () => store.readAllowlistedFile("comparison-turn-evidence", unsafePath),
        (error: unknown) => error instanceof Error && error.name === "StudioEvidenceNotFoundError",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function makeTurnEvidence(): StudioTurnEvidence {
  return {
    schemaVersion: 1,
    comparisonId: "comparison-turn-evidence",
    trialId: "trial-1",
    turnId: "turn-1",
    ordinal: 0,
    task: "Remember that the support language is English.",
    context: {
      schemaVersion: 1,
      comparisonId: "comparison-turn-evidence",
      trialId: "trial-1",
      strategyId: "full-history",
      strategyVersion: "1",
      strategyParameters: {},
      task: "Remember that the support language is English.",
      retainedMessageIds: [],
      omittedMessageIds: [],
      summarizedMessageIds: [],
      messages: [],
      budget: {
        contextWindowTokens: 1200,
        inputTokens: 16,
        reservedOutputTokens: 240,
        safetyMarginTokens: 60,
        remainingTokens: 884,
        remainingPercent: 73.6666666667,
        quality: "exact",
        tokenizerBasis: "test",
        pressure: "normal",
      },
      decision: "within-budget",
    },
    memory: {
      schemaVersion: 1,
      comparisonId: "comparison-turn-evidence",
      trialId: "trial-1",
      adapterId: "semantic-keyed-facts",
      adapterVersion: "1",
      seededRecordIds: [],
      stateRecovered: false,
      stateRevision: 1,
      queryTerms: ["support", "language", "English"],
      candidates: [],
      retrievedRecordIds: [],
      omittedRecordIds: [],
      writtenRecordIds: ["turn-1-add-support-language-record"],
      updatedRecordIds: [],
      discardedRecordIds: [],
      expiredRecordIds: [],
      decisions: [],
      activeRecordIds: ["turn-1-add-support-language-record"],
      scopes: ["semantic"],
    },
    composition: {
      schemaVersion: 1,
      comparisonId: "comparison-turn-evidence",
      trialId: "trial-1",
      slots: [],
    },
    result: {
      status: "completed",
      output: "Stored support language preference.",
      grade: { graderId: "deterministic", status: "pass", reason: "completed", requiredSourceId: null },
      error: null,
      startedAt: "2026-09-16T12:00:01.000Z",
      finishedAt: "2026-09-16T12:00:02.000Z",
    },
    metrics: {
      contextInputTokens: 16,
      modelInputTokens: 16,
      modelOutputTokens: 8,
      modelCalls: 1,
      latencyMs: 10,
      costUsd: 0,
      memoryCandidateCount: 0,
      memoryRetrievedCount: 0,
      memoryOmittedCount: 0,
      memoryWrittenCount: 1,
      memoryUpdatedCount: 0,
      memoryNoopCount: 0,
      memoryExpiredCount: 0,
      activeRecordCount: 1,
      requiredRecordHit: null,
      stateRecovered: false,
      measurementBasis: {
        contextTokens: "test",
        modelTokens: "test",
        latency: "test",
        cost: "test",
        memoryCounts: "test",
      },
    },
  };
}
