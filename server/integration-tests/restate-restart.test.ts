import { retainRestartEvidence } from "../src/evals/restart-evidence.js";
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { createLocalFixtureServer } from "../src/capabilities/integrations/local-fixture/service.js";
import { loadRestateConfig } from "../src/platforms/restate/config.js";
import { RestateBaselineRunner } from "../src/platforms/restate/runner-adapter/restate-runner.js";

test(
  "native Restate replays active work after service and server replacement",
  {
    skip:
      process.env.AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION === "1"
        ? false
        : "Set AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 to run the isolated native restart exercise.",
  },
  async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "agentlab-restate-restart-data-"));
    const contextRoot = await mkdtemp(join(tmpdir(), "agentlab-restate-restart-context-"));
    const ingressPort = await unusedPort();
    const adminPort = await unusedPort();
    const messageFabricPort = await unusedPort();
    const servicePort = await unusedPort();
    const fixture = await createLocalFixtureServer({ host: "127.0.0.1", port: 0 });
    const restateEnvironment = {
      ...process.env,
      AGENTLAB_CONTEXT_ROOT: contextRoot,
      AGENTLAB_X01_MODEL_ATTEMPTS_FILE: join(contextRoot, "synthetic-model-attempts.jsonl"),
      AGENTLAB_RESTATE_INGRESS_URL: `http://127.0.0.1:${ingressPort}`,
      AGENTLAB_RESTATE_ADMIN_URL: `http://127.0.0.1:${adminPort}`,
      AGENTLAB_RESTATE_SERVICE_URL: `http://127.0.0.1:${servicePort}`,
      AGENTLAB_RESTATE_SERVICE_PORT: String(servicePort),
      AGENTLAB_RESTATE_DATA_DIR: dataDirectory,
      RESTATE_BIND_IP: "127.0.0.1",
      RESTATE_ADMIN__BIND_ADDRESS: `127.0.0.1:${adminPort}`,
      RESTATE_INGRESS__BIND_ADDRESS: `127.0.0.1:${ingressPort}`,
      RESTATE_BIND_PORT: String(messageFabricPort),
      AGENTLAB_LOCAL_FIXTURE_URL: `http://127.0.0.1:${fixture.port}`,
    };
    let restateProcess: ChildProcess | null = null;
    let serviceProcess: ChildProcess | null = null;

    try {
      restateProcess = startRestateProcess(restateEnvironment, dataDirectory);
      await waitForHttp(`${restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL}/health`);
      serviceProcess = startServiceProcess(restateEnvironment);
      await waitForTcp(servicePort);
      await registerService(restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL, restateEnvironment.AGENTLAB_RESTATE_SERVICE_URL);

      const config = loadRestateConfig(restateEnvironment);
      const runner = await RestateBaselineRunner.connect(config);
      const serviceRunId = `restate-restart-service-${Date.now()}`;
      const serviceManifest = buildRunManifest(
        {
          platform: "restate",
          variant: "baseline",
          task: { kind: "prompt", prompt: "Replay this run after the service is replaced." },
          model: { provider: "fake", model: "fake-delay" },
        },
        { runId: serviceRunId, platformConfig: runner.manifestConfiguration() },
      );
      let serviceReference = await runner.start(serviceManifest);
      await waitForRunning(runner, serviceReference);
      await stopProcess(serviceProcess);
      serviceProcess = startServiceProcess(restateEnvironment);
      await waitForTcp(servicePort);
      await registerService(restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL, restateEnvironment.AGENTLAB_RESTATE_SERVICE_URL, true);
      const serviceResult = await waitForResult(runner, serviceReference);
      serviceReference = serviceResult.reference;
      assert.equal(serviceResult.result?.status, "completed");
      assert.equal(serviceResult.result?.output, "Fake response: Replay this run after the service is replaced.");

      const mcpRunId = `restate-restart-mcp-${Date.now()}`;
      const mcpManifest = buildRunManifest(
        {
          platform: "restate",
          variant: "baseline",
          task: { kind: "prompt", prompt: "Replay the completed MCP action after the service is replaced." },
          model: { provider: "fake", model: "fake-mcp-tool-call-delay" },
          capabilities: {
            tools: { enabledNames: ["mcp_fixture_lookup"], maxRounds: 3, maxCalls: 2 },
            connections: [{
              toolName: "mcp_fixture_lookup",
              connectionRef: "conn_local_mcp_fixture",
              operations: ["lookup"],
              mcp: {
                endpointRef: "local-fixture-mcp",
                serverName: "agentlab-local-mcp",
                protocolVersion: "2025-06-18",
                toolName: "fixture.lookup",
                toolVersion: "1.0.0",
              },
            }],
          },
        },
        { runId: mcpRunId, platformConfig: runner.manifestConfiguration() },
      );
      let mcpReference = await runner.start(mcpManifest);
      await waitForMcpCall(fixture);
      let beforeMcpRestart = await runner.inspect(mcpReference);
      for (let attempt = 0; attempt < 100 && !(beforeMcpRestart.eventIntents.some(event => event.kind === "ToolExecutionCompleted") && beforeMcpRestart.eventIntents.filter(event => event.kind === "ModelRequested").length >= 2); attempt++) {
        await delay(25); beforeMcpRestart = await runner.inspect(mcpReference);
      }
      assert.ok(beforeMcpRestart.eventIntents.some(event => event.kind === "ToolExecutionCompleted"));
      assert.ok(beforeMcpRestart.eventIntents.filter(event => event.kind === "ModelRequested").length >= 2);
      const providerCallsBefore = fixture.mcpCallCount;
      serviceProcess!.kill("SIGKILL");
      await new Promise<void>(done => serviceProcess!.once("exit", () => done()));
      serviceProcess = startServiceProcess(restateEnvironment);
      await waitForTcp(servicePort);
      await registerService(restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL, restateEnvironment.AGENTLAB_RESTATE_SERVICE_URL, true);
      const mcpResult = await waitForResult(runner, mcpReference);
      mcpReference = mcpResult.reference;
      assert.equal(mcpResult.result?.status, "completed");
      assert.equal(mcpResult.result?.output, 'The local MCP fixture returned {"key":"alpha","value":"local fixture alpha"}.');
      const mcpCompletion = mcpResult.eventIntents.find((event) => event.kind === "ToolExecutionCompleted");
      assert.equal(mcpCompletion?.payload.toolName, "mcp_fixture_lookup");
      assert.equal((mcpCompletion?.payload.connection as { providerRequestIds?: readonly string[] } | undefined)?.providerRequestIds?.length, 1);
      assert.equal(fixture.mcpCallCount, 1, "the completed MCP action must be replayed from Restate's journal, not dispatched again");
      assert.equal(mcpReference.executionId, `agentlab:${mcpRunId}`);
      await retainRestartEvidence(process.env.AGENTLAB_X01_EVIDENCE, { platform: "restate", deployment: `native:${restateEnvironment.AGENTLAB_RESTATE_INGRESS_URL}`, runId: mcpRunId,
        before: { status: beforeMcpRestart.status, events: beforeMcpRestart.eventIntents, native: beforeMcpRestart.reference }, after: { status: mcpResult.status, events: mcpResult.eventIntents, result: mcpResult.result, native: mcpReference },
        beforeModelOutcomePersistence: beforeMcpRestart.eventIntents.filter(event => event.kind === "ModelRequested").length >= 2 && beforeMcpRestart.result === null,
        afterToolPersistence: beforeMcpRestart.eventIntents.some(event => event.kind === "ToolExecutionCompleted"), sameNativeIdentity: beforeMcpRestart.reference.executionId === mcpReference.executionId,
        retainedState: mcpResult.result?.status === "completed" && !!mcpCompletion, providerCallsBefore, providerCallsAfter: fixture.mcpCallCount,
        normalizedModelRequests: mcpResult.eventIntents.filter(event => event.kind === "ModelRequested").length, nativeModelActivityAttempts: null, providerModelDispatches: (await readFile(restateEnvironment.AGENTLAB_X01_MODEL_ATTEMPTS_FILE, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(record => record.runId === mcpRunId) });

      const serverRunId = `restate-restart-server-${Date.now()}`;
      const serverManifest = buildRunManifest(
        {
          platform: "restate",
          variant: "baseline",
          task: { kind: "prompt", prompt: "Replay this run after the server is replaced." },
          model: { provider: "fake", model: "fake-delay" },
        },
        { runId: serverRunId, platformConfig: runner.manifestConfiguration() },
      );
      let serverReference = await runner.start(serverManifest);
      await waitForRunning(runner, serverReference);
      await stopProcess(serviceProcess);
      serviceProcess = null;
      await stopProcess(restateProcess);
      restateProcess = null;

      restateProcess = startRestateProcess(restateEnvironment, dataDirectory);
      await waitForHttp(`${restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL}/health`);
      serviceProcess = startServiceProcess(restateEnvironment);
      await waitForTcp(servicePort);
      await registerService(restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL, restateEnvironment.AGENTLAB_RESTATE_SERVICE_URL, true);
      const serverResult = await waitForResult(runner, serverReference);
      serverReference = serverResult.reference;
      assert.equal(serverResult.result?.status, "completed");
      assert.equal(serverResult.result?.output, "Fake response: Replay this run after the server is replaced.");
      assert.equal(serverReference.executionId, `agentlab:${serverRunId}`);
    } finally {
      await stopProcess(serviceProcess);
      await stopProcess(restateProcess);
      await rm(contextRoot, { recursive: true, force: true });
      await rm(dataDirectory, { recursive: true, force: true });
      await fixture.close();
    }
  },
);

function startRestateProcess(environment: NodeJS.ProcessEnv, dataDirectory: string): ChildProcess {
  const executable = resolve(process.cwd(), "src/platforms/restate/node_modules/.bin/restate-server");
  return spawn(executable, ["--no-logo", "--node-name=agentlab-restart", "--base-dir", dataDirectory], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForMcpCall(fixture: { readonly mcpCallCount: number }): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fixture.mcpCallCount > 0) return;
    await delay(50);
  }
  throw new Error("The Restate workflow did not dispatch the MCP call before the replacement window.");
}

function startServiceProcess(environment: NodeJS.ProcessEnv): ChildProcess {
  const entrypoint = resolve(process.cwd(), "dist/src/platforms/restate/service-entry.js");
  return spawn(process.execPath, ["--enable-source-maps", entrypoint], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForRunning(runner: RestateBaselineRunner, reference: Awaited<ReturnType<RestateBaselineRunner["start"]>>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.status === "running") return;
    if (inspection.result) throw new Error(`Workflow completed before the replacement window: ${inspection.result.status}`);
    await delay(50);
  }
  throw new Error("Native workflow did not reach a running state before the replacement window.");
}

async function waitForResult(
  runner: RestateBaselineRunner,
  reference: Awaited<ReturnType<RestateBaselineRunner["start"]>>,
): Promise<Awaited<ReturnType<RestateBaselineRunner["inspect"]>>> {
  let current = reference;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const inspection = await runner.inspect(current);
      current = inspection.reference;
      if (inspection.result) return inspection;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Native workflow did not reach a terminal result${lastError instanceof Error ? `: ${lastError.message}` : "."}`);
}

async function registerService(adminUrl: string, serviceUrl: string, allowExisting = false): Promise<void> {
  const response = await fetch(`${adminUrl}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: serviceUrl }),
  });
  if (response.ok) return;
  if (allowExisting && (response.status === 400 || response.status === 409)) {
    const deployments = await fetch(`${adminUrl}/deployments`).then((result) => result.json()) as { deployments?: readonly { services?: readonly { uri?: string }[] }[] };
    if (deployments.deployments?.some((deployment) => deployment.services?.some((service) => service.uri === serviceUrl))) return;
  }
  throw new Error(`Restate service registration failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function waitForHttp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The native process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForTcp(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const connected = await new Promise<boolean>((resolveConnection) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveConnection(true);
      });
      socket.once("error", () => resolveConnection(false));
    });
    if (connected) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for TCP port ${port}`);
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    onceExit(child),
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function onceExit(child: ChildProcess): Promise<void> {
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The operating system did not allocate a TCP port.");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
