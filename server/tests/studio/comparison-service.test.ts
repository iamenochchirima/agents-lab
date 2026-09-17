import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StudioEvidenceStore } from "../../src/studio/adapters/evidence-store.js";
import {
  StudioComparisonService,
  StudioInjectedCrashError,
  type StudioFailureInjector,
} from "../../src/studio/application/comparison-service.js";
import type { StudioComparisonRequest, StudioModelAdapter } from "../../src/studio/index.js";

test("an interrupted comparison is exposed as recovery_required without a fabricated parent result", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-recovery-"));
  try {
    let comparisonId: string | undefined;
    const failureInjector: StudioFailureInjector = {
      inject(point, id) {
        comparisonId = id;
        if (point === "between-trials") throw new StudioInjectedCrashError(point);
      },
    };
    const service = new StudioComparisonService({
      evidence: new StudioEvidenceStore(root),
      failureInjector,
    });

    await assert.rejects(() => service.create(comparisonRequest("recovery-1")), StudioInjectedCrashError);
    assert.ok(comparisonId);
    const projection = await new StudioComparisonService({ evidence: new StudioEvidenceStore(root) }).inspect(comparisonId);
    assert.equal(projection.status, "recovery_required");
    assert.equal(projection.result, null);
    assert.equal(projection.trials.length, 1);
    assert.equal(projection.trials[0].result?.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interruption before configuration and during publication remains explicit", async () => {
  for (const point of ["before-comparison-write", "during-evidence-publication"] as const) {
    const root = await mkdtemp(join(tmpdir(), `agentlab-studio-${point}-`));
    try {
      let comparisonId: string | undefined;
      const failureInjector: StudioFailureInjector = {
        inject(injectedPoint, id) {
          comparisonId = id;
          if (injectedPoint === point) throw new StudioInjectedCrashError(injectedPoint);
        },
      };
      const service = new StudioComparisonService({
        evidence: new StudioEvidenceStore(root),
        failureInjector,
      });

      await assert.rejects(() => service.create(comparisonRequest(`failure-${point}`)), StudioInjectedCrashError);
      assert.ok(comparisonId);
      const restarted = new StudioComparisonService({ evidence: new StudioEvidenceStore(root) });
      if (point === "before-comparison-write") {
        await assert.rejects(() => restarted.inspect(comparisonId!), /Studio comparison was not found/);
      } else {
        const projection = await restarted.inspect(comparisonId);
        assert.equal(projection.status, "recovery_required");
        assert.equal(projection.result, null);
        assert.equal(projection.trials.length, 2);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("cancellation during a model call leaves only the in-flight trial cancelled", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-cancel-"));
  try {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const model: StudioModelAdapter = {
      provider: "replay",
      model: "blocking-test-model",
      async complete(_request, signal) {
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("cancelled", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
        });
        return { output: "unreachable", inputTokens: null, outputTokens: null };
      },
    };
    const service = new StudioComparisonService({ evidence: new StudioEvidenceStore(root), model });
    const pending = service.create(comparisonRequest("cancel-1"));
    await started;

    const comparisonId = (await readdir(root, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name !== "idempotency")?.name;
    assert.ok(comparisonId);
    const cancelled = await service.cancel(comparisonId, "stop this comparison");
    const created = await pending;

    assert.equal(cancelled.status, "cancelled");
    assert.equal(created.status, "cancelled");
    assert.equal(cancelled.trials.length, 1);
    assert.equal(cancelled.trials[0].result?.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function comparisonRequest(idempotencyKey: string): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-context-retention",
      version: "1",
      scenario: { id: "context-old-important-fact", version: "1" },
      subject: {
        component: "context-management",
        strategies: [
          { id: "full-history", version: "1", parameters: {} },
          { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
        ],
      },
    },
    seed: "seed-1",
    idempotencyKey,
  };
}
