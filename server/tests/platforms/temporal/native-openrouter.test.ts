import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NativeConnection, Worker } from "@temporalio/worker";

import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../../../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../../../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../../../src/control-plane/bootstrap/config.js";
import { baselineActivities } from "../../../src/platforms/temporal/variants/baseline/activities.js";
import { TemporalBaselineRunner } from "../../../src/platforms/temporal/runner-adapter/temporal-runner.js";

const SELECTED_MODEL = "cohere/north-mini-code:free";
const TEST_KEY = "test-temporal-openrouter-secret";

test("native Temporal workflow executes the selected model through the OpenRouter boundary", { skip: process.env.AGENTLAB_RUN_TEMPORAL_NATIVE_OPENROUTER !== "1" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-temporal-native-openrouter-"));
  const provider = await startMockOpenRouter();
  const taskQueue = `agentlab-temporal-openrouter-${randomUUID()}`;
  const previousEnvironment = new Map<string, string | undefined>([
    ["AGENTLAB_RUN_ROOT", process.env.AGENTLAB_RUN_ROOT],
    ["AGENTLAB_CONTEXT_ROOT", process.env.AGENTLAB_CONTEXT_ROOT],
    ["AGENTLAB_TEMPORAL_TASK_QUEUE", process.env.AGENTLAB_TEMPORAL_TASK_QUEUE],
    ["AGENTLAB_OPENROUTER_BASE_URL", process.env.AGENTLAB_OPENROUTER_BASE_URL],
    ["OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY],
    ["AGENTLAB_ALLOWED_MODEL_PROVIDERS", process.env.AGENTLAB_ALLOWED_MODEL_PROVIDERS],
  ]);

  process.env.AGENTLAB_RUN_ROOT = root;
  process.env.AGENTLAB_CONTEXT_ROOT = join(root, "sessions");
  process.env.AGENTLAB_TEMPORAL_TASK_QUEUE = taskQueue;
  process.env.AGENTLAB_OPENROUTER_BASE_URL = provider.baseUrl;
  process.env.OPENROUTER_API_KEY = TEST_KEY;
  process.env.AGENTLAB_ALLOWED_MODEL_PROVIDERS = "openrouter";

  let nativeConnection: NativeConnection | undefined;
  let worker: Worker | undefined;
  let workerRun: Promise<void> | undefined;
  let runner: TemporalBaselineRunner | undefined;

  try {
    const config = loadServerConfig(process.env, root);
    nativeConnection = await NativeConnection.connect({ address: config.temporal.endpoint });
    const workflowExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    worker = await Worker.create({
      connection: nativeConnection,
      namespace: config.temporal.namespace,
      taskQueue,
      workflowsPath: fileURLToPath(new URL(`../../../src/platforms/temporal/variants/baseline/workflow.${workflowExtension}`, import.meta.url)),
      activities: baselineActivities,
    });
    workerRun = worker.run();

    runner = await TemporalBaselineRunner.connect(config);
    const store = new RunEvidenceStore(root);
    const service = new RunService({
      config,
      context: new ContextService(new ContextSessionStore(config.contextRoot), new CharacterTokenEstimator()),
      evidence: store,
      registry: new PlatformRegistry([runner]),
    });

    const run = await service.createRun({
      platform: "temporal",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Return the exact phrase: native Temporal provider boundary." },
      model: { provider: "openrouter", model: SELECTED_MODEL, contextWindowTokens: 128_000 },
    });
    const completed = await waitForTerminal(service, run.runId);

    assert.equal(completed.status, "completed");
    assert.equal(completed.manifest.model.provider, "openrouter");
    assert.equal(completed.manifest.model.model, SELECTED_MODEL);
    assert.equal(completed.result?.output, "native Temporal provider boundary.");
    assert.deepEqual(completed.result?.usage, { inputTokens: 14, outputTokens: 5, totalTokens: 19 });
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.authorization, `Bearer ${TEST_KEY}`);
    assert.equal(provider.requests[0]?.body.model, SELECTED_MODEL);
    assert.equal(completed.events.find((event) => event.kind === "ModelRequested")?.payload.provider, "openrouter");

    const evidence = await readFile(join(root, run.runId, "result.json"), "utf8");
    assert.equal(evidence.includes(TEST_KEY), false);
    assert.equal(JSON.stringify(completed.executionReference).includes(TEST_KEY), false);
  } finally {
    await runner?.close();
    await worker?.shutdown();
    await workerRun;
    await nativeConnection?.close();
    await provider.close();
    await rm(root, { recursive: true, force: true });
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

interface MockOpenRouter {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  readonly requests: readonly MockRequest[];
}

interface MockRequest {
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

async function startMockOpenRouter(): Promise<MockOpenRouter> {
  const requests: MockRequest[] = [];
  const server = createServer((request, response) => void handleMockRequest(request, response, requests));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    requests,
  };
}

async function handleMockRequest(request: IncomingMessage, response: ServerResponse, requests: MockRequest[]): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
  requests.push({
    authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
    body,
  });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: "temporal-native-provider-request",
    choices: [{ message: { content: "native Temporal provider boundary." } }],
    usage: { prompt_tokens: 14, completion_tokens: 5, total_tokens: 19 },
  }));
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function waitForTerminal(service: RunService, runId: string): Promise<RunView> {
  const deadline = Date.now() + 20_000;
  let latest: RunView | undefined;
  while (Date.now() < deadline) {
    latest = await service.getRun(runId);
    if (["completed", "failed", "cancelled", "reconciliation_required"].includes(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Temporal native OpenRouter run did not finish. Last status: ${latest?.status ?? "unknown"}.`);
}
