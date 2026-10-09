export type EvalVerdict = "pass" | "fail" | "blocked" | "error";
export type EvalMode = "live" | "scripted" | "capability-acceptance" | "unknown";

export interface SavedEvalCase {
  readonly caseId: string;
  readonly trial: number;
  readonly verdict: EvalVerdict;
  readonly reason?: string;
  readonly reviewRequired?: boolean;
  readonly platform?: string;
  readonly task?: string;
  readonly statuses?: readonly string[];
  readonly assertions?: Readonly<Record<string, boolean>>;
  readonly runIds: readonly string[];
  readonly evidence: string | null;
}

/** A retained invocation summary. A blocked case may have no admitted run. */
export interface SavedEvalInvocation {
  readonly invocationId: string;
  readonly mode: EvalMode;
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
  readonly status?: "complete" | "incomplete";
  readonly summaryIssue?: string;
  readonly counts: Readonly<Record<EvalVerdict, number>>;
  readonly cases: readonly SavedEvalCase[];
}

const baseUrl = import.meta.env?.DEV
  ? ""
  : (import.meta.env?.VITE_AGENTLAB_API_URL || "").replace(/\/$/, "");

/** Read bounded saved summaries; this endpoint never dispatches an evaluation. */
export async function getSavedEvals(signal: AbortSignal): Promise<{ invocations: readonly SavedEvalInvocation[]; scanTruncated?: boolean }> {
  const response = await fetch(`${baseUrl}/api/evals?limit=25`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Saved evals could not be read. Server returned ${response.status}.`);
  return await response.json() as { invocations: SavedEvalInvocation[]; scanTruncated?: boolean };
}

export function evalEvidenceUrl(runId: string, file: "artifacts/eval.json" | "artifacts/eval-grader-3.json" | "artifacts/eval-grader-4.json" | "trajectory.json" | "context.json" | "events.jsonl"): string {
  return `${baseUrl}/api/runs/${encodeURIComponent(runId)}/evidence/${file}`;
}


export interface EvalTrialDetail {
  invocation: SavedEvalInvocation;
  case: SavedEvalCase;
  report: { assertions?: readonly { id: string; passed: boolean; expected: unknown; observed: unknown; observationRefs?: unknown }[]; observations?: readonly unknown[]; reviewRequired?: boolean } | null;
  runs: readonly { runId: string; artifacts: Record<string, unknown>; issues: readonly string[] }[];
  issues: readonly string[];
  evidenceDigest?: string | null;
  assessmentContext?: { eligible: boolean; evidenceDigest: string | null; rubricVersion: string | null; rubric: string | null; questions: readonly { id: string; prompt: string }[]; reason?: string };
  assessments?: readonly EvalAssessmentRecord[];
  assessedOutcome?: { assessmentId: string; outcome: "pass" | "fail" | "uncertain"; reviewRequired: boolean; source: "human-assessment" } | null;
}

export async function getEvalTrialDetail(invocationId: string, caseId: string, trial: number, signal: AbortSignal): Promise<EvalTrialDetail> {
  const response = await fetch(`${baseUrl}/api/evals/${encodeURIComponent(invocationId)}/cases/${encodeURIComponent(caseId)}/trials/${trial}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Trial details are unavailable. Server returned ${response.status}.`);
  return await response.json() as EvalTrialDetail;
}

export interface EvalAssessmentInput {
  assessmentId: string;
  evidenceDigest: string;
  rubricVersion: string;
  reviewerLabel: string;
  rationale: string;
  answers: readonly { questionId: string; outcome: "pass" | "fail" | "uncertain"; rationale: string }[];
  supersedesAssessmentId?: string;
}
export interface EvalAssessmentRecord extends EvalAssessmentInput {
  schemaVersion: 1;
  invocationId: string;
  caseId: string;
  trial: number;
  graderVersion: string;
  createdAt: string;
  outcome: "pass" | "fail" | "uncertain";
  reviewerIdentity: "local-unverified-label";
}

/** A retry retains the same assessment ID; no model or tool is dispatched. */
export async function submitEvalAssessment(invocationId: string, caseId: string, trial: number, input: EvalAssessmentInput): Promise<EvalAssessmentRecord> {
  const response = await fetch(`${baseUrl}/api/evals/${encodeURIComponent(invocationId)}/cases/${encodeURIComponent(caseId)}/trials/${trial}/assessments`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json() as { assessment?: EvalAssessmentRecord; error?: { message?: string } };
  if (!response.ok || !body.assessment) throw new Error(body.error?.message ?? `Assessment could not be saved (${response.status}).`);
  return body.assessment;
}

export interface EvalCoverageView {
  schemaVersion: 1;
  coverageVersion: string;
  issues?: readonly string[];
  scanTruncated: boolean;
  observedAt: string;
  cells: readonly {
    platform: string; variant: string; requirementId: string; group: string;
    implementation: string; measurement: string; boundary: string;
    extensionEvidence?: { invocationId: string; completedAt: string; revision: string | null; metadata?: Record<string, unknown>; report: { observations: readonly { check: string; observed: boolean; sources: readonly string[] }[]; missingChecks: readonly string[]; reason: string; deployment: string } };
    evidence?: { invocationId: string; caseId: string; trial: number; originalVerdict: EvalVerdict; suiteVersion?: string; graderVersion?: string; completedAt: string | null; modelId: string | null };
  }[];
}
export async function getEvalCoverage(signal: AbortSignal): Promise<EvalCoverageView> {
  const response = await fetch(`${baseUrl}/api/evals/coverage`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error(`Coverage could not be read (${response.status}).`);
  return await response.json() as EvalCoverageView;
}
