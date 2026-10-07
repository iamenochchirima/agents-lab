/** Synthetic observations from the actual mapped model boundary and execution events. */
export type BaselineCaseId = "B01" | "B02" | "B03" | "B07";
export interface BaselineToolCall { callId: string; toolName: string; input: unknown }
export interface BaselineMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: BaselineToolCall[];
}
export interface BaselineRequest {
  runId: string;
  sequence: number;
  messages: BaselineMessage[];
  /** Calls returned by the synthetic model on this request. */
  responseToolCalls?: BaselineToolCall[];
}
export interface BaselineRun {
  runId: string;
  sessionId: string;
  turnId: string;
  status: string;
  output: string | null;
  instructions: string;
  maxCalls: number;
  maxRounds: number;
  probe?: "calls" | "rounds";
  error?: { code?: string; failureKind?: string; message?: string } | null;
}
export interface BaselineToolObservation {
  runId: string;
  callId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: string;
  /** Sequence of the model request that returned this call, when available. */
  requestSequence?: number;
}
export interface BaselineObservation {
  runs: BaselineRun[];
  requests: BaselineRequest[];
  /** Actual dispatch observations, including failed dispatches, excluding rejections before execution. */
  tools: BaselineToolObservation[];
}
export interface BaselineAssertion { id: string; passed: boolean; expected: unknown; observed: unknown }
export interface BaselineGrade { caseId: BaselineCaseId; verdict: "pass" | "fail"; assertions: BaselineAssertion[] }
export interface BaselineCase {
  id: BaselineCaseId;
  name: string;
  prompts: readonly string[];
  outputs: readonly string[];
  enabledTools: readonly string[];
  maxCalls: number;
  maxRounds: number;
}
export const BASELINE_SUITE_VERSION: "1";
export const BASELINE_GRADER_VERSION: "1";
export const BASELINE_MARKER: "conformance-4318";
export const BASELINE_CASES: readonly BaselineCase[];
export const UNIMPLEMENTED_CORE_CASES: readonly string[];
export function baselineCase(id: BaselineCaseId): BaselineCase;
/** Missing observations fail. Never infers tool execution from answer text. */
export function gradeBaselineCase(id: BaselineCaseId, observation: BaselineObservation): BaselineGrade;
