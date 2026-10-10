import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextSessionStore } from "../../../src/capabilities/context/index.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";
import type { PlatformExecutionReference } from "../../../src/control-plane/domain/types.js";

async function interrupted(root: string, runId: string) {
  const runner = new MastraBaselineRunner({ contextRoot: root });
  const manifest = { ...buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Add 17 and 25" },
    model: { provider: "fake", model: "fake-tool-call" } }, { runId, platformConfig: runner.manifestConfiguration() }),
    execution: { schemaVersion: 1 as const, mode: "sustained" as const, deadlineAt: new Date(Date.now() + 60_000).toISOString(), modelTimeoutMs: 30_000 } };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const child = spawn(process.execPath, ["--import", "tsx", new URL("./fixtures/sustained-worker.ts", import.meta.url).pathname, root], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Worker did not reach interruption point: ${errors}`)); }, 15_000);
    child.stdout.on("data", chunk => { if (String(chunk).includes("SECOND_MODEL_REQUEST")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Worker exited ${code}: ${errors}`)); });
  });
  child.kill("SIGKILL"); await once(child, "exit");
  const saved = JSON.parse(await readFile(join(root, ".mastra-baseline", runId, "state.json"), "utf8"));
  assert.equal(saved.status, "running");
  return saved.reference as PlatformExecutionReference;
}
async function result(runner: MastraBaselineRunner, reference: PlatformExecutionReference) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const inspected = await runner.inspect(reference);
    if (inspected.result) return inspected;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Sustained run did not resolve");
}

test("sustained native recovery retains a completed tool result after actual worker death", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-sustained-"));
  try {
    const reference = await interrupted(root, "native-recovery");
    let recoveredRequests = 0;
    const replacement = new MastraBaselineRunner({ contextRoot: root, modelFactory: () => createDeterministicFakeModel({ modelId: "fake-tool-call", toolCall: true, onRequest: () => recoveredRequests++ }) });
    const completed = await result(replacement, reference);
    assert.equal(completed.result?.status, "completed", JSON.stringify({ root, completed })); assert.match(completed.result?.output ?? "", /42/);
    assert.equal(recoveredRequests, 1);
    assert.equal(await readFile(join(root, "effects.jsonl"), "utf8"), "calculator\n");
    assert.equal(completed.reference.native?.processScoped, false);
    await replacement.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replacement refuses native recovery with an unresolved external dispatch journal", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-unsafe-recovery-"));
  try {
    const reference = await interrupted(root, "unsafe-recovery");
    const path = join(root, ".mastra-baseline", "unsafe-recovery", "state.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    // Inject the exact persisted boundary left when a host call loses its worker.
    saved.pendingDispatches = ["external-write-1"];
    await writeFile(path, JSON.stringify(saved));
    let recoveredRequests = 0;
    const replacement = new MastraBaselineRunner({ contextRoot: root, modelFactory: () => createDeterministicFakeModel({ modelId: "fake-success", onRequest: () => recoveredRequests++ }) });
    const refused = await result(replacement, reference);
    assert.equal(refused.result?.status, "reconciliation_required"); assert.equal(refused.result?.error?.code, "MASTRA_RECOVERY_UNSAFE");
    assert.equal(recoveredRequests, 0); assert.ok(refused.eventIntents.some(event => event.kind === "RecoveryRefused"));
    await replacement.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sustained model timeout stops a dispatched native request without retry", { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-model-timeout-"));
  const requests: unknown[] = [];
  const runner = new MastraBaselineRunner({ contextRoot: root, modelFactory: () => createDeterministicFakeModel({ modelId: "fake-slow", delayMs: 1_500, onRequest: prompt => requests.push(prompt) }) });
  try {
    const manifest = { ...buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Wait for the result" }, model: { provider: "fake", model: "fake-slow" } }, { runId: "model-timeout", platformConfig: runner.manifestConfiguration() }),
      execution: { schemaVersion: 1 as const, mode: "sustained" as const, deadlineAt: new Date(Date.now() + 10_000).toISOString(), modelTimeoutMs: 1_000 } };
    const reference = await runner.start(manifest);
    const inspected = await result(runner, reference);
    assert.equal(inspected.result?.error?.failureKind, "outcome_unknown"); assert.equal(requests.length, 1);
    await runner.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("summary dispatch and reported usage contribute to total model metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-summary-metrics-"));
  const store = new ContextSessionStore(root);
  await store.create({ sessionId: "summary-metrics", platform: "mastra", variant: "baseline", model: "openrouter/test-model",
    systemInstruction: "Answer", contextWindowTokens: 3_000, reservedOutputTokens: 100, safetyMarginTokens: 100,
    compactionThresholdPercent: 40, recentMessageGroups: 0 });
  const old = await store.admitTurn("summary-metrics", "old", "old question ".repeat(800));
  await store.settleTurn("summary-metrics", old.turn.turnId, { status: "completed", output: "old answer ".repeat(800) });
  const current = await store.admitTurn("summary-metrics", "summary-run", "Current request");
  let requests = 0;
  const runner = new MastraBaselineRunner({ contextRoot: root, environment: { OPENROUTER_API_KEY: "fake-key" },
    modelFactory: () => createDeterministicFakeModel({ modelId: "test-model", responseText: "A concise answer.", onRequest: () => requests++ }) });
  try {
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Current request" },
      model: { provider: "openrouter", model: "test-model", contextWindowTokens: 3_000 } },
      { runId: "summary-run", platformConfig: runner.manifestConfiguration() });
    const manifest = { ...base, context: { ...base.context, sessionId: "summary-metrics", turnId: current.turn.turnId },
      execution: { schemaVersion: 1 as const, mode: "sustained" as const, deadlineAt: new Date(Date.now() + 30_000).toISOString(), modelTimeoutMs: 10_000 } };
    const inspected = await result(runner, await runner.start(manifest));
    assert.equal(inspected.result?.status, "completed");
    assert.equal(requests, 2); assert.equal(inspected.metrics?.modelCallCount, 2);
    const summary = inspected.eventIntents.find(event => event.kind === "SummaryModelCompleted");
    assert.equal(summary?.payload.purpose, "summary");
    assert.equal(inspected.metrics?.totalTokens, 2 * 7);
    await runner.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("native streaming provider rejection retains HTTP classification and safe diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-native-provider-failure-"));
  const error = Object.assign(new Error("Controlled provider rejection: Bearer pretend-secret"), { name: "AI_APICallError", statusCode: 429 });
  const runner = new MastraBaselineRunner({ contextRoot: root, modelFactory: () => Object.assign(createDeterministicFakeModel({ modelId: "fake-success" }), { doStream: async () => { throw error; } }) });
  try {
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Answer" },
      model: { provider: "fake", model: "fake-success" } }, { runId: "native-provider-rejection", platformConfig: runner.manifestConfiguration() });
    const inspected = await result(runner, await runner.start({ ...base,
      execution: { schemaVersion: 1, mode: "sustained", deadlineAt: new Date(Date.now() + 30_000).toISOString(), modelTimeoutMs: 10_000 } }));
    assert.equal(inspected.result?.error?.code, "OPENROUTER_HTTP_429");
    assert.equal(inspected.result?.error?.failureKind, "provider");
    const diagnostic = inspected.eventIntents.find(event => event.kind === "ModelTransportFailed");
    assert.equal(diagnostic?.payload.providerStatus, 429);
    assert.match(String(diagnostic?.payload.message), /redacted/);
    assert.doesNotMatch(JSON.stringify(diagnostic), /pretend-secret/);
    assert.equal(inspected.metrics?.modelCallCount, 1);
    await runner.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("default OpenRouter native durable route classifies a mocked provider rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-router-error-"));
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fake-router-key";
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ error: { message: "Controlled quota rejection", code: 429 } }), { status: 429, headers: { "content-type": "application/json" } }); };
  const runner = new MastraBaselineRunner({ contextRoot: root, environment: { OPENROUTER_API_KEY: "fake-router-key" } });
  try {
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Answer" },
      model: { provider: "openrouter", model: "cohere/north-mini-code:free" } }, { runId: "default-router-rejection", platformConfig: runner.manifestConfiguration() });
    const inspected = await result(runner, await runner.start({ ...base,
      execution: { schemaVersion: 1, mode: "sustained", deadlineAt: new Date(Date.now() + 30_000).toISOString(), modelTimeoutMs: 10_000 } }));
    assert.equal(requests, 1);
    assert.equal(inspected.result?.error?.code, "OPENROUTER_HTTP_429", JSON.stringify(inspected.eventIntents));
    await runner.close();
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey; await rm(root, { recursive: true, force: true }); }
});
