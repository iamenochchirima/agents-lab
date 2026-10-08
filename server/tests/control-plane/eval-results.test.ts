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

test("eight retained business workflows preserve platform verdicts/assertions and reject malformed acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-business-"));
  try {
    const outcomes = ["mastra", "langgraph", "temporal", "restate"].flatMap(platform => ["support", "workspace"].map(task => ({ platform, task, runIds: [`run-${platform}-${task}`], statuses: [platform === "mastra" ? "failed" : "completed"], assertions: { independentlySaved: platform !== "mastra", routingValid: true }, verdict: platform === "mastra" ? "error" : "pass", ...(platform === "mastra" ? { error: "Bearer fixture-secret timed out" } : {}), toolEvidence: [], serviceSnapshots: [{ adjustmentCents: 500 }], artifact: null })));
    const acceptance = { schemaVersion: 1, mode: "capability-acceptance", invocationId: "business-eight", startedAt: "2026-10-08T01:00:00Z", completedAt: "2026-10-08T01:10:00Z", status: "completed", controls: { platforms: ["mastra", "langgraph", "temporal", "restate"], tasks: ["support", "workspace"], model: { id: "fixture-model:free" } }, outcomes };
    await save(root, "business-eight", acceptance);
    await save(root, "business-malformed", { ...acceptance, invocationId: "business-malformed", outcomes: [{ ...outcomes[0], assertions: { routingValid: "true" } }] });
    const projected = (await readEvalResults(root)).invocations;
    const saved = projected.find(value => value.invocationId === "business-eight")!;
    assert.equal(saved.mode, "capability-acceptance"); assert.equal(saved.platform, "multiple"); assert.equal(saved.modelId, "fixture-model:free"); assert.equal(saved.status, "complete");
    assert.deepEqual(saved.counts, { pass: 6, fail: 0, blocked: 0, error: 2 }); assert.equal(saved.cases.length, 8);
    assert.equal(saved.cases[0].platform, "mastra"); assert.equal(saved.cases[0].verdict, "error"); assert.equal(saved.cases[0].assertions?.independentlySaved, false);
    assert.equal(saved.comparisonKey, null); assert.doesNotMatch(JSON.stringify(saved), /fixture-secret/);
    assert.equal(projected.find(value => value.invocationId === "business-malformed")?.mode, "unknown");
    const runId = "run-mastra-support";
    await mkdir(join(root, runId), { recursive: true });
    const artifacts = { "events.jsonl": "", "context.json": "{}", "trajectory.json": "{}", "result.json": JSON.stringify({ status: "failed" }) };
    for (const [file, raw] of Object.entries(artifacts)) await writeFile(join(root, runId, file), raw);
    const detail = await readEvalTrialDetail(root, { readAllowlistedFile: async (_id, file) => artifacts[file as keyof typeof artifacts] }, "business-eight", "mastra-support", 1);
    assert.equal((detail.report as { verdict: string }).verdict, "error");
    assert.deepEqual((detail.report as { assertions: unknown[] }).assertions[0], { id: "independentlySaved", passed: false, expected: true, observed: false });
    assert.equal(detail.runs[0].runId, runId); assert.equal(detail.issues.length, 0);
    await save(root, "business-historical", { ...acceptance, invocationId: "business-historical", startedAt: undefined, completedAt: undefined, status: undefined });
    const historical = (await readEvalResults(root)).invocations.find(value => value.invocationId === "business-historical")!;
    assert.equal(historical.status, "incomplete"); assert.equal(historical.cases.length, 8); assert.match(historical.summaryIssue!, /no retained timing/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
