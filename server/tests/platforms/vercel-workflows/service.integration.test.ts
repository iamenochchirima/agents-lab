import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadVercelWorkflowsConfig } from "../../../src/platforms/vercel-workflows/config.js";
import { AdmissionStore } from "../../../src/platforms/vercel-workflows/variants/baseline/state/admission-store.js";
import type { VercelWorkflowInput } from "../../../src/platforms/vercel-workflows/variants/baseline/contracts.js";
const hasPlatformDependencies = canResolveWorkflowPackage();

test("local Workflow World runs a durable prompt and exposes native identity", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-"));
  const port = await freePort();
  const config = {
    ...loadVercelWorkflowsConfig({}),
    host: "127.0.0.1",
    port,
    serviceUrl: `http://127.0.0.1:${port}`,
    dataDir,
  };
  const service = new VercelWorkflowsPlatformService({
    config,
  });

  try {
    await service.start();
    const ready = await fetch(`${service.address}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, "ready");

    const input = workflowInput("integration-vercel-workflow-1");
    const admission = await admit(service.address, input);
    assert.equal(admission.status, 202);
    const admitted = await admission.json() as { workflowRunId: string; submissionOutcome: string };
    assert.equal(admitted.submissionOutcome, "accepted");
    assert.match(admitted.workflowRunId, /^wrun_/);

    const duplicate = await admit(service.address, input);
    const duplicateBody = await duplicate.json() as { workflowRunId: string; submissionOutcome: string };
    assert.equal(duplicateBody.submissionOutcome, "already_accepted");
    assert.equal(duplicateBody.workflowRunId, admitted.workflowRunId);

    const record = await waitForTerminal(service.address, admitted.workflowRunId);
    assert.equal(record.status, "completed");
    assert.equal(record.result.output, "Fake response: Explain durable execution in one sentence.");
    assert.equal(record.result.native.workflowName, "agentLabPrompt");

    const conflict = await admit(service.address, {
      ...input,
      prompt: "A different request with the same ID.",
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "RUN_ID_CONFLICT");

    const invalid = await fetch(`${service.address}/runs/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "missing-prompt" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow World executes the selected OpenRouter model through its durable step", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-openrouter-"));
  const port = await freePort();
  const config = {
    ...loadVercelWorkflowsConfig({}),
    host: "127.0.0.1",
    port,
    serviceUrl: `http://127.0.0.1:${port}`,
    dataDir,
  };
  const service = new VercelWorkflowsPlatformService({ config });
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousBaseUrl = process.env.AGENTLAB_OPENROUTER_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  process.env.OPENROUTER_API_KEY = "test-secret";
  process.env.AGENTLAB_OPENROUTER_BASE_URL = "https://openrouter.example/v1";
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://openrouter.example/v1/chat/completions") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "vercel-openrouter-provider-id",
        choices: [{ message: { content: "hello from Vercel Workflows OpenRouter" } }],
        usage: { prompt_tokens: 13, completion_tokens: 4, total_tokens: 17 },
      }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    await service.start();
    const admission = await admit(service.address, openRouterWorkflowInput("integration-vercel-workflow-openrouter"));
    assert.equal(admission.status, 202);
    const admitted = await admission.json() as { readonly workflowRunId: string };
    const record = await waitForTerminal(service.address, admitted.workflowRunId);

    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.equal(record.status, "completed");
    assert.equal(record.result.output, "hello from Vercel Workflows OpenRouter");
    assert.deepEqual(record.result.usage, { inputTokens: 13, outputTokens: 4, totalTokens: 17 });
    assert.equal(record.result.metrics.modelCallCount, 1);
    assert.equal(record.result.metrics.modelAttemptCount, 1);
    const completedEvent = record.result.eventIntents.find((event: { readonly kind: string }) => event.kind === "model_call_completed");
    assert.equal(completedEvent?.payload.provider, "openrouter");
    assert.equal(completedEvent?.payload.model, "cohere/north-mini-code:free");
    assert.equal(completedEvent?.payload.attempt, 1);
    assert.equal(completedEvent?.payload.requestId, "vercel-openrouter-provider-id");
    assert.equal(typeof completedEvent?.payload.stepId, "string");
    assert.deepEqual(record.result.trajectory.phases.map((phase: { readonly name: string }) => phase.name), ["model"]);
    assert.deepEqual(record.result.native.stepNames, ["step//./model-step//executeModelStep"]);
    assert.equal(JSON.stringify(record).includes("test-secret"), false);
  } finally {
    await service.stop();
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL;
    else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBaseUrl;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow projects a model failure without fabricating a successful result", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-failure-"));
  const port = await freePort();
  const service = new VercelWorkflowsPlatformService({
    config: { ...loadVercelWorkflowsConfig({}), host: "127.0.0.1", port, serviceUrl: `http://127.0.0.1:${port}`, dataDir },
  });

  try {
    await service.start();
    const admission = await admit(service.address, workflowInput("integration-vercel-workflow-failure", "fake-failure"));
    assert.equal(admission.status, 202);
    const admitted = await admission.json() as { readonly workflowRunId: string };
    const record = await waitForTerminal(service.address, admitted.workflowRunId);

    assert.equal(record.status, "failed");
    assert.equal(record.result.output, null);
    assert.equal(record.result.error.code, "WORKFLOW_RUN_FAILED");
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow cancellation is surfaced through the service", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-cancel-"));
  const port = await freePort();
  const config = { ...loadVercelWorkflowsConfig({}), host: "127.0.0.1", port, serviceUrl: `http://127.0.0.1:${port}`, dataDir };
  const service = new VercelWorkflowsPlatformService({ config });
  try {
    await service.start();
    const admission = await admit(service.address, workflowInput("integration-vercel-workflow-cancel", "fake-wait"));
    const admitted = await admission.json() as { workflowRunId: string };
    await waitForStatus(service.address, admitted.workflowRunId, ["pending", "running"]);
    const cancelled = await fetch(`${service.address}/runs/${encodeURIComponent(admitted.workflowRunId)}?cancel=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test cancellation" }) });
    const body = await cancelled.json() as { accepted: boolean; alreadyTerminal: boolean };
    assert.equal(cancelled.status, 202);
    assert.equal(body.accepted, true);
    const record = await waitForTerminal(service.address, admitted.workflowRunId);
    assert.equal(record.status, "cancelled");
    assert.equal(record.result.error.failureKind, "cancelled");
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow admission preserves an unresolved pending record across service construction", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-pending-"));
  const port = await freePort();
  const input = workflowInput("integration-vercel-workflow-pending");
  const admissionStore = new AdmissionStore(join(dataDir, "agentlab-admissions.json"));
  await admissionStore.load();
  await admissionStore.reserve(input, hashInput(input));
  const service = new VercelWorkflowsPlatformService({
    config: { ...loadVercelWorkflowsConfig({}), host: "127.0.0.1", port, serviceUrl: `http://127.0.0.1:${port}`, dataDir },
  });

  try {
    await service.start();
    const response = await admit(service.address, input);
    const body = await response.json() as { readonly workflowRunId: string | null; readonly submissionOutcome: string; readonly status: string };

    assert.equal(response.status, 202);
    assert.equal(body.workflowRunId, null);
    assert.equal(body.submissionOutcome, "unknown");
    assert.equal(body.status, "pending_admission_reconciliation");
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow World recovers an active run after the service restarts", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-restart-"));
  const port = await freePort();
  const config = { ...loadVercelWorkflowsConfig({}), host: "127.0.0.1", port, serviceUrl: `http://127.0.0.1:${port}`, dataDir };
  const firstService = new VercelWorkflowsPlatformService({ config });
  let secondService: InstanceType<typeof VercelWorkflowsPlatformService> | null = null;

  try {
    await firstService.start();
    const admission = await admit(serviceAddress(firstService), workflowInput("integration-vercel-workflow-restart", "fake-wait"));
    assert.equal(admission.status, 202);
    const admitted = await admission.json() as { readonly workflowRunId: string };
    await waitForStatus(serviceAddress(firstService), admitted.workflowRunId, ["pending", "running"]);
    await firstService.stop();

    secondService = new VercelWorkflowsPlatformService({ config });
    await secondService.start();
    const recovered = await waitForTerminal(serviceAddress(secondService), admitted.workflowRunId, 20_000);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.result.output, "Fake response: wait");
  } finally {
    await firstService.stop();
    await secondService?.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function waitForTerminal(address: string, workflowRunId: string, timeoutMs = 10_000): Promise<any> {
  return waitForStatus(address, workflowRunId, ["completed", "failed", "cancelled"], timeoutMs);
}

async function waitForStatus(address: string, workflowRunId: string, expectedStatuses: readonly string[], timeoutMs = 5_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${address}/runs/${encodeURIComponent(workflowRunId)}`);
    assert.equal(response.status, 200);
    const record = await response.json() as any;
    if (expectedStatuses.includes(record.status)) return record;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Workflow ${workflowRunId} did not reach one of ${expectedStatuses.join(", ")} within ${timeoutMs}ms.`);
}

async function admit(address: string, input: VercelWorkflowInput): Promise<Response> {
  return fetch(`${address}/runs/admit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

function workflowInput(runId: string, model = "fake"): VercelWorkflowInput {
  return {
    runId,
    prompt: model === "fake" ? "Explain durable execution in one sentence." : "wait",
    systemInstruction: "Be concise.",
    model: { provider: "fake", model },
    modelTimeoutMs: 1_000,
  };
}

function openRouterWorkflowInput(runId: string): VercelWorkflowInput {
  return {
    runId,
    prompt: "Say hello from a Vercel Workflow.",
    systemInstruction: "Respond directly.",
    model: { provider: "openrouter", model: "cohere/north-mini-code:free" },
    modelTimeoutMs: 1_000,
  };
}

function hashInput(input: VercelWorkflowInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function serviceAddress(service: { readonly address: string }): string {
  return service.address;
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The operating system did not return a test port.");
  }
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

function canResolveWorkflowPackage(): boolean {
  const candidatePackagePaths = [
    new URL("../../../src/platforms/vercel-workflows/package.json", import.meta.url),
    new URL("../../../../src/platforms/vercel-workflows/package.json", import.meta.url),
  ];
  for (const packagePath of candidatePackagePaths) {
    try {
      const platformPackageRequire = createRequire(packagePath);
      platformPackageRequire.resolve("workflow/api");
      platformPackageRequire.resolve("@workflow/world-local");
      return true;
    } catch {
      // The compiled shared suite may not have the platform package installed.
    }
  }
  return false;
}
