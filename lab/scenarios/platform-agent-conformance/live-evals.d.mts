import type { BaselineObservation, BaselineAssertion, BaselineRun } from "./baseline-evals.mjs";
export type LiveCaseId = "L01" | "L02" | "L03" | "L04" | "L05" | "L06" | "L07";
export interface LiveCase {
  id: LiveCaseId;
  name: string;
  requirementId?: "M02";
  caseVersion?: string;
  rubricVersion?: string;
  prompts: readonly string[];
  enabledTools: readonly string[];
  maxCalls: number;
  maxRounds: number;
  paired?: boolean;
  probes?: readonly string[];
  namespaces?: readonly string[];
  seeds?: readonly { namespace: string; records: Readonly<Record<string, string>> }[];
  lookupFailure?: { key: string; message: string; count: number };
  marker?: string;
  reviewRubric?: string;
}
export interface LiveRun extends BaselineRun {
  /** Immutable selected manifest metadata plus independently resolved allowlisted skill content. */
  declaredSkills?: readonly { id: string; version: string; digest: string }[];
  skillContexts?: readonly { skillId: string; skillVersion: string; digest: string; content: string }[];
}
export interface LiveObservation extends Omit<BaselineObservation, "runs"> {
  runs: LiveRun[];
  fixtureSnapshots?: { namespace: string; before: Record<string, string>; after: Record<string, string>; effectCount: number; lookupCount: number; writeAttemptCount: number }[];
  approvals?: boolean[];
}
export interface LiveGrade { caseId: LiveCaseId; verdict: "pass" | "fail" | "blocked"; reviewRequired?: true; assertions: BaselineAssertion[] }
export const LIVE_SUITE_VERSION: "3";
export const LIVE_GRADER_VERSION: "4";
export const LIVE_MARKER: "live-conformance-5831";
export const LIVE_INSTRUCTIONS: string;
export const LIVE_CASES: readonly LiveCase[];
export function liveCase(id: LiveCaseId): LiveCase;
export function buildLiveFixture(id: LiveCaseId, namespace: string): LiveCase;
/** Objective development grading. L05 and L07 text interpretation remains explicitly pending human review. */
export function gradeLiveCase(id: LiveCaseId, observation: LiveObservation, fixture?: LiveCase): LiveGrade;
