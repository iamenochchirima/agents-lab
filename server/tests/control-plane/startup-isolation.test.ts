import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { createControlPlaneRuntime } from "../../src/control-plane/bootstrap/server.js";
import { TemporalBaselineRunner } from "../../src/platforms/temporal/runner-adapter/temporal-runner.js";
import { RestateBaselineRunner } from "../../src/platforms/restate/runner-adapter/restate-runner.js";
import { HatchetBaselineRunner } from "../../src/platforms/hatchet/runner-adapter/hatchet-runner.js";

// Exercise real bootstrap and HTTP registration with controlled native clients.
// A pending promise models an SDK waiting indefinitely for an optional service.
test("core readiness and capability catalog survive blocked and failed native startup", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-startup-"));
  const originalStateRoot = process.env.AGENTLAB_CAPABILITY_STATE_ROOT;
  process.env.AGENTLAB_CAPABILITY_STATE_ROOT = join(root, "capabilities");
  const temporalConnect = TemporalBaselineRunner.connect;
  const restateConnect = RestateBaselineRunner.connect;
  const hatchetConnect = HatchetBaselineRunner.connect;
  TemporalBaselineRunner.connect = () => new Promise(() => {});
  HatchetBaselineRunner.connect = () => new Promise(() => {});
  RestateBaselineRunner.connect = async () => { throw new Error("native unavailable"); };
  let runtime: Awaited<ReturnType<typeof createControlPlaneRuntime>> | undefined;
  try {
    const config = loadServerConfig({ AGENTLAB_MASTRA_WORKFLOW_ENABLED: "false" }, root);
    runtime = await createControlPlaneRuntime(config);
    for (const url of ["/ready", "/api/capabilities", "/api/capability-packages"]) {
      assert.equal((await runtime.app.inject({ method: "GET", url })).statusCode, 200, url);
    }
    for (const url of ["/internal/capabilities/prepare", "/internal/capabilities/execute"]) {
      const response: { statusCode: number; json(): { error: string } } = await runtime.app.inject({ method: "POST", url, payload: {} });
      assert.equal(response.statusCode, 401, url);
      assert.equal(response.json().error, "Runtime authentication required.");
    }
    for (const platform of ["temporal", "hatchet", "restate"]) {
      const response: { statusCode: number; json(): { reachable: boolean } } = await runtime.app.inject({ method: "GET", url: `/api/platforms/${platform}/health` });
      assert.equal(response.statusCode, 200, platform);
      assert.equal(response.json().reachable, false);
    }
  } finally {
    await runtime?.close();
    TemporalBaselineRunner.connect = temporalConnect;
    RestateBaselineRunner.connect = restateConnect;
    HatchetBaselineRunner.connect = hatchetConnect;
    if (originalStateRoot === undefined) delete process.env.AGENTLAB_CAPABILITY_STATE_ROOT;
    else process.env.AGENTLAB_CAPABILITY_STATE_ROOT = originalStateRoot;
    await rm(root, { recursive: true, force: true });
  }
});
