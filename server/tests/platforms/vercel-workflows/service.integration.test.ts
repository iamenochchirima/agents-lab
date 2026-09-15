import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadVercelWorkflowsConfig } from "../../../src/platforms/vercel-workflows/config.js";
const hasPlatformDependencies = canResolveWorkflowPackage();

test("local Workflow World runs a durable prompt and exposes native identity", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-"));
  const port = 39_093;
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

    const admission = await fetch(`${service.address}/runs/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "integration-vercel-workflow-1",
        prompt: "Explain durable execution in one sentence.",
        systemInstruction: "Be concise.",
        model: { provider: "fake", model: "fake" },
        modelTimeoutMs: 1_000,
      }),
    });
    assert.equal(admission.status, 202);
    const admitted = await admission.json() as { workflowRunId: string; submissionOutcome: string };
    assert.equal(admitted.submissionOutcome, "accepted");
    assert.match(admitted.workflowRunId, /^wrun_/);

    const duplicate = await fetch(`${service.address}/runs/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "integration-vercel-workflow-1",
        prompt: "Explain durable execution in one sentence.",
        systemInstruction: "Be concise.",
        model: { provider: "fake", model: "fake" },
        modelTimeoutMs: 1_000,
      }),
    });
    const duplicateBody = await duplicate.json() as { workflowRunId: string; submissionOutcome: string };
    assert.equal(duplicateBody.submissionOutcome, "already_accepted");
    assert.equal(duplicateBody.workflowRunId, admitted.workflowRunId);

    const record = await waitForTerminal(service.address, admitted.workflowRunId);
    assert.equal(record.status, "completed");
    assert.equal(record.result.output, "Fake response: Explain durable execution in one sentence.");
    assert.equal(record.result.native.workflowName, "agentLabPrompt");
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("local Workflow cancellation is surfaced through the service", { skip: !hasPlatformDependencies }, async () => {
  const { VercelWorkflowsPlatformService } = await import("../../../src/platforms/vercel-workflows/service/platform-service.js");
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-vercel-workflows-cancel-"));
  const port = 39_094;
  const config = { ...loadVercelWorkflowsConfig({}), host: "127.0.0.1", port, serviceUrl: `http://127.0.0.1:${port}`, dataDir };
  const service = new VercelWorkflowsPlatformService({ config });
  try {
    await service.start();
    const admission = await fetch(`${service.address}/runs/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "integration-vercel-workflow-cancel", prompt: "wait", systemInstruction: "", model: { provider: "fake", model: "fake-wait" }, modelTimeoutMs: 1_000 }),
    });
    const admitted = await admission.json() as { workflowRunId: string };
    const cancelled = await fetch(`${service.address}/runs/${encodeURIComponent(admitted.workflowRunId)}?cancel=1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test cancellation" }) });
    const body = await cancelled.json() as { accepted: boolean; alreadyTerminal: boolean };
    assert.equal(body.accepted || body.alreadyTerminal, true);
    const record = await waitForTerminal(service.address, admitted.workflowRunId);
    assert.ok(record.status === "cancelled" || record.status === "completed");
  } finally {
    await service.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function waitForTerminal(address: string, workflowRunId: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${address}/runs/${encodeURIComponent(workflowRunId)}`);
    const record = await response.json() as any;
    if (["completed", "failed", "cancelled"].includes(record.status)) return record;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Workflow ${workflowRunId} did not reach a terminal state.`);
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
