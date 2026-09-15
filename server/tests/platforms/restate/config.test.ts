import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidRestateConfigError,
  loadRestateConfig,
  safeManifestConfiguration,
} from "../../../src/platforms/restate/config.js";

test("Restate configuration has bounded local defaults and redacts provider credentials", () => {
  const config = loadRestateConfig({ OPENROUTER_API_KEY: "test-secret" });
  const safe = safeManifestConfiguration(config);

  assert.equal(config.ingressUrl, "http://127.0.0.1:8080");
  assert.equal(config.adminUrl, "http://127.0.0.1:9070");
  assert.equal(config.servicePort, 9080);
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.runMaxRetryAttempts, 3);
  assert.equal(safe.workflowHandler, "run");
  assert.equal(JSON.stringify(safe).includes("test-secret"), false);
  assert.equal("openRouterApiKey" in safe, false);
});

test("Restate configuration rejects invalid URLs and retry intervals", () => {
  assert.throws(
    () => loadRestateConfig({ AGENTLAB_RESTATE_ADMIN_URL: "not-a-url" }),
    (error: unknown) => error instanceof InvalidRestateConfigError && error.message.includes("AGENTLAB_RESTATE_ADMIN_URL"),
  );
  assert.throws(
    () => loadRestateConfig({ AGENTLAB_RESTATE_RUN_RETRY_INTERVAL_MS: "500", AGENTLAB_RESTATE_RUN_MAX_RETRY_INTERVAL_MS: "100" }),
    (error: unknown) => error instanceof InvalidRestateConfigError && error.message.includes("at least"),
  );
});
