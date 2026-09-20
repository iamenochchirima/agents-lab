import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { MastraWorkflowRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-workflow-runner.js";

test("Mastra workflow completes a native stored run", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-"));
  const runner = new MastraWorkflowRunner({ storagePath: join(root, "workflow.db") });

  try {
    const manifest = manifestFor(runner, "Say hello.");
    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);

    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.status, "completed");
    assert.equal(inspection.result?.output, "Deterministic Mastra response.");
    assert.equal(inspection.reference.native.nativeStatus, "success");
    assert.equal(inspection.reference.native.evidenceSchema, "mastra.native.v2");
    assert.equal(inspection.reference.native.eventCount, inspection.eventIntents.length);
    assert.equal(inspection.reference.native.toolCallCount, 0);
    assert.ok(inspection.eventIntents.some((event) => event.kind === "WorkflowCompleted"));
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow reports an invalid storage path as unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-storage-error-"));
  const storageDirectory = join(root, "workflow-storage-directory");
  await mkdir(storageDirectory);

  const runner = new MastraWorkflowRunner({ storagePath: storageDirectory });
  try {
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, false);
    assert.match(connectivity.message, /storage|database|connection/i);
    await assert.rejects(runner.start(manifestFor(runner, "Say hello.", "mastra-invalid-storage")), /storage|database|connection/i);
  } finally {
    await runner.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Mastra workflow suspends, resumes, and can be inspected by a replacement runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-workflow-resume-"));
  const storagePath = join(root, "workflow.db");
  const original = new MastraWorkflowRunner({ storagePath });
  const manifest = manifestFor(original, "[approval] Publish the prepared post.", "mastra-workflow-approval");
  const reference = await original.start(manifest);
  const suspended = await waitForStatus(original, reference, "suspended");
  assert.equal(suspended.result, null);
  assert.equal(suspended.reference.native.nativeStatus, "suspended");
  assert.equal(suspended.reference.native.evidenceSchema, "mastra.native.v2");
  assert.equal(suspended.reference.native.eventCount, suspended.eventIntents.length);
  await original.close();

  const replacement = new MastraWorkflowRunner({ storagePath });
  try {
    const duplicateStart = await replacement.start(manifest);
    assert.deepEqual(duplicateStart, reference);
    const recovered = await replacement.inspect(reference);
    assert.equal(recovered.status, "suspended");
    assert.ok(recovered.eventIntents.some((event) => event.kind === "WorkflowSuspended"));

    await assert.rejects(
      replacement.resume(reference, { approved: "yes" }),
      /approved boolean/,
    );
    const resume = await replacement.resume(reference, { approved: true });
    assert.equal(resume.accepted, true);
    const completed = await waitForTerminal(replacement, reference);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result?.output, "Deterministic Mastra response.");
    assert.ok(completed.eventIntents.some((event) => event.kind === "WorkflowResumed"));
  } finally {
    await replacement.close();
    await rm(root, { recursive: true, force: true });
  }
});

function manifestFor(
  runner: MastraWorkflowRunner,
  prompt: string,
  runId = `mastra-workflow-${prompt.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
): RunManifest {
  return buildRunManifest(
    {
      platform: "mastra",
      variant: "workflow",
      task: { kind: "prompt", prompt },
      model: { provider: "fake", model: "fake-success" },
    },
    { runId, platformConfig: runner.manifestConfiguration() },
  );
}

async function waitForTerminal(
  runner: MastraWorkflowRunner,
  reference: Awaited<ReturnType<MastraWorkflowRunner["start"]>>,
) {
  return waitForStatus(runner, reference, "completed");
}

async function waitForStatus(
  runner: MastraWorkflowRunner,
  reference: Awaited<ReturnType<MastraWorkflowRunner["start"]>>,
  expected: "suspended" | "completed",
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.status === expected) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Mastra workflow did not reach ${expected}.`);
}
