import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { buildControlPlaneServer } from "../src/control-plane/http/server.js";
import type { RunManifest } from "../src/control-plane/domain/types.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../src/capabilities/context/index.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";

const shouldRun = process.env.AGENTLAB_RUN_LANGGRAPH_INTEGRATION === "1";
const platformRoot = existsSync(join(process.cwd(), "src", "platforms", "langgraph"))
  ? join(process.cwd(), "src", "platforms", "langgraph")
  : join(process.cwd(), "server", "src", "platforms", "langgraph");

test("real LangGraph service completes, cancels, restarts, and reconciles a baseline run", { skip: !shouldRun }, async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agentlab-langgraph-"));
  const contextRoot = join(stateDirectory, "sessions");
  let service: ManagedService | null = null;
  try {
    service = await startService(stateDirectory);
    const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, contextRoot, timeoutMs: 5_000 });
    assert.equal((await runner.checkConnection()).reachable, true);

    await assertGenericApiRun(runner, contextRoot);

    const completed = await terminalResult(runner, await runner.start(manifest(runner, "fake-success", "integration-success")));
    assert.equal(completed.status, "completed");
    assert.match(completed.output ?? "", /^Fake response:/);

    const toolInspection = await terminalInspection(runner, await runner.start({
      ...manifest(runner, "fake-tool-call", "integration-tool"),
      task: { kind: "prompt", prompt: "Calculate 17 plus 25." },
      capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 3, maxCalls: 2 } },
    }));
    assert.equal(toolInspection.result?.status, "completed");
    assert.equal(toolInspection.result?.output, 'The calculator returned {"value":42}.');
    assert.equal(toolInspection.metrics?.modelCallCount, 2);
    assert.ok(toolInspection.eventIntents.some((event) => event.kind === "ToolCallRequested"));
    assert.ok(toolInspection.eventIntents.some((event) => event.kind === "ToolExecutionCompleted"));

    const contextStore = new ContextSessionStore(contextRoot);
    await contextStore.create({
      sessionId: "session-integration-context",
      platform: "langgraph",
      variant: "baseline",
      model: "fake/fake-context",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 16_384,
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
      recentMessageGroups: 2,
    });
    const firstTurn = await contextStore.admitTurn(
      "session-integration-context",
      "integration-context-first",
      "Remember conformance-4318.",
    );
    await contextStore.settleTurn("session-integration-context", firstTurn.turn.turnId, {
      status: "completed",
      output: "Stored the test value.",
      error: null,
    });
    const secondTurn = await contextStore.admitTurn(
      "session-integration-context",
      "integration-context",
      "What value did you remember?",
    );
    const contextInspection = await terminalInspection(runner, await runner.start({
      ...manifest(runner, "fake-context", "integration-context"),
      task: { kind: "prompt", prompt: "What value did you remember?" },
      context: {
        systemInstruction: "Answer directly.",
        sessionId: "session-integration-context",
        turnId: secondTurn.turn.turnId,
      },
    }));
    assert.equal(contextInspection.result?.status, "completed");
    assert.equal(contextInspection.result?.output, "conformance-4318");
    const prepared = contextInspection.eventIntents.find((event) => event.kind === "ContextPrepared");
    assert.equal(prepared?.payload.contextSource, "shared-snapshot");
    assert.equal(typeof prepared?.payload.snapshotId, "string");
    assert.equal(prepared?.payload.quality, "estimated");

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
    const restartRunner = LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, contextRoot, timeoutMs: 5_000 });
    const delayedReference = await restartRunner.start(manifest(restartRunner, "fake-delay", "integration-restart"));
    await waitForStatus(restartRunner, delayedReference, "running");
    await service.stop("SIGKILL");
    service = await startService(stateDirectory);

    const recovered = await terminalResult(
      LangGraphBaselineRunner.fromOptions({ serviceUrl: service.url, contextRoot }),
      delayedReference,
    );
    assert.equal(recovered.status, "reconciliation_required");
    assert.equal(recovered.error?.failureKind, "reconciliation");
  } finally {
    await service?.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function assertGenericApiRun(runner: LangGraphBaselineRunner, contextRoot: string): Promise<void> {
  const runRoot = await mkdtemp(join(tmpdir(), "agentlab-langgraph-api-"));
  const config = loadServerConfig(
    {
      AGENTLAB_RUN_ROOT: runRoot,
      AGENTLAB_CONTEXT_ROOT: contextRoot,
      AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
    },
    process.cwd(),
  );
  const evidence = new RunEvidenceStore(runRoot);
  const apiRunner = LangGraphBaselineRunner.fromOptions({
    serviceUrl: String(runner.manifestConfiguration().serviceUrl),
    contextRoot: config.contextRoot,
    timeoutMs: 5_000,
  });
  const registry = new PlatformRegistry([apiRunner]);
  const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
  const service = new RunService({ config, context, evidence, registry });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  try {
    await app.ready();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        platform: "langgraph",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Calculate 17 plus 25." },
        model: { provider: "fake", model: "fake-tool-call", contextWindowTokens: 16_384 },
        sessionId: "session-generic-api",
        clientTurnId: "client-generic-api",
        capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 3, maxCalls: 2 } },
      },
    });
    assert.equal(createdResponse.statusCode, 202, createdResponse.body);

    let run = createdResponse.json() as RunView;
    for (let attempt = 0; attempt < 100 && !run.result; attempt += 1) {
      await delay(25);
      const inspectionResponse = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}` });
      assert.equal(inspectionResponse.statusCode, 200, inspectionResponse.body);
      run = inspectionResponse.json() as RunView;
    }

    assert.equal(run.status, "completed");
    assert.equal(run.result?.output, 'The calculator returned {"value":42}.');
    assert.equal(run.manifest.context.sessionId, "session-generic-api");
    assert.equal(run.context?.sessionId, "session-generic-api");
    assert.equal(run.executionReference?.native.threadId, runnerThreadId("session-generic-api"));
    assert.ok(run.events.some((event) => event.kind === "ToolExecutionCompleted"));
    assert.equal(run.context?.budget.quality, "estimated");
    for (const file of ["config.json", "events.jsonl", "trajectory.json", "metrics.json", "context.json", "result.json", "native/langgraph.json"]) {
      const response = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}/evidence/${file}` });
      assert.equal(response.statusCode, 200, `${file}: ${response.body}`);
    }
  } finally {
    await app.close();
    await rm(runRoot, { recursive: true, force: true });
  }
}

function runnerThreadId(sessionId: string): string {
  return `langgraph:baseline:${createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 32)}`;
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

async function terminalInspection(
  runner: LangGraphBaselineRunner,
  reference: Awaited<ReturnType<LangGraphBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
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
  const python = resolvePython();
  const child = spawn(python, ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: platformRoot,
    env: {
      ...process.env,
      PYTHONPATH: platformRoot,
      AGENTLAB_LANGGRAPH_STATE_DIR: stateDirectory,
      AGENTLAB_LANGGRAPH_PORT: String(port),
      AGENTLAB_CONTEXT_ROOT: join(stateDirectory, "sessions"),
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

function resolvePython(): string {
  const candidates = [
    process.env.AGENTLAB_LANGGRAPH_PYTHON,
    join(platformRoot, ".venv", "bin", "python"),
    join(platformRoot, ".local311", "bin", "python"),
    join(platformRoot, ".local", "bin", "python"),
    "python3.12",
    "python3.11",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const selected = candidates.find((candidate) => {
    const result = spawnSync(candidate, ["-c", "import fastapi, langgraph, uvicorn"], { stdio: "ignore" });
    return result.status === 0;
  });
  assert.ok(selected, "No Python interpreter with the locked LangGraph dependencies was found. Set AGENTLAB_LANGGRAPH_PYTHON.");
  return selected;
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
