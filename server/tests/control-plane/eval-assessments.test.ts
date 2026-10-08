import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvalAssessmentStore, assessmentContext } from "../../src/control-plane/application/eval-assessments.js";
import type { readEvalTrialDetail } from "../../src/control-plane/application/eval-results.js";

type Detail = Awaited<ReturnType<typeof readEvalTrialDetail>>;
const detail = { invocation: { invocationId: "synthetic-invocation" }, case: { caseId: "L05", trial: 1, verdict: "blocked", reviewRequired: true },
  report: { suiteVersion: "synthetic-suite", graderVersion: "synthetic-grader", verdict: "blocked", reviewRequired: true, assertions: [{ id: "objective", passed: true }], observations: [{ fixture: { reviewRubric: "Synthetic test rubric: answer asks for clarification." } }] }, evidenceDigest: "a".repeat(64) } as unknown as Detail;
const input = { assessmentId: "synthetic-assessment", evidenceDigest: detail.evidenceDigest!, rubricVersion: assessmentContext(detail).rubricVersion!, reviewerLabel: "Synthetic unit-test reviewer", rationale: "Synthetic fixture only.", answers: [{ questionId: "semantic-rubric", outcome: "pass" as const, rationale: "Synthetic passing answer." }] };

test("atomic assessment publication replays, persists revisions after restart, and keeps original verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-assessments-"));
  try {
    const store = new EvalAssessmentStore(root);
    const [first, replay] = await Promise.all([store.submit(detail, input), store.submit(detail, input)]);
    assert.deepEqual(first, replay);
    assert.equal(first.reviewerIdentity, "local-unverified-label");
    await assert.rejects(store.submit(detail, { ...input, rationale: "Different content." }), /already used/);
    await assert.rejects(store.submit(detail, { ...input, assessmentId: "synthetic-revision" }), /explicitly supersede/);
    const revision = await store.submit(detail, { ...input, assessmentId: "synthetic-revision", supersedesAssessmentId: input.assessmentId, answers: [{ ...input.answers[0], outcome: "uncertain" }] });
    const restored = await new EvalAssessmentStore(root).list(detail);
    assert.deepEqual(restored, [first, revision]);
    assert.equal(detail.case.verdict, "blocked");
    assert.equal(restored.at(-1)?.outcome, "uncertain");
    assert.equal(JSON.parse(await readFile(join(root, ".eval-assessments", "synthetic-assessment.json"), "utf8")).outcome, "pass");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("objective failures, stale evidence, invalid answers and corrupt publication reject", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-assessments-"));
  try {
    const store = new EvalAssessmentStore(root);
    const failed = { ...detail, report: { ...detail.report as Record<string, unknown>, assertions: [{ id: "objective", passed: false }] } };
    assert.equal(assessmentContext(failed).eligible, false);
    await assert.rejects(store.submit(failed, input), /not eligible/);
    await assert.rejects(store.submit(detail, { ...input, evidenceDigest: "b".repeat(64) }), /changed/);
    await assert.rejects(store.submit(detail, { ...input, answers: [] }), /Invalid assessment/);
    await store.submit(detail, input);
    await writeFile(join(root, ".eval-assessments", "synthetic-assessment.json"), "{broken");
    await assert.rejects(new EvalAssessmentStore(root).list(detail));
  } finally { await rm(root, { recursive: true, force: true }); }
});
