import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, link, unlink, opendir } from "node:fs/promises";
import { join } from "node:path";
import type { readEvalTrialDetail } from "./eval-results.js";

type Detail = Awaited<ReturnType<typeof readEvalTrialDetail>>;
type Outcome = "pass" | "fail" | "uncertain";
export interface AssessmentInput {
  assessmentId: string; evidenceDigest: string; rubricVersion: string; reviewerLabel: string; rationale: string;
  answers: { questionId: string; outcome: Outcome; rationale: string }[];
  supersedesAssessmentId?: string;
}
export interface EvalAssessment extends AssessmentInput {
  schemaVersion: 1; invocationId: string; caseId: string; trial: number; graderVersion: string;
  createdAt: string; outcome: Outcome; reviewerIdentity: "local-unverified-label";
}
export class EvalAssessmentError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const digest = /^[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : object(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);

/** Rubrics come from retained fixtures. Objective assertions must already pass. */
export function assessmentContext(detail: Detail) {
  const report = object(detail.report) ? detail.report : null;
  const fixture = report && Array.isArray(report.observations) ? report.observations.map(v => object(v) && object(v.fixture) ? v.fixture : null).find(v => v && text(v.reviewRubric, 8192)) : null;
  const rubric = fixture?.reviewRubric as string | undefined;
  const eligible = detail.case.reviewRequired === true && detail.case.verdict === "blocked" && report?.reviewRequired === true && report.verdict === "blocked" &&
    Array.isArray(report.assertions) && report.assertions.length > 0 && report.assertions.every(a => object(a) && a.passed === true) &&
    !!detail.evidenceDigest && !!rubric && text(report.graderVersion, 256);
  const rubricVersion = rubric && report ? createHash("sha256").update(canonical({ suite: report.suiteVersion, grader: report.graderVersion, rubric })).digest("hex") : null;
  return { eligible, evidenceDigest: detail.evidenceDigest, rubricVersion, rubric: rubric ?? null,
    questions: rubric ? [{ id: "semantic-rubric", prompt: rubric }] : [],
    ...(eligible ? {} : { reason: "Assessment requires a matching retained review-required report, rubric, and passing objective assertions." }) };
}

function validate(v: unknown): asserts v is AssessmentInput {
  const allowed = ["assessmentId", "evidenceDigest", "rubricVersion", "reviewerLabel", "rationale", "answers", "supersedesAssessmentId"];
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k)) || !(typeof v.assessmentId === "string" && id.test(v.assessmentId)) || !(typeof v.evidenceDigest === "string" && digest.test(v.evidenceDigest)) || !(typeof v.rubricVersion === "string" && digest.test(v.rubricVersion)) ||
      !text(v.reviewerLabel, 128) || !text(v.rationale, 4096) || !Array.isArray(v.answers) || v.answers.length !== 1 ||
      v.answers.some(a => !object(a) || Object.keys(a).some(k => !["questionId", "outcome", "rationale"].includes(k)) || a.questionId !== "semantic-rubric" || !["pass", "fail", "uncertain"].includes(String(a.outcome)) || !text(a.rationale, 4096)) ||
      (v.supersedesAssessmentId !== undefined && (!(typeof v.supersedesAssessmentId === "string" && id.test(v.supersedesAssessmentId)) || v.supersedesAssessmentId === v.assessmentId))) {
    throw new EvalAssessmentError(400, "INVALID_ASSESSMENT", "Invalid assessment identity, rubric answers, or reviewer attribution.");
  }
}
async function directory(root: string): Promise<string> {
  const path = join(root, ".eval-assessments");
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new EvalAssessmentError(503, "ASSESSMENT_STORE_UNAVAILABLE", "Assessment directory must be a real directory.");
  return path;
}

/** One designated control-plane writer serializes lineage changes. Publication is atomic,
 * synced before acknowledgement; retrying an identity performs no agent work. */
export class EvalAssessmentStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly runsRoot: string) {}
  async list(detail: Detail): Promise<EvalAssessment[]> {
    const path = await directory(this.runsRoot), entries = await opendir(path), result: EvalAssessment[] = [];
    let count = 0;
    for await (const entry of entries) {
      if (++count > 2000) throw new EvalAssessmentError(503, "ASSESSMENT_STORE_UNAVAILABLE", "Assessment scan limit exceeded.");
      if (!entry.name.endsWith(".json")) continue;
      if (!entry.isFile() || !id.test(entry.name.slice(0, -5))) throw new EvalAssessmentError(503, "ASSESSMENT_STORE_UNAVAILABLE", "Unsafe assessment record.");
      const handle = await open(join(path, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat(); if (!stat.isFile() || stat.size > 16384) throw new Error("Invalid assessment size.");
        const buffer = Buffer.alloc(16385), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 16384) throw new Error("Invalid assessment size.");
        const value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
        const { schemaVersion, invocationId, caseId, trial, graderVersion, createdAt, outcome, reviewerIdentity, ...input } = value;
        validate(input);
        if (schemaVersion !== 1 || !id.test(invocationId) || !id.test(caseId) || !Number.isInteger(trial) || trial < 1 || trial > 100 || !text(graderVersion, 256) || !text(createdAt, 64) || !Number.isFinite(Date.parse(createdAt)) || reviewerIdentity !== "local-unverified-label" || outcome !== input.answers[0].outcome || value.assessmentId !== entry.name.slice(0, -5)) throw new Error("Invalid retained assessment.");
        if (invocationId === detail.invocation.invocationId && caseId === detail.case.caseId && trial === detail.case.trial) result.push(value);
      } finally { await handle.close(); }
    }
    // Reconstruct an unambiguous chain; corruption never becomes a completed assessment.
    const sorted: EvalAssessment[] = []; let parent: string | undefined;
    while (sorted.length < result.length) {
      const next = result.filter(v => v.supersedesAssessmentId === parent);
      if (next.length !== 1) throw new EvalAssessmentError(503, "ASSESSMENT_STORE_UNAVAILABLE", "Assessment lineage is incomplete or branched.");
      sorted.push(next[0]!); parent = next[0]!.assessmentId;
    }
    return sorted;
  }
  submit(detail: Detail, value: unknown): Promise<EvalAssessment> {
    const pending = this.tail.then(() => this.write(detail, value)); this.tail = pending.catch(() => undefined); return pending;
  }
  private async write(detail: Detail, value: unknown): Promise<EvalAssessment> {
    validate(value);
    const context = assessmentContext(detail);
    if (!context.eligible || value.evidenceDigest !== context.evidenceDigest || value.rubricVersion !== context.rubricVersion) throw new EvalAssessmentError(409, "ASSESSMENT_EVIDENCE_CONFLICT", "The retained report is not eligible or its evidence/rubric changed.");
    const records = await this.list(detail), existing = records.find(r => r.assessmentId === value.assessmentId);
    if (existing) {
      const { schemaVersion, invocationId, caseId, trial, graderVersion, createdAt, outcome, reviewerIdentity, ...original } = existing;
      if (canonical(original) === canonical(value)) return existing;
      throw new EvalAssessmentError(409, "ASSESSMENT_ID_CONFLICT", "Assessment identity was already used with different content.");
    }
    if (records.at(-1)?.assessmentId !== value.supersedesAssessmentId) throw new EvalAssessmentError(409, "ASSESSMENT_LINEAGE_CONFLICT", "A revision must explicitly supersede the latest assessment.");
    const record: EvalAssessment = { ...value, schemaVersion: 1, invocationId: detail.invocation.invocationId, caseId: detail.case.caseId, trial: detail.case.trial,
      graderVersion: String((detail.report as Record<string, unknown>).graderVersion), createdAt: new Date().toISOString(), outcome: value.answers[0]!.outcome, reviewerIdentity: "local-unverified-label" };
    const path = await directory(this.runsRoot), temporary = join(path, `.pending-${randomUUID()}`), target = join(path, `${value.assessmentId}.json`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    try {
      // Hard-link publication refuses global identity collisions, including other trials.
      await link(temporary, target);
      const dir = await open(path, constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); }
    } catch (error) {
      if (object(error) && error.code === "EEXIST") throw new EvalAssessmentError(409, "ASSESSMENT_ID_CONFLICT", "Assessment identity already exists.");
      throw error;
    } finally { await unlink(temporary).catch(() => undefined); }
    return record;
  }
}
