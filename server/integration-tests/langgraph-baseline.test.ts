import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { buildControlPlaneServer } from "../src/control-plane/http/server.js";
import type { RunManifest } from "../src/control-plane/domain/types.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";

const shouldRun = process.env.AGENTLAB_RUN_LANGGRAPH_INTEGRATION === "1";
const platformRoot = existsSync(join(process.cwd(), "src", "platforms", "langgraph"))
  ? join(process.cwd(), "src", "platforms", "langgraph")
  : join(process.cwd(), "server", "src", "platforms", "langgraph");

test("real LangGraph service completes, cancels, restarts, and reconciles a baseline run", { skip: !shouldRun }, async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agentlab-langgraph-"));
  let service: ManagedService | null = null;
  try {
    service = await startService(stateDirectory);
    const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, timeoutMs: 5_000 });
    assert.equal((await runner.checkConnection()).reachable, true);

    await assertGenericApiRun(runner);

    const completed = await terminalResult(runner, await runner.start(manifest(runner, "fake-success", "integration-success")));
    assert.equal(completed.status, "completed");
    assert.match(completed.output ?? "", /^Fake response:/);

    const retried = await terminalResult(runner, await runner.start(manifest(runner, "fake-pre-dispatch-retry", "integration-retry")));
    assert.equal(retried.status, "completed");
    assert.equal(retried.attemptCount, 2);

    const cancellationReference = await runner.start(manifest(runner, "fake-cancel", "integration-cancel"));
    const cancellation = await runner.cancel(cancellationReference, "integration cancellation");
    assert.equal(cancellation.accepted, true);
    const cancelled = await terminalResult(runner, cancellationReference);
    assert.equal(cancelled.status, "cancelled");

    await service.stop();
    assert.equal((await LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url }).checkConnection()).reachable, false);

    service = await startService(stateDirectory);
    const restartRunner = LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, timeoutMs: 5_000 });
    const delayedReference = await restartRunner.start(manifest(restartRunner, "fake-delay", "integration-restart"));
    await waitForStatus(restartRunner, delayedReference, "running");
    await service.stop("SIGKILL");
    service = await startService(stateDirectory);

    const recovered = await terminalResult(
      LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url }),
      delayedReference,
    );
    assert.equal(recovered.status, "reconciliation_required");
    assert.equal(recovered.error?.failureKind, "reconciliation");
  } finally {
    await service?.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function assertGenericApiRun(runner: LangGraphBaselineRunner): Promise<void> {
  const runRoot = await mkdtemp(join(tmpdir(), "agentlab-langgraph-api-"));
  const config = loadServerConfig(
    { AGENTLAB_RUN_ROOT: runRoot, AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake" },
    process.cwd(),
  );
  const evidence = new RunEvidenceStore(runRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({ config, evidence, registry });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "langgraph",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Return one generic API checkpoint sentence." },
        model: { provider: "fake", model: "fake-success" },
      },
    });
    assert.equal(createdResponse.statusCode, 202, createdResponse.body);

    let run = createdResponse.json() as { runId: string; result: { output: string } | null; status: string };
    for (let attempt = 0; attempt < 100 && !run.result; attempt += 1) {
      await delay(25);
      const inspectionResponse = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}` });
      assert.equal(inspectionResponse.statusCode, 200, inspectionResponse.body);
      run = inspectionResponse.json() as typeof run;
    }

    assert.equal(run.status, "completed");
    assert.equal(run.result?.output, "Fake response: Return one generic API checkpoint sentence.");
    for (const file of ["config.json", "events.jsonl", "trajectory.json", "metrics.json", "result.json", "native/langgraph.json"]) {
      const response = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}/evidence/${file}` });
      assert.equal(response.statusCode, 200, `${file}: ${response.body}`);
    }
  } finally {
    await app.close();
    await rm(runRoot, { recursive: true, force: true });
  }
}

function manifest(runner: LangGraphBaselineRunner, model: string, runId: string): RunManifest {
  return {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    serverVersion: "integration",
    platform: "langgraph",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Return a short checkpoint explanation." },
    context: { systemInstruction: "Answer directly." },
    platformConfig: runner.manifestConfiguration(),
    model: { provider: "fake", model },
  };
}

async function terminalResult(
  runner: LangGraphBaselineRunner,
  reference: Awaited<ReturnType<LangGraphBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection.result;
    await delay(25);
  }
  assert.fail(`LangGraph execution did not reach a terminal result: ${reference.executionId}`);
}

async function waitForStatus(
  runner: LangGraphBaselineRunner,
  reference: Awaited<ReturnType<LangGraphBaselineRunner["start"]>>,
  expected: "running" | "queued",
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await runner.inspect(reference)).status === expected) return;
    await delay(25);
  }
  assert.fail(`LangGraph execution did not reach ${expected}: ${reference.executionId}`);
}

interface ManagedService {
  readonly url: string;
  readonly process: ChildProcessWithoutNullStreams;
  readonly logs: () => string;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

async function startService(stateDirectory: string): Promise<ManagedService> {
  const port = await freePort();
  const python = process.env.AGENTLAB_LANGGRAPH_PYTHON ?? "/usr/bin/python3.12";
  const child = spawn(python, ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: platformRoot,
    env: {
      ...process.env,
      PYTHONPATH: platformRoot,
      AGENTLAB_LANGGRAPH_STATE_DIR: stateDirectory,
      AGENTLAB_LANGGRAPH_PORT: String(port),
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  await waitForHealth(child, `http://127.0.0.1:${port}`, () => output);

  return {
    url: `http://127.0.0.1:${port}`,
    process: child,
    logs: () => output,
    async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      await Promise.race([
        once(child, "exit").then(() => undefined),
        delay(signal === "SIGKILL" ? 2_000 : 5_000),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

async function waitForHealth(child: ChildProcessWithoutNullStreams, url: string, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`LangGraph service exited before readiness.\n${logs()}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      const body = await response.json() as { status?: string; message?: string };
      if (response.ok && body.status === "ready") return;
    } catch {
      // The process is still starting. The child exit check above handles a hard failure.
    }
    await delay(50);
  }
  assert.fail(`LangGraph service did not become ready.\n${logs()}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
