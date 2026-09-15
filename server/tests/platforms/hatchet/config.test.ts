import assert from "node:assert/strict";
import test from "node:test";

import {
  HATCHET_SDK_VERSION,
  HATCHET_SERVER_VERSION,
  InvalidHatchetConfigError,
  loadHatchetConfig,
  safeManifestConfiguration,
} from "../../../src/platforms/hatchet/config.js";

test("Hatchet config pins the researched runtime and excludes credentials from manifests", () => {
  const config = loadHatchetConfig({
    HATCHET_CLIENT_TOKEN: "test-secret",
    OPENROUTER_API_KEY: "openrouter-secret",
  });
  const safe = safeManifestConfiguration(config);

  assert.equal(config.sdkVersion, HATCHET_SDK_VERSION);
  assert.equal(config.serverVersion, HATCHET_SERVER_VERSION);
  assert.equal(safe.clientTokenConfigured, true);
  assert.equal(safe.openRouterConfigured, true);
  assert.equal(JSON.stringify(safe).includes("test-secret"), false);
  assert.equal(JSON.stringify(safe).includes("openrouter-secret"), false);
  assert.deepEqual(safe.idempotency, {
    strategy: "status",
    expression: "input.runId",
    fallbackTtlMs: config.idempotencyFallbackTtlMs,
  });
});

test("Hatchet config rejects invalid topology and inconsistent timeouts", () => {
  assert.throws(
    () =>
      loadHatchetConfig({
        AGENTLAB_HATCHET_HOST_PORT: "http://127.0.0.1:7077",
      }),
    InvalidHatchetConfigError,
  );
  assert.throws(
    () =>
      loadHatchetConfig({
        AGENTLAB_HATCHET_EXECUTION_TIMEOUT_MS: "5000",
        AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS: "1000",
      }),
    InvalidHatchetConfigError,
  );
});
