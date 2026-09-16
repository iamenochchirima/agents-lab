import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  asSessionId,
  asCorrelationId,
  asTurnId,
  isTerminalStatus,
  terminalEventType,
  type LifecycleEvent,
  type LifecycleEventType,
  type SessionId,
  type CorrelationId,
  type SessionMetadata,
  type RoundEvidence,
  type TerminalTurnStatus,
  type TranscriptMessage,
  type TurnRecord,
  type TurnResult,
  type TurnStatus,
} from "../runtime/contracts.js";
import { ComputerNativeError } from "../runtime/errors.js";
import {
  appendJsonLine,
  atomicWriteJson,
  atomicWriteJsonLines,
  ensureDirectory,
  readJson,
  readJsonLines,
  redactRecord,
  safePathSegment,
  stableStringify,
} from "./json.js";
import { assertTransition } from "../runtime/state.js";
import { SessionLock } from "./lock.js";
import { assertMutationTransition, type WorkspaceMutationRecord } from "../workspace/mutation.js";
import { assertProcessTransition, type ProcessExecutionRecord } from "../process/process.js";
import { assertBrowserActionTransition, type BrowserActionRecord } from "../browser/records.js";
import type { BrowserArtifactInfo } from "../browser/artifacts.js";
import { assertMemoryActionTransition, type MemoryActionRecord, type MemorySearchEvidence } from "../memory/contracts.js";

const NON_TERMINAL_STATES: readonly TurnStatus[] = ["submitting", "streaming"];

export type PersistenceWriteOperation = "replace-json" | "replace-json-lines" | "append-json-line";

export interface PersistenceWriteHooks {
  readonly beforeWrite?: (operation: PersistenceWriteOperation, filePath: string) => Promise<void> | void;
  readonly afterWrite?: (operation: PersistenceWriteOperation, filePath: string) => Promise<void> | void;
}

export interface SessionStoreOptions {
  /**
   * Optional diagnostic/failure-injection seam. Normal application code leaves this
   * unset; hooks may throw after a write to model a process stopping after durability
   * but before the caller receives acknowledgement.
   */
  readonly writeHooks?: PersistenceWriteHooks;
}

function now(): string {
  return new Date().toISOString();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function sessionId(): SessionId {
  return asSessionId(id("session"));
}

function turnId(): string {
  return id("turn");
}

function correlationId(): CorrelationId {
  return asCorrelationId(id("corr"));
}

function turnDirectory(sessionDirectory: string, idValue: string): string {
  return path.join(sessionDirectory, "turns", safePathSegment(idValue, "Turn ID"));
}

function terminalStateFromResult(result: TurnResult): Exclude<TurnStatus, "idle"> {
  return result.status;
}

function assertTerminalResultState(currentState: TurnStatus, result: TurnResult): void {
  if (isTerminalStatus(currentState) && currentState !== result.status) {
    throw new ComputerNativeError("persistence", `Terminal result status '${result.status}' does not match durable turn state '${currentState}'.`);
  }
}

function validateTurnRecord(record: unknown, sessionId: SessionId, directoryName?: string): asserts record is TurnRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ComputerNativeError("persistence", "A durable turn record is not an object.");
  }
  const candidate = record as Record<string, unknown>;
  const state = candidate.state;
  const turnId = candidate.turnId;
  const provider = candidate.provider;
  if (candidate.schemaVersion !== 1
    || candidate.sessionId !== sessionId
    || typeof turnId !== "string"
    || (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string")
    || typeof provider !== "string"
    || (provider !== "deterministic" && provider !== "openrouter")
    || typeof candidate.model !== "string"
    || (!NON_TERMINAL_STATES.includes(state as TurnStatus) && !isTerminalStatus(state as TurnStatus))
    || typeof candidate.userMessagePersisted !== "boolean"
    || typeof candidate.createdAt !== "string"
    || typeof candidate.updatedAt !== "string") {
    throw new ComputerNativeError("persistence", `Turn '${typeof turnId === "string" ? turnId : "unknown"}' has an invalid durable record.`);
  }
  safePathSegment(turnId, "Turn ID");
  if (directoryName !== undefined && turnId !== directoryName) {
    throw new ComputerNativeError("persistence", `Turn '${turnId}' does not match its durable directory '${directoryName}'.`);
  }
}

function validateTurnResult(result: unknown, record: TurnRecord): asserts result is TurnResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ComputerNativeError("persistence", `Turn '${record.turnId}' contains an invalid terminal result.`);
  }
  const candidate = result as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || !isTerminalStatus(candidate.status as TurnStatus)) {
    throw new ComputerNativeError("persistence", `Turn '${record.turnId}' contains an invalid terminal result.`);
  }
  if (candidate.sessionId !== record.sessionId) {
    throw new ComputerNativeError("persistence", `Terminal result does not belong to session '${record.sessionId}'.`);
  }
  if (candidate.turnId !== record.turnId) {
    throw new ComputerNativeError("persistence", `Terminal result does not belong to turn '${record.turnId}'.`);
  }
  if (candidate.provider !== record.provider) {
    throw new ComputerNativeError("persistence", `Terminal result provider does not match the admitted provider '${record.provider}'.`);
  }
  if (candidate.model !== record.model) {
    throw new ComputerNativeError("persistence", `Terminal result model does not match the admitted model '${record.model}'.`);
  }
  if (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string") {
    throw new ComputerNativeError("persistence", `Terminal result for turn '${record.turnId}' has an invalid correlation.`);
  }
  assertRecordCorrelation(record.correlationId ?? asCorrelationId(record.turnId), candidate.correlationId as CorrelationId | undefined, "Terminal result");
}

function validateTranscriptMessage(message: unknown, expectedSessionId: SessionId): asserts message is TranscriptMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new ComputerNativeError("persistence", "A durable transcript message is not an object.");
  }
  const candidate = message as Record<string, unknown>;
  if (candidate.schemaVersion !== 1
    || typeof candidate.messageId !== "string"
    || candidate.messageId.trim().length === 0
    || typeof candidate.turnId !== "string"
    || candidate.turnId.trim().length === 0
    || (candidate.role !== "user" && candidate.role !== "assistant")
    || typeof candidate.content !== "string"
    || typeof candidate.createdAt !== "string"
    || candidate.createdAt.trim().length === 0) {
    throw new ComputerNativeError("persistence", "A durable transcript message has an invalid record.");
  }
  if (candidate.sessionId !== expectedSessionId) {
    throw new ComputerNativeError("persistence", `Transcript message '${candidate.messageId}' does not belong to session '${expectedSessionId}'.`);
  }
  safePathSegment(candidate.turnId, "Turn ID");
}

function assertTurnStartedIdentity(
  record: TurnRecord,
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (type !== "TurnStarted") return;
  if (payload.provider !== undefined && payload.provider !== record.provider) {
    throw new ComputerNativeError("persistence", `TurnStarted provider '${String(payload.provider)}' does not match admitted provider '${record.provider}'.`);
  }
  if (payload.model !== undefined && payload.model !== record.model) {
    throw new ComputerNativeError("persistence", `TurnStarted model '${String(payload.model)}' does not match admitted model '${record.model}'.`);
  }
}

function isTerminalLifecycleEvent(type: LifecycleEventType): boolean {
  return type === "TurnCompleted" || type === "TurnFailed" || type === "TurnCancelled" || type === "TurnInterrupted";
}

const LIFECYCLE_EVENT_TYPES: ReadonlySet<LifecycleEventType> = new Set([
  "TurnStarted",
  "ModelRequested",
  "ModelRequestRejected",
  "ModelAttemptCompleted",
  "ModelRetryScheduled",
  "ModelCompleted",
  "ProcessPrepared",
  "ProcessApprovalDecided",
  "ProcessStarted",
  "ProcessTerminating",
  "ProcessCompleted",
  "BrowserPrepared",
  "BrowserApprovalDecided",
  "BrowserStarted",
  "BrowserCompleted",
  "BrowserArtifactCreated",
  "MemoryBootstrapLoaded",
  "MemorySearched",
  "MemoryPrepared",
  "MemoryApprovalDecided",
  "MemoryCommitted",
  "MemoryForgotten",
  "MemoryFailed",
  "WorkspaceMutationProposed",
  "WorkspaceMutationApprovalDecided",
  "WorkspaceMutationApplying",
  "WorkspaceMutationProgress",
  "WorkspaceMutationCommitted",
  "WorkspaceMutationFailed",
  "WorkspaceMutationReconciled",
  "TurnCompleted",
  "TurnFailed",
  "TurnCancelled",
  "TurnInterrupted",
]);

const WORKSPACE_MUTATION_LIFECYCLE_EVENTS: ReadonlySet<LifecycleEventType> = new Set([
  "WorkspaceMutationProposed",
  "WorkspaceMutationApprovalDecided",
  "WorkspaceMutationApplying",
  "WorkspaceMutationProgress",
  "WorkspaceMutationCommitted",
  "WorkspaceMutationFailed",
  "WorkspaceMutationReconciled",
]);

function isWorkspaceMutationLifecycleEvent(type: LifecycleEventType): boolean {
  return WORKSPACE_MUTATION_LIFECYCLE_EVENTS.has(type);
}

type ActionIdentityField = "executionId" | "actionId" | "operationId";

const ACTION_LIFECYCLE_IDENTITY_FIELDS: Readonly<Partial<Record<LifecycleEventType, ActionIdentityField>>> = {
  ProcessPrepared: "executionId",
  ProcessApprovalDecided: "executionId",
  ProcessStarted: "executionId",
  ProcessTerminating: "executionId",
  ProcessCompleted: "executionId",
  BrowserPrepared: "actionId",
  BrowserApprovalDecided: "actionId",
  BrowserStarted: "actionId",
  BrowserCompleted: "actionId",
  MemoryPrepared: "operationId",
  MemoryApprovalDecided: "operationId",
  MemoryCommitted: "operationId",
  MemoryForgotten: "operationId",
  MemoryFailed: "operationId",
};

const ACTION_LIFECYCLE_PREVIOUS: Readonly<Partial<Record<LifecycleEventType, readonly LifecycleEventType[]>>> = {
  ProcessPrepared: [],
  ProcessApprovalDecided: ["ProcessPrepared"],
  ProcessStarted: ["ProcessApprovalDecided"],
  ProcessTerminating: ["ProcessStarted"],
  // Recovery may close a prepared/approved process directly when it never reached
  // a launch record. A started process may also be completed without a terminating
  // event when the child exits normally.
  ProcessCompleted: ["ProcessPrepared", "ProcessApprovalDecided", "ProcessStarted", "ProcessTerminating"],
  BrowserPrepared: [],
  BrowserApprovalDecided: ["BrowserPrepared"],
  BrowserStarted: ["BrowserApprovalDecided"],
  // Recovery and denied approvals can produce a terminal browser observation without
  // a started event; the action must still have been prepared first.
  BrowserCompleted: ["BrowserPrepared", "BrowserApprovalDecided", "BrowserStarted"],
  MemoryPrepared: [],
  MemoryApprovalDecided: ["MemoryPrepared"],
  // A durable memory commit may be recovered after its approval or terminal write
  // acknowledgement was lost, so the terminal evidence accepts either predecessor.
  MemoryCommitted: ["MemoryPrepared", "MemoryApprovalDecided"],
  MemoryForgotten: ["MemoryPrepared", "MemoryApprovalDecided"],
  MemoryFailed: ["MemoryPrepared", "MemoryApprovalDecided"],
};

function isActionLifecycleEvent(type: LifecycleEventType): boolean {
  return ACTION_LIFECYCLE_IDENTITY_FIELDS[type] !== undefined;
}

function assertActionLifecycleEventOrder(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (!isActionLifecycleEvent(type)) return;
  const identityField = ACTION_LIFECYCLE_IDENTITY_FIELDS[type];
  const identity = identityField ? payload[identityField] : undefined;
  if (typeof identity !== "string" || identity.trim().length === 0) {
    throw new ComputerNativeError("persistence", `${type} requires a non-empty ${identityField ?? "action"} identity.`);
  }
  if (!identityField) throw new ComputerNativeError("persistence", `${type} has no configured action identity field.`);
  const related = existing.filter((event) => {
    const eventIdentityField = ACTION_LIFECYCLE_IDENTITY_FIELDS[event.type];
    if (eventIdentityField !== identityField) return false;
    return event.payload[identityField] === identity;
  });
  const previous = related.at(-1)?.type;
  const allowedPrevious = ACTION_LIFECYCLE_PREVIOUS[type] ?? [];
  if (previous === undefined) {
    const recoveredTerminal = payload.recovered === true
      && (type === "ProcessCompleted" || type === "BrowserCompleted" || type === "MemoryCommitted" || type === "MemoryForgotten" || type === "MemoryFailed");
    if (recoveredTerminal) return;
    if (allowedPrevious.length > 0) {
      throw new ComputerNativeError("persistence", `${type} for '${identity}' cannot be recorded before ${allowedPrevious.join(" or ")}.`);
    }
    return;
  }
  if (!allowedPrevious.includes(previous)) {
    throw new ComputerNativeError("persistence", `${type} for '${identity}' cannot follow ${previous}.`);
  }
}

function assertWorkspaceMutationLifecycleEventOrder(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (!isWorkspaceMutationLifecycleEvent(type)) return;
  const mutationId = payload.mutationId;
  if (typeof mutationId !== "string" || mutationId.trim().length === 0) {
    throw new ComputerNativeError("persistence", `${type} requires a mutation identity.`);
  }
  const related = existing.filter((event) => isWorkspaceMutationLifecycleEvent(event.type) && event.payload.mutationId === mutationId);
  const previous = related.at(-1)?.type;
  if (type === "WorkspaceMutationProposed") {
    if (previous !== undefined) throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' was proposed more than once.`);
    return;
  }
  if (previous === undefined) {
    throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' cannot record '${type}' before its proposal.`);
  }
  if (previous === "WorkspaceMutationCommitted" || previous === "WorkspaceMutationFailed" || previous === "WorkspaceMutationReconciled") {
    throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' cannot record '${type}' after its terminal lifecycle event.`);
  }
  if (type === "WorkspaceMutationApprovalDecided") {
    if (previous !== "WorkspaceMutationProposed") throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' approval must follow its proposal.`);
    return;
  }
  if (type === "WorkspaceMutationApplying") {
    if (previous !== "WorkspaceMutationApprovalDecided" || payload.decision !== "allow-once") {
      throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' cannot start before an allow-once approval.`);
    }
    return;
  }
  if (type === "WorkspaceMutationProgress") {
    if (previous !== "WorkspaceMutationApplying" && previous !== "WorkspaceMutationProgress") {
      throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' progress must follow application start.`);
    }
    return;
  }
  // A restart can prove that an approved mutation never reached the applying
  // boundary because its before-write acknowledgement failed. In that case the
  // reconciler emits a terminal "not applied" observation directly after the
  // approval evidence; it must remain explicitly recovery-marked.
  if (type === "WorkspaceMutationReconciled" && previous === "WorkspaceMutationApprovalDecided" && payload.recovered === true) return;
  if (type === "WorkspaceMutationFailed" && previous === "WorkspaceMutationApprovalDecided") return;
  if (previous !== "WorkspaceMutationApplying" && previous !== "WorkspaceMutationProgress") {
    throw new ComputerNativeError("persistence", `Workspace mutation '${mutationId}' cannot finish before application starts.`);
  }
}

function assertModelLifecycleEventOrder(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  const isModelEvidence = type === "ModelRequested"
    || type === "ModelRequestRejected"
    || type === "ModelAttemptCompleted"
    || type === "ModelRetryScheduled"
    || type === "ModelCompleted";
  if (!isModelEvidence) return;
  if (!existing.some((event) => event.type === "TurnStarted")) {
    throw new ComputerNativeError("persistence", `${type} cannot be recorded before TurnStarted.`);
  }
  if (type === "ModelAttemptCompleted" || type === "ModelRetryScheduled" || type === "ModelRequested") {
    const attemptId = payload.attemptId;
    if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
      throw new ComputerNativeError("persistence", `${type} requires a non-empty attemptId.`);
    }
    if (type === "ModelAttemptCompleted") {
      const requested = existing.some((event) => event.type === "ModelRequested" && event.payload.attemptId === attemptId);
      if (!requested) throw new ComputerNativeError("persistence", "A model attempt cannot complete before its request is recorded.");
    }
    if (type === "ModelRetryScheduled") {
      const completed = existing.filter((event) => event.type === "ModelAttemptCompleted").at(-1);
      if (!completed || completed.payload.attemptId !== attemptId) {
        throw new ComputerNativeError("persistence", "A model retry cannot be scheduled before the failed attempt is recorded.");
      }
      if (completed.payload.status === "completed") {
        throw new ComputerNativeError("persistence", "A model retry can only follow a failed attempt.");
      }
    }
  }
  if (type === "ModelCompleted") {
    const completed = existing.filter((event) => event.type === "ModelAttemptCompleted").at(-1);
    if (!completed) {
      throw new ComputerNativeError("persistence", "A model cannot complete before at least one model attempt is recorded.");
    }
    if (completed.payload.status !== "completed") {
      throw new ComputerNativeError("persistence", "A model cannot complete because the final model attempt did not complete successfully.");
    }
  }
}

function assertLifecycleEventOrder(existing: readonly LifecycleEvent[], type: LifecycleEventType, payload: Readonly<Record<string, unknown>>): void {
  assertModelLifecycleEventOrder(existing, type, payload);
  assertActionLifecycleEventOrder(existing, type, payload);
  assertWorkspaceMutationLifecycleEventOrder(existing, type, payload);
}

function validateLifecycleEventHistory(
  events: readonly LifecycleEvent[],
  expectedSessionId?: SessionId,
  expectedTurnId?: TurnRecord["turnId"],
): void {
  const prefix: LifecycleEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new ComputerNativeError("persistence", "A durable lifecycle event has an invalid record.");
    }
    if (event.schemaVersion !== 1 || typeof event.eventId !== "string" || event.eventId.trim().length === 0) {
      throw new ComputerNativeError("persistence", "A durable lifecycle event has an invalid record identity.");
    }
    if (!LIFECYCLE_EVENT_TYPES.has(event.type)) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.eventId}' has an unknown event type.`);
    }
    if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.eventId}' has an invalid sequence.`);
    }
    if (expectedSessionId !== undefined && event.sessionId !== expectedSessionId) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.eventId}' does not belong to session '${expectedSessionId}'.`);
    }
    if (expectedTurnId !== undefined && event.turnId !== expectedTurnId) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.eventId}' does not belong to turn '${expectedTurnId}'.`);
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.eventId}' has an invalid payload.`);
    }
    if (prefix.some((candidate) => isTerminalLifecycleEvent(candidate.type))) {
      throw new ComputerNativeError("persistence", `Lifecycle event '${event.type}' appears after a terminal turn event.`);
    }
    assertLifecycleEventOrder(prefix, event.type, event.payload);
    prefix.push(event);
  }
}

/**
 * Model evidence has stable attempt identities. If a caller loses the write
 * acknowledgement and retries the same append, return the durable event instead
 * of appending a second observation. A different payload for the same identity
 * is corruption, not a new attempt.
 */
function findIdempotentModelEvent(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): LifecycleEvent | undefined {
  if (type !== "TurnStarted" && type !== "ModelRequested" && type !== "ModelAttemptCompleted" && type !== "ModelRetryScheduled" && type !== "ModelCompleted") return undefined;
  const attemptId = payload.attemptId;
  const candidate = type === "TurnStarted" || type === "ModelCompleted"
    ? existing.find((event) => event.type === type)
    : typeof attemptId === "string"
      ? existing.find((event) => event.type === type && event.payload.attemptId === attemptId)
      : undefined;
  if (!candidate) return undefined;
  const normalizedPayload = redactRecord(payload);
  if (stableStringify(candidate.payload) !== stableStringify(normalizedPayload)) {
    throw new ComputerNativeError("persistence", `${type} evidence was repeated with a different payload for the same identity.`);
  }
  return candidate;
}

function lifecycleEventIdentity(type: LifecycleEventType, payload: Readonly<Record<string, unknown>>): readonly [string, string] | undefined {
  // Progress is a sequence of distinct journal observations for one mutation,
  // not a retryable one-shot lifecycle phase.
  if (type === "WorkspaceMutationProgress") return undefined;
  const actionField = ACTION_LIFECYCLE_IDENTITY_FIELDS[type]
    ?? (isWorkspaceMutationLifecycleEvent(type) ? "mutationId" : undefined)
    ?? (type === "MemorySearched" ? "searchId" : undefined)
    ?? (type === "BrowserArtifactCreated" ? "artifactId" : undefined);
  if (!actionField) return undefined;
  const value = payload[actionField];
  return typeof value === "string" && value.length > 0 ? [actionField, value] : undefined;
}

function findIdempotentActionEvent(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): LifecycleEvent | undefined {
  const identity = lifecycleEventIdentity(type, payload);
  if (!identity) return undefined;
  const [field, value] = identity;
  const candidate = existing.find((event) => event.type === type && event.payload[field] === value);
  if (!candidate) return undefined;
  const normalizedPayload = redactRecord(payload);
  if (stableStringify(candidate.payload) !== stableStringify(normalizedPayload)) {
    throw new ComputerNativeError("persistence", `${type} evidence was repeated with a different payload for the same identity.`);
  }
  return candidate;
}

function validateRound(round: RoundEvidence, sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  const validPhase = round.phase === "model_requested"
    || round.phase === "model_completed"
    || round.phase === "tool_requested"
    || round.phase === "tool_completed";
  if (round.schemaVersion !== 1 || round.sessionId !== sessionId || round.turnId !== turnId || !Number.isInteger(round.round) || round.round < 1 || !validPhase) {
    throw new ComputerNativeError("persistence", `Turn '${turnId}' contains an invalid round record. Repair it before continuing.`);
  }
  if ((round.phase === "tool_requested" || round.phase === "tool_completed")
    && (typeof round.callId !== "string" || round.callId.trim().length === 0 || typeof round.toolName !== "string" || round.toolName.trim().length === 0)) {
    throw new ComputerNativeError("persistence", `Turn '${turnId}' contains a tool round without call identity. Repair it before continuing.`);
  }
}

function validateRoundOrder(rounds: readonly RoundEvidence[], sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  let previous: RoundEvidence | undefined;
  const callIds = new Set<string>();
  for (const [index, round] of rounds.entries()) {
    validateRound(round, sessionId, turnId);
    if (index === 0 && (round.round !== 1 || round.phase !== "model_requested")) {
      throw new ComputerNativeError("persistence", `Turn '${turnId}' must begin with model request evidence for round 1.`);
    }
    if (previous) {
      if (round.round < previous.round || round.round > previous.round + 1) {
        throw new ComputerNativeError("persistence", `Turn '${turnId}' contains out-of-order round evidence. Repair it before continuing.`);
      }
      if (round.round === previous.round + 1 && round.phase !== "model_requested") {
        throw new ComputerNativeError("persistence", `Turn '${turnId}' starts a new round with an invalid phase. Repair it before continuing.`);
      }
      if (round.round === previous.round) {
        const validSameRoundTransition =
          (previous.phase === "model_requested" && round.phase === "model_completed") ||
          (previous.phase === "model_completed" && round.phase === "tool_requested") ||
          (previous.phase === "tool_requested" && round.phase === "tool_completed") ||
          (previous.phase === "tool_completed" && round.phase === "tool_requested");
        if (!validSameRoundTransition) {
          throw new ComputerNativeError("persistence", `Turn '${turnId}' contains out-of-order phase evidence. Repair it before continuing.`);
        }
        if (previous.phase === "tool_requested" && round.phase === "tool_completed"
          && (round.callId !== previous.callId || round.toolName !== previous.toolName)) {
          throw new ComputerNativeError("persistence", `Turn '${turnId}' contains tool completion evidence that does not match its request.`);
        }
      }
    }
    if (round.callId && (round.phase === "tool_requested" || round.phase === "tool_completed")) {
      if (callIds.has(round.callId) && round.phase === "tool_requested") {
        throw new ComputerNativeError("persistence", `Turn '${turnId}' contains duplicate tool call '${round.callId}'. Repair it before continuing.`);
      }
      if (round.phase === "tool_requested") callIds.add(round.callId);
    }
    previous = round;
  }
}

function roundIdentity(round: RoundEvidence): string {
  return stableStringify({ round: round.round, phase: round.phase, callId: round.callId ?? null, toolName: round.toolName ?? null });
}

function roundSemantics(round: RoundEvidence): Readonly<Record<string, unknown>> {
  const redacted = redactRecord(round) as Record<string, unknown>;
  const { recordedAt: _recordedAt, ...semantics } = redacted;
  return semantics;
}

function assertRecordCorrelation(expected: CorrelationId, actual: CorrelationId | undefined, kind: string): void {
  if (actual !== undefined && actual !== expected) {
    throw new ComputerNativeError("persistence", `${kind} correlation '${actual}' does not belong to correlation '${expected}'.`);
  }
}

function assertTurnBoundRecord(
  record: unknown,
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
  kind: string,
  identityField: string,
): void {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ComputerNativeError("persistence", `${kind} has an invalid durable record.`);
  }
  const candidate = record as Record<string, unknown>;
  const identity = candidate[identityField];
  if (candidate.schemaVersion !== 1 || typeof identity !== "string" || identity.trim().length === 0) {
    throw new ComputerNativeError("persistence", `${kind} '${identity}' has an invalid durable identity.`);
  }
  if (candidate.turnId !== expectedTurnId) {
    throw new ComputerNativeError("persistence", `${kind} '${identity}' does not belong to turn '${expectedTurnId}'.`);
  }
  if (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string") {
    throw new ComputerNativeError("persistence", `${kind} '${identity}' has an invalid correlation.`);
  }
  assertRecordCorrelation(expectedCorrelationId, candidate.correlationId as CorrelationId | undefined, kind);
}

function assertProcessExecutionRecord(
  record: unknown,
  expectedSessionId: SessionId,
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is ProcessExecutionRecord {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Process execution", "executionId");
  const candidate = record as Record<string, unknown>;
  if (candidate.sessionId !== expectedSessionId) {
    throw new ComputerNativeError("persistence", `Process execution '${String(candidate.executionId)}' does not belong to session '${expectedSessionId}'.`);
  }
  const limits = candidate.limits as Record<string, unknown> | undefined;
  const validPositiveInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0;
  const validNonNegativeInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
  const validStatus = candidate.status === "prepared"
    || candidate.status === "approved"
    || candidate.status === "running"
    || candidate.status === "completed"
    || candidate.status === "failed"
    || candidate.status === "cancelled"
    || candidate.status === "ambiguous";
  const validErrorCode = candidate.errorCode === "process-exit"
    || candidate.errorCode === "process-signal"
    || candidate.errorCode === "process-start"
    || candidate.errorCode === "process-timeout"
    || candidate.errorCode === "process-output-limit"
    || candidate.errorCode === "process-cancelled"
    || candidate.errorCode === "process-ambiguous"
    || candidate.errorCode === "process-approval-denied"
    || candidate.errorCode === "process-approval-unavailable"
    || candidate.errorCode === "process-policy";
  const processIdentity = candidate.processIdentity as Record<string, unknown> | undefined;
  const validProcessIdentity = processIdentity === undefined
    || (processIdentity !== null
      && typeof processIdentity === "object"
      && typeof processIdentity.platform === "string"
      && processIdentity.platform.trim().length > 0
      && typeof processIdentity.executablePath === "string"
      && processIdentity.executablePath.trim().length > 0
      && typeof processIdentity.startTime === "string"
      && processIdentity.startTime.trim().length > 0);
  if (typeof candidate.callId !== "string" || candidate.callId.trim().length === 0
    || typeof candidate.command !== "string" || candidate.command.trim().length === 0
    || !Array.isArray(candidate.displayArgs) || candidate.displayArgs.some((value) => typeof value !== "string")
    || typeof candidate.cwd !== "string" || candidate.cwd.trim().length === 0
    || typeof candidate.executablePath !== "string" || candidate.executablePath.trim().length === 0
    || candidate.environmentProfile !== "sanitized-default"
    || !Array.isArray(candidate.environmentKeys) || candidate.environmentKeys.some((value) => typeof value !== "string")
    || limits === undefined || limits === null || typeof limits !== "object"
    || !validPositiveInteger(limits.timeoutMs)
    || !validPositiveInteger(limits.terminationGraceMs)
    || !validPositiveInteger(limits.maxOutputBytes)
    || !validPositiveInteger(limits.maxArgumentCount)
    || !validPositiveInteger(limits.maxArgumentBytes)
    || typeof candidate.argvHash !== "string" || candidate.argvHash.trim().length === 0
    || !validStatus
    || (candidate.errorCode !== undefined && !validErrorCode)
    || (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== "string")
    || (candidate.decision !== undefined && candidate.decision !== "allow-once" && candidate.decision !== "deny" && candidate.decision !== "unavailable")
    || (candidate.approvalTimeoutMs !== undefined && !validPositiveInteger(candidate.approvalTimeoutMs))
    || (candidate.pid !== undefined && !validPositiveInteger(candidate.pid))
    || (candidate.processIdentity !== undefined && !validProcessIdentity)
    || (candidate.stdout !== undefined && typeof candidate.stdout !== "string")
    || (candidate.stderr !== undefined && typeof candidate.stderr !== "string")
    || (candidate.stdoutBytes !== undefined && !validNonNegativeInteger(candidate.stdoutBytes))
    || (candidate.stderrBytes !== undefined && !validNonNegativeInteger(candidate.stderrBytes))
    || (candidate.outputTruncated !== undefined && typeof candidate.outputTruncated !== "boolean")
    || (candidate.durationMs !== undefined && !validNonNegativeInteger(candidate.durationMs))
    || (candidate.exitCode !== undefined && candidate.exitCode !== null && !Number.isSafeInteger(candidate.exitCode))
    || (candidate.signal !== undefined && candidate.signal !== null && typeof candidate.signal !== "string")
    || (candidate.terminationConfirmed !== undefined && typeof candidate.terminationConfirmed !== "boolean")
    || (candidate.startedAt !== undefined && typeof candidate.startedAt !== "string")
    || (candidate.finishedAt !== undefined && typeof candidate.finishedAt !== "string")
    || typeof candidate.recordedAt !== "string" || candidate.recordedAt.trim().length === 0
    || (candidate.status === "running" && (!validPositiveInteger(candidate.pid) || typeof candidate.startedAt !== "string" || candidate.startedAt.trim().length === 0))) {
    throw new ComputerNativeError("persistence", `Process execution '${String(candidate.executionId)}' has an invalid durable record.`);
  }
}

function assertBrowserActionRecord(
  record: unknown,
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is BrowserActionRecord {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Browser action", "actionId");
  const candidate = record as Record<string, unknown>;
  const validAction = candidate.action === "click"
    || candidate.action === "type"
    || candidate.action === "press"
    || candidate.action === "upload"
    || candidate.action === "download"
    || candidate.action === "dialog";
  const validStatus = candidate.status === "prepared"
    || candidate.status === "approved"
    || candidate.status === "running"
    || candidate.status === "completed"
    || candidate.status === "failed"
    || candidate.status === "cancelled"
    || candidate.status === "ambiguous";
  const validErrorCode = candidate.errorCode === "session-not-found"
    || candidate.errorCode === "session-closed"
    || candidate.errorCode === "session-timeout"
    || candidate.errorCode === "tab-not-found"
    || candidate.errorCode === "tab-closed"
    || candidate.errorCode === "tab-ownership"
    || candidate.errorCode === "navigation-policy"
    || candidate.errorCode === "stale-reference"
    || candidate.errorCode === "invalid-action"
    || candidate.errorCode === "browser-timeout"
    || candidate.errorCode === "browser-cancelled"
    || candidate.errorCode === "browser-crash"
    || candidate.errorCode === "browser-ambiguous"
    || candidate.errorCode === "browser-resource-limit"
    || candidate.errorCode === "artifact-violation"
    || candidate.errorCode === "adapter-failure"
    || candidate.errorCode === "browser-approval-denied"
    || candidate.errorCode === "browser-approval-unavailable";
  const dialog = candidate.dialog as Record<string, unknown> | undefined;
  const validDialog = dialog === undefined
    || (dialog !== null
      && typeof dialog === "object"
      && (dialog.type === "alert" || dialog.type === "beforeunload" || dialog.type === "confirm" || dialog.type === "prompt")
      && typeof dialog.message === "string");
  const diagnostic = candidate.diagnostic as Record<string, unknown> | undefined;
  const validDiagnostic = diagnostic === undefined
    || (diagnostic !== null
      && typeof diagnostic === "object"
      && typeof diagnostic.name === "string"
      && typeof diagnostic.message === "string");
  const validPositiveInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0;
  const validNonNegativeInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.trim().length === 0
    || typeof candidate.callId !== "string" || candidate.callId.trim().length === 0
    || typeof candidate.tabId !== "string" || candidate.tabId.trim().length === 0
    || !validAction
    || typeof candidate.reference !== "string" || candidate.reference.trim().length === 0
    || typeof candidate.documentId !== "string" || candidate.documentId.trim().length === 0
    || (candidate.text !== undefined && typeof candidate.text !== "string")
    || (candidate.key !== undefined && typeof candidate.key !== "string")
    || (candidate.path !== undefined && (typeof candidate.path !== "string" || candidate.path.trim().length === 0))
    || (candidate.maxBytes !== undefined && !validNonNegativeInteger(candidate.maxBytes))
    || typeof candidate.actionHash !== "string" || candidate.actionHash.trim().length === 0
    || (candidate.approvalTimeoutMs !== undefined && !validPositiveInteger(candidate.approvalTimeoutMs))
    || !validStatus
    || (candidate.decision !== undefined && candidate.decision !== "allow-once" && candidate.decision !== "deny" && candidate.decision !== "unavailable")
    || (candidate.summary !== undefined && typeof candidate.summary !== "string")
    || (candidate.errorCode !== undefined && !validErrorCode)
    || (candidate.underlyingErrorCode !== undefined && !validErrorCode)
    || (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== "string")
    || !validDialog
    || (candidate.dialogDecision !== undefined && candidate.dialogDecision !== "accept" && candidate.dialogDecision !== "dismiss")
    || (candidate.cancellationConfirmed !== undefined && typeof candidate.cancellationConfirmed !== "boolean")
    || !validDiagnostic
    || (candidate.startedAt !== undefined && typeof candidate.startedAt !== "string")
    || (candidate.finishedAt !== undefined && typeof candidate.finishedAt !== "string")
    || typeof candidate.recordedAt !== "string" || candidate.recordedAt.trim().length === 0
    || (candidate.status === "running" && (typeof candidate.startedAt !== "string" || candidate.startedAt.trim().length === 0))) {
    throw new ComputerNativeError("persistence", `Browser action '${String(candidate.actionId)}' has an invalid durable record.`);
  }
}

function assertMemoryActionRecord(
  record: unknown,
  expectedSessionId: SessionMetadata["sessionId"],
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is MemoryActionRecord {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Memory action", "operationId");
  const candidate = record as Record<string, unknown>;
  const validNonEmptyString = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
  const validOptionalString = (value: unknown): boolean => value === undefined || validNonEmptyString(value);
  const validMemoryScope = (value: unknown): boolean => value === "user" || value === "workspace" || value === "daily";
  const validOperation = candidate.operation === "add"
    || candidate.operation === "replace"
    || candidate.operation === "remove"
    || candidate.operation === "batch";
  const validScope = validMemoryScope(candidate.scope);
  const validStatus = candidate.status === "proposed"
    || candidate.status === "approved"
    || candidate.status === "denied"
    || candidate.status === "committed"
    || candidate.status === "failed";
  const validDecision = candidate.decision === undefined
    || candidate.decision === "allow-once"
    || candidate.decision === "deny"
    || candidate.decision === "unavailable";
  const validBatch = candidate.batch === undefined
    || (Array.isArray(candidate.batch)
      && candidate.batch.length > 0
      && candidate.batch.every((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return (item.operation === "add" || item.operation === "replace" || item.operation === "remove")
          && validMemoryScope(item.scope)
          && validOptionalString(item.recordId)
          && validNonEmptyString(item.sourcePath)
          && validOptionalString(item.beforeContentHash)
          && validOptionalString(item.afterContentHash);
      }));
  if (candidate.sessionId !== expectedSessionId
    || !validNonEmptyString(candidate.callId)
    || !validOperation
    || (candidate.recordId !== undefined && !validNonEmptyString(candidate.recordId))
    || !validScope
    || !validNonEmptyString(candidate.sourcePath)
    || !validOptionalString(candidate.beforeContentHash)
    || !validOptionalString(candidate.afterContentHash)
    || !validNonEmptyString(candidate.inputHash)
    || !validBatch
    || (candidate.operation === "batch" && candidate.batch === undefined)
    || (candidate.approvalTimeoutMs !== undefined && (!Number.isSafeInteger(candidate.approvalTimeoutMs) || (candidate.approvalTimeoutMs as number) <= 0))
    || !validStatus
    || !validDecision
    || (candidate.reason !== undefined && !validNonEmptyString(candidate.reason))
    || !validNonEmptyString(candidate.recordedAt)) {
    throw new ComputerNativeError("persistence", `Memory action '${String(candidate.operationId)}' has an invalid durable record.`);
  }
  assertRecordCorrelation(expectedCorrelationId, candidate.correlationId as CorrelationId | undefined, "Memory action");
}

function assertWorkspaceMutationRecord(
  record: unknown,
  expectedCorrelationId: CorrelationId,
): asserts record is WorkspaceMutationRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ComputerNativeError("persistence", "Workspace mutation has an invalid durable record.");
  }
  const candidate = record as Record<string, unknown>;
  const validOperation = candidate.operation === "add"
    || candidate.operation === "update"
    || candidate.operation === "write"
    || candidate.operation === "patch-set"
    || candidate.operation === "mkdir"
    || candidate.operation === "delete"
    || candidate.operation === "delete-directory"
    || candidate.operation === "delete-directory-tree"
    || candidate.operation === "restore"
    || candidate.operation === "restore-directory"
    || candidate.operation === "purge-quarantine"
    || candidate.operation === "copy"
    || candidate.operation === "move"
    || candidate.operation === "rename";
  const validRisk = candidate.risk === undefined
    || candidate.risk === "create-file"
    || candidate.risk === "replace-file"
    || candidate.risk === "patch-file"
    || candidate.risk === "create-directory"
    || candidate.risk === "quarantine-file"
    || candidate.risk === "delete-directory"
    || candidate.risk === "delete-directory-tree"
    || candidate.risk === "restore-file"
    || candidate.risk === "restore-directory"
    || candidate.risk === "purge-quarantine"
    || candidate.risk === "copy-file"
    || candidate.risk === "copy-directory"
    || candidate.risk === "move-file"
    || candidate.risk === "move-directory"
    || candidate.risk === "rename-file"
    || candidate.risk === "rename-directory"
    || candidate.risk === "multi-file-patch";
  const validStatus = candidate.status === "proposed"
    || candidate.status === "approved"
    || candidate.status === "applying"
    || candidate.status === "denied"
    || candidate.status === "failed"
    || candidate.status === "committed"
    || candidate.status === "reconciled"
    || candidate.status === "reconciliation_required";
  const validErrorCode = candidate.errorCode === "mutation-invalid"
    || candidate.errorCode === "approval-denied"
    || candidate.errorCode === "approval-unavailable"
    || candidate.errorCode === "mutation-stale"
    || candidate.errorCode === "mutation-failed"
    || candidate.errorCode === "reconciliation-required";
  const validNonEmptyString = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
  const validNonNegativeInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
  const validPositiveInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0;
  const validOptionalString = (value: unknown): boolean => value === undefined || validNonEmptyString(value);
  const validMember = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const member = value as Record<string, unknown>;
    return validNonEmptyString(member.path)
      && (member.operation === "add" || member.operation === "update")
      && validNonEmptyString(member.beforeHash)
      && validNonEmptyString(member.afterHash)
      && validNonNegativeInteger(member.addedLines)
      && validNonNegativeInteger(member.removedLines)
      && typeof member.diff === "string"
      && member.diff.length > 0;
  };
  const journal = candidate.journal as Record<string, unknown> | undefined;
  const validJournal = journal === undefined
    || (journal !== null
      && typeof journal === "object"
      && journal.schemaVersion === 1
      && (journal.state === "prepared" || journal.state === "staging" || journal.state === "committing" || journal.state === "committed" || journal.state === "reconciled" || journal.state === "reconciliation_required")
      && validNonEmptyString(journal.transactionPath)
      && Array.isArray(journal.members)
      && journal.members.every((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const member = value as Record<string, unknown>;
        return validNonEmptyString(member.path)
          && validNonEmptyString(member.beforeHash)
          && validNonEmptyString(member.afterHash)
          && validPositiveInteger(member.commitOrder)
          && (member.state === "pending" || member.state === "staged" || member.state === "committed")
          && (member.temporaryPath === undefined || validNonEmptyString(member.temporaryPath));
      }));
  if (candidate.schemaVersion !== 1
    || !validNonEmptyString(candidate.mutationId)
    || (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string")
    || (candidate.callId !== undefined && !validNonEmptyString(candidate.callId))
    || !validOperation
    || !validRisk
    || (candidate.kind !== undefined && candidate.kind !== "file" && candidate.kind !== "directory")
    || (candidate.approvalTimeoutMs !== undefined && !validPositiveInteger(candidate.approvalTimeoutMs))
    || (candidate.paths !== undefined && (!Array.isArray(candidate.paths) || candidate.paths.length === 0 || candidate.paths.some((value) => !validNonEmptyString(value))))
    || (candidate.members !== undefined && (!Array.isArray(candidate.members) || candidate.members.length === 0 || candidate.members.some((value) => !validMember(value))))
    || !validJournal
    || !validNonEmptyString(candidate.path)
    || !validOptionalString(candidate.beforeHash)
    || !validOptionalString(candidate.afterHash)
    || !validOptionalString(candidate.quarantinePath)
    || !validOptionalString(candidate.sourceMutationId)
    || !validOptionalString(candidate.sourcePath)
    || !validOptionalString(candidate.sourceHash)
    || !validOptionalString(candidate.manifestHash)
    || (candidate.entryCount !== undefined && !validNonNegativeInteger(candidate.entryCount))
    || (candidate.totalBytes !== undefined && !validNonNegativeInteger(candidate.totalBytes))
    || (candidate.maxBytes !== undefined && !validNonNegativeInteger(candidate.maxBytes))
    || (candidate.maxDepth !== undefined && !validNonNegativeInteger(candidate.maxDepth))
    || !validNonNegativeInteger(candidate.addedLines)
    || !validNonNegativeInteger(candidate.removedLines)
    || typeof candidate.diff !== "string" || candidate.diff.length === 0
    || !validStatus
    || (candidate.decision !== undefined && candidate.decision !== "allow-once" && candidate.decision !== "deny" && candidate.decision !== "unavailable")
    || (candidate.errorCode !== undefined && !validErrorCode)
    || (candidate.reason !== undefined && typeof candidate.reason !== "string")
    || (candidate.bytesWritten !== undefined && !validNonNegativeInteger(candidate.bytesWritten))
    || !validNonEmptyString(candidate.recordedAt)) {
    throw new ComputerNativeError("persistence", `Workspace mutation '${String(candidate.mutationId)}' has an invalid durable record.`);
  }
  assertRecordCorrelation(expectedCorrelationId, candidate.correlationId as CorrelationId | undefined, "Workspace mutation");
}

export type BrowserArtifactEvidence = BrowserArtifactInfo & {
  readonly turnId: TurnRecord["turnId"];
  readonly correlationId?: CorrelationId;
};

function assertBrowserArtifactEvidence(
  record: unknown,
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is BrowserArtifactEvidence {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Browser artifact", "artifactId");
  const candidate = record as Record<string, unknown>;
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.trim().length === 0
    || typeof candidate.tabId !== "string" || candidate.tabId.trim().length === 0
    || typeof candidate.path !== "string" || candidate.path.trim().length === 0
    || (candidate.kind !== "screenshot" && candidate.kind !== "download")
    || (candidate.mimeType !== "image/png" && candidate.mimeType !== "application/octet-stream")
    || !Number.isInteger(candidate.byteSize) || (candidate.byteSize as number) < 0
    || typeof candidate.createdAt !== "string" || candidate.createdAt.trim().length === 0
    || (candidate.width !== undefined && (!Number.isInteger(candidate.width) || (candidate.width as number) <= 0))
    || (candidate.height !== undefined && (!Number.isInteger(candidate.height) || (candidate.height as number) <= 0))
    || (candidate.fileName !== undefined && (typeof candidate.fileName !== "string" || candidate.fileName.trim().length === 0))) {
    throw new ComputerNativeError("persistence", `Browser artifact '${String(candidate.artifactId)}' has an invalid durable record.`);
  }
}

function browserArtifactEventPayload(record: BrowserArtifactEvidence): Readonly<Record<string, unknown>> {
  return {
    artifactId: record.artifactId,
    kind: record.kind,
    sessionId: record.sessionId,
    tabId: record.tabId,
    path: record.path,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    createdAt: record.createdAt,
    ...(record.width !== undefined ? { width: record.width } : {}),
    ...(record.height !== undefined ? { height: record.height } : {}),
    fileName: record.fileName ?? null,
  };
}

function assertMemoryActionHistory(
  history: readonly MemoryActionRecord[],
  expectedSessionId: SessionMetadata["sessionId"],
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): void {
  let previous: MemoryActionRecord | undefined;
  for (const record of history) {
    assertMemoryActionRecord(record, expectedSessionId, expectedTurnId, expectedCorrelationId);
    if (previous) {
      try {
        assertMemoryActionTransition(previous, record);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Memory action '${record.operationId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    previous = record;
  }
}

export class SessionStore {
  private constructor(
    readonly stateDir: string,
    readonly sessionDirectory: string,
    readonly metadata: SessionMetadata,
    private readonly writeHooks?: PersistenceWriteHooks,
  ) {}

  static async open(stateDir: string, requestedSessionId?: string, options: SessionStoreOptions = {}): Promise<SessionStore> {
    await ensureDirectory(path.join(stateDir, "sessions"));
    const selectedId = requestedSessionId ? safePathSegment(requestedSessionId, "Session ID") : sessionId();
    const sessionDirectory = path.join(stateDir, "sessions", selectedId);
    const metadataPath = path.join(sessionDirectory, "session.json");
    try {
      const metadata = await readJson<SessionMetadata>(metadataPath);
      if (metadata.sessionId !== selectedId || metadata.schemaVersion !== 1) {
        throw new ComputerNativeError("persistence", "The session metadata is invalid.");
      }
      return new SessionStore(stateDir, sessionDirectory, metadata, options.writeHooks);
    } catch (error) {
      const metadataExists = await stat(metadataPath).then(() => true).catch(() => false);
      if (metadataExists || (error instanceof ComputerNativeError && !error.message.startsWith("Could not read"))) throw error;
      if (requestedSessionId) throw new ComputerNativeError("session-not-found", `Session '${requestedSessionId}' was not found.`);
      const metadata: SessionMetadata = {
        schemaVersion: 1,
        sessionId: asSessionId(selectedId),
        createdAt: now(),
        source: "cli",
        profileId: "default",
      };
      await ensureDirectory(path.join(sessionDirectory, "turns"));
      const store = new SessionStore(stateDir, sessionDirectory, metadata, options.writeHooks);
      await store.replaceJson(metadataPath, metadata);
      return store;
    }
  }

  async replaceJson(filePath: string, value: unknown): Promise<void> {
    await this.writeHooks?.beforeWrite?.("replace-json", filePath);
    await atomicWriteJson(filePath, value);
    await this.writeHooks?.afterWrite?.("replace-json", filePath);
  }

  async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    await this.writeHooks?.beforeWrite?.("append-json-line", filePath);
    await appendJsonLine(filePath, value);
    await this.writeHooks?.afterWrite?.("append-json-line", filePath);
  }

  async replaceJsonLines(filePath: string, values: readonly unknown[]): Promise<void> {
    await this.writeHooks?.beforeWrite?.("replace-json-lines", filePath);
    await atomicWriteJsonLines(filePath, values);
    await this.writeHooks?.afterWrite?.("replace-json-lines", filePath);
  }

  async acquireLock(): Promise<SessionLock> {
    return SessionLock.acquire(path.join(this.sessionDirectory, ".lock"));
  }

  /**
   * Own the single foreground runtime slot for this session. The lock remains
   * held for the complete turn, while the durable turn record remains the
   * authority used by restart recovery after an owner process disappears.
   */
  async acquireTurnExecution(): Promise<SessionLock> {
    const lock = await SessionLock.acquire(path.join(this.sessionDirectory, ".turn-execution.lock"));
    try {
      await this.assertNoActiveTurn();
      return lock;
    } catch (error) {
      await lock.release().catch(() => undefined);
      throw error;
    }
  }

  async readTranscript(): Promise<TranscriptMessage[]> {
    const transcript = await readJsonLines<TranscriptMessage>(path.join(this.sessionDirectory, "transcript.jsonl"));
    const messageIds = new Set<string>();
    for (const message of transcript) {
      validateTranscriptMessage(message, this.metadata.sessionId);
      if (messageIds.has(message.messageId)) {
        throw new ComputerNativeError("persistence", `Transcript message '${message.messageId}' is duplicated.`);
      }
      messageIds.add(message.messageId);
    }
    return transcript;
  }

  async admitTurn(userPrompt: string, provider: TurnRecord["provider"], model: string): Promise<TurnStore> {
    const content = userPrompt.trim();
    if (content.length === 0) throw new ComputerNativeError("invalid-input", "A message is required.");
    const selectedTurnId = asTurnId(turnId());
    const selectedCorrelationId = correlationId();
    const createdAt = now();
    const directory = turnDirectory(this.sessionDirectory, selectedTurnId);
    await ensureDirectory(directory);
    const record: TurnRecord = {
      schemaVersion: 1,
      sessionId: this.metadata.sessionId,
      turnId: selectedTurnId,
      correlationId: selectedCorrelationId,
      provider,
      model,
      state: "submitting",
      userMessagePersisted: false,
      createdAt,
      updatedAt: createdAt,
    };
    await this.replaceJson(path.join(directory, "turn.json"), record);
    const message: TranscriptMessage = {
      schemaVersion: 1,
      messageId: `${selectedTurnId}_user`,
      sessionId: this.metadata.sessionId,
      turnId: selectedTurnId,
      role: "user",
      content,
      createdAt,
    };
    await this.appendMessage(message);
    await this.replaceJson(path.join(directory, "turn.json"), { ...record, userMessagePersisted: true, updatedAt: now() });
    return new TurnStore(this, directory, { ...record, userMessagePersisted: true });
  }

  private async assertNoActiveTurn(): Promise<void> {
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    await ensureDirectory(turnsDirectory);
    const entries = await readdir(turnsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let record: TurnRecord;
      try {
        record = await readJson<TurnRecord>(path.join(turnsDirectory, entry.name, "turn.json"));
        validateTurnRecord(record, this.metadata.sessionId, entry.name);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Turn '${entry.name}' cannot be admitted around an invalid durable record.`, { cause: error });
      }
      if (NON_TERMINAL_STATES.includes(record.state)) {
        throw new ComputerNativeError("lock", `Session '${this.metadata.sessionId}' already has active turn '${record.turnId}' in state '${record.state}'. Recover it before starting another turn.`);
      }
    }
  }

  async recoverInterruptedTurns(
    reconcileMutation?: (record: WorkspaceMutationRecord) => Promise<WorkspaceMutationRecord>,
    reconcileProcess?: (record: ProcessExecutionRecord) => Promise<ProcessExecutionRecord>,
    reconcileMemory?: (record: MemoryActionRecord) => Promise<MemoryActionRecord>,
  ): Promise<TurnResult[]> {
    const lock = await SessionLock.acquire(path.join(this.sessionDirectory, ".turn-execution.lock"));
    try {
      return await this.recoverInterruptedTurnsUnlocked(reconcileMutation, reconcileProcess, reconcileMemory);
    } finally {
      await lock.release();
    }
  }

  private async recoverInterruptedTurnsUnlocked(
    reconcileMutation?: (record: WorkspaceMutationRecord) => Promise<WorkspaceMutationRecord>,
    reconcileProcess?: (record: ProcessExecutionRecord) => Promise<ProcessExecutionRecord>,
    reconcileMemory?: (record: MemoryActionRecord) => Promise<MemoryActionRecord>,
  ): Promise<TurnResult[]> {
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    await ensureDirectory(turnsDirectory);
    const entries = await readdir(turnsDirectory, { withFileTypes: true });
    const recovered: TurnResult[] = [];
    const transcript = await this.readTranscript();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(turnsDirectory, entry.name);
      const recordPath = path.join(directory, "turn.json");
      let record: TurnRecord;
      try {
        record = await readJson<TurnRecord>(recordPath);
        validateTurnRecord(record, this.metadata.sessionId, entry.name);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Turn '${entry.name}' has no valid turn record. Repair it before continuing.`, { cause: error });
      }
      const resultPath = path.join(directory, "result.json");
      const result = await fileExists(resultPath) ? await readJson<TurnResult>(resultPath) : undefined;
      const turn = new TurnStore(this, directory, record);
      if (result) {
        validateTurnResult(result, record);
        assertTerminalResultState(record.state, result);
      }
      for (const execution of await turn.readProcesses()) {
        let reconciledExecution = execution;
        if (execution.status === "prepared") {
          reconciledExecution = { ...execution, status: "failed", errorCode: "process-approval-unavailable", errorMessage: "The process approval ended when the parent process stopped; the command was not replayed.", finishedAt: now(), recordedAt: now() };
          await turn.writeProcess(reconciledExecution);
        } else if (execution.status === "approved") {
          reconciledExecution = { ...execution, status: "failed", errorCode: "process-approval-unavailable", errorMessage: "The approved process had not reached a launch record when the parent process stopped; the command was not replayed.", finishedAt: now(), recordedAt: now() };
          await turn.writeProcess(reconciledExecution);
        } else if (execution.status === "running") {
          reconciledExecution = reconcileProcess
            ? await reconcileProcess(execution)
            : { ...execution, status: "ambiguous", errorCode: "process-ambiguous", errorMessage: "The process was running when the parent process stopped; its outcome is unknown and the command was not replayed.", finishedAt: now(), recordedAt: now() };
          if (reconciledExecution.status !== "ambiguous") {
            throw new ComputerNativeError("persistence", `Process execution '${execution.executionId}' reconciliation must remain ambiguous because its outcome is unknown.`);
          }
          await turn.writeProcess(reconciledExecution);
        }
        await turn.ensureProcessTerminalEvent(reconciledExecution);
      }
      for (const action of await turn.readBrowserActions()) {
        let reconciledAction = action;
        if (action.status === "prepared") {
          reconciledAction = {
            ...action,
            status: "failed",
            errorCode: "browser-approval-unavailable",
            errorMessage: "The browser approval ended when the parent process stopped; the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeBrowserAction(reconciledAction);
        } else if (action.status === "approved") {
          reconciledAction = {
            ...action,
            status: "failed",
            errorCode: "browser-approval-unavailable",
            errorMessage: "The approved browser action had not started when the parent process stopped; the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeBrowserAction(reconciledAction);
        } else if (action.status === "running") {
          reconciledAction = {
            ...action,
            status: "ambiguous",
            errorCode: "browser-ambiguous",
            errorMessage: "The browser action was running when the parent process stopped; its outcome is unknown and the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeBrowserAction(reconciledAction);
        }
        await turn.ensureBrowserTerminalEvent(reconciledAction);
      }
      for (const artifact of await turn.readBrowserArtifacts()) {
        await turn.ensureBrowserArtifactEvent(artifact);
      }
      for (const action of await turn.readMemoryActions()) {
        let reconciledAction = action;
        if (action.status === "proposed") {
          reconciledAction = {
            ...action,
            status: "denied",
            decision: "unavailable",
            reason: "The process stopped before the memory operation committed; it was not replayed.",
            recordedAt: now(),
          };
          await turn.writeMemoryAction(reconciledAction);
        } else if (action.status === "approved") {
          reconciledAction = reconcileMemory
            ? await reconcileMemory(action)
            : {
                ...action,
                status: "denied",
                decision: "unavailable",
                reason: "The process stopped before memory commit evidence was reconciled; the operation was not replayed.",
                recordedAt: now(),
              };
          await turn.writeMemoryAction(reconciledAction);
        }
        await turn.ensureMemoryTerminalEvent(reconciledAction);
      }
      for (const search of await turn.readMemorySearches()) {
        await turn.ensureMemorySearchEvent(search);
      }
      if (result) {
        await turn.ensureTerminalEvent(result);
        if (!isTerminalStatus(record.state)) await turn.updateState(terminalStateFromResult(result));
        continue;
      }
      if (isTerminalStatus(record.state)) {
        throw new ComputerNativeError("persistence", `Turn '${record.turnId}' is terminal but has no result record.`);
      }
      for (const mutation of await turn.readMutations()) {
        let reconciledMutation = mutation;
        if (mutation.status === "proposed") {
          reconciledMutation = {
            ...mutation,
            status: "denied",
            decision: "unavailable",
            errorCode: "approval-unavailable",
            reason: "The process stopped before approval was decided; the mutation was not applied.",
          };
          await turn.writeMutation(reconciledMutation);
        } else if (reconcileMutation && (mutation.status === "approved" || mutation.status === "applying")) {
          reconciledMutation = await reconcileMutation(mutation);
          await turn.writeMutation(reconciledMutation);
        }
        await turn.ensureMutationTerminalEvent(reconciledMutation);
      }
      const hasUserMessage = transcript.some((message) => message.turnId === record.turnId && message.role === "user");
      if (!record.userMessagePersisted && !hasUserMessage) {
        throw new ComputerNativeError("persistence", `Turn '${record.turnId}' is incomplete: its user message is missing. Repair it before continuing.`);
      }
      const interrupted: TurnResult = {
        schemaVersion: 1,
        sessionId: record.sessionId,
        turnId: record.turnId,
        correlationId: record.correlationId ?? asCorrelationId(record.turnId),
        status: "interrupted",
        provider: record.provider,
        model: record.model,
        startedAt: record.createdAt,
        finishedAt: now(),
        error: { code: "interrupted", message: "The process stopped before the turn reached a terminal outcome. No model request was retried." },
      };
      await turn.writeResult(interrupted);
      await turn.updateState("interrupted");
      await turn.ensureTerminalEvent(interrupted);
      recovered.push(interrupted);
    }
    return recovered;
  }

  async appendMessage(message: TranscriptMessage): Promise<void> {
    validateTranscriptMessage(message, this.metadata.sessionId);
    const transcript = await this.readTranscript();
    const existing = transcript.find((candidate) => candidate.messageId === message.messageId);
    if (existing) {
      if (stableStringify(existing) !== stableStringify(message)) {
        throw new ComputerNativeError("persistence", `Transcript message '${message.messageId}' already has different content.`);
      }
      return;
    }
    await this.appendJsonLine(path.join(this.sessionDirectory, "transcript.jsonl"), message);
  }
}

export class TurnStore {
  constructor(
    private readonly session: SessionStore,
    readonly directory: string,
    private record: TurnRecord,
  ) {}

  get sessionId(): SessionId {
    return this.record.sessionId;
  }

  get turnId(): TurnRecord["turnId"] {
    return this.record.turnId;
  }

  /** Older turn records used the turn ID as their only correlation key. */
  get correlationId(): CorrelationId {
    return this.record.correlationId ?? asCorrelationId(this.record.turnId);
  }

  get state(): TurnStatus {
    return this.record.state;
  }

  async appendEvent(type: LifecycleEventType, payload: Readonly<Record<string, unknown>> = {}): Promise<LifecycleEvent> {
    const eventsPath = path.join(this.directory, "events.jsonl");
    const existing = await readJsonLines<LifecycleEvent>(eventsPath);
    validateLifecycleEventHistory(existing, this.sessionId, this.turnId);
    for (const event of existing) assertRecordCorrelation(this.correlationId, event.correlationId, "Lifecycle event");
    assertTurnStartedIdentity(this.record, type, payload);
    const terminal = existing.find((event) => isTerminalLifecycleEvent(event.type));
    if (terminal) {
      if (terminal.type === type) {
        const normalizedPayload = redactRecord(payload);
        if (stableStringify(terminal.payload) !== stableStringify(normalizedPayload)) {
          throw new ComputerNativeError("persistence", `${type} evidence was repeated with a different payload for the same terminal turn.`);
        }
        return terminal;
      }
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' already has terminal event '${terminal.type}'; '${type}' cannot be appended.`);
    }
    const existingModelEvent = findIdempotentModelEvent(existing, type, payload);
    if (existingModelEvent) return existingModelEvent;
    const existingActionEvent = findIdempotentActionEvent(existing, type, payload);
    if (existingActionEvent) return existingActionEvent;
    assertLifecycleEventOrder(existing, type, payload);
    const event: LifecycleEvent = {
      schemaVersion: 1,
      eventId: id("event"),
      sequence: existing.length + 1,
      type,
      recordedAt: now(),
      sessionId: this.record.sessionId,
      turnId: this.record.turnId,
      correlationId: this.correlationId,
      payload: redactRecord(payload) as Readonly<Record<string, unknown>>,
    };
    await this.session.appendJsonLine(eventsPath, event);
    return event;
  }

  private async appendRecoveredEvent(type: LifecycleEventType, payload: Readonly<Record<string, unknown>>): Promise<LifecycleEvent> {
    const eventsPath = path.join(this.directory, "events.jsonl");
    const existing = await readJsonLines<LifecycleEvent>(eventsPath);
    validateLifecycleEventHistory(existing, this.sessionId, this.turnId);
    for (const event of existing) assertRecordCorrelation(this.correlationId, event.correlationId, "Lifecycle event");
    const terminalIndex = existing.findIndex((event) => isTerminalLifecycleEvent(event.type));
    if (terminalIndex < 0) return this.appendEvent(type, payload);
    const prefix = existing.slice(0, terminalIndex);
    assertLifecycleEventOrder(prefix, type, payload);
    const event: LifecycleEvent = {
      schemaVersion: 1,
      eventId: id("event"),
      sequence: terminalIndex + 1,
      type,
      recordedAt: now(),
      sessionId: this.record.sessionId,
      turnId: this.record.turnId,
      correlationId: this.correlationId,
      payload: redactRecord(payload) as Readonly<Record<string, unknown>>,
    };
    const repaired = [...prefix, event, existing[terminalIndex]].map((candidate, index) => ({ ...candidate, sequence: index + 1 }));
    await this.session.replaceJsonLines(eventsPath, repaired);
    return event;
  }

  async readEvents(): Promise<LifecycleEvent[]> {
    const events = await readJsonLines<LifecycleEvent>(path.join(this.directory, "events.jsonl"));
    validateLifecycleEventHistory(events, this.sessionId, this.turnId);
    for (const event of events) {
      assertRecordCorrelation(this.correlationId, event.correlationId, "Lifecycle event");
      assertTurnStartedIdentity(this.record, event.type, event.payload);
    }
    return events;
  }

  async appendRound(round: RoundEvidence): Promise<void> {
    const existing = await this.readRounds();
    assertRecordCorrelation(this.correlationId, round.correlationId, "Round");
    const normalized = { ...round, correlationId: round.correlationId ?? this.correlationId };
    const previous = existing.at(-1);
    if (previous && roundIdentity(previous) === roundIdentity(normalized)) {
      if (stableStringify(roundSemantics(previous)) !== stableStringify(roundSemantics(normalized))) {
        throw new ComputerNativeError("persistence", `Round '${round.round}/${round.phase}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    validateRoundOrder([...existing, normalized], this.sessionId, this.turnId);
    await this.session.appendJsonLine(path.join(this.directory, "rounds.jsonl"), redactRecord(normalized));
  }

  async readRounds(): Promise<RoundEvidence[]> {
    const rounds = await readJsonLines<RoundEvidence>(path.join(this.directory, "rounds.jsonl"));
    validateRoundOrder(rounds, this.sessionId, this.turnId);
    for (const round of rounds) assertRecordCorrelation(this.correlationId, round.correlationId, "Round");
    return rounds;
  }

  async writeMutation(record: WorkspaceMutationRecord): Promise<void> {
    assertWorkspaceMutationRecord(record, this.correlationId);
    const directory = path.join(this.directory, "mutations");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.mutationId, "Mutation ID")}.json`);
    let previous: WorkspaceMutationRecord | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<WorkspaceMutationRecord>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertWorkspaceMutationRecord(previous, this.correlationId);
      assertMutationTransition(previous, record);
    }
    await this.session.replaceJson(recordPath, record);
  }

  async writeProcess(record: ProcessExecutionRecord): Promise<void> {
    assertProcessExecutionRecord(record, this.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "executions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.executionId, "Execution ID")}.json`);
    let previous: ProcessExecutionRecord | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<ProcessExecutionRecord>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertProcessExecutionRecord(previous, this.sessionId, this.turnId, this.correlationId);
      try {
        assertProcessTransition(previous, record);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Process execution '${record.executionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, record);
  }

  async readProcesses(): Promise<ProcessExecutionRecord[]> {
    const directory = path.join(this.directory, "executions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' process records cannot be listed.`, { cause: error });
    });
    const records: ProcessExecutionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<ProcessExecutionRecord>(path.join(directory, entry.name));
      assertProcessExecutionRecord(record, this.sessionId, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async writeBrowserAction(record: BrowserActionRecord): Promise<void> {
    assertBrowserActionRecord(record, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "browser-actions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.actionId, "Browser action ID")}.json`);
    let previous: BrowserActionRecord | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<BrowserActionRecord>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertBrowserActionRecord(previous, this.turnId, this.correlationId);
      try {
        assertBrowserActionTransition(previous, record);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Browser action '${record.actionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, record);
  }

  async writeMemoryAction(record: MemoryActionRecord): Promise<void> {
    assertMemoryActionRecord(record, this.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "memory-actions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.operationId, "Memory operation ID")}.jsonl`);
    const history = await readJsonLines<MemoryActionRecord>(recordPath);
    assertMemoryActionHistory([...history, record], this.sessionId, this.turnId, this.correlationId);
    // Lifecycle updates are append-only. Recovery reads the latest state, while
    // the JSONL history preserves the earlier proposal/approval outcome.
    await this.session.appendJsonLine(recordPath, record);
  }

  async readMemoryActions(): Promise<MemoryActionRecord[]> {
    const directory = path.join(this.directory, "memory-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' memory records cannot be listed.`, { cause: error });
    });
    const records: MemoryActionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".jsonl")).sort((left, right) => left.name.localeCompare(right.name))) {
      const history = await readJsonLines<MemoryActionRecord>(path.join(directory, entry.name));
      assertMemoryActionHistory(history, this.sessionId, this.turnId, this.correlationId);
      const latest = history.at(-1);
      if (latest) records.push(latest);
    }
    return records;
  }

  async writeMemorySearch(record: MemorySearchEvidence): Promise<void> {
    if (record.schemaVersion !== 1 || record.searchId.trim().length === 0 || record.callId.trim().length === 0) {
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' contains an invalid memory search record.`);
    }
    assertRecordCorrelation(this.correlationId, record.correlationId, "Memory search");
    if (record.turnId !== this.turnId || record.sessionId !== this.sessionId) {
      throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' does not belong to turn '${this.turnId}'.`);
    }
    const directory = path.join(this.directory, "memory-searches");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.searchId, "Memory search ID")}.json`);
    let previous: MemorySearchEvidence | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<MemorySearchEvidence>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertTurnBoundRecord(previous, this.turnId, this.correlationId, "Memory search", "searchId");
      if (previous.sessionId !== this.sessionId || typeof previous.callId !== "string" || previous.callId.trim().length === 0) {
        throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' does not belong to turn '${this.turnId}'.`);
      }
      const { recordedAt: _previousRecordedAt, ...previousSemantics } = redactRecord(previous) as Record<string, unknown>;
      const { recordedAt: _recordedAt, ...recordSemantics } = redactRecord(record) as Record<string, unknown>;
      if (stableStringify(previousSemantics) !== stableStringify(recordSemantics)) {
        throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    await this.session.replaceJson(recordPath, record);
  }

  async readMemorySearches(): Promise<MemorySearchEvidence[]> {
    const directory = path.join(this.directory, "memory-searches");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' memory searches cannot be listed.`, { cause: error });
    });
    const records: MemorySearchEvidence[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<MemorySearchEvidence>(path.join(directory, entry.name));
      assertTurnBoundRecord(record, this.turnId, this.correlationId, "Memory search", "searchId");
      if (record.sessionId !== this.sessionId || typeof record.callId !== "string" || record.callId.trim().length === 0) {
        throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' does not belong to turn '${this.turnId}'.`);
      }
      records.push(record);
    }
    return records;
  }

  async ensureMemorySearchEvent(record: MemorySearchEvidence): Promise<void> {
    assertTurnBoundRecord(record, this.turnId, this.correlationId, "Memory search", "searchId");
    if (record.sessionId !== this.sessionId || typeof record.callId !== "string" || record.callId.trim().length === 0) {
      throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' does not belong to turn '${this.turnId}'.`);
    }
    const payload = {
      searchId: record.searchId,
      callId: record.callId,
      queryHash: record.queryHash,
      scopes: record.scopes ?? null,
      resultCount: record.resultCount,
      resultIds: record.resultIds,
      truncated: record.truncated,
    };
    const existing = (await this.readEvents()).find((event) => event.type === "MemorySearched" && event.payload.searchId === record.searchId);
    if (existing) {
      const { recovered: _recovered, ...existingPayload } = existing.payload;
      if (stableStringify(existingPayload) !== stableStringify(redactRecord(payload))) {
        throw new ComputerNativeError("persistence", `Memory search '${record.searchId}' lifecycle evidence conflicts with its durable search record.`);
      }
      return;
    }
    await this.appendRecoveredEvent("MemorySearched", { ...payload, recovered: true });
  }

  async readBrowserActions(): Promise<BrowserActionRecord[]> {
    const directory = path.join(this.directory, "browser-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' browser action records cannot be listed.`, { cause: error });
    });
    const records: BrowserActionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<BrowserActionRecord>(path.join(directory, entry.name));
      assertBrowserActionRecord(record, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async writeBrowserArtifact(record: BrowserArtifactEvidence): Promise<void> {
    assertBrowserArtifactEvidence(record, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "browser-artifacts");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(record.artifactId, "Browser artifact ID")}.json`);
    let previous: BrowserArtifactEvidence | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<BrowserArtifactEvidence>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertBrowserArtifactEvidence(previous, this.turnId, this.correlationId);
      if (stableStringify(previous) !== stableStringify(record)) {
        throw new ComputerNativeError("persistence", `Browser artifact '${record.artifactId}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    await this.session.replaceJson(recordPath, record);
  }

  async readBrowserArtifacts(): Promise<BrowserArtifactEvidence[]> {
    const directory = path.join(this.directory, "browser-artifacts");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' browser artifacts cannot be listed.`, { cause: error });
    });
    const records: BrowserArtifactEvidence[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<BrowserArtifactEvidence>(path.join(directory, entry.name));
      assertBrowserArtifactEvidence(record, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async ensureBrowserArtifactEvent(record: BrowserArtifactEvidence): Promise<void> {
    assertBrowserArtifactEvidence(record, this.turnId, this.correlationId);
    const payload = browserArtifactEventPayload(record);
    const existing = (await this.readEvents()).find((event) => event.type === "BrowserArtifactCreated" && event.payload.artifactId === record.artifactId);
    if (existing) {
      const { recovered: _recovered, ...existingPayload } = existing.payload;
      if (stableStringify(existingPayload) !== stableStringify(redactRecord(payload))) {
        throw new ComputerNativeError("persistence", `Browser artifact '${record.artifactId}' lifecycle evidence conflicts with its durable artifact record.`);
      }
      return;
    }
    await this.appendRecoveredEvent("BrowserArtifactCreated", { ...payload, recovered: true });
  }

  async readMutations(): Promise<WorkspaceMutationRecord[]> {
    const directory = path.join(this.directory, "mutations");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' mutation records cannot be listed.`, { cause: error });
    });
    const records: WorkspaceMutationRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<WorkspaceMutationRecord>(path.join(directory, entry.name));
      assertWorkspaceMutationRecord(record, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async updateState(nextState: Exclude<TurnStatus, "idle">): Promise<void> {
    if (this.record.state !== nextState) assertTransition(this.record.state, nextState);
    const nextRecord = { ...this.record, state: nextState, updatedAt: now() };
    await this.session.replaceJson(path.join(this.directory, "turn.json"), nextRecord);
    // Keep the in-memory view behind the durable record until the write has
    // acknowledged. An after-write interruption leaves the disk state ahead,
    // which the next explicit retry can safely reconcile through the same path.
    this.record = nextRecord;
  }

  async appendAssistantMessage(content: string, createdAt = now()): Promise<string> {
    const messageId = `${this.turnId}_assistant`;
    const transcript: TranscriptMessage = {
      schemaVersion: 1,
      messageId,
      sessionId: this.sessionId,
      turnId: this.turnId,
      role: "assistant",
      content,
      createdAt,
    };
    await this.session.appendMessage(transcript);
    return messageId;
  }

  async writeResult(result: TurnResult): Promise<void> {
    validateTurnResult(result, this.record);
    assertTerminalResultState(this.record.state, result);
    const resultPath = path.join(this.directory, "result.json");
    if (await fileExists(resultPath)) {
      const existing = await readJson<TurnResult>(resultPath);
      if (stableStringify(existing) !== stableStringify(result)) {
        throw new ComputerNativeError("persistence", `Turn '${this.turnId}' already has a different terminal result.`);
      }
      return;
    }
    await this.session.replaceJson(resultPath, result);
  }

  async ensureTerminalEvent(result: TurnResult): Promise<void> {
    const events = await this.readEvents();
    const expected = terminalEventType(result.status);
    const existing = events.find((event) => event.type === expected);
    if (existing) {
      if (existing.payload.status !== undefined && existing.payload.status !== result.status) {
        throw new ComputerNativeError("persistence", `Terminal event '${expected}' does not match terminal result status '${result.status}'.`);
      }
      if (existing.payload.assistantMessageId !== undefined && existing.payload.assistantMessageId !== result.assistantMessageId) {
        throw new ComputerNativeError("persistence", `Terminal event '${expected}' does not match the terminal assistant message.`);
      }
      if (existing.payload.error !== undefined && stableStringify(existing.payload.error) !== stableStringify(redactRecord(result.error))) {
        throw new ComputerNativeError("persistence", `Terminal event '${expected}' does not match the terminal error.`);
      }
      return;
    }
    await this.appendEvent(expected, { status: result.status, recovered: true });
  }

  async ensureProcessTerminalEvent(record: ProcessExecutionRecord): Promise<void> {
    if (record.status !== "completed" && record.status !== "failed" && record.status !== "cancelled" && record.status !== "ambiguous") return;
    const events = await this.readEvents();
    if (events.some((event) => event.type === "ProcessCompleted" && event.payload.executionId === record.executionId)) return;
    await this.appendRecoveredEvent("ProcessCompleted", {
      executionId: record.executionId,
      callId: record.callId,
      status: record.status,
      errorCode: record.errorCode ?? null,
      stdoutBytes: record.stdoutBytes ?? 0,
      stderrBytes: record.stderrBytes ?? 0,
      recovered: true,
    });
  }

  async ensureBrowserTerminalEvent(record: BrowserActionRecord): Promise<void> {
    if (record.status !== "completed" && record.status !== "failed" && record.status !== "cancelled" && record.status !== "ambiguous") return;
    const events = await this.readEvents();
    if (events.some((event) => event.type === "BrowserCompleted" && event.payload.actionId === record.actionId)) return;
    await this.appendRecoveredEvent("BrowserCompleted", {
      actionId: record.actionId,
      callId: record.callId,
      status: record.status,
      errorCode: record.errorCode ?? null,
      underlyingErrorCode: record.underlyingErrorCode ?? null,
      recovered: true,
    });
  }

  async ensureMemoryTerminalEvent(record: MemoryActionRecord): Promise<void> {
    if (record.status !== "committed" && record.status !== "denied" && record.status !== "failed") return;
    const events = await this.readEvents();
    const terminalTypes: readonly LifecycleEventType[] = ["MemoryCommitted", "MemoryForgotten", "MemoryFailed"];
    if (events.some((event) => terminalTypes.includes(event.type) && event.payload.operationId === record.operationId)) return;
    const type: LifecycleEventType = record.status === "committed"
      ? record.operation === "remove" ? "MemoryForgotten" : "MemoryCommitted"
      : "MemoryFailed";
    await this.appendRecoveredEvent(type, {
      operationId: record.operationId,
      callId: record.callId,
      operation: record.operation,
      recordId: record.recordId ?? null,
      scope: record.scope,
      sourcePath: record.sourcePath,
      status: record.status,
      ...(record.reason ? { reason: record.reason } : {}),
      recovered: true,
    });
  }

  async ensureMutationTerminalEvent(record: WorkspaceMutationRecord): Promise<void> {
    if (record.status !== "committed" && record.status !== "failed" && record.status !== "denied" && record.status !== "reconciled" && record.status !== "reconciliation_required") return;
    const events = await this.readEvents();
    const terminalTypes: readonly LifecycleEventType[] = ["WorkspaceMutationCommitted", "WorkspaceMutationFailed", "WorkspaceMutationReconciled"];
    if (events.some((event) => terminalTypes.includes(event.type) && event.payload.mutationId === record.mutationId)) return;
    if (!events.some((event) => isWorkspaceMutationLifecycleEvent(event.type) && event.payload.mutationId === record.mutationId)) return;
    const type: LifecycleEventType = record.status === "committed"
      ? "WorkspaceMutationCommitted"
      : record.status === "reconciled"
        ? "WorkspaceMutationReconciled"
        : "WorkspaceMutationFailed";
    await this.appendEvent(type, {
      mutationId: record.mutationId,
      operation: record.operation,
      path: record.path,
      status: record.status,
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.afterHash ? { afterHash: record.afterHash } : {}),
      recovered: true,
    });
  }

  async commitTerminal(
    result: TurnResult,
    terminalType: LifecycleEventType,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const expectedType = terminalEventType(result.status);
    if (terminalType !== expectedType) {
      throw new ComputerNativeError(
        "persistence",
        `Turn '${this.turnId}' cannot commit '${terminalType}' for a '${result.status}' result.`,
      );
    }
    if (this.record.state !== result.status) assertTransition(this.record.state, result.status);
    await this.writeResult(result);
    await this.updateState(result.status);
    // Re-append through the idempotency validator even when a terminal event
    // already exists. An identical acknowledgement retry is safe; a changed
    // payload must fail closed instead of being silently ignored.
    await this.appendEvent(terminalType, payload);
  }
}

export function isNonTerminalState(state: TurnStatus): boolean {
  return NON_TERMINAL_STATES.includes(state);
}

export function isTerminalResult(value: unknown): value is TurnResult {
  return Boolean(value && typeof value === "object" && isTerminalStatus((value as TurnResult).status));
}
