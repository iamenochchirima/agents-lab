import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StudioEvidenceConflictError, StudioCorruptEvidenceError, StudioEvidenceStore } from "../../src/studio/adapters/evidence-store.js";
import { buildStudioManifest } from "../../src/studio/domain/manifest.js";
import { resolveStudioCatalog } from "../../src/studio/catalog.js";
import type { StudioComparisonRequest } from "../../src/studio/domain/types.js";

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
