import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readEvalResults, readEvalTrialDetail } from "../../src/control-plane/application/eval-results.js";

const summary = { schemaVersion: 1, invocationId: "scripted-one", platform: "mastra",
  startedAt: "2026-10-07T00:00:00Z", completedAt: "2026-10-07T00:00:10Z",
  profile: { apiKey: "private-test-key" }, counts: { pass: 99, fail: 0, blocked: 0, error: 0 },
  cases: [{ caseId: "B01", trial: 1, verdict: "pass", runIds: ["run-one"], evidence: "/private/local/run-one/eval.json" }] };

async function save(root: string, id: string, value: unknown) {
  const directory = join(root, ".evals", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "summary.json"), typeof value === "string" ? value : JSON.stringify(value));
}

test("saved summaries project historical/live trials, redact fields, and retain interrupted outcomes", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-results-"));
  try {
    assert.deepEqual(await readEvalResults(root), { invocations: [], scanTruncated: false });
    await save(root, "scripted-one", summary);
    await save(root, "live-two", { ...summary, invocationId: "live-two", mode: "live", model: { model: "google/gemma-4-31b-it:free", apiKey: "private-test-key" },
      completedAt: null, cases: [{ caseId: "L02", trial: 1, verdict: "blocked", runIds: [], evidence: null, reason: "key private-test-key, Bearer fake-secret-token" }] });
    const result = await readEvalResults(root, 25, ["private-test-key"]);
    const historical = result.invocations.find(item => item.invocationId === "scripted-one")!;
    assert.equal(historical.mode, "scripted");
    assert.equal(historical.counts.pass, 1, "derive counts from actual cases, not stored aggregate");
    assert.equal(historical.cases[0].evidence, "artifacts/eval.json");
    const live = result.invocations.find(item => item.invocationId === "live-two")!;
    assert.equal(live.mode, "live");
    assert.equal(live.modelId, "google/gemma-4-31b-it:free");
    assert.equal(live.status, "incomplete");
    assert.equal(live.counts.blocked, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-test-key|fake-secret-token|private\/local|profile/);
    assert.equal((await readEvalResults(root, 1)).invocations.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed, oversized, and linked summaries cannot masquerade as passes or read outside the index", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-results-"));
  const outside = await mkdtemp(join(tmpdir(), "eval-results-outside-"));
  try {
    await save(root, "malformed", "{broken");
    await save(root, "oversized", " ".repeat(256 * 1024 + 1));
    await save(root, "traversal", { ...summary, invocationId: "traversal", cases: [{ ...summary.cases[0], runIds: ["../outside"] }] });
    await mkdir(join(root, ".evals", "linked-file"));
    await writeFile(join(outside, "summary.json"), JSON.stringify({ ...summary, invocationId: "linked-file" }));
    await symlink(join(outside, "summary.json"), join(root, ".evals", "linked-file", "summary.json"));
    await symlink(outside, join(root, ".evals", "linked-directory"));
    const result = await readEvalResults(root);
    assert.equal(result.invocations.length, 4);
    assert.ok(result.invocations.every(item => item.status === "incomplete" && item.cases.length === 0 && item.counts.pass === 0));
    await assert.rejects(() => readEvalResults(root, 0), /between 1 and 50/);
    await assert.rejects(() => readEvalResults(root, 51), /between 1 and 50/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});


test("trial detail is anchored to summary runs, bounds artifacts and retains matching comparison controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-detail-"));
  const controls = { modelSettings: { temperature: 0 }, context: { tokens: 4096 }, toolConfiguration: ["calculator"], faultConfiguration: {}, profile: "baseline" };
  try {
    await save(root, "scripted-one", { ...summary, suiteVersion: "core-v2", comparisonControls: controls });
    await mkdir(join(root, "run-one", "artifacts"), { recursive: true });
    const artifacts: Record<string, string> = { "artifacts/eval.json": JSON.stringify({ ownerRunId: "run-one", caseId: "B01", runIds: ["run-one"], assertions: [], observations: [{ secret: "sentinel", text: "Bearer secret-token" }] }), "events.jsonl": JSON.stringify({ kind: "ToolRejected", payload: { callId: "call-one" } }) + "\n", "context.json": "{}", "trajectory.json": "{}", "result.json": JSON.stringify({ status: "cancelled" }) };
    for (const [file, raw] of Object.entries(artifacts)) await writeFile(join(root, "run-one", file), raw);
    const evidence = { readAllowlistedFile: async (id: string, file: string) => { assert.equal(id, "run-one"); return artifacts[file]; } };
    const detail = await readEvalTrialDetail(root, evidence, "scripted-one", "B01", 1);
    assert.equal(detail.runs.length, 1);
    assert.equal(detail.issues.length, 0);
    assert.match(detail.invocation.comparisonKey!, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(detail), /sentinel|secret-token/);
    await assert.rejects(() => readEvalTrialDetail(root, evidence, "scripted-one", "B02", 1), /not found/);
    await assert.rejects(() => readEvalTrialDetail(root, evidence, "..", "B01", 1), /identity/);
    await rm(join(root, "run-one", "context.json"));
    await symlink(join(root, "run-one", "result.json"), join(root, "run-one", "context.json"));
    const unsafe = await readEvalTrialDetail(root, evidence, "scripted-one", "B01", 1);
    assert.equal(unsafe.runs[0].artifacts["context.json"], undefined);
    assert.match(unsafe.runs[0].issues.join(" "), /unsafe/);
    await save(root, "regraded-trial", { ...summary, invocationId: "regraded-trial", sourceInvocationId: "scripted-one", graderVersion: "3", cases: [{ ...summary.cases[0], evidence: "/private/local/run-one/artifacts/eval-grader-3.json" }] });
    artifacts["artifacts/eval-grader-3.json"] = JSON.stringify({ ownerRunId: "run-one", caseId: "B01", runIds: ["run-one"], graderVersion: "3", assertions: [{ id: "revised", passed: true }], observations: [] });
    await writeFile(join(root, "run-one", "artifacts/eval-grader-3.json"), artifacts["artifacts/eval-grader-3.json"]);
    const original = artifacts["artifacts/eval.json"];
    const revised = await readEvalTrialDetail(root, evidence, "regraded-trial", "B01", 1);
    assert.equal(revised.case.evidence, "artifacts/eval-grader-3.json");
    assert.equal(revised.invocation.sourceInvocationId, "scripted-one");
    assert.equal((revised.report as { graderVersion: string }).graderVersion, "3");
    assert.equal(artifacts["artifacts/eval.json"], original, "regrading does not overwrite the original report");
    await save(root, "different-platform", { ...summary, invocationId: "different-platform", platform: "temporal", suiteVersion: "core-v2", comparisonControls: controls });
    const list = await readEvalResults(root);
    assert.equal(list.invocations.find(item => item.invocationId === "scripted-one")?.comparisonKey, list.invocations.find(item => item.invocationId === "different-platform")?.comparisonKey);
  } finally { await rm(root, { recursive: true, force: true }); }
});
