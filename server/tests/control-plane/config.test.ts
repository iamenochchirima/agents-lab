import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULTS, InvalidServerConfigError, loadServerConfig } from "../../src/control-plane/bootstrap/config.js";

test("configuration has safe local defaults and resolves the run root", () => {
  const config = loadServerConfig({}, "/repo");

  assert.equal(config.api.host, DEFAULTS.apiHost);
  assert.equal(config.api.port, DEFAULTS.apiPort);
  assert.equal(config.temporal.endpoint, "localhost:7233");
  assert.equal(config.temporal.namespace, "default");
  assert.equal(config.temporal.taskQueue, "agentlab-temporal-baseline");
  assert.equal(config.temporal.queryTimeoutMs, 1000);
  assert.deepEqual(config.allowedModelProviders, ["fake"]);
  assert.equal(config.runsRoot, "/repo/lab/runs");
});

test("configuration allows an explicit local profile and optional OpenRouter", () => {
  const config = loadServerConfig(
    {
      AGENTLAB_API_PORT: "5000",
      AGENTLAB_RUN_ROOT: "var/runs",
      AGENTLAB_TEMPORAL_ENDPOINT: "127.0.0.1:7233",
      AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake, openrouter, fake",
      AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_LIMIT: "0",
      AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS: "750",
    },
    "/repo",
  );

  assert.equal(config.api.port, 5000);
  assert.equal(config.runsRoot, "/repo/var/runs");
  assert.deepEqual(config.allowedModelProviders, ["fake", "openrouter"]);
  assert.equal(config.temporal.preDispatchRetryLimit, 0);
  assert.equal(config.temporal.queryTimeoutMs, 750);
});

test("invalid or missing explicit configuration fails before startup", () => {
  assert.throws(
    () => loadServerConfig({ AGENTLAB_API_PORT: "not-a-port" }),
    (error: unknown) => error instanceof InvalidServerConfigError,
  );
  assert.throws(
    () => loadServerConfig({ AGENTLAB_TEMPORAL_ENDPOINT: " " }),
    (error: unknown) => error instanceof InvalidServerConfigError,
  );
  assert.throws(
    () => loadServerConfig({ AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake,unknown" }),
    (error: unknown) => error instanceof InvalidServerConfigError,
  );
});
