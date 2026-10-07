import type { BaselineObservation, BaselineAssertion } from "./baseline-evals.mjs";
export type LiveCaseId = "L01" | "L02" | "L03";
export interface LiveCase {
  id: LiveCaseId;
  name: string;
  prompts: readonly string[];
  enabledTools: readonly string[];
  maxCalls: number;
  maxRounds: number;
}
export interface LiveGrade { caseId: LiveCaseId; verdict: "pass" | "fail"; assertions: BaselineAssertion[] }
export const LIVE_SUITE_VERSION: "1";
export const LIVE_GRADER_VERSION: "1";
export const LIVE_MARKER: "live-conformance-5831";
export const LIVE_INSTRUCTIONS: string;
export const LIVE_CASES: readonly LiveCase[];
export function liveCase(id: LiveCaseId): LiveCase;
/** Objective development grading; accepts varied answer wording and requires actual tool/context evidence. */
export function gradeLiveCase(id: LiveCaseId, observation: BaselineObservation): LiveGrade;
