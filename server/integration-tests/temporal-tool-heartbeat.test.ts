import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createLocalFixtureServer } from "../src/capabilities/integrations/local-fixture/service.js";
import { createDefaultCapabilityCatalog } from "../src/capabilities/catalog.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";

/** An actual worker is essential: a direct Activity-core call cannot establish
 * server heartbeat delivery or cancellation notification. Requires local Temporal. */
test("Temporal connected tool survives heartbeat deadline and receives cancellation", {
  skip: process.env.AGENTLAB_RUN_TEMPORAL_TOOL_HEARTBEAT !== "1", timeout: 60_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-temporal-heartbeat-"));
  const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0, mcpCallBehavior: "delay", mcpCallDelayMs: 1_500 });
  const environment = { ...process.env, AGENTLAB_RUN_ROOT: root, AGENTLAB_CONTEXT_ROOT: join(root, "context"),
    AGENTLAB_TEMPORAL_TASK_QUEUE: `heartbeat-${Date.now()}`, AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS: "15000",
    AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS: "2000", AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
    AGENTLAB_LOCAL_FIXTURE_URL: `http://127.0.0.1:${fixture.port}` };
  const worker = spawn(process.execPath, [resolve("dist/src/platforms/temporal/runner-adapter/worker-entry.js")],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  worker.stderr?.on("data", value => { output = (output + value).slice(-4_000); });
  let runner: TemporalBaselineRunner | undefined;
  try {
    const config = loadServerConfig(environment, process.cwd());
    runner = await TemporalBaselineRunner.connect(config);
    const service = new RunService({ config, evidence: new RunEvidenceStore(root),
      context: new ContextService(new ContextSessionStore(config.contextRoot), new CharacterTokenEstimator()),
      registry: new PlatformRegistry([runner]), capabilities: createDefaultCapabilityCatalog() });
    const request = { platform: "temporal" as const, variant: "baseline" as const,
      task: { kind: "prompt" as const, prompt: "Read alpha" },
      model: { provider: "fake" as const, model: "fake-mcp-connected-tool", contextWindowTokens: 16_384 },
      capabilities: { profileId: "local-mcp-safe", tools: { enabledNames: [], maxCalls: 2, maxRounds: 3 } } };
    const success = await service.createRun(request);
    const completed = await waitFor(service, success.runId, run => !!run.result, worker, () => output);
    assert.equal(completed.status, "completed", JSON.stringify(completed.result));
    assert.equal(fixture.mcpCallCount, 1);
    assert.ok(Number(completed.events.find(event => event.kind === "ToolExecutionCompleted")?.payload.durationMs) >= 1_000);
    const cancelled = await service.createRun(request);
    await waitFor(service, cancelled.runId, () => fixture.mcpCallCount === 2, worker, () => output);
    await service.cancelRun(cancelled.runId, "Cancel in-flight connected tool");
    const result = await waitFor(service, cancelled.runId, run => !!run.result, worker, () => output);
    assert.equal(result.status, "cancelled", JSON.stringify(result.result));
    assert.equal(fixture.mcpCallCount, 2, "Cancellation must not retry the provider call");
  } finally {
    await stopWorker(worker);
    await runner?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function waitFor(service: RunService, runId: string,
  done: (run: Awaited<ReturnType<RunService["getRun"]>>) => boolean, worker: ChildProcess, output: () => string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const run = await service.getRun(runId);
    if (done(run)) return run;
    if (worker.exitCode !== null) throw new Error(`Temporal worker exited: ${output()}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Temporal run did not settle: ${runId}. ${output()}`);
}
async function stopWorker(worker: ChildProcess) {
  if (worker.exitCode !== null) return;
  worker.kill("SIGTERM");
  await Promise.race([new Promise<void>(resolve => worker.once("exit", () => resolve())),
    new Promise<void>(resolve => setTimeout(() => { if (worker.exitCode === null) worker.kill("SIGKILL"); resolve(); }, 3_000))]);
}
