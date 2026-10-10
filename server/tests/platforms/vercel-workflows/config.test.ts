import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidVercelWorkflowsConfigError,
  loadVercelWorkflowsConfig,
  safeManifestConfiguration,
  VERCEL_WORKFLOW_MIN_DELIVERY_TIMEOUT_MS,
} from "../../../src/platforms/vercel-workflows/config.js";

test("Vercel Workflows configuration has safe defaults and no secret fields", () => {
  const config = loadVercelWorkflowsConfig({});
  const safe = safeManifestConfiguration(config);

  assert.equal(config.serviceUrl, "http://127.0.0.1:9094");
  assert.equal(config.openRouterApiKey, null);
  assert.equal("openRouterApiKey" in safe, false);
  assert.equal(safe.sdk, "workflow");
  assert.equal(safe.world, "local");
});

test("Vercel Workflows configuration rejects invalid ports and URLs", () => {
  assert.throws(
    () => loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_PORT: "not-a-port" }),
    InvalidVercelWorkflowsConfigError,
  );
  assert.throws(
    () => loadVercelWorkflowsConfig({ AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: "file:///tmp/workflows" }),
    InvalidVercelWorkflowsConfigError,
  );
});

test("local queue delivery covers the maximum admitted task without an unbounded timeout", () => {
  assert.equal(loadVercelWorkflowsConfig({}).deliveryHeadersTimeoutMs, VERCEL_WORKFLOW_MIN_DELIVERY_TIMEOUT_MS);
  assert.equal(loadVercelWorkflowsConfig({ WORKFLOW_LOCAL_HEADERS_TIMEOUT_MS: "7200000" }).deliveryHeadersTimeoutMs, 7200000);
  for (const value of ["0", "30000", "invalid"]) assert.throws(() => loadVercelWorkflowsConfig({ WORKFLOW_LOCAL_HEADERS_TIMEOUT_MS: value }), InvalidVercelWorkflowsConfigError);
});
