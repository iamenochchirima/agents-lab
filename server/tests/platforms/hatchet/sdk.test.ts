import assert from "node:assert/strict";
import test from "node:test";

import { loadHatchetConfig } from "../../../src/platforms/hatchet/config.js";
import {
  loadHatchetEmbeddedSdk,
  loadHatchetSdk,
} from "../../../src/platforms/hatchet/sdk.js";
import { createHatchetBaselineTask } from "../../../src/platforms/hatchet/variants/baseline/execution/task.js";

test("pinned Hatchet SDK exposes the v1 client/task calls used by the baseline", () => {
  const config = loadHatchetConfig({ HATCHET_CLIENT_TOKEN: "test-token" });
  const token = [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(JSON.stringify({ sub: config.tenantId })).toString("base64url"),
    "test-signature",
  ].join(".");
  const sdk = loadHatchetSdk();
  const client = sdk.HatchetClient.init({
    token,
    host_port: config.hostPort,
    api_url: config.apiUrl,
    tenant_id: config.tenantId,
    tls_config: { tls_strategy: config.tlsStrategy },
  });
  const task = createHatchetBaselineTask(client, config);

  assert.equal(typeof sdk.HatchetClient.init, "function");
  assert.equal(typeof client.task, "function");
  assert.equal(typeof task.runNoWait, "function");
  assert.equal(typeof client.runs.get, "function");
  assert.equal(typeof client.runs.cancel, "function");
  assert.equal(typeof client.worker, "function");
});

test("pinned Hatchet SDK exposes the no-Docker embedded entry point", () => {
  const embedded = loadHatchetEmbeddedSdk();
  assert.equal(typeof embedded.HatchetEmbeddedClient.init, "function");
});
