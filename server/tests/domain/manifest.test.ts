import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest, InvalidRunRequestError } from "../../src/control-plane/domain/manifest.js";
import type { RunRequest } from "../../src/control-plane/domain/types.js";

const validRequest: RunRequest = {
  platform: "temporal",
  variant: "baseline",
  task: { kind: "prompt", prompt: "Explain durable execution." },
  model: { provider: "fake", model: "fake-success" },
};

test("manifest contains immutable safe run configuration", () => {
  const manifest = buildRunManifest({
    ...validRequest,
    selection: {
      scenarioId: "research",
      backendProfileId: "local-temporal-stack",
      infrastructureId: "temporal-server",
      experimentId: "none",
    },
  }, {
    now: "2026-09-15T08:00:00.000Z",
    runId: "run-test-1",
    serverVersion: "test-version",
    platformConfig: { namespace: "default", taskQueue: "test" },
  });

  assert.equal(manifest.runId, "run-test-1");
  assert.equal(manifest.createdAt, "2026-09-15T08:00:00.000Z");
  assert.equal(manifest.model.provider, "fake");
  assert.deepEqual(manifest.selection, {
    scenarioId: "research",
    backendProfileId: "local-temporal-stack",
    infrastructureId: "temporal-server",
    experimentId: "none",
  });
  assert.equal("apiKey" in manifest, false);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.task), true);
  assert.equal(Object.isFrozen(manifest.model), true);
  assert.equal(Object.isFrozen(manifest.platformConfig), true);
  assert.equal(Object.isFrozen(manifest.selection), true);
  assert.throws(() => {
    (manifest.platformConfig as { taskQueue: string }).taskQueue = "changed";
  }, TypeError);
});

test("platform identifiers are accepted by the domain and empty prompts are rejected", () => {
  const manifest = buildRunManifest({ ...validRequest, platform: "restate" }, { runId: "run-test-2" });
  assert.equal(manifest.platform, "restate");

  assert.throws(
    () => buildRunManifest({ ...validRequest, task: { kind: "prompt", prompt: "  " } }, { runId: "run-test-3" }),
    (error: unknown) => error instanceof InvalidRunRequestError,
  );
});

test("invalid platform identifiers are rejected before persistence", () => {
  assert.throws(
    () => buildRunManifest({ ...validRequest, platform: "Temporal" }, { runId: "run-test-invalid-platform" }),
    (error: unknown) => error instanceof InvalidRunRequestError,
  );
});

test("only supported model adapters are accepted", () => {
  assert.throws(
    () => buildRunManifest({ ...validRequest, model: { provider: "unknown", model: "x" } }, { runId: "run-test-4" }),
    (error: unknown) => error instanceof InvalidRunRequestError,
  );
});
