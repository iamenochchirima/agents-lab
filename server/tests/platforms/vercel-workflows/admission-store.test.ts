import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AdmissionStore } from "../../../src/platforms/vercel-workflows/variants/baseline/state/admission-store.js";
import type { VercelWorkflowInput } from "../../../src/platforms/vercel-workflows/variants/baseline/contracts.js";

const input: VercelWorkflowInput = {
  runId: "run-admission-1",
  prompt: "hello",
  systemInstruction: "be concise",
  model: { provider: "fake", model: "fake" },
  modelTimeoutMs: 1_000,
};

test("admission store persists pending and accepted states", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-vercel-admission-"));
  try {
    const filePath = join(directory, "admissions.json");
    const store = new AdmissionStore(filePath);
    await store.load();

    const reserved = await store.reserve(input, "hash-1");
    assert.equal(reserved.kind, "pending");
    assert.equal(store.lookup(input.runId, "hash-1").kind, "pending");
    assert.equal(store.lookup(input.runId, "different-hash").kind, "conflict");

    await store.markAccepted(input.runId, "wrun_native_1");
    const accepted = store.lookup(input.runId, "hash-1");
    assert.equal(accepted.kind, "accepted");
    if (accepted.kind === "accepted") assert.equal(accepted.record.workflowRunId, "wrun_native_1");

    const reloaded = new AdmissionStore(filePath);
    await reloaded.load();
    const persisted = reloaded.lookup(input.runId, "hash-1");
    assert.equal(persisted.kind, "accepted");
    assert.match(await readFile(filePath, "utf8"), /wrun_native_1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
