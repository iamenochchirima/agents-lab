import type { BaselineRun, BaselineObservation, BaselineAssertion, BaselineCase } from "./baseline-evals.mjs";
export type BehaviourCaseId = "B01" | "B02" | "B03" | "B04" | "B05" | "B06" | "B07" | "B08" | "B09" | "B10" | "B11" | "B12";
export interface BehaviourRun extends Omit<BaselineRun, "probe"> {
  probe?: string;
  failurePolicy?: "terminal" | "continue";
  approvalGranted?: boolean;
  observedFailureKind?: "provider" | "malformed" | "tool";
  attemptCount?: number;
  expectedAttempts?: number;
  deadlineMs?: number;
  elapsedMs?: number;
  deadlineSource?: "native";
  inFlight?: "cancelled" | "completed" | "unknown";
}
export interface BehaviourEvent { runId: string; sequence: number; type: string; at?: string; data?: unknown }
export interface BehaviourRejection { runId: string; callId: string; toolName: string; kind: "validation" | "disabled" | "approval"; reason: string }
export interface FixtureSnapshot { probe: string; namespace: string; before: unknown; after: unknown; effectCount: number }
export interface AdmissionReceipt {
  probe: "replay" | "conflict" | "unavailable" | "ack-loss";
  accepted: boolean;
  runId?: string;
  canonicalRunId?: string;
  errorCode?: string;
  dispatchCount: number;
  reconciliationRequired?: boolean;
  /** Historical ambiguous admission and later resolution through the retained identity. */
  observedUnknown?: boolean;
  resolved?: boolean;
}
export interface CancellationReceipt { runId: string; probe: "during" | "completed" | "repeated"; observedSequence: number; requestedCount: number; status: string; terminalCount: number; inFlight: "cancelled" | "completed" | "unknown" | "none" }
/** Driver derives these facts from the actual stored files and projection output. */
export interface IntegrityReceipt {
  runId: string;
  configImmutable: boolean;
  eventIdentities: boolean;
  eventOrder: boolean;
  trajectoryConsistent: boolean;
  metricsConsistent: boolean;
  resultConsistent: boolean;
  referencesSafe: boolean;
  credentialsAbsent: boolean;
  usageUnknownCorrect: boolean;
}
export interface BehaviourObservation extends Omit<BaselineObservation, "runs"> {
  runs: BehaviourRun[];
  events?: BehaviourEvent[];
  rejections?: BehaviourRejection[];
  fixtureSnapshots?: FixtureSnapshot[];
  admissions?: AdmissionReceipt[];
  cancellations?: CancellationReceipt[];
  integrity?: IntegrityReceipt[];
  projection?: { inputCount: number; uniqueActions: number; expectedActions: number; duplicateCount: number; outOfOrderCount: number };
}
export interface BehaviourCase extends Partial<Omit<BaselineCase, "id">> { id: BehaviourCaseId; name: string; probes?: readonly string[] }
export interface BehaviourGrade { caseId: BehaviourCaseId; verdict: "pass" | "fail"; assertions: BaselineAssertion[] }
export const BEHAVIOUR_SUITE_VERSION: "2";
export const BEHAVIOUR_GRADER_VERSION: "2";
export const ISOLATION_MARKERS: readonly ["isolation-alpha-7319", "isolation-beta-8264"];
export const BEHAVIOUR_CASES: readonly BehaviourCase[];
export function behaviourCase(id: BehaviourCaseId): BehaviourCase;
export function gradeBehaviourCase(id: BehaviourCaseId, observation: BehaviourObservation): BehaviourGrade;
