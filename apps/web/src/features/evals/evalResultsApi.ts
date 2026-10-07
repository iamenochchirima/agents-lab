export type EvalVerdict = "pass" | "fail" | "blocked" | "error";
export type EvalMode = "live" | "scripted" | "unknown";

export interface SavedEvalCase {
  readonly caseId: string;
  readonly trial: number;
  readonly verdict: EvalVerdict;
  readonly reason?: string;
  readonly reviewRequired?: boolean;
  readonly runIds: readonly string[];
  readonly evidence: string | null;
}

/** A retained invocation summary. A blocked case may have no admitted run. */
export interface SavedEvalInvocation {
  readonly invocationId: string;
  readonly mode: EvalMode;
  readonly platform: string;
  readonly modelId: string | null;
  readonly suiteVersion?: string;
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

const baseUrl = (import.meta.env?.VITE_AGENTLAB_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");

/** Read bounded saved summaries; this endpoint never dispatches an evaluation. */
export async function getSavedEvals(signal: AbortSignal): Promise<{ invocations: readonly SavedEvalInvocation[]; scanTruncated?: boolean }> {
  const response = await fetch(`${baseUrl}/api/evals?limit=25`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Saved evals could not be read. Server returned ${response.status}.`);
  return await response.json() as { invocations: SavedEvalInvocation[]; scanTruncated?: boolean };
}

export function evalEvidenceUrl(runId: string, file: "artifacts/eval.json" | "trajectory.json" | "context.json" | "events.jsonl"): string {
  return `${baseUrl}/api/runs/${encodeURIComponent(runId)}/evidence/${file}`;
}


export interface EvalTrialDetail {
  invocation: SavedEvalInvocation;
  case: SavedEvalCase;
  report: { assertions?: readonly { id: string; passed: boolean; expected: unknown; observed: unknown; observationRefs?: unknown }[]; observations?: readonly unknown[]; reviewRequired?: boolean } | null;
  runs: readonly { runId: string; artifacts: Record<string, unknown>; issues: readonly string[] }[];
  issues: readonly string[];
}

export async function getEvalTrialDetail(invocationId: string, caseId: string, trial: number, signal: AbortSignal): Promise<EvalTrialDetail> {
  const response = await fetch(`${baseUrl}/api/evals/${encodeURIComponent(invocationId)}/cases/${encodeURIComponent(caseId)}/trials/${trial}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Trial details are unavailable. Server returned ${response.status}.`);
  return await response.json() as EvalTrialDetail;
}
