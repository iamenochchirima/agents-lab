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
