import { createHash } from "node:crypto";
import type { RunEvidenceStore } from "./evidence-store.js";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const verdicts = ["pass", "fail", "blocked", "error"] as const;
const maxSummaryBytes = 256 * 1024;
const maxScannedEntries = 500;
type Verdict = typeof verdicts[number];

export interface EvalResultCase {
  readonly caseId: string;
  readonly trial: number;
  readonly verdict: Verdict;
  readonly runIds: readonly string[];
  /** A safe report marker, never the writer's local absolute path. */
  readonly evidence: "artifacts/eval.json" | "artifacts/eval-grader-3.json" | "artifacts/eval-grader-4.json" | null;
  readonly reason?: string;
  readonly reviewRequired?: boolean;
  readonly platform?: string;
  readonly task?: string;
  readonly statuses?: readonly string[];
  readonly assertions?: Readonly<Record<string, boolean>>;
}

export interface EvalResultInvocation {
  readonly invocationId: string;
  readonly mode: "live" | "scripted" | "capability-acceptance" | "unknown";
  readonly platform: string;
  readonly variant?: string;
  readonly modelId: string | null;
  readonly suiteVersion?: string;
  readonly graderVersion?: string;
  readonly sourceInvocationId?: string;
  readonly comparisonKey?: string | null;
  readonly comparisonIssue?: string;
  readonly controls?: Record<string, unknown>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status: "complete" | "incomplete";
  readonly summaryIssue?: string;
  readonly counts: Readonly<Record<Verdict, number>>;
  readonly cases: readonly EvalResultCase[];
}

/** Project retained summaries without exposing arbitrary files or raw runner configuration.
 * The directory scan and each read are bounded. Corrupt/interrupted summaries remain
 * visible as incomplete invocations rather than disappearing or becoming a pass.
 */
export async function readEvalResults(runsRoot: string, limit = 25, secrets: readonly string[] = []): Promise<{
  invocations: EvalResultInvocation[]; scanTruncated: boolean;
}> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Eval result limit must be between 1 and 50.");
  const root = resolve(runsRoot);
  const index = join(root, ".evals");
  try {
    const info = await lstat(index);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Eval summary index must be a directory, not a symlink.");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { invocations: [], scanTruncated: false };
    throw error;
  }
  const realRoot = await realpath(root), realIndex = await realpath(index);
  if (!inside(realRoot, realIndex)) throw new Error("Eval summary index escaped the runs directory.");
  const directory = await opendir(index);
  const candidates: { id: string; modified: number }[] = [];
  let scanned = 0, scanTruncated = false;
  for await (const entry of directory) {
    if (++scanned > maxScannedEntries) { scanTruncated = true; break; }
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    const path = join(index, entry.name);
    const info = await lstat(path).catch(() => null);
    if (info?.isDirectory() && !info.isSymbolicLink() && inside(realIndex, await realpath(path))) {
      candidates.push({ id: entry.name, modified: info.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.modified - a.modified || b.id.localeCompare(a.id));
  const invocations = await Promise.all(candidates.slice(0, limit).map(async candidate => {
    const fallback: EvalResultInvocation = {
      invocationId: candidate.id, mode: "unknown", platform: "Unknown", modelId: null,
      startedAt: new Date(candidate.modified).toISOString(), completedAt: null, status: "incomplete",
      summaryIssue: "Retained summary is missing, malformed, oversized, or unsafe to read.",
      counts: emptyCounts(), cases: [],
    };
    try {
      const path = join(index, candidate.id, "summary.json");
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile() || !inside(realIndex, await realpath(path))) return fallback;
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxSummaryBytes) return fallback;
        // Read at most the ceiling plus one byte even if a writer grows the file after stat.
        const buffer = Buffer.alloc(maxSummaryBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > maxSummaryBytes) return fallback;
        return projectSummary(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), candidate.id, secrets, new Date(candidate.modified).toISOString());
      } finally { await handle.close(); }
    } catch { return fallback; }
  }));
  return { invocations, scanTruncated };
}

function projectSummary(value: unknown, invocationId: string, secrets: readonly string[], fallbackStartedAt?: string): EvalResultInvocation {
  if (record(value) && value.mode === "capability-acceptance") return projectAcceptance(value, invocationId, secrets, fallbackStartedAt);
  if (!record(value) || value.schemaVersion !== 1 || value.invocationId !== invocationId ||
      !idPattern.test(String(value.platform)) || !date(value.startedAt) ||
      (value.completedAt !== null && (!date(value.completedAt) || Date.parse(String(value.completedAt)) < Date.parse(String(value.startedAt)))) ||
      !Array.isArray(value.cases) || value.cases.length > 100 || (value.completedAt !== null && value.cases.length === 0)) invalid();
  const mode = value.mode === undefined ? "scripted" : value.mode;
  if (mode !== "live" && mode !== "scripted") invalid();
  const modelId = mode === "live" && record(value.model) && text(value.model.model) ? value.model.model : null;
  if (mode === "live" && modelId === null) invalid();
  const counts = emptyCounts();
  const identities = new Set<string>();
  const cases = value.cases.map(item => {
    if (!record(item) || !idPattern.test(String(item.caseId)) ||
        !Number.isSafeInteger(item.trial) || Number(item.trial) < 1 || Number(item.trial) > 100 ||
        !verdicts.includes(item.verdict as Verdict) || !Array.isArray(item.runIds) || item.runIds.length > 16 ||
        item.runIds.some(id => typeof id !== "string" || !idPattern.test(id)) || new Set(item.runIds).size !== item.runIds.length ||
        (item.evidence !== null && !text(item.evidence, 4096)) ||
        (item.reason !== undefined && !text(item.reason, 4096)) ||
        (item.verdict === "pass" && (item.runIds.length === 0 || !item.evidence))) invalid();
    const identity = `${item.caseId}-${item.trial}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    const verdict = item.verdict as Verdict;
    counts[verdict]++;
    return { caseId: item.caseId as string, trial: item.trial as number, verdict,
      runIds: item.runIds as string[], evidence: reportMarker(item.evidence),
      ...(item.reviewRequired === true ? { reviewRequired: true } : {}),
      ...(item.reason ? { reason: safeReason(item.reason as string, secrets) } : {}) };
  });
  const incomplete = value.completedAt === null;
  return { invocationId, mode, platform: String(value.platform), ...(typeof value.variant === "string" && idPattern.test(value.variant) ? { variant: value.variant } : {}), modelId,
    ...(text(value.suiteVersion) ? { suiteVersion: value.suiteVersion } : {}),
    ...(text(value.graderVersion) ? { graderVersion: value.graderVersion } : {}),
    ...(typeof value.sourceInvocationId === "string" && idPattern.test(value.sourceInvocationId) ? { sourceInvocationId: value.sourceInvocationId } : {}),
    ...comparisonControls(value, mode, modelId, secrets),
    startedAt: value.startedAt as string, completedAt: value.completedAt as string | null,
    status: incomplete ? "incomplete" : "complete",
    ...(incomplete ? { summaryIssue: "Invocation has no retained completion. Recorded trials are partial." } : {}), counts, cases };
}

/** Preserve original acceptance verdicts; boolean workflow assertions are evidence, not a new grader. */
function projectAcceptance(value: Record<string, unknown>, invocationId: string, secrets: readonly string[], fallbackStartedAt?: string): EvalResultInvocation {
  if (value.schemaVersion !== 1 || value.invocationId !== invocationId || !record(value.controls) || !record(value.controls.model) || !text(value.controls.model.id) || !Array.isArray(value.outcomes) || value.outcomes.length > 100) invalid();
  const historical = value.startedAt === undefined;
  if ((!historical && !date(value.startedAt)) ||
      (value.completedAt !== undefined && value.completedAt !== null &&
        (!date(value.completedAt) || (!historical && Date.parse(String(value.completedAt)) < Date.parse(String(value.startedAt)))))) invalid();
  if (value.status !== undefined && !["complete", "completed", "incomplete"].includes(String(value.status))) invalid();
  const controls = value.controls;
  const allowedPlatforms = ["mastra", "langgraph", "temporal", "restate"], allowedTasks = ["support", "workspace", "service"];
  for (const [key, allowed] of [["platforms", allowedPlatforms], ["tasks", allowedTasks]] as const) {
    const selected = controls[key];
    if (selected !== undefined && (!Array.isArray(selected) || !selected.length || selected.length > allowed.length || selected.some(item => !allowed.includes(String(item))) || new Set(selected).size !== selected.length)) invalid();
  }
  const counts = emptyCounts(), identities = new Set<string>();
  const cases: EvalResultCase[] = value.outcomes.map(item => {
    if (!record(item) || !allowedPlatforms.includes(String(item.platform)) || !allowedTasks.includes(String(item.task)) ||
        !verdicts.includes(item.verdict as Verdict) || !Array.isArray(item.runIds) || item.runIds.length > 16 ||
        item.runIds.some(id => typeof id !== "string" || !idPattern.test(id)) || new Set(item.runIds).size !== item.runIds.length ||
        !Array.isArray(item.statuses) || item.statuses.length !== item.runIds.length ||
        item.statuses.some(status => !["created", "queued", "running", "suspended", "completed", "failed", "cancelled", "reconciliation_required"].includes(String(status))) ||
        !record(item.assertions) || Object.keys(item.assertions).length > 64 ||
        Object.entries(item.assertions).some(([name, passed]) => !idPattern.test(name) || typeof passed !== "boolean") ||
        (item.verdict === "pass" && item.runIds.length === 0) || (item.error !== undefined && !text(item.error, 4096))) invalid();
    if ((Array.isArray(controls.platforms) && !controls.platforms.includes(item.platform)) ||
        (Array.isArray(controls.tasks) && !controls.tasks.includes(item.task))) invalid();
    const caseId = `${item.platform}-${item.task}`;
    if (identities.has(caseId)) invalid(); identities.add(caseId);
    const verdict = item.verdict as Verdict; counts[verdict]++;
    return { caseId, trial: 1, platform: String(item.platform), task: String(item.task), verdict, runIds: item.runIds as string[], statuses: item.statuses as string[], assertions: item.assertions as Record<string, boolean>, evidence: null, ...(item.error ? { reason: safeReason(String(item.error), secrets) } : {}) };
  });
  const platforms = [...new Set(cases.map(item => item.platform!))];
  const expected = Array.isArray(value.controls.platforms) && Array.isArray(value.controls.tasks) ? value.controls.platforms.length * value.controls.tasks.length : null;
  const complete = !historical && date(value.completedAt) && value.status !== "incomplete" && cases.length > 0 && (expected === null || cases.length === expected);
  return { invocationId, mode: "capability-acceptance", platform: platforms.length === 1 ? platforms[0]! : "multiple", modelId: safeReason(value.controls.model.id, secrets), startedAt: historical ? fallbackStartedAt ?? new Date(0).toISOString() : String(value.startedAt), completedAt: date(value.completedAt) ? String(value.completedAt) : null, status: complete ? "complete" : "incomplete", counts, cases,
    comparisonKey: null, comparisonIssue: "Business workflow observations preserve platform outcomes; equivalent benchmark controls have not been established.",
    ...(complete ? {} : { summaryIssue: historical ? "Historical workflow summary has no retained timing/completion marker; recorded outcomes are preserved." : "Workflow invocation has no complete retained outcome set." }) };
}

function safeReason(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) if (secret) result = result.split(secret).join("[REDACTED]");
  return result.replace(/\bBearer\s+\S+|\bsk-or-[A-Za-z0-9_-]+/gi, "[REDACTED]");
}
function emptyCounts(): Record<Verdict, number> { return { pass: 0, fail: 0, blocked: 0, error: 0 }; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, maximum = 512): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function date(value: unknown): boolean { return text(value) && Number.isFinite(Date.parse(value)); }
function inside(root: string, path: string): boolean { const value = relative(root, path); return value !== "" && !value.startsWith("..") && !value.startsWith("/"); }
function hasCode(error: unknown, code: string): boolean { return record(error) && error.code === code; }
function invalid(): never { throw new Error("Invalid retained eval invocation summary."); }


/** Compare only explicit common controls. Transport addresses are never comparison inputs. */
function comparisonControls(value: Record<string, unknown>, mode: string, modelId: string | null, secrets: readonly string[]) {
  const source = record(value.comparisonControls) ? value.comparisonControls : null;
  if (!source || !text(value.suiteVersion) || !["modelSettings", "context", "toolConfiguration", "faultConfiguration", "profile"].every(key => source[key] !== undefined)) {
    return { comparisonKey: null, comparisonIssue: "Common comparison controls were not retained." };
  }
  const controls = Object.fromEntries(["modelSettings", "context", "toolConfiguration", "faultConfiguration", "profile"].map(key => [key, sanitizeDetail(source[key], secrets)]));
  const canonical = (item: unknown): string => Array.isArray(item) ? `[${item.map(canonical).join(",")}]` : record(item) ? `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}` : JSON.stringify(item);
  return { controls, comparisonKey: createHash("sha256").update(canonical({ suiteVersion: value.suiteVersion, graderVersion: text(value.graderVersion) ? value.graderVersion : null, mode, modelId, controls })).digest("hex") };
}

async function readInvocation(root: string, id: string, secrets: readonly string[]): Promise<{ invocation: EvalResultInvocation; summary: Record<string, unknown> }> {
  if (!idPattern.test(id)) throw new Error("Invalid eval invocation identity.");
  const directory = join(resolve(root), ".evals", id);
  for (const path of [join(resolve(root), ".evals"), directory]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe eval invocation directory.");
  }
  const path = join(directory, "summary.json");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxSummaryBytes || !inside(await realpath(root), await realpath(path))) throw new Error("Unsafe eval summary.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(maxSummaryBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maxSummaryBytes) throw new Error("Eval summary exceeds the read limit.");
    const summary: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    if (!record(summary)) invalid();
    return { invocation: projectSummary(summary, id, secrets, new Date(info.mtimeMs).toISOString()), summary };
  } finally { await handle.close(); }
}

/** Detail is anchored to a retained trial and uses the supported evidence reader only.
 * Individual artifacts are bounded and missing evidence remains explicit.
 */
export async function readEvalTrialDetail(runsRoot: string, evidence: Pick<RunEvidenceStore, "readAllowlistedFile">,
  invocationId: string, caseId: string, trial: number, secrets: readonly string[] = []) {
  if (!idPattern.test(caseId) || !Number.isSafeInteger(trial) || trial < 1 || trial > 100) throw new Error("Invalid eval trial identity.");
  const { invocation, summary } = await readInvocation(runsRoot, invocationId, secrets);
  const item = invocation.cases.find(value => value.caseId === caseId && value.trial === trial);
  if (!item) throw new Error("Retained eval trial was not found.");
  const root = await realpath(runsRoot);
  let evidenceDigest: string | null = null;
  const read = async (runId: string, file: "artifacts/eval.json" | "artifacts/eval-grader-3.json" | "artifacts/eval-grader-4.json" | "events.jsonl" | "context.json" | "trajectory.json" | "result.json") => {
    const path = join(runsRoot, runId, file);
    for (const directory of [join(runsRoot, runId), ...(file.startsWith("artifacts/") ? [join(runsRoot, runId, "artifacts")] : [])]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe evidence directory.");
    }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxSummaryBytes || !inside(root, await realpath(path))) throw new Error("Evidence is unsafe or exceeds the inline read limit.");
    const raw = await evidence.readAllowlistedFile(runId, file);
    if (Buffer.byteLength(raw) > maxSummaryBytes) throw new Error("Evidence exceeds the inline read limit.");
    if (file === item.evidence) evidenceDigest = createHash("sha256").update(raw).digest("hex");
    const value = file.endsWith(".jsonl") ? raw.split("\n").filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(raw);
    return sanitizeDetail(value, secrets);
  };
  let report: unknown = null;
  const issues: string[] = [];
  if (invocation.mode === "capability-acceptance") {
    const outcome = (summary.outcomes as Record<string, unknown>[]).find(value => `${value.platform}-${value.task}` === caseId)!;
    report = { verdict: item.verdict, assertions: Object.entries(item.assertions ?? {}).map(([id, passed]) => ({ id, passed, expected: true, observed: passed })),
      observations: [sanitizeDetail({ platform: item.platform, task: item.task, statuses: item.statuses, prompts: outcome.prompts, toolEvidence: outcome.toolEvidence, serviceSnapshots: outcome.serviceSnapshots, reviews: outcome.reviews, artifact: outcome.artifact }, secrets)] };
  }
  if (item.evidence && item.runIds[0]) {
    try {
      report = await read(item.runIds[0], item.evidence);
      if (!record(report) || report.ownerRunId !== item.runIds[0] || report.caseId !== caseId ||
          !Array.isArray(report.runIds) || report.runIds.some(id => !item.runIds.includes(String(id))) ||
          invocation.graderVersion !== undefined && report.graderVersion !== invocation.graderVersion) {
        report = null; issues.push("Retained report does not match this trial's run identities.");
      }
    } catch { issues.push("Verdict report is missing, incomplete, oversized, or unsafe to read."); }
  }
  const runs = await Promise.all(item.runIds.map(async runId => {
    const artifacts: Record<string, unknown> = {}, issues: string[] = [];
    for (const file of ["events.jsonl", "context.json", "trajectory.json", "result.json"] as const) {
      try { artifacts[file] = await read(runId, file); }
      catch { issues.push(`${file} is missing, incomplete, oversized, or unsafe to read.`); }
    }
    return { runId, artifacts, issues };
  }));
  return { invocation, case: item, report, evidenceDigest: report ? evidenceDigest : null, runs, issues };
}

function sanitizeDetail(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > 32) return "[Depth limit]";
  if (typeof value === "string") return safeReason(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitizeDetail(item, secrets, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /api.?key|authorization|password|secret|access.?token|credential/i.test(key) ? "[REDACTED]" : sanitizeDetail(item, secrets, depth + 1)]));
  return value;
}


/** Historical writers saved absolute report paths. Project only supported filenames,
 * never accept a caller-selected directory or an arbitrary grader revision.
 */
function reportMarker(value: unknown): EvalResultCase["evidence"] {
  if (!value) return null;
  if (typeof value !== "string") invalid();
  if (value === "artifacts/eval-grader-4.json" || value.endsWith("/artifacts/eval-grader-4.json")) return "artifacts/eval-grader-4.json";
  if (value === "artifacts/eval-grader-3.json" || value.endsWith("/artifacts/eval-grader-3.json")) return "artifacts/eval-grader-3.json";
  if (value === "eval.json" || value === "artifacts/eval.json" || value.endsWith("/eval.json")) return "artifacts/eval.json";
  return invalid();
}
