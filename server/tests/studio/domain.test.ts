import assert from "node:assert/strict";
import test from "node:test";

import { buildStudioManifest, validateStudioComparisonRequest } from "../../src/studio/domain/manifest.js";
import { InvalidStudioTransitionError, transitionStudioComparison } from "../../src/studio/domain/state.js";
import { resolveStudioCatalog } from "../../src/studio/catalog.js";
import type { StudioComparisonRequest } from "../../src/studio/domain/types.js";

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
  idempotencyKey: "domain-test-1",
};

test("Studio validation accepts the fixed catalog request and freezes the manifest", () => {
  validateStudioComparisonRequest(request);
  const manifest = buildStudioManifest(request, resolveStudioCatalog(request), {
    comparisonId: "comparison-1",
    now: "2026-09-16T12:00:00.000Z",
  });

  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(manifest.fixedEnvelope.scenarioId, "context-old-important-fact");
  assert.equal(manifest.experiment.changedComponent, "context-management");
});

test("Studio validation rejects duplicate strategies and unsafe seeds", () => {
  assert.throws(
    () => validateStudioComparisonRequest({
      ...request,
      experiment: {
        ...request.experiment,
        subject: {
          ...request.experiment.subject,
          strategies: [request.experiment.subject.strategies[0], request.experiment.subject.strategies[0]],
        },
      },
    }),
    /Strategy is repeated/,
  );
  assert.throws(
    () => validateStudioComparisonRequest({ ...request, seed: "seed with spaces" }),
    /seed must use/,
  );
});

test("Studio lifecycle exposes legal transitions and rejects backwards movement", () => {
  assert.equal(transitionStudioComparison("created", "running"), "running");
  assert.equal(transitionStudioComparison("running", "completed"), "completed");
  assert.throws(
    () => transitionStudioComparison("completed", "running"),
    (error: unknown) => error instanceof InvalidStudioTransitionError,
  );
});
