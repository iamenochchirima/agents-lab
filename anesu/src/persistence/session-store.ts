import { randomUUID } from "node:crypto";
import { constants as fsConstants, type Dirent } from "node:fs";
import { lstat, open, readdir, rm, stat } from "node:fs/promises";
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
import { AnesuError } from "../runtime/errors.js";
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
import { assertComputerActionTransition, assertComputerRunEvent, assertComputerRunTransition, type ComputerActionRecord, type ComputerRunEventInput, type ComputerRunEventRecord, type ComputerRunRecord } from "../computer/records.js";
import { assertMemoryActionTransition, type MemoryActionRecord, type MemorySearchEvidence } from "../memory/contracts.js";
import { contextCompactionRevision, contextSourceRevision, type ContextSnapshot } from "../context/context.js";
import { emptyComputerRunRetentionResult, summarizeComputerRunEvent, type ComputerRunRetentionOptions, type ComputerRunRetentionResult, type ComputerRunSummary } from "../computer/inspection.js";

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
  /** Secrets known by the selected local provider; never write them to evidence. */
  readonly redactionSecrets?: readonly string[];
}

export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly state: "available" | "unavailable";
  readonly createdAt?: string;
  readonly lastActivityAt?: string;
  readonly lastMessage?: { readonly role: TranscriptMessage["role"]; readonly preview: string };
}

const MAX_SESSION_METADATA_BYTES = 8 * 1024;
const MAX_SESSION_PREVIEW_BYTES = 8 * 1024;
const MAX_SESSION_PREVIEW_CHARS = 180;

async function readSessionMetadata(filePath: string, expectedSessionId: string): Promise<SessionMetadata> {
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_SESSION_METADATA_BYTES) {
      throw new AnesuError("persistence", "Session metadata is not a bounded regular file.");
    }
    const value = JSON.parse(await handle.readFile("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AnesuError("persistence", "Session metadata is invalid.");
    }
    const metadata = value as Record<string, unknown>;
    if (metadata.schemaVersion !== 1
      || metadata.sessionId !== expectedSessionId
      || typeof metadata.createdAt !== "string"
      || !Number.isFinite(Date.parse(metadata.createdAt))
      || metadata.source !== "cli"
      || metadata.profileId !== "default") {
      throw new AnesuError("persistence", "Session metadata is invalid.");
    }
    return metadata as unknown as SessionMetadata;
  } finally {
    await handle.close();
  }
}

async function readLastSessionMessage(filePath: string, expectedSessionId: SessionId): Promise<SessionSummary["lastMessage"]> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0) return undefined;
    const length = Math.min(info.size, MAX_SESSION_PREVIEW_BYTES);
    const offset = info.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const tail = buffer.subarray(0, bytesRead).toString("utf8");
    const end = tail.endsWith("\n") ? tail.length - 1 : tail.length;
    const separator = tail.lastIndexOf("\n", end - 1);
    if (offset > 0 && separator < 0) return undefined;
    const line = tail.slice(separator + 1, end);
    if (line.length === 0) return undefined;
    const message = JSON.parse(line) as unknown;
    validateTranscriptMessage(message, expectedSessionId);
    return { role: message.role, preview: message.content.slice(0, MAX_SESSION_PREVIEW_CHARS) };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
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
    throw new AnesuError("persistence", `Terminal result status '${result.status}' does not match durable turn state '${currentState}'.`);
  }
}

function validateTurnRecord(record: unknown, sessionId: SessionId, directoryName?: string): asserts record is TurnRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new AnesuError("persistence", "A durable turn record is not an object.");
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
    throw new AnesuError("persistence", `Turn '${typeof turnId === "string" ? turnId : "unknown"}' has an invalid durable record.`);
  }
  safePathSegment(turnId, "Turn ID");
  if (directoryName !== undefined && turnId !== directoryName) {
    throw new AnesuError("persistence", `Turn '${turnId}' does not match its durable directory '${directoryName}'.`);
  }
}

function assertContextSnapshot(
  value: unknown,
  sessionId: SessionId,
  turnId: TurnRecord["turnId"],
  expectedProvider?: TurnRecord["provider"],
  expectedModel?: string,
): asserts value is ContextSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnesuError("persistence", `Turn '${turnId}' has an invalid context snapshot.`);
  const candidate = value as Record<string, unknown>;
  const budget = candidate.budget;
  if (candidate.schemaVersion !== 1
    || candidate.sessionId !== sessionId
    || candidate.turnId !== turnId
    || typeof candidate.snapshotId !== "string"
    || !Number.isSafeInteger(candidate.revision)
    || (candidate.revision as number) < 1
    || (candidate.previousSnapshotId !== null && typeof candidate.previousSnapshotId !== "string")
    || typeof candidate.provider !== "string"
    || (candidate.provider !== "deterministic" && candidate.provider !== "openrouter")
    || typeof candidate.model !== "string"
    || typeof candidate.requestHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(candidate.requestHash)
    || typeof candidate.sourceRevision !== "string"
    || !/^[a-f0-9]{64}$/u.test(candidate.sourceRevision)
    || (candidate.compactionRevision !== null && (typeof candidate.compactionRevision !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.compactionRevision)))
    || !Array.isArray(candidate.messages)
    || !Array.isArray(candidate.sources)
    || !budget
    || typeof budget !== "object"
    || Array.isArray(budget)
    || typeof (budget as Record<string, unknown>).maxRequestBytes !== "number"
    || typeof (budget as Record<string, unknown>).reservedOutputBytes !== "number"
    || typeof (budget as Record<string, unknown>).requestBytes !== "number"
    || typeof (budget as Record<string, unknown>).inputBytes !== "number"
    || typeof (budget as Record<string, unknown>).estimatedInputTokens !== "number"
    || typeof (budget as Record<string, unknown>).tokenEstimateBasis !== "string"
    || ((budget as Record<string, unknown>).tokenEstimateQuality !== "estimated" && (budget as Record<string, unknown>).tokenEstimateQuality !== "unknown")
    || (budget as Record<string, unknown>).contextWindowTokens !== null
    || typeof candidate.createdAt !== "string") {
    throw new AnesuError("persistence", `Turn '${turnId}' has an invalid context snapshot.`);
  }
  if (expectedProvider !== undefined && candidate.provider !== expectedProvider) {
    throw new AnesuError("persistence", `Context snapshot provider does not match the admitted provider '${expectedProvider}'.`);
  }
  if (expectedModel !== undefined && candidate.model !== expectedModel) {
    throw new AnesuError("persistence", `Context snapshot model does not match the admitted model '${expectedModel}'.`);
  }
  safePathSegment(candidate.snapshotId, "Context snapshot ID");
  if ((candidate.revision as number) === 1 && candidate.previousSnapshotId !== null) {
    throw new AnesuError("persistence", `Turn '${turnId}' has a first context revision with a predecessor.`);
  }
  if ((candidate.revision as number) > 1 && (candidate.previousSnapshotId === null || (candidate.previousSnapshotId as string).trim().length === 0)) {
    throw new AnesuError("persistence", `Turn '${turnId}' has a context revision without a predecessor.`);
  }
  if (candidate.previousSnapshotId !== null) safePathSegment(candidate.previousSnapshotId as string, "Previous context snapshot ID");
  const budgetRecord = budget as Record<string, unknown>;
  const maxRequestBytes = budgetRecord.maxRequestBytes as number;
  const reservedOutputBytes = budgetRecord.reservedOutputBytes as number;
  const requestBytes = budgetRecord.requestBytes as number;
  const inputBytes = budgetRecord.inputBytes as number;
  const estimatedInputTokens = budgetRecord.estimatedInputTokens as number;
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes <= 0
    || !Number.isInteger(reservedOutputBytes) || reservedOutputBytes < 0
    || !Number.isInteger(requestBytes) || requestBytes < 0
    || !Number.isInteger(inputBytes) || inputBytes < 0
    || !Number.isInteger(estimatedInputTokens) || estimatedInputTokens < 0) {
    throw new AnesuError("persistence", `Turn '${turnId}' has invalid context budget evidence.`);
  }
  const sourceIds = new Set<string>();
  const validSourceKinds = new Set(["system", "workspace-resource", "skills", "memory", "transcript", "prompt", "tools", "compaction"]);
  const validTrust = new Set(["system", "workspace", "user", "model-output"]);
  const validSourceStatuses = new Set(["selected", "truncated", "omitted"]);
  for (const [index, source] of (candidate.sources as unknown[]).entries()) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context source evidence at index ${index}.`);
    }
    const sourceRecord = source as Record<string, unknown>;
    const bytes = sourceRecord.bytes;
    const selectedBytes = sourceRecord.selectedBytes;
    if (typeof sourceRecord.id !== "string" || sourceRecord.id.trim().length === 0
      || sourceIds.has(sourceRecord.id)
      || typeof sourceRecord.kind !== "string" || !validSourceKinds.has(sourceRecord.kind)
      || typeof sourceRecord.trust !== "string" || !validTrust.has(sourceRecord.trust)
      || typeof sourceRecord.status !== "string" || !validSourceStatuses.has(sourceRecord.status)
      || !Number.isSafeInteger(bytes) || (bytes as number) < 0
      || !Number.isSafeInteger(selectedBytes) || (selectedBytes as number) < 0
      || (sourceRecord.status !== "omitted" && (typeof sourceRecord.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(sourceRecord.contentHash)))) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context source evidence at index ${index}.`);
    }
    if (sourceRecord.status === "omitted" && selectedBytes !== 0) {
      throw new AnesuError("persistence", `Turn '${turnId}' has selected bytes for an omitted context source.`);
    }
    sourceIds.add(sourceRecord.id);
  }
  const messageIds = new Set<string>();
  for (const [index, message] of (candidate.messages as unknown[]).entries()) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context message evidence at index ${index}.`);
    }
    const messageRecord = message as Record<string, unknown>;
    if (messageRecord.messageId !== `message:${index}`
      || messageIds.has(String(messageRecord.messageId))
      || (messageRecord.role !== "system" && messageRecord.role !== "user" && messageRecord.role !== "assistant" && messageRecord.role !== "tool")
      || typeof messageRecord.sourceId !== "string" || !sourceIds.has(messageRecord.sourceId)
      || !Number.isSafeInteger(messageRecord.bytes) || (messageRecord.bytes as number) < 0
      || typeof messageRecord.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(messageRecord.contentHash)) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context message evidence at index ${index}.`);
    }
    messageIds.add(String(messageRecord.messageId));
  }
  if (candidate.sourceRevision !== contextSourceRevision(candidate.sources as ContextSnapshot["sources"])) {
    throw new AnesuError("persistence", `Turn '${turnId}' has a context source revision that does not match its source evidence.`);
  }
  const compaction = candidate.compaction;
  if (compaction !== null) {
    if (!compaction || typeof compaction !== "object" || Array.isArray(compaction)) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context compaction evidence.`);
    }
    const compactionRecord = compaction as Record<string, unknown>;
    const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
    if (typeof compactionRecord.strategy !== "string"
      || !isStringArray(compactionRecord.removedMessageIds)
      || !isStringArray(compactionRecord.retainedMessageIds)
      || !isStringArray(compactionRecord.removedGroupIds)
      || !isStringArray(compactionRecord.retainedGroupIds)
      || (compactionRecord.reason !== "request-budget" && compactionRecord.reason !== "provider-overflow" && compactionRecord.reason !== "manual")) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context compaction evidence.`);
    }
    const beforeRequestBytes = compactionRecord.beforeRequestBytes;
    const afterRequestBytes = compactionRecord.afterRequestBytes;
    const validBudgetBytes = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const validBudgetEvidence = beforeRequestBytes === undefined && afterRequestBytes === undefined
      || validBudgetBytes(beforeRequestBytes) && validBudgetBytes(afterRequestBytes);
    if (!validBudgetEvidence) {
      throw new AnesuError("persistence", `Turn '${turnId}' has invalid context compaction budget evidence.`);
    }
    const removedMessages = new Set(compactionRecord.removedMessageIds as string[]);
    const retainedMessages = new Set(compactionRecord.retainedMessageIds as string[]);
    const removedGroups = new Set(compactionRecord.removedGroupIds as string[]);
    const retainedGroups = new Set(compactionRecord.retainedGroupIds as string[]);
    if (removedMessages.size !== (compactionRecord.removedMessageIds as string[]).length
      || retainedMessages.size !== (compactionRecord.retainedMessageIds as string[]).length
      || removedGroups.size !== (compactionRecord.removedGroupIds as string[]).length
      || retainedGroups.size !== (compactionRecord.retainedGroupIds as string[]).length
      || [...removedMessages].some((id) => retainedMessages.has(id))
      || [...removedGroups].some((id) => retainedGroups.has(id))) {
      throw new AnesuError("persistence", `Turn '${turnId}' has overlapping context compaction evidence.`);
    }
  }
  const normalizedCompaction = compaction as ContextSnapshot["compaction"];
  if (candidate.compactionRevision !== contextCompactionRevision(normalizedCompaction)) {
    throw new AnesuError("persistence", `Turn '${turnId}' has a context compaction revision that does not match its compaction evidence.`);
  }
}

function validateTurnResult(result: unknown, record: TurnRecord): asserts result is TurnResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AnesuError("persistence", `Turn '${record.turnId}' contains an invalid terminal result.`);
  }
  const candidate = result as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || !isTerminalStatus(candidate.status as TurnStatus)) {
    throw new AnesuError("persistence", `Turn '${record.turnId}' contains an invalid terminal result.`);
  }
  if (candidate.sessionId !== record.sessionId) {
    throw new AnesuError("persistence", `Terminal result does not belong to session '${record.sessionId}'.`);
  }
  if (candidate.turnId !== record.turnId) {
    throw new AnesuError("persistence", `Terminal result does not belong to turn '${record.turnId}'.`);
  }
  if (candidate.provider !== record.provider) {
    throw new AnesuError("persistence", `Terminal result provider does not match the admitted provider '${record.provider}'.`);
  }
  if (candidate.model !== record.model) {
    throw new AnesuError("persistence", `Terminal result model does not match the admitted model '${record.model}'.`);
  }
  if (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string") {
    throw new AnesuError("persistence", `Terminal result for turn '${record.turnId}' has an invalid correlation.`);
  }
  assertRecordCorrelation(record.correlationId ?? asCorrelationId(record.turnId), candidate.correlationId as CorrelationId | undefined, "Terminal result");
}

function validateTranscriptMessage(message: unknown, expectedSessionId: SessionId): asserts message is TranscriptMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new AnesuError("persistence", "A durable transcript message is not an object.");
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
    throw new AnesuError("persistence", "A durable transcript message has an invalid record.");
  }
  if (candidate.sessionId !== expectedSessionId) {
    throw new AnesuError("persistence", `Transcript message '${candidate.messageId}' does not belong to session '${expectedSessionId}'.`);
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
    throw new AnesuError("persistence", `TurnStarted provider '${String(payload.provider)}' does not match admitted provider '${record.provider}'.`);
  }
  if (payload.model !== undefined && payload.model !== record.model) {
    throw new AnesuError("persistence", `TurnStarted model '${String(payload.model)}' does not match admitted model '${record.model}'.`);
  }
}

function isTerminalLifecycleEvent(type: LifecycleEventType): boolean {
  return type === "TurnCompleted" || type === "TurnFailed" || type === "TurnCancelled" || type === "TurnInterrupted";
}

const LIFECYCLE_EVENT_TYPES: ReadonlySet<LifecycleEventType> = new Set([
  "TurnStarted",
  "ContextPrepared",
  "ContextCompacted",
  "ContextRoundCompacted",
  "ContextPressure",
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
  "ComputerPrepared",
  "ComputerApprovalDecided",
  "ComputerStarted",
  "ComputerCompleted",
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

const CONTEXT_LIFECYCLE_EVENTS: ReadonlySet<LifecycleEventType> = new Set([
  "ContextPrepared",
  "ContextCompacted",
  "ContextRoundCompacted",
  "ContextPressure",
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
  ComputerPrepared: "actionId",
  ComputerApprovalDecided: "actionId",
  ComputerStarted: "actionId",
  ComputerCompleted: "actionId",
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
  ComputerPrepared: [],
  ComputerApprovalDecided: ["ComputerPrepared"],
  ComputerStarted: ["ComputerApprovalDecided"],
  // Recovery and denied approvals can close a native action without dispatching
  // input; a started action may also complete without a separate verification
  // event when the adapter returns a terminal result.
  ComputerCompleted: ["ComputerPrepared", "ComputerApprovalDecided", "ComputerStarted"],
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
    throw new AnesuError("persistence", `${type} requires a non-empty ${identityField ?? "action"} identity.`);
  }
  if (!identityField) throw new AnesuError("persistence", `${type} has no configured action identity field.`);
  const related = existing.filter((event) => {
    const eventIdentityField = ACTION_LIFECYCLE_IDENTITY_FIELDS[event.type];
    if (eventIdentityField !== identityField) return false;
    return event.payload[identityField] === identity;
  });
  const previous = related.at(-1)?.type;
  const allowedPrevious = ACTION_LIFECYCLE_PREVIOUS[type] ?? [];
  if (previous === undefined) {
    const recoveredTerminal = payload.recovered === true
      && (type === "ProcessCompleted" || type === "BrowserCompleted" || type === "ComputerCompleted" || type === "MemoryCommitted" || type === "MemoryForgotten" || type === "MemoryFailed");
    if (recoveredTerminal) return;
    if (allowedPrevious.length > 0) {
      throw new AnesuError("persistence", `${type} for '${identity}' cannot be recorded before ${allowedPrevious.join(" or ")}.`);
    }
    return;
  }
  if (!allowedPrevious.includes(previous)) {
    throw new AnesuError("persistence", `${type} for '${identity}' cannot follow ${previous}.`);
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
    throw new AnesuError("persistence", `${type} requires a mutation identity.`);
  }
  const related = existing.filter((event) => isWorkspaceMutationLifecycleEvent(event.type) && event.payload.mutationId === mutationId);
  const previous = related.at(-1)?.type;
  if (type === "WorkspaceMutationProposed") {
    if (previous !== undefined) throw new AnesuError("persistence", `Workspace mutation '${mutationId}' was proposed more than once.`);
    return;
  }
  if (previous === undefined) {
    throw new AnesuError("persistence", `Workspace mutation '${mutationId}' cannot record '${type}' before its proposal.`);
  }
  if (previous === "WorkspaceMutationCommitted" || previous === "WorkspaceMutationFailed" || previous === "WorkspaceMutationReconciled") {
    throw new AnesuError("persistence", `Workspace mutation '${mutationId}' cannot record '${type}' after its terminal lifecycle event.`);
  }
  if (type === "WorkspaceMutationApprovalDecided") {
    if (previous !== "WorkspaceMutationProposed") throw new AnesuError("persistence", `Workspace mutation '${mutationId}' approval must follow its proposal.`);
    return;
  }
  if (type === "WorkspaceMutationApplying") {
    if (previous !== "WorkspaceMutationApprovalDecided" || payload.decision !== "allow-once") {
      throw new AnesuError("persistence", `Workspace mutation '${mutationId}' cannot start before an allow-once approval.`);
    }
    return;
  }
  if (type === "WorkspaceMutationProgress") {
    if (previous !== "WorkspaceMutationApplying" && previous !== "WorkspaceMutationProgress") {
      throw new AnesuError("persistence", `Workspace mutation '${mutationId}' progress must follow application start.`);
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
    throw new AnesuError("persistence", `Workspace mutation '${mutationId}' cannot finish before application starts.`);
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
    throw new AnesuError("persistence", `${type} cannot be recorded before TurnStarted.`);
  }
  if (type === "ModelAttemptCompleted" || type === "ModelRetryScheduled" || type === "ModelRequested") {
    const attemptId = payload.attemptId;
    if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
      throw new AnesuError("persistence", `${type} requires a non-empty attemptId.`);
    }
    if (type === "ModelAttemptCompleted") {
      const requested = existing.some((event) => event.type === "ModelRequested" && event.payload.attemptId === attemptId);
      if (!requested) throw new AnesuError("persistence", "A model attempt cannot complete before its request is recorded.");
    }
    if (type === "ModelRetryScheduled") {
      const completed = existing.filter((event) => event.type === "ModelAttemptCompleted").at(-1);
      if (!completed || completed.payload.attemptId !== attemptId) {
        throw new AnesuError("persistence", "A model retry cannot be scheduled before the failed attempt is recorded.");
      }
      if (completed.payload.status === "completed") {
        throw new AnesuError("persistence", "A model retry can only follow a failed attempt.");
      }
    }
  }
  if (type === "ModelCompleted") {
    const completed = existing.filter((event) => event.type === "ModelAttemptCompleted").at(-1);
    if (!completed) {
      throw new AnesuError("persistence", "A model cannot complete before at least one model attempt is recorded.");
    }
    if (completed.payload.status !== "completed") {
      throw new AnesuError("persistence", "A model cannot complete because the final model attempt did not complete successfully.");
    }
  }
}

function assertContextLifecycleEventOrder(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (!CONTEXT_LIFECYCLE_EVENTS.has(type)) return;
  const snapshotId = payload.snapshotId;
  if (typeof snapshotId !== "string" || snapshotId.trim().length === 0) {
    throw new AnesuError("persistence", `${type} requires a non-empty snapshotId.`);
  }
  if (!existing.some((event) => event.type === "TurnStarted")) {
    throw new AnesuError("persistence", `${type} cannot be recorded before TurnStarted.`);
  }
  if (type !== "ContextPrepared" && !existing.some((event) => event.type === "ContextPrepared" && event.payload.snapshotId === snapshotId)) {
    throw new AnesuError("persistence", `${type} for '${snapshotId}' cannot be recorded before ContextPrepared.`);
  }
  if (type === "ContextRoundCompacted") {
    const isStringArray = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
    if (!Number.isSafeInteger(payload.round) || (payload.round as number) < 1
      || payload.strategy !== "deterministic-runtime-round-truncation"
      || !isStringArray(payload.removedGroupIds)
      || !isStringArray(payload.retainedGroupIds)
      || !Number.isSafeInteger(payload.removedMessageCount) || (payload.removedMessageCount as number) < 1
      || !Number.isSafeInteger(payload.requestBytes) || (payload.requestBytes as number) < 0
      || !Number.isSafeInteger(payload.maxRequestBytes) || (payload.maxRequestBytes as number) <= 0) {
      throw new AnesuError("persistence", "ContextRoundCompacted has invalid bounded projection evidence.");
    }
  }
  if (type === "ContextPressure" && (payload.pressure !== "compaction_due" && payload.pressure !== "exhausted" && payload.pressure !== "unknown")) {
    throw new AnesuError("persistence", "ContextPressure requires a non-normal pressure state.");
  }
}

function assertLifecycleEventOrder(existing: readonly LifecycleEvent[], type: LifecycleEventType, payload: Readonly<Record<string, unknown>>): void {
  assertContextLifecycleEventOrder(existing, type, payload);
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
      throw new AnesuError("persistence", "A durable lifecycle event has an invalid record.");
    }
    if (event.schemaVersion !== 1 || typeof event.eventId !== "string" || event.eventId.trim().length === 0) {
      throw new AnesuError("persistence", "A durable lifecycle event has an invalid record identity.");
    }
    if (!LIFECYCLE_EVENT_TYPES.has(event.type)) {
      throw new AnesuError("persistence", `Lifecycle event '${event.eventId}' has an unknown event type.`);
    }
    if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
      throw new AnesuError("persistence", `Lifecycle event '${event.eventId}' has an invalid sequence.`);
    }
    if (expectedSessionId !== undefined && event.sessionId !== expectedSessionId) {
      throw new AnesuError("persistence", `Lifecycle event '${event.eventId}' does not belong to session '${expectedSessionId}'.`);
    }
    if (expectedTurnId !== undefined && event.turnId !== expectedTurnId) {
      throw new AnesuError("persistence", `Lifecycle event '${event.eventId}' does not belong to turn '${expectedTurnId}'.`);
    }
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw new AnesuError("persistence", `Lifecycle event '${event.eventId}' has an invalid payload.`);
    }
    if (prefix.some((candidate) => isTerminalLifecycleEvent(candidate.type))) {
      throw new AnesuError("persistence", `Lifecycle event '${event.type}' appears after a terminal turn event.`);
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
    throw new AnesuError("persistence", `${type} evidence was repeated with a different payload for the same identity.`);
  }
  return candidate;
}

function findIdempotentContextEvent(
  existing: readonly LifecycleEvent[],
  type: LifecycleEventType,
  payload: Readonly<Record<string, unknown>>,
): LifecycleEvent | undefined {
  if (!CONTEXT_LIFECYCLE_EVENTS.has(type)) return undefined;
  const snapshotId = payload.snapshotId;
  if (typeof snapshotId !== "string" || snapshotId.length === 0) return undefined;
  const candidate = existing.find((event) => event.type === type
    && event.payload.snapshotId === snapshotId
    && (type !== "ContextRoundCompacted" || event.payload.round === payload.round));
  if (!candidate) return undefined;
  const normalizedPayload = redactRecord(payload);
  if (stableStringify(candidate.payload) !== stableStringify(normalizedPayload)) {
    throw new AnesuError("persistence", `${type} evidence was repeated with a different payload for the same snapshot identity.`);
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
    throw new AnesuError("persistence", `${type} evidence was repeated with a different payload for the same identity.`);
  }
  return candidate;
}

function validateRound(round: RoundEvidence, sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  const validPhase = round.phase === "model_requested"
    || round.phase === "model_completed"
    || round.phase === "tool_requested"
    || round.phase === "tool_completed";
  if (round.schemaVersion !== 1 || round.sessionId !== sessionId || round.turnId !== turnId || !Number.isInteger(round.round) || round.round < 1 || !validPhase) {
    throw new AnesuError("persistence", `Turn '${turnId}' contains an invalid round record. Repair it before continuing.`);
  }
  if ((round.phase === "tool_requested" || round.phase === "tool_completed")
    && (typeof round.callId !== "string" || round.callId.trim().length === 0 || typeof round.toolName !== "string" || round.toolName.trim().length === 0)) {
    throw new AnesuError("persistence", `Turn '${turnId}' contains a tool round without call identity. Repair it before continuing.`);
  }
}

function validateRoundOrder(rounds: readonly RoundEvidence[], sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  let previous: RoundEvidence | undefined;
  const callIds = new Set<string>();
  for (const [index, round] of rounds.entries()) {
    validateRound(round, sessionId, turnId);
    if (index === 0 && (round.round !== 1 || round.phase !== "model_requested")) {
      throw new AnesuError("persistence", `Turn '${turnId}' must begin with model request evidence for round 1.`);
    }
    if (previous) {
      if (round.round < previous.round || round.round > previous.round + 1) {
        throw new AnesuError("persistence", `Turn '${turnId}' contains out-of-order round evidence. Repair it before continuing.`);
      }
      if (round.round === previous.round + 1 && round.phase !== "model_requested") {
        throw new AnesuError("persistence", `Turn '${turnId}' starts a new round with an invalid phase. Repair it before continuing.`);
      }
      if (round.round === previous.round) {
        const validSameRoundTransition =
          (previous.phase === "model_requested" && round.phase === "model_completed") ||
          (previous.phase === "model_completed" && round.phase === "tool_requested") ||
          (previous.phase === "tool_requested" && round.phase === "tool_completed") ||
          (previous.phase === "tool_completed" && round.phase === "tool_requested");
        if (!validSameRoundTransition) {
          throw new AnesuError("persistence", `Turn '${turnId}' contains out-of-order phase evidence. Repair it before continuing.`);
        }
        if (previous.phase === "tool_requested" && round.phase === "tool_completed"
          && (round.callId !== previous.callId || round.toolName !== previous.toolName)) {
          throw new AnesuError("persistence", `Turn '${turnId}' contains tool completion evidence that does not match its request.`);
        }
      }
    }
    if (round.callId && (round.phase === "tool_requested" || round.phase === "tool_completed")) {
      if (callIds.has(round.callId) && round.phase === "tool_requested") {
        throw new AnesuError("persistence", `Turn '${turnId}' contains duplicate tool call '${round.callId}'. Repair it before continuing.`);
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
    throw new AnesuError("persistence", `${kind} correlation '${actual}' does not belong to correlation '${expected}'.`);
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
    throw new AnesuError("persistence", `${kind} has an invalid durable record.`);
  }
  const candidate = record as Record<string, unknown>;
  const identity = candidate[identityField];
  if (candidate.schemaVersion !== 1 || typeof identity !== "string" || identity.trim().length === 0) {
    throw new AnesuError("persistence", `${kind} '${identity}' has an invalid durable identity.`);
  }
  if (candidate.turnId !== expectedTurnId) {
    throw new AnesuError("persistence", `${kind} '${identity}' does not belong to turn '${expectedTurnId}'.`);
  }
  if (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string") {
    throw new AnesuError("persistence", `${kind} '${identity}' has an invalid correlation.`);
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
    throw new AnesuError("persistence", `Process execution '${String(candidate.executionId)}' does not belong to session '${expectedSessionId}'.`);
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
  const permissionGrant = candidate.permissionGrant as Record<string, unknown> | undefined;
  const validPermissionGrant = permissionGrant === undefined
    || (permissionGrant !== null
      && typeof permissionGrant === "object"
      && typeof permissionGrant.id === "string"
      && /^(?:conversation|local)_[a-f0-9]{32}$/u.test(permissionGrant.id)
      && (permissionGrant.scope === "conversation" || permissionGrant.scope === "local")
      && permissionGrant.id.startsWith(`${permissionGrant.scope}_`));
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
    || !validPermissionGrant
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
    throw new AnesuError("persistence", `Process execution '${String(candidate.executionId)}' has an invalid durable record.`);
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
    || candidate.action === "select"
    || candidate.action === "scroll"
    || candidate.action === "upload"
    || candidate.action === "download"
    || candidate.action === "pointer"
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
    || candidate.errorCode === "browser-action-refused"
    || candidate.errorCode === "browser-ambiguous"
    || candidate.errorCode === "browser-resource-limit"
    || candidate.errorCode === "artifact-violation"
    || candidate.errorCode === "adapter-failure"
    || candidate.errorCode === "browser-approval-denied"
    || candidate.errorCode === "browser-approval-unavailable";
  const validEffect = candidate.effect === undefined
    || candidate.effect === "confirmed"
    || candidate.effect === "partial"
    || candidate.effect === "unverifiable"
    || candidate.effect === "suspected_noop"
    || candidate.effect === "refused";
  const validRoute = candidate.route === undefined
    || candidate.route === "accessibility"
    || candidate.route === "synthetic_events"
    || candidate.route === "global_input"
    || candidate.route === "system_api"
    || candidate.route === "dom"
    || candidate.route === "trusted_input"
    || candidate.route === "trusted"
    || candidate.route === "dom_event";
  const delivery = candidate.delivery as Record<string, unknown> | undefined;
  const validDelivery = candidate.delivery === undefined
    || (delivery !== null && typeof delivery === "object"
      && (delivery.mode === "background" || delivery.mode === "foreground" || delivery.mode === "not_applicable" || delivery.mode === "unknown")
      && (delivery.deliveredCount === undefined || (Number.isSafeInteger(delivery.deliveredCount) && (delivery.deliveredCount as number) >= 0)));
  const escalation = candidate.escalation as Record<string, unknown> | undefined;
  const validEscalation = candidate.escalation === undefined
    || (escalation !== null && typeof escalation === "object"
      && (escalation.target === "pixel" || escalation.target === "foreground" || escalation.target === "page" || escalation.target === "session")
      && (escalation.reason === "route_unavailable" || escalation.reason === "delivery_failed" || escalation.reason === "effect_unconfirmed" || escalation.reason === "suspected_noop" || escalation.reason === "permission_required"));
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
  const validTaskActions = (value: unknown): boolean => value === undefined
    || (Array.isArray(value) && value.length <= 16 && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 32));
  const validScrollDirection = candidate.direction === undefined
    || candidate.direction === "up"
    || candidate.direction === "down"
    || candidate.direction === "left"
    || candidate.direction === "right";
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.trim().length === 0
    || typeof candidate.callId !== "string" || candidate.callId.trim().length === 0
    || typeof candidate.tabId !== "string" || candidate.tabId.trim().length === 0
    || !validAction
    || (candidate.taskId !== undefined && (typeof candidate.taskId !== "string" || candidate.taskId.trim().length === 0 || candidate.taskId.length > 128))
    || (candidate.grantHash !== undefined && (typeof candidate.grantHash !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.grantHash)))
    || !validTaskActions(candidate.allowedTaskActions)
    || typeof candidate.reference !== "string" || candidate.reference.trim().length === 0
    || typeof candidate.documentId !== "string" || candidate.documentId.trim().length === 0
    || (candidate.text !== undefined && typeof candidate.text !== "string")
    || (candidate.key !== undefined && typeof candidate.key !== "string")
    || (candidate.value !== undefined && (typeof candidate.value !== "string" || candidate.value.length === 0 || candidate.value.length > 256))
    || (candidate.action === "select" && (typeof candidate.value !== "string" || candidate.value.length === 0 || candidate.value.length > 256))
    || !validScrollDirection
    || (candidate.amount !== undefined && (!Number.isSafeInteger(candidate.amount) || (candidate.amount as number) < 1 || (candidate.amount as number) > 2_000))
    || (candidate.action === "scroll" && (!validScrollDirection || !Number.isSafeInteger(candidate.amount) || (candidate.amount as number) < 1 || (candidate.amount as number) > 2_000))
    || (candidate.path !== undefined && (typeof candidate.path !== "string" || candidate.path.trim().length === 0))
    || (candidate.maxBytes !== undefined && !validNonNegativeInteger(candidate.maxBytes))
    || typeof candidate.actionHash !== "string" || candidate.actionHash.trim().length === 0
    || (candidate.approvalTimeoutMs !== undefined && !validPositiveInteger(candidate.approvalTimeoutMs))
    || !validStatus
    || (candidate.decision !== undefined && candidate.decision !== "allow-once" && candidate.decision !== "deny" && candidate.decision !== "unavailable")
    || (candidate.summary !== undefined && typeof candidate.summary !== "string")
    || !validEffect
    || !validRoute
    || !validDelivery
    || !validEscalation
    || (candidate.errorCode !== undefined && !validErrorCode)
    || (candidate.underlyingErrorCode !== undefined && !validErrorCode)
    || (candidate.cuaCode !== undefined && (typeof candidate.cuaCode !== "string" || candidate.cuaCode.length === 0 || candidate.cuaCode.length > 128))
    || (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== "string")
    || !validDialog
    || (candidate.dialogDecision !== undefined && candidate.dialogDecision !== "accept" && candidate.dialogDecision !== "dismiss")
    || (candidate.cancellationConfirmed !== undefined && typeof candidate.cancellationConfirmed !== "boolean")
    || !validDiagnostic
    || (candidate.startedAt !== undefined && typeof candidate.startedAt !== "string")
    || (candidate.finishedAt !== undefined && typeof candidate.finishedAt !== "string")
    || typeof candidate.recordedAt !== "string" || candidate.recordedAt.trim().length === 0
    || (candidate.status === "running" && (typeof candidate.startedAt !== "string" || candidate.startedAt.trim().length === 0))) {
    throw new AnesuError("persistence", `Browser action '${String(candidate.actionId)}' has an invalid durable record.`);
  }
}

function assertComputerActionRecord(
  record: unknown,
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is ComputerActionRecord {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Computer action", "actionId");
  const candidate = record as Record<string, unknown>;
  const validNonEmptyString = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
  const validCoordinate = (value: unknown): boolean => value === undefined || (typeof value === "number" && Number.isFinite(value));
  const validStatus = candidate.status === "prepared"
    || candidate.status === "approved"
    || candidate.status === "running"
    || candidate.status === "completed"
    || candidate.status === "failed"
    || candidate.status === "cancelled"
    || candidate.status === "ambiguous";
  const validOperation = candidate.operation === "click"
    || candidate.operation === "move"
    || candidate.operation === "type"
    || candidate.operation === "press"
    || candidate.operation === "scroll"
    || candidate.operation === "drag";
  const validDirection = candidate.direction === undefined
    || candidate.direction === "up"
    || candidate.direction === "down"
    || candidate.direction === "left"
    || candidate.direction === "right";
  const validErrorCode = candidate.errorCode === undefined
    || candidate.errorCode === "computer-approval-denied"
    || candidate.errorCode === "computer-approval-unavailable"
    || candidate.errorCode === "computer-ambiguous"
    || candidate.errorCode === "computer-blocked"
    || candidate.errorCode === "computer-cancelled"
    || candidate.errorCode === "computer-decision"
    || candidate.errorCode === "computer-environment"
    || candidate.errorCode === "computer-verification";
  const validModifiers = candidate.modifiers === undefined
    || (Array.isArray(candidate.modifiers)
      && candidate.modifiers.length <= 8
      && candidate.modifiers.every((value) => validNonEmptyString(value) && (value as string).length <= 32));
  const validTaskActions = candidate.allowedTaskActions === undefined
    || (Array.isArray(candidate.allowedTaskActions) && candidate.allowedTaskActions.length <= 16 && candidate.allowedTaskActions.every((value) => validNonEmptyString(value) && (value as string).length <= 32));
  const validPositiveInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0;
  if (candidate.environment !== "ubuntu-x11-cua"
    || !validNonEmptyString(candidate.callId)
    || !validNonEmptyString(candidate.sessionId)
    || !validNonEmptyString(candidate.displayId)
    || !validOperation
    || (candidate.taskId !== undefined && !validNonEmptyString(candidate.taskId))
    || (candidate.grantHash !== undefined && (typeof candidate.grantHash !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.grantHash)))
    || !validTaskActions
    || !validNonEmptyString(candidate.observationId)
    || !Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 0
    || !validCoordinate(candidate.x) || !validCoordinate(candidate.y)
    || !validCoordinate(candidate.endX) || !validCoordinate(candidate.endY)
    || (candidate.textLength !== undefined && (!validPositiveInteger(candidate.textLength) || (candidate.textLength as number) > 1_024))
    || (candidate.textPreview !== undefined && (typeof candidate.textPreview !== "string" || candidate.textPreview.length > 160))
    || (candidate.key !== undefined && !validNonEmptyString(candidate.key))
    || !validModifiers
    || !validDirection
    || (candidate.amount !== undefined && (!validPositiveInteger(candidate.amount) || (candidate.amount as number) > 100))
    || (candidate.targetLabel !== undefined && (typeof candidate.targetLabel !== "string" || candidate.targetLabel.trim().length === 0 || candidate.targetLabel.length > 512))
    || (candidate.targetRole !== undefined && (typeof candidate.targetRole !== "string" || candidate.targetRole.trim().length === 0 || candidate.targetRole.length > 64))
    || (candidate.targetSource !== undefined && candidate.targetSource !== "accessibility" && candidate.targetSource !== "focused" && candidate.targetSource !== "screen")
    || (candidate.approvalTimeoutMs !== undefined && !validPositiveInteger(candidate.approvalTimeoutMs))
    || !validStatus
    || (candidate.decision !== undefined && candidate.decision !== "allow-once" && candidate.decision !== "deny" && candidate.decision !== "unavailable")
    || (candidate.summary !== undefined && typeof candidate.summary !== "string")
    || !validErrorCode
    || (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== "string")
    || (candidate.startedAt !== undefined && !validNonEmptyString(candidate.startedAt))
    || (candidate.finishedAt !== undefined && !validNonEmptyString(candidate.finishedAt))
    || !validNonEmptyString(candidate.recordedAt)
    || (candidate.status === "running" && !validNonEmptyString(candidate.startedAt))) {
    throw new AnesuError("persistence", `Computer action '${String(candidate.actionId)}' has an invalid durable record.`);
  }
}

function assertComputerRunRecord(
  record: unknown,
  expectedSessionId: SessionMetadata["sessionId"],
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is ComputerRunRecord {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Computer run", "runId");
  const candidate = record as Record<string, unknown>;
  const validString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const validStatus = candidate.status === "running"
    || candidate.status === "completed"
    || candidate.status === "failed"
    || candidate.status === "cancelled"
    || candidate.status === "outcome-unknown";
  const validOutcome = candidate.outcome === undefined
    || candidate.outcome === "completed"
    || candidate.outcome === "clarification-required"
    || candidate.outcome === "abstained"
    || candidate.outcome === "failed"
    || candidate.outcome === "cancelled"
    || candidate.outcome === "outcome-unknown"
    || candidate.outcome === "action-limit";
  const validErrorCode = candidate.errorCode === undefined
    || candidate.errorCode === "computer-disabled"
    || candidate.errorCode === "computer-no-candidate"
    || candidate.errorCode === "computer-confidence-abstention"
    || candidate.errorCode === "computer-blocked"
    || candidate.errorCode === "computer-disagreement"
    || candidate.errorCode === "computer-verification"
    || candidate.errorCode === "computer-decision"
    || candidate.errorCode === "computer-malformed-response"
    || candidate.errorCode === "computer-provider-timeout"
    || candidate.errorCode === "computer-driver-failure"
    || candidate.errorCode === "computer-display-unavailable"
    || candidate.errorCode === "computer-stale-observation"
    || candidate.errorCode === "computer-action-limit"
    || candidate.errorCode === "computer-surface-ambiguous"
    || candidate.errorCode === "computer-surface-unavailable"
    || candidate.errorCode === "computer-task-invalid"
    || candidate.errorCode === "computer-strategy-unavailable"
    || candidate.errorCode === "computer-approval-denied"
    || candidate.errorCode === "computer-approval-unavailable"
    || candidate.errorCode === "computer-cancelled"
    || candidate.errorCode === "computer-environment";
  const validStrategy = candidate.strategy === "traditional" || candidate.strategy === "typesafe" || candidate.strategy === "compare";
  const validOrigins = candidate.allowedOrigins === undefined
    || (Array.isArray(candidate.allowedOrigins) && candidate.allowedOrigins.length <= 32 && candidate.allowedOrigins.every((value) => validString(value) && value.length <= 512));
  const validTypeSafeModel = candidate.typeSafeModel === undefined || (() => {
    const raw = candidate.typeSafeModel;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const model = raw as Record<string, unknown>;
    return typeof model.requestedModel === "string"
      && model.requestedModel.length > 0
      && model.requestedModel.length <= 128
      && typeof model.resolvedModel === "string"
      && model.resolvedModel.length > 0
      && model.resolvedModel.length <= 128;
  })();
  if (candidate.sessionId !== expectedSessionId
    || !validString(candidate.callId)
    || (candidate.environment !== "browser" && candidate.environment !== "ubuntu-x11-cua")
    || !validStrategy
    || !validString(candidate.goal) || candidate.goal.length > 1_000
    || (candidate.maxActions !== undefined && (!Number.isSafeInteger(candidate.maxActions) || (candidate.maxActions as number) <= 0))
    || (candidate.taskId !== undefined && !validString(candidate.taskId))
    || (candidate.grantHash !== undefined && (typeof candidate.grantHash !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.grantHash)))
    || (candidate.taskSurface !== undefined && candidate.taskSurface !== "browser" && candidate.taskSurface !== "native")
    || !validOrigins
    || (candidate.inputRoute !== undefined && candidate.inputRoute !== "trusted" && candidate.inputRoute !== "dom_event")
    || (candidate.taskExpiresAtMs !== undefined && (!Number.isSafeInteger(candidate.taskExpiresAtMs) || (candidate.taskExpiresAtMs as number) <= 0))
    || !validTypeSafeModel
    || !validStatus
    || !validOutcome
    || !validErrorCode
    || (candidate.summary !== undefined && (typeof candidate.summary !== "string" || candidate.summary.length > 2_000))
    || !validString(candidate.startedAt)
    || (candidate.finishedAt !== undefined && !validString(candidate.finishedAt))
    || !validString(candidate.recordedAt)) {
    throw new AnesuError("persistence", `Computer run '${String(candidate.runId)}' has an invalid durable record.`);
  }
  if (candidate.status === "running" && candidate.finishedAt !== undefined) {
    throw new AnesuError("persistence", `Computer run '${String(candidate.runId)}' cannot be running after it has finished.`);
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
    throw new AnesuError("persistence", `Memory action '${String(candidate.operationId)}' has an invalid durable record.`);
  }
  assertRecordCorrelation(expectedCorrelationId, candidate.correlationId as CorrelationId | undefined, "Memory action");
}

function assertMemorySearchEvidence(
  record: unknown,
  expectedSessionId: SessionMetadata["sessionId"],
  expectedTurnId: TurnRecord["turnId"],
  expectedCorrelationId: CorrelationId,
): asserts record is MemorySearchEvidence {
  assertTurnBoundRecord(record, expectedTurnId, expectedCorrelationId, "Memory search", "searchId");
  const candidate = record as Record<string, unknown>;
  const validNonEmptyString = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
  const validScope = (value: unknown): boolean => value === "user" || value === "workspace" || value === "daily";
  const resultIds = candidate.resultIds;
  const scopes = candidate.scopes;
  if (candidate.sessionId !== expectedSessionId
    || !validNonEmptyString(candidate.callId)
    || !validNonEmptyString(candidate.queryHash)
    || (scopes !== undefined && (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((value) => !validScope(value))))
    || !Number.isSafeInteger(candidate.maxResults) || (candidate.maxResults as number) <= 0
    || !Array.isArray(resultIds) || resultIds.some((value) => !validNonEmptyString(value))
    || !Number.isSafeInteger(candidate.resultCount) || (candidate.resultCount as number) < 0
    || candidate.resultCount !== resultIds.length
    || (candidate.resultCount as number) > (candidate.maxResults as number)
    || typeof candidate.truncated !== "boolean"
    || !validNonEmptyString(candidate.recordedAt)) {
    throw new AnesuError("persistence", `Memory search '${String(candidate.searchId)}' has an invalid durable record.`);
  }
  assertRecordCorrelation(expectedCorrelationId, candidate.correlationId as CorrelationId | undefined, "Memory search");
}

function assertWorkspaceMutationRecord(
  record: unknown,
  expectedCorrelationId: CorrelationId,
): asserts record is WorkspaceMutationRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new AnesuError("persistence", "Workspace mutation has an invalid durable record.");
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
    throw new AnesuError("persistence", `Workspace mutation '${String(candidate.mutationId)}' has an invalid durable record.`);
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
    throw new AnesuError("persistence", `Browser artifact '${String(candidate.artifactId)}' has an invalid durable record.`);
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
        throw new AnesuError("persistence", `Memory action '${record.operationId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
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
    private readonly redactionSecrets: readonly string[] = [],
  ) {}

  static async open(stateDir: string, requestedSessionId?: string, options: SessionStoreOptions = {}): Promise<SessionStore> {
    await ensureDirectory(path.join(stateDir, "sessions"));
    const selectedId = requestedSessionId ? safePathSegment(requestedSessionId, "Session ID") : sessionId();
    const sessionDirectory = path.join(stateDir, "sessions", selectedId);
    const metadataPath = path.join(sessionDirectory, "session.json");
    try {
      const metadata = await readJson<SessionMetadata>(metadataPath);
      if (metadata.sessionId !== selectedId || metadata.schemaVersion !== 1) {
        throw new AnesuError("persistence", "The session metadata is invalid.");
      }
      return new SessionStore(stateDir, sessionDirectory, metadata, options.writeHooks, options.redactionSecrets ?? []);
    } catch (error) {
      const metadataExists = await stat(metadataPath).then(() => true).catch(() => false);
      if (metadataExists || (error instanceof AnesuError && !error.message.startsWith("Could not read"))) throw error;
      if (requestedSessionId) throw new AnesuError("session-not-found", `Session '${requestedSessionId}' was not found.`);
      const metadata: SessionMetadata = {
        schemaVersion: 1,
        sessionId: asSessionId(selectedId),
        createdAt: now(),
        source: "cli",
        profileId: "default",
      };
      await ensureDirectory(path.join(sessionDirectory, "turns"));
      const store = new SessionStore(stateDir, sessionDirectory, metadata, options.writeHooks, options.redactionSecrets ?? []);
      await store.replaceJson(metadataPath, metadata);
      return store;
    }
  }

  static async listRecentSessions(stateDir: string, limit = 20): Promise<readonly SessionSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AnesuError("invalid-input", "Session list limit must be an integer between 1 and 100.");
    }
    const sessionsDirectory = path.join(stateDir, "sessions");
    let entries: Dirent[];
    try {
      const directoryInfo = await lstat(sessionsDirectory);
      if (!directoryInfo.isDirectory()) {
        throw new AnesuError("persistence", "The sessions path is not a directory.");
      }
      entries = await readdir(sessionsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof AnesuError) throw error;
      throw new AnesuError("persistence", "Sessions cannot be listed.", { cause: error });
    }

    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let selectedId: string;
      try {
        selectedId = safePathSegment(entry.name, "Session ID");
      } catch {
        continue;
      }
      const sessionDirectory = path.join(sessionsDirectory, selectedId);
      try {
        const sessionInfo = await lstat(sessionDirectory);
        if (!sessionInfo.isDirectory()) continue;
      } catch {
        continue;
      }

      let metadata: SessionMetadata;
      try {
        metadata = await readSessionMetadata(path.join(sessionDirectory, "session.json"), selectedId);
      } catch {
        summaries.push({ sessionId: asSessionId(selectedId), state: "unavailable" });
        continue;
      }

      const createdAtMs = Date.parse(metadata.createdAt);
      let lastActivityAtMs = createdAtMs;
      let lastMessage: SessionSummary["lastMessage"];
      try {
        const transcriptPath = path.join(sessionDirectory, "transcript.jsonl");
        const transcriptInfo = await lstat(transcriptPath);
        if (transcriptInfo.isFile()) {
          lastActivityAtMs = Math.max(createdAtMs, transcriptInfo.mtimeMs);
          lastMessage = await readLastSessionMessage(transcriptPath, metadata.sessionId);
        }
      } catch {
        // A session without a readable transcript can still be selected. The full
        // read path reports corruption or permissions when the user resumes it.
      }
      summaries.push({
        sessionId: metadata.sessionId,
        state: "available",
        createdAt: metadata.createdAt,
        lastActivityAt: new Date(lastActivityAtMs).toISOString(),
        ...(lastMessage ? { lastMessage } : {}),
      });
    }

    summaries.sort((left, right) => {
      if (left.lastActivityAt === undefined) return right.lastActivityAt === undefined ? left.sessionId.localeCompare(right.sessionId) : 1;
      if (right.lastActivityAt === undefined) return -1;
      return right.lastActivityAt.localeCompare(left.lastActivityAt) || left.sessionId.localeCompare(right.sessionId);
    });
    return summaries.slice(0, limit);
  }

  /** Normalize untrusted values before any session-owned evidence is published. */
  redactEvidence<T>(value: T): T {
    return redactRecord(value, this.redactionSecrets) as T;
  }

  async replaceJson(filePath: string, value: unknown): Promise<void> {
    const normalized = this.redactEvidence(value);
    await this.writeHooks?.beforeWrite?.("replace-json", filePath);
    await atomicWriteJson(filePath, normalized);
    await this.writeHooks?.afterWrite?.("replace-json", filePath);
  }

  async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    const normalized = this.redactEvidence(value);
    await this.writeHooks?.beforeWrite?.("append-json-line", filePath);
    await appendJsonLine(filePath, normalized);
    await this.writeHooks?.afterWrite?.("append-json-line", filePath);
  }

  async replaceJsonLines(filePath: string, values: readonly unknown[]): Promise<void> {
    const normalized = values.map((value) => this.redactEvidence(value));
    await this.writeHooks?.beforeWrite?.("replace-json-lines", filePath);
    await atomicWriteJsonLines(filePath, normalized);
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
        throw new AnesuError("persistence", `Transcript message '${message.messageId}' is duplicated.`);
      }
      messageIds.add(message.messageId);
    }
    return transcript;
  }

  async readLatestContextSnapshot(): Promise<ContextSnapshot | undefined> {
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    const entries = await readdir(turnsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Session '${this.metadata.sessionId}' context records cannot be listed.`, { cause: error });
    });
    const snapshots: ContextSnapshot[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const directory = path.join(turnsDirectory, entry.name);
      const contextPath = path.join(directory, "context.json");
      if (!(await fileExists(contextPath))) continue;
      const turnRecord = await readJson<TurnRecord>(path.join(directory, "turn.json"));
      validateTurnRecord(turnRecord, this.metadata.sessionId, entry.name);
      const turn = new TurnStore(this, directory, turnRecord);
      const snapshot = await turn.readContextSnapshot();
      if (!snapshot) continue;
      snapshots.push(snapshot);
    }
    return snapshots.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.turnId.localeCompare(right.turnId)).at(-1);
  }

  /**
   * Read bounded, lossy computer-run projections for inspection surfaces. The
   * durable event payload is validated first, then reduced to selected
   * lifecycle fields; screenshots, provider bodies, and arbitrary payload keys
   * never cross this API boundary.
   */
  async readComputerRunSummaries(options: { readonly limit?: number } = {}): Promise<ComputerRunSummary[]> {
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new AnesuError("invalid-input", "Computer run summary limit must be between 1 and 100.");
    }
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    const entries = await readdir(turnsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Session '${this.metadata.sessionId}' computer runs cannot be listed.`, { cause: error });
    });
    const summaries: ComputerRunSummary[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name)).slice(0, 1_000)) {
      const directory = path.join(turnsDirectory, entry.name);
      let turnRecord: TurnRecord;
      try {
        turnRecord = await readJson<TurnRecord>(path.join(directory, "turn.json"));
        validateTurnRecord(turnRecord, this.metadata.sessionId, entry.name);
      } catch (error) {
        throw new AnesuError("persistence", `Turn '${entry.name}' has an invalid record while reading computer runs.`, { cause: error });
      }
      const turn = new TurnStore(this, directory, turnRecord);
      for (const run of await turn.readComputerRuns()) {
        const events = await turn.readComputerRunEvents(run.runId);
        const lastEvent = events.at(-1);
        summaries.push({
          run,
          eventCount: events.length,
          ...(lastEvent ? { lastEvent: summarizeComputerRunEvent(lastEvent) } : {}),
        });
      }
    }
    return summaries
      .sort((left, right) => right.run.startedAt.localeCompare(left.run.startedAt) || right.run.runId.localeCompare(left.run.runId))
      .slice(0, limit);
  }

  /** Read one validated computer run by ID without exposing its raw events. */
  async readComputerRun(runId: string): Promise<ComputerRunRecord> {
    const safeRunId = safePathSegment(runId, "Computer run ID");
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    const entries = await readdir(turnsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Session '${this.metadata.sessionId}' computer runs cannot be listed.`, { cause: error });
    });
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const directory = path.join(turnsDirectory, entry.name);
      let turnRecord: TurnRecord;
      try {
        turnRecord = await readJson<TurnRecord>(path.join(directory, "turn.json"));
        validateTurnRecord(turnRecord, this.metadata.sessionId, entry.name);
      } catch (error) {
        throw new AnesuError("persistence", `Turn '${entry.name}' has an invalid record while reading computer runs.`, { cause: error });
      }
      const turn = new TurnStore(this, directory, turnRecord);
      const runDirectory = path.join(directory, "computer-runs", safeRunId);
      if (!(await fileExists(path.join(runDirectory, "run.json")))) continue;
      return await turn.readComputerRun(safeRunId);
    }
    throw new AnesuError("persistence", `Computer run '${safeRunId}' was not found in session '${this.metadata.sessionId}'.`);
  }

  /**
   * Remove only old terminal run journals under this session. The operation is
   * bounded, refuses symlinked run directories, and takes a sibling cleanup
   * lease so an active writer cannot be deleted accidentally. Native input is
   * never replayed or reconstructed by retention.
   */
  async cleanupComputerRuns(options: ComputerRunRetentionOptions): Promise<ComputerRunRetentionResult> {
    if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
      throw new AnesuError("invalid-input", "Computer run retention maxAgeMs must be a non-negative integer.");
    }
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new AnesuError("invalid-input", "Computer run retention maxEntries must be a positive integer.");
    }
    const nowMs = options.now ?? Date.now;
    const result = { ...emptyComputerRunRetentionResult() } as { -readonly [K in keyof ComputerRunRetentionResult]: ComputerRunRetentionResult[K] };
    const turnsDirectory = path.join(this.sessionDirectory, "turns");
    const turnEntries = await readdir(turnsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Session '${this.metadata.sessionId}' computer-run retention could not scan turns.`, { cause: error });
    });
    for (const turnEntry of turnEntries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      if (result.scanned >= options.maxEntries) {
        result.truncated = true;
        break;
      }
      const turnDirectoryPath = path.join(turnsDirectory, turnEntry.name);
      let turnRecord: TurnRecord;
      try {
        turnRecord = await readJson<TurnRecord>(path.join(turnDirectoryPath, "turn.json"));
        validateTurnRecord(turnRecord, this.metadata.sessionId, turnEntry.name);
      } catch {
        result.failed += 1;
        continue;
      }
      const runsDirectory = path.join(turnDirectoryPath, "computer-runs");
      const runEntries = await readdir(runsDirectory, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        result.failed += 1;
        return [];
      });
      const turn = new TurnStore(this, turnDirectoryPath, turnRecord);
      for (const runEntry of runEntries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
        if (result.scanned >= options.maxEntries) {
          result.truncated = true;
          break;
        }
        result.scanned += 1;
        let run: ComputerRunRecord;
        try {
          run = await turn.readComputerRun(runEntry.name);
        } catch {
          result.failed += 1;
          continue;
        }
        const timestamp = Date.parse(run.finishedAt ?? run.recordedAt ?? run.startedAt);
        if (run.status === "running" || !Number.isFinite(timestamp) || timestamp > nowMs() - options.maxAgeMs) {
          result.retained += 1;
          continue;
        }
        const cleanupLeasePath = path.join(runsDirectory, `.${safePathSegment(run.runId, "Computer run ID")}.retention.lock`);
        let cleanupLease: SessionLock;
        try {
          cleanupLease = await SessionLock.acquire(cleanupLeasePath);
        } catch (error) {
          if (error instanceof AnesuError && error.code === "lock") {
            result.retained += 1;
            continue;
          }
          result.failed += 1;
          continue;
        }
        try {
          const metadata = await lstat(path.join(runsDirectory, runEntry.name));
          if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
            result.skipped += 1;
            continue;
          }
          await rm(path.join(runsDirectory, runEntry.name), { recursive: true, force: false });
          result.removed += 1;
        } catch {
          result.failed += 1;
        } finally {
          await cleanupLease.release().catch(() => undefined);
        }
      }
    }
    return result;
  }

  async admitTurn(userPrompt: string, provider: TurnRecord["provider"], model: string): Promise<TurnStore> {
    const content = userPrompt.trim();
    if (content.length === 0) throw new AnesuError("invalid-input", "A message is required.");
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
        throw new AnesuError("persistence", `Turn '${entry.name}' cannot be admitted around an invalid durable record.`, { cause: error });
      }
      if (NON_TERMINAL_STATES.includes(record.state)) {
        throw new AnesuError("lock", `Session '${this.metadata.sessionId}' already has active turn '${record.turnId}' in state '${record.state}'. Recover it before starting another turn.`);
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
        throw new AnesuError("persistence", `Turn '${entry.name}' has no valid turn record. Repair it before continuing.`, { cause: error });
      }
      const resultPath = path.join(directory, "result.json");
      const result = await fileExists(resultPath) ? await readJson<TurnResult>(resultPath) : undefined;
      const turn = new TurnStore(this, directory, record);
      if (await fileExists(path.join(directory, "context.json"))) await turn.readContextSnapshot();
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
            throw new AnesuError("persistence", `Process execution '${execution.executionId}' reconciliation must remain ambiguous because its outcome is unknown.`);
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
      for (const action of await turn.readComputerActions()) {
        let reconciledAction = action;
        if (action.status === "prepared") {
          reconciledAction = {
            ...action,
            status: "failed",
            decision: "unavailable",
            errorCode: "computer-approval-unavailable",
            errorMessage: "The native computer approval ended when the parent process stopped; the input was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeComputerAction(reconciledAction);
        } else if (action.status === "approved") {
          reconciledAction = {
            ...action,
            status: "failed",
            decision: "unavailable",
            errorCode: "computer-approval-unavailable",
            errorMessage: "The approved native computer action had not started when the parent process stopped; the input was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeComputerAction(reconciledAction);
        } else if (action.status === "running") {
          reconciledAction = {
            ...action,
            status: "ambiguous",
            errorCode: "computer-ambiguous",
            errorMessage: "The native computer input may have reached the desktop before the parent process stopped; its outcome is unknown and the input was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          };
          await turn.writeComputerAction(reconciledAction);
        }
        await turn.ensureComputerTerminalEvent(reconciledAction);
      }
      for (const run of await turn.readComputerRuns()) {
        await turn.ensureComputerRunTerminal(run);
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
        throw new AnesuError("persistence", `Turn '${record.turnId}' is terminal but has no result record.`);
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
        } else if (mutation.status === "approved") {
          // The applying record is the durable boundary immediately before a
          // workspace side effect. An approved record without that boundary
          // is therefore safe to close as unavailable when no workspace
          // reconciler is configured; it must never be replayed on restart.
          reconciledMutation = reconcileMutation
            ? await reconcileMutation(mutation)
            : {
                ...mutation,
                status: "failed",
                decision: "unavailable",
                errorCode: "approval-unavailable",
                reason: "The approved mutation had not reached the applying boundary when the process stopped; the mutation was not applied.",
              };
          await turn.writeMutation(reconciledMutation);
        } else if (reconcileMutation && mutation.status === "applying") {
          reconciledMutation = await reconcileMutation(mutation);
          await turn.writeMutation(reconciledMutation);
        }
        await turn.ensureMutationTerminalEvent(reconciledMutation);
      }
      const hasUserMessage = transcript.some((message) => message.turnId === record.turnId && message.role === "user");
      if (!record.userMessagePersisted && !hasUserMessage) {
        throw new AnesuError("persistence", `Turn '${record.turnId}' is incomplete: its user message is missing. Repair it before continuing.`);
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
    const normalized = this.redactEvidence(message);
    validateTranscriptMessage(normalized, this.metadata.sessionId);
    const transcript = await this.readTranscript();
    const existing = transcript.find((candidate) => candidate.messageId === normalized.messageId);
    if (existing) {
      if (stableStringify(existing) !== stableStringify(normalized)) {
        throw new AnesuError("persistence", `Transcript message '${normalized.messageId}' already has different content.`);
      }
      return;
    }
    await this.appendJsonLine(path.join(this.sessionDirectory, "transcript.jsonl"), normalized);
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
    const normalizedPayload = this.session.redactEvidence(payload);
    assertTurnStartedIdentity(this.record, type, normalizedPayload);
    const terminal = existing.find((event) => isTerminalLifecycleEvent(event.type));
    if (terminal) {
      if (terminal.type === type) {
        if (stableStringify(terminal.payload) !== stableStringify(normalizedPayload)) {
          throw new AnesuError("persistence", `${type} evidence was repeated with a different payload for the same terminal turn.`);
        }
        return terminal;
      }
      throw new AnesuError("persistence", `Turn '${this.turnId}' already has terminal event '${terminal.type}'; '${type}' cannot be appended.`);
    }
    const existingModelEvent = findIdempotentModelEvent(existing, type, normalizedPayload);
    if (existingModelEvent) return existingModelEvent;
    const existingContextEvent = findIdempotentContextEvent(existing, type, normalizedPayload);
    if (existingContextEvent) return existingContextEvent;
    const existingActionEvent = findIdempotentActionEvent(existing, type, normalizedPayload);
    if (existingActionEvent) return existingActionEvent;
    assertLifecycleEventOrder(existing, type, normalizedPayload);
    const event: LifecycleEvent = {
      schemaVersion: 1,
      eventId: id("event"),
      sequence: existing.length + 1,
      type,
      recordedAt: now(),
      sessionId: this.record.sessionId,
      turnId: this.record.turnId,
      correlationId: this.correlationId,
      payload: normalizedPayload as Readonly<Record<string, unknown>>,
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
    const normalizedPayload = this.session.redactEvidence(payload);
    assertLifecycleEventOrder(prefix, type, normalizedPayload);
    const event: LifecycleEvent = {
      schemaVersion: 1,
      eventId: id("event"),
      sequence: terminalIndex + 1,
      type,
      recordedAt: now(),
      sessionId: this.record.sessionId,
      turnId: this.record.turnId,
      correlationId: this.correlationId,
      payload: normalizedPayload as Readonly<Record<string, unknown>>,
    };
    const repaired = [...prefix, event, existing[terminalIndex]].map((candidate, index) => ({ ...candidate, sequence: index + 1 }));
    await this.session.replaceJsonLines(eventsPath, repaired);
    return event;
  }

  private async repairActionPreludeBeforeTerminal(
    identityField: string,
    identity: string,
    terminalTypes: readonly LifecycleEventType[],
    repairs: readonly (readonly [LifecycleEventType, Readonly<Record<string, unknown>>])[],
  ): Promise<void> {
    const eventsPath = path.join(this.directory, "events.jsonl");
    const existing = await readJsonLines<LifecycleEvent>(eventsPath);
    validateLifecycleEventHistory(existing, this.sessionId, this.turnId);
    for (const event of existing) assertRecordCorrelation(this.correlationId, event.correlationId, "Lifecycle event");
    const terminalIndex = existing.findIndex((event) => terminalTypes.includes(event.type) && event.payload[identityField] === identity);
    if (terminalIndex < 0) return;

    // A terminal action event can be durable before its approval prelude. The
    // regular append-recovery path inserts before a terminal turn event, which
    // would place this prelude after the action terminal. Rewrite the one
    // action segment in one bounded operation so its lifecycle order stays
    // valid.
    const prefix = existing.slice(0, terminalIndex);
    const inserted: LifecycleEvent[] = [];
    for (const [type, payload] of repairs) {
      const normalizedPayload = this.session.redactEvidence(payload);
      assertLifecycleEventOrder([...prefix, ...inserted], type, normalizedPayload);
      inserted.push({
        schemaVersion: 1,
        eventId: id("event"),
        sequence: terminalIndex + inserted.length + 1,
        type,
        recordedAt: now(),
        sessionId: this.record.sessionId,
        turnId: this.record.turnId,
        correlationId: this.correlationId,
        payload: normalizedPayload as Readonly<Record<string, unknown>>,
      });
    }
    const repaired = [...prefix, ...inserted, ...existing.slice(terminalIndex)].map((event, index) => ({ ...event, sequence: index + 1 }));
    validateLifecycleEventHistory(repaired, this.sessionId, this.turnId);
    await this.session.replaceJsonLines(eventsPath, repaired);
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
    const normalized = this.session.redactEvidence({ ...round, correlationId: round.correlationId ?? this.correlationId });
    assertRecordCorrelation(this.correlationId, normalized.correlationId, "Round");
    const previous = existing.at(-1);
    if (previous && roundIdentity(previous) === roundIdentity(normalized)) {
      if (stableStringify(roundSemantics(previous)) !== stableStringify(roundSemantics(normalized))) {
        throw new AnesuError("persistence", `Round '${round.round}/${round.phase}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    validateRoundOrder([...existing, normalized], this.sessionId, this.turnId);
    await this.session.appendJsonLine(path.join(this.directory, "rounds.jsonl"), normalized);
  }

  async readRounds(): Promise<RoundEvidence[]> {
    const rounds = await readJsonLines<RoundEvidence>(path.join(this.directory, "rounds.jsonl"));
    validateRoundOrder(rounds, this.sessionId, this.turnId);
    for (const round of rounds) assertRecordCorrelation(this.correlationId, round.correlationId, "Round");
    return rounds;
  }

  /**
   * Publish the bounded context evidence before the first provider request. The
   * request body is intentionally not persisted here; hashes and byte counts are
   * enough to inspect the decision without copying workspace secrets into logs.
   */
  async writeContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    const normalized = this.session.redactEvidence(snapshot);
    assertContextSnapshot(normalized, this.sessionId, this.turnId, this.record.provider, this.record.model);
    const contextPath = path.join(this.directory, "context.json");
    let replacing = false;
    if (await fileExists(contextPath)) {
      const existing = await readJson<ContextSnapshot>(contextPath);
      assertContextSnapshot(existing, this.sessionId, this.turnId, this.record.provider, this.record.model);
      if (stableStringify(existing) !== stableStringify(normalized)) {
        if (normalized.revision !== existing.revision + 1 || normalized.previousSnapshotId !== existing.snapshotId) {
          throw new AnesuError("persistence", `Turn '${this.turnId}' already has a different context snapshot revision.`);
        }
        replacing = true;
        const revisionsDirectory = path.join(this.directory, "context-revisions");
        await ensureDirectory(revisionsDirectory);
        const archivePath = path.join(revisionsDirectory, `${safePathSegment(existing.snapshotId, "Context snapshot ID")}.json`);
        if (await fileExists(archivePath)) {
          const archived = await readJson<ContextSnapshot>(archivePath);
          assertContextSnapshot(archived, this.sessionId, this.turnId, this.record.provider, this.record.model);
          if (stableStringify(archived) !== stableStringify(existing)) {
            throw new AnesuError("persistence", `Turn '${this.turnId}' has conflicting archived context revision '${existing.snapshotId}'.`);
          }
        } else {
          await this.session.replaceJson(archivePath, existing);
        }
        await this.session.replaceJson(contextPath, normalized);
      }
    } else {
      if (normalized.revision !== 1 || normalized.previousSnapshotId !== null) {
        throw new AnesuError("persistence", `Turn '${this.turnId}' cannot publish a context revision without its first revision.`);
      }
      await this.session.replaceJson(contextPath, normalized);
    }
    if (normalized.compaction) {
      const compactionPath = path.join(this.directory, "compaction.json");
      if (await fileExists(compactionPath)) {
        const existing = await readJson<ContextSnapshot["compaction"]>(compactionPath);
        if (stableStringify(existing) !== stableStringify(normalized.compaction)) {
          if (!replacing) {
            throw new AnesuError("persistence", `Turn '${this.turnId}' already has different compaction evidence.`);
          }
          await this.session.replaceJson(compactionPath, normalized.compaction);
        }
      } else {
        await this.session.replaceJson(compactionPath, normalized.compaction);
      }
    }
  }

  private async assertContextRevisionChain(latest: ContextSnapshot): Promise<void> {
    const revisionsDirectory = path.join(this.directory, "context-revisions");
    const entries = await readdir(revisionsDirectory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' context revisions cannot be listed.`, { cause: error });
    });
    const archived = new Map<number, ContextSnapshot>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new AnesuError("persistence", `Turn '${this.turnId}' has an invalid context revision entry.`);
      }
      const revisionPath = path.join(revisionsDirectory, entry.name);
      const snapshot = await readJson<ContextSnapshot>(revisionPath);
      assertContextSnapshot(snapshot, this.sessionId, this.turnId, this.record.provider, this.record.model);
      // The archive is published before context.json is replaced. If the
      // acknowledgement is lost at that boundary, revision one can briefly
      // appear both as the active snapshot and as its own staged archive. It
      // is safe to ignore that exact duplicate; any other extra revision is
      // treated as corruption.
      if (snapshot.revision === latest.revision
        && latest.revision === 1
        && snapshot.snapshotId === latest.snapshotId
        && stableStringify(snapshot) === stableStringify(latest)) continue;
      if (entry.name !== `${safePathSegment(snapshot.snapshotId, "Context snapshot ID")}.json`
        || snapshot.revision >= latest.revision
        || archived.has(snapshot.revision)) {
        throw new AnesuError("persistence", `Turn '${this.turnId}' has an invalid archived context revision chain.`);
      }
      archived.set(snapshot.revision, snapshot);
    }
    let previousSnapshotId: string | null = null;
    for (let revision = 1; revision <= latest.revision; revision += 1) {
      const snapshot = revision === latest.revision ? latest : archived.get(revision);
      if (!snapshot || snapshot.revision !== revision || snapshot.previousSnapshotId !== previousSnapshotId) {
        throw new AnesuError("persistence", `Turn '${this.turnId}' has a broken context revision chain at revision ${revision}.`);
      }
      previousSnapshotId = snapshot.snapshotId;
    }
    if (archived.size !== latest.revision - 1) {
      throw new AnesuError("persistence", `Turn '${this.turnId}' has extra context revisions outside the active chain.`);
    }
  }

  async readContextSnapshot(): Promise<ContextSnapshot | undefined> {
    const contextPath = path.join(this.directory, "context.json");
    if (!(await fileExists(contextPath))) return undefined;
    const snapshot = await readJson<ContextSnapshot>(contextPath);
    assertContextSnapshot(snapshot, this.sessionId, this.turnId, this.record.provider, this.record.model);
    await this.assertContextRevisionChain(snapshot);
    return snapshot;
  }

  async writeMutation(record: WorkspaceMutationRecord): Promise<void> {
    // Patch previews can contain file content supplied by an untrusted model or
    // workspace. Normalize the complete bounded record before validation and
    // transition comparison so redaction remains stable across updates.
    const normalized = this.session.redactEvidence(record);
    assertWorkspaceMutationRecord(normalized, this.correlationId);
    const directory = path.join(this.directory, "mutations");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.mutationId, "Mutation ID")}.json`);
    let previous: WorkspaceMutationRecord | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<WorkspaceMutationRecord>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertWorkspaceMutationRecord(previous, this.correlationId);
      assertMutationTransition(previous, normalized);
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async writeProcess(record: ProcessExecutionRecord): Promise<void> {
    const normalized = this.session.redactEvidence(record);
    assertProcessExecutionRecord(normalized, this.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "executions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.executionId, "Execution ID")}.json`);
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
        assertProcessTransition(previous, normalized);
      } catch (error) {
        throw new AnesuError("persistence", `Process execution '${normalized.executionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async readProcesses(): Promise<ProcessExecutionRecord[]> {
    const directory = path.join(this.directory, "executions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' process records cannot be listed.`, { cause: error });
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
    const normalized = this.session.redactEvidence(record);
    assertBrowserActionRecord(normalized, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "browser-actions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.actionId, "Browser action ID")}.json`);
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
        assertBrowserActionTransition(previous, normalized);
      } catch (error) {
        throw new AnesuError("persistence", `Browser action '${normalized.actionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async writeMemoryAction(record: MemoryActionRecord): Promise<void> {
    const normalized = this.session.redactEvidence(record);
    assertMemoryActionRecord(normalized, this.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "memory-actions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.operationId, "Memory operation ID")}.jsonl`);
    const history = await readJsonLines<MemoryActionRecord>(recordPath);
    assertMemoryActionHistory([...history, normalized], this.sessionId, this.turnId, this.correlationId);
    // Lifecycle updates are append-only. Recovery reads the latest state, while
    // the JSONL history preserves the earlier proposal/approval outcome.
    await this.session.appendJsonLine(recordPath, normalized);
  }

  async readMemoryActions(): Promise<MemoryActionRecord[]> {
    const directory = path.join(this.directory, "memory-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' memory records cannot be listed.`, { cause: error });
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
    const normalized = this.session.redactEvidence(record);
    assertMemorySearchEvidence(normalized, this.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "memory-searches");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.searchId, "Memory search ID")}.json`);
    let previous: MemorySearchEvidence | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<MemorySearchEvidence>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertMemorySearchEvidence(previous, this.sessionId, this.turnId, this.correlationId);
      const { recordedAt: _previousRecordedAt, ...previousSemantics } = redactRecord(previous) as Record<string, unknown>;
      const { recordedAt: _recordedAt, ...recordSemantics } = normalized;
      if (stableStringify(previousSemantics) !== stableStringify(recordSemantics)) {
        throw new AnesuError("persistence", `Memory search '${record.searchId}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async readMemorySearches(): Promise<MemorySearchEvidence[]> {
    const directory = path.join(this.directory, "memory-searches");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' memory searches cannot be listed.`, { cause: error });
    });
    const records: MemorySearchEvidence[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<MemorySearchEvidence>(path.join(directory, entry.name));
      assertMemorySearchEvidence(record, this.sessionId, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async ensureMemorySearchEvent(record: MemorySearchEvidence): Promise<void> {
    assertMemorySearchEvidence(record, this.sessionId, this.turnId, this.correlationId);
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
        throw new AnesuError("persistence", `Memory search '${record.searchId}' lifecycle evidence conflicts with its durable search record.`);
      }
      return;
    }
    await this.appendRecoveredEvent("MemorySearched", { ...payload, recovered: true });
  }

  async readBrowserActions(): Promise<BrowserActionRecord[]> {
    const directory = path.join(this.directory, "browser-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' browser action records cannot be listed.`, { cause: error });
    });
    const records: BrowserActionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<BrowserActionRecord>(path.join(directory, entry.name));
      assertBrowserActionRecord(record, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async writeComputerAction(record: ComputerActionRecord): Promise<void> {
    const normalized = this.session.redactEvidence(record);
    assertComputerActionRecord(normalized, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "computer-actions");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.actionId, "Computer action ID")}.json`);
    let previous: ComputerActionRecord | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<ComputerActionRecord>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertComputerActionRecord(previous, this.turnId, this.correlationId);
      try {
        assertComputerActionTransition(previous, normalized);
      } catch (error) {
        throw new AnesuError("persistence", `Computer action '${normalized.actionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async readComputerActions(): Promise<ComputerActionRecord[]> {
    const directory = path.join(this.directory, "computer-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' computer action records cannot be listed.`, { cause: error });
    });
    const records: ComputerActionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<ComputerActionRecord>(path.join(directory, entry.name));
      assertComputerActionRecord(record, this.turnId, this.correlationId);
      records.push(record);
    }
    return records;
  }

  async writeComputerRun(record: ComputerRunRecord): Promise<void> {
    const normalized = this.session.redactEvidence(record);
    assertComputerRunRecord(normalized, this.session.metadata.sessionId, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "computer-runs", safePathSegment(normalized.runId, "Computer run ID"));
    await ensureDirectory(directory);
    const recordPath = path.join(directory, "run.json");
    let previous: ComputerRunRecord | undefined;
    if (await fileExists(recordPath)) {
      previous = await readJson<ComputerRunRecord>(recordPath);
      assertComputerRunRecord(previous, this.session.metadata.sessionId, this.turnId, this.correlationId);
    }
    if (previous) {
      if (stableStringify(previous) === stableStringify(normalized)) return;
      try {
        assertComputerRunTransition(previous, normalized);
      } catch (error) {
        throw new AnesuError("persistence", `Computer run '${normalized.runId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async readComputerRun(runId: string): Promise<ComputerRunRecord> {
    const safeRunId = safePathSegment(runId, "Computer run ID");
    const record = await readJson<ComputerRunRecord>(path.join(this.directory, "computer-runs", safeRunId, "run.json"));
    assertComputerRunRecord(record, this.session.metadata.sessionId, this.turnId, this.correlationId);
    return record;
  }

  async readComputerRuns(): Promise<ComputerRunRecord[]> {
    const directory = path.join(this.directory, "computer-runs");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' computer runs cannot be listed.`, { cause: error });
    });
    const records: ComputerRunRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const record = await readJson<ComputerRunRecord>(path.join(directory, entry.name, "run.json"));
      assertComputerRunRecord(record, this.session.metadata.sessionId, this.turnId, this.correlationId);
      if (record.runId !== entry.name) throw new AnesuError("persistence", `Computer run directory '${entry.name}' does not match its run ID.`);
      records.push(record);
    }
    return records;
  }

  async appendComputerRunEvent(input: ComputerRunEventInput): Promise<void> {
    const run = await this.readComputerRun(input.runId);
    if (input.sessionId !== run.sessionId || input.turnId !== run.turnId || (run.strategy !== "compare" && input.strategy !== run.strategy) || input.correlationId !== run.correlationId) {
      throw new AnesuError("persistence", `Computer run event '${input.eventId}' does not match its run identity.`);
    }
    const directory = path.join(this.directory, "computer-runs", safePathSegment(input.runId, "Computer run ID"));
    const eventsPath = path.join(directory, "events.jsonl");
    const existing = await readJsonLines<ComputerRunEventRecord>(eventsPath);
    for (const event of existing) assertComputerRunEvent(event);
    const existingEvent = existing.find((event) => event.eventId === input.eventId);
    if (existingEvent) {
      const normalized = this.session.redactEvidence({ ...input, sequence: existingEvent.sequence, recordedAt: input.recordedAt ?? existingEvent.recordedAt });
      assertComputerRunEvent(normalized);
      if (stableStringify(existingEvent) !== stableStringify(normalized)) {
        throw new AnesuError("persistence", `Computer run event '${input.eventId}' was repeated with different evidence.`);
      }
      return;
    }
    const normalized = this.session.redactEvidence({ ...input, sequence: existing.length + 1, recordedAt: input.recordedAt ?? now() });
    assertComputerRunEvent(normalized);
    await this.session.appendJsonLine(eventsPath, normalized);
  }

  async readComputerRunEvents(runId: string): Promise<ComputerRunEventRecord[]> {
    const run = await this.readComputerRun(runId);
    const eventsPath = path.join(this.directory, "computer-runs", safePathSegment(runId, "Computer run ID"), "events.jsonl");
    const events = await readJsonLines<ComputerRunEventRecord>(eventsPath);
    events.forEach((event, index) => {
      assertComputerRunEvent(event);
      if (event.runId !== run.runId || event.sessionId !== run.sessionId || event.turnId !== run.turnId || (run.strategy !== "compare" && event.strategy !== run.strategy) || event.correlationId !== run.correlationId || event.sequence !== index + 1) {
        throw new AnesuError("persistence", `Computer run '${runId}' has out-of-order or cross-run event evidence.`);
      }
    });
    return events;
  }

  /**
   * Close a run that was still active when the owning process stopped. The
   * recovery event is written before the terminal run record so an
   * acknowledgement lost after the append can be repaired idempotently on the
   * next restart. No host input is attempted here.
   */
  async ensureComputerRunTerminal(record: ComputerRunRecord): Promise<void> {
    if (record.status !== "running") return;
    const reason = "The computer run was interrupted; its outcome is unknown and no input was replayed.";
    await this.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: `computer_recovery_${record.runId}`,
      runId: record.runId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      correlationId: record.correlationId,
      kind: "failed",
      strategy: record.strategy,
      payload: { recovered: true, reason, status: "outcome-unknown" },
    });
    const timestamp = now();
    await this.writeComputerRun({
      ...record,
      status: "outcome-unknown",
      outcome: "outcome-unknown",
      summary: reason,
      finishedAt: timestamp,
      recordedAt: timestamp,
    });
  }

  async writeBrowserArtifact(record: BrowserArtifactEvidence): Promise<void> {
    const normalized = this.session.redactEvidence(record);
    assertBrowserArtifactEvidence(normalized, this.turnId, this.correlationId);
    const directory = path.join(this.directory, "browser-artifacts");
    await ensureDirectory(directory);
    const recordPath = path.join(directory, `${safePathSegment(normalized.artifactId, "Browser artifact ID")}.json`);
    let previous: BrowserArtifactEvidence | undefined;
    try {
      await stat(recordPath);
      previous = await readJson<BrowserArtifactEvidence>(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assertBrowserArtifactEvidence(previous, this.turnId, this.correlationId);
      if (stableStringify(previous) !== stableStringify(normalized)) {
        throw new AnesuError("persistence", `Browser artifact '${normalized.artifactId}' evidence was repeated with a different payload for the same identity.`);
      }
      return;
    }
    await this.session.replaceJson(recordPath, normalized);
  }

  async readBrowserArtifacts(): Promise<BrowserArtifactEvidence[]> {
    const directory = path.join(this.directory, "browser-artifacts");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' browser artifacts cannot be listed.`, { cause: error });
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
        throw new AnesuError("persistence", `Browser artifact '${record.artifactId}' lifecycle evidence conflicts with its durable artifact record.`);
      }
      return;
    }
    await this.appendRecoveredEvent("BrowserArtifactCreated", { ...payload, recovered: true });
  }

  async readMutations(): Promise<WorkspaceMutationRecord[]> {
    const directory = path.join(this.directory, "mutations");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new AnesuError("persistence", `Turn '${this.turnId}' mutation records cannot be listed.`, { cause: error });
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
        throw new AnesuError("persistence", `Turn '${this.turnId}' already has a different terminal result.`);
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
        throw new AnesuError("persistence", `Terminal event '${expected}' does not match terminal result status '${result.status}'.`);
      }
      if (existing.payload.assistantMessageId !== undefined && existing.payload.assistantMessageId !== result.assistantMessageId) {
        throw new AnesuError("persistence", `Terminal event '${expected}' does not match the terminal assistant message.`);
      }
      if (existing.payload.error !== undefined && stableStringify(existing.payload.error) !== stableStringify(redactRecord(result.error))) {
        throw new AnesuError("persistence", `Terminal event '${expected}' does not match the terminal error.`);
      }
      return;
    }
    await this.appendEvent(expected, { status: result.status, recovered: true });
  }

  async ensureProcessTerminalEvent(record: ProcessExecutionRecord): Promise<void> {
    if (record.status !== "completed" && record.status !== "failed" && record.status !== "cancelled" && record.status !== "ambiguous") return;
    let events = await this.readEvents();
    const processEvents = () => events.filter((event) => event.payload.executionId === record.executionId);
    const hasTerminal = () => processEvents().some((event) => event.type === "ProcessCompleted");

    const missingPrelude: (readonly [LifecycleEventType, Readonly<Record<string, unknown>>])[] = [];
    if (!processEvents().some((event) => event.type === "ProcessPrepared")) {
      missingPrelude.push(["ProcessPrepared", {
        executionId: record.executionId,
        callId: record.callId,
        cwd: record.cwd,
        command: record.command,
        recovered: true,
      }]);
    }
    if (!processEvents().some((event) => event.type === "ProcessApprovalDecided")) {
      missingPrelude.push(["ProcessApprovalDecided", {
        executionId: record.executionId,
        callId: record.callId,
        decision: record.decision ?? (record.status === "failed" ? "unavailable" : "allow-once"),
        recovered: true,
      }]);
    }
    if (hasTerminal()) {
      if (missingPrelude.length > 0) {
        await this.repairActionPreludeBeforeTerminal("executionId", record.executionId, ["ProcessCompleted"], missingPrelude);
      }
      return;
    }

    // A process record can be durable even when its first lifecycle append was
    // interrupted. Rebuild the approval prelude from the immutable request
    // fields before closing the action, while keeping the recovery marker
    // visible and never launching the command.
    if (!processEvents().some((event) => event.type === "ProcessPrepared")) {
      await this.appendRecoveredEvent("ProcessPrepared", {
        executionId: record.executionId,
        callId: record.callId,
        cwd: record.cwd,
        command: record.command,
        recovered: true,
      });
      events = await this.readEvents();
    }
    if (!processEvents().some((event) => event.type === "ProcessApprovalDecided")) {
      await this.appendRecoveredEvent("ProcessApprovalDecided", {
        executionId: record.executionId,
        callId: record.callId,
        decision: record.decision ?? (record.status === "failed" ? "unavailable" : "allow-once"),
        recovered: true,
      });
      events = await this.readEvents();
    }
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
    let events = await this.readEvents();
    const browserEvents = () => events.filter((event) => event.payload.actionId === record.actionId);

    const missingPrelude: (readonly [LifecycleEventType, Readonly<Record<string, unknown>>])[] = [];
    if (!browserEvents().some((event) => event.type === "BrowserPrepared")) {
      missingPrelude.push(["BrowserPrepared", {
        actionId: record.actionId,
        callId: record.callId,
        sessionId: record.sessionId,
        tabId: record.tabId,
        action: record.action,
        reference: record.reference,
        recovered: true,
      }]);
    }
    if (!browserEvents().some((event) => event.type === "BrowserApprovalDecided")) {
      missingPrelude.push(["BrowserApprovalDecided", {
        actionId: record.actionId,
        callId: record.callId,
        decision: record.decision ?? (record.status === "failed" ? "unavailable" : "allow-once"),
        recovered: true,
      }]);
    }
    if (browserEvents().some((event) => event.type === "BrowserCompleted")) {
      if (missingPrelude.length > 0) {
        await this.repairActionPreludeBeforeTerminal("actionId", record.actionId, ["BrowserCompleted"], missingPrelude);
      }
      return;
    }

    // Browser action records are persisted before their lifecycle event. Repair
    // the approval prelude when that first acknowledgement is lost; recovery
    // records observation only and never reopens a tab or dispatches an action.
    for (const [type, payload] of missingPrelude) {
      await this.appendRecoveredEvent(type, payload);
      events = await this.readEvents();
    }
    await this.appendRecoveredEvent("BrowserCompleted", {
      actionId: record.actionId,
      callId: record.callId,
      status: record.status,
      errorCode: record.errorCode ?? null,
      underlyingErrorCode: record.underlyingErrorCode ?? null,
      recovered: true,
    });
  }

  async ensureComputerTerminalEvent(record: ComputerActionRecord): Promise<void> {
    if (record.status !== "completed" && record.status !== "failed" && record.status !== "cancelled" && record.status !== "ambiguous") return;
    let events = await this.readEvents();
    const computerEvents = () => events.filter((event) => event.payload.actionId === record.actionId);
    const basePayload: Record<string, unknown> = {
      actionId: record.actionId,
      callId: record.callId,
      sessionId: record.sessionId,
      environment: record.environment,
      displayId: record.displayId,
      operation: record.operation,
      observationId: record.observationId,
      generation: record.generation,
      ...(record.x !== undefined ? { x: record.x } : {}),
      ...(record.y !== undefined ? { y: record.y } : {}),
      ...(record.endX !== undefined ? { endX: record.endX } : {}),
      ...(record.endY !== undefined ? { endY: record.endY } : {}),
      ...(record.textLength !== undefined ? { textLength: record.textLength } : {}),
      ...(record.key !== undefined ? { key: record.key } : {}),
      ...(record.modifiers !== undefined ? { modifiers: record.modifiers } : {}),
      ...(record.direction !== undefined ? { direction: record.direction } : {}),
      ...(record.amount !== undefined ? { amount: record.amount } : {}),
    };
    const missingPrelude: (readonly [LifecycleEventType, Readonly<Record<string, unknown>>])[] = [];
    if (!computerEvents().some((event) => event.type === "ComputerPrepared")) {
      missingPrelude.push(["ComputerPrepared", { ...basePayload, recovered: true }]);
    }
    if (!computerEvents().some((event) => event.type === "ComputerApprovalDecided")) {
      missingPrelude.push(["ComputerApprovalDecided", {
        ...basePayload,
        decision: record.decision ?? (record.status === "failed" ? "unavailable" : "allow-once"),
        recovered: true,
      }]);
    }
    if (record.startedAt !== undefined && !computerEvents().some((event) => event.type === "ComputerStarted")) {
      missingPrelude.push(["ComputerStarted", { ...basePayload, startedAt: record.startedAt, recovered: true }]);
    }
    if (computerEvents().some((event) => event.type === "ComputerCompleted")) {
      if (missingPrelude.length > 0) {
        await this.repairActionPreludeBeforeTerminal("actionId", record.actionId, ["ComputerCompleted"], missingPrelude);
      }
      return;
    }
    for (const [type, payload] of missingPrelude) {
      await this.appendRecoveredEvent(type, payload);
      events = await this.readEvents();
    }
    await this.appendRecoveredEvent("ComputerCompleted", {
      ...basePayload,
      status: record.status,
      decision: record.decision ?? null,
      errorCode: record.errorCode ?? null,
      summary: record.summary ?? null,
      errorMessage: record.errorMessage ?? null,
      recovered: true,
    });
  }

  async ensureMemoryTerminalEvent(record: MemoryActionRecord): Promise<void> {
    if (record.status !== "committed" && record.status !== "denied" && record.status !== "failed") return;
    let events = await this.readEvents();
    const memoryEvents = () => events.filter((event) => event.payload.operationId === record.operationId);
    const terminalTypes: readonly LifecycleEventType[] = ["MemoryCommitted", "MemoryForgotten", "MemoryFailed"];

    // The action history is durable before its normalized event. Reconstruct
    // the prepared/approval prelude from hash-only evidence after an
    // acknowledgement loss; memory contents are intentionally not recovered
    // from this record and no memory write is replayed.
    const risk = record.operation === "add"
      ? "remember"
      : record.operation === "replace"
        ? "replace"
        : record.operation === "remove"
          ? "forget"
          : "batch";
    const basePayload: Record<string, unknown> = {
      operationId: record.operationId,
      callId: record.callId,
      ...(record.correlationId ? { correlationId: record.correlationId } : {}),
      operation: record.operation,
      recordId: record.recordId ?? null,
      scope: record.scope,
      sourcePath: record.sourcePath,
      beforeContentHash: record.beforeContentHash ?? null,
      afterContentHash: record.afterContentHash ?? null,
      risk,
    };
    const missingPrelude: (readonly [LifecycleEventType, Readonly<Record<string, unknown>>])[] = [];
    if (!memoryEvents().some((event) => event.type === "MemoryPrepared")) {
      missingPrelude.push(["MemoryPrepared", { ...basePayload, recovered: true }]);
    }
    if (!memoryEvents().some((event) => event.type === "MemoryApprovalDecided")) {
      missingPrelude.push(["MemoryApprovalDecided", {
        ...basePayload,
        decision: record.decision ?? (record.status === "denied" ? "unavailable" : "allow-once"),
        recovered: true,
      }]);
    }
    if (memoryEvents().some((event) => terminalTypes.includes(event.type))) {
      if (missingPrelude.length > 0) {
        await this.repairActionPreludeBeforeTerminal("operationId", record.operationId, terminalTypes, missingPrelude);
      }
      return;
    }
    for (const [type, payload] of missingPrelude) {
      await this.appendRecoveredEvent(type, payload);
      events = await this.readEvents();
    }
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
    let events = await this.readEvents();
    const terminalTypes: readonly LifecycleEventType[] = ["WorkspaceMutationCommitted", "WorkspaceMutationFailed", "WorkspaceMutationReconciled"];
    if (events.some((event) => terminalTypes.includes(event.type) && event.payload.mutationId === record.mutationId)) return;

    // The mutation record and lifecycle stream are separate durable files. If
    // the record write is acknowledged by the filesystem but the first event
    // append is interrupted, recovery must rebuild the approval boundary from
    // the bounded record before it can append a terminal observation. This is
    // deliberately local to workspace mutations; it does not claim a
    // cross-file transaction or infer that a side effect was applied.
    const mutationEvents = () => events.filter((event) => isWorkspaceMutationLifecycleEvent(event.type) && event.payload.mutationId === record.mutationId);
    const basePayload: Record<string, unknown> = {
      mutationId: record.mutationId,
      ...(record.callId ? { callId: record.callId } : {}),
      operation: record.operation,
      ...(record.risk ? { risk: record.risk } : {}),
      path: record.path,
      ...(record.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: record.approvalTimeoutMs } : {}),
      ...(record.paths ? { paths: record.paths } : {}),
      ...(record.members ? {
        members: record.members.map((member) => ({
          path: member.path,
          operation: member.operation,
          beforeHash: member.beforeHash,
          afterHash: member.afterHash,
        })),
      } : {}),
      ...(record.beforeHash ? { beforeHash: record.beforeHash } : {}),
      ...(record.afterHash ? { afterHash: record.afterHash } : {}),
      ...(record.sourcePath ? { sourcePath: record.sourcePath } : {}),
      ...(record.sourceHash ? { sourceHash: record.sourceHash } : {}),
      ...(record.manifestHash ? { manifestHash: record.manifestHash } : {}),
      ...(record.entryCount !== undefined ? { entryCount: record.entryCount } : {}),
      ...(record.totalBytes !== undefined ? { totalBytes: record.totalBytes } : {}),
      ...(record.maxBytes !== undefined ? { maxBytes: record.maxBytes } : {}),
      ...(record.maxDepth !== undefined ? { maxDepth: record.maxDepth } : {}),
    };
    if (!mutationEvents().some((event) => event.type === "WorkspaceMutationProposed")) {
      await this.appendEvent("WorkspaceMutationProposed", { ...basePayload, recovered: true });
      events = await this.readEvents();
    }
    if (!mutationEvents().some((event) => event.type === "WorkspaceMutationApprovalDecided")) {
      const decision = record.decision ?? (record.status === "denied" ? "unavailable" : "allow-once");
      await this.appendEvent("WorkspaceMutationApprovalDecided", {
        ...basePayload,
        decision,
        ...(record.reason ? { reason: record.reason } : {}),
        recovered: true,
      });
      events = await this.readEvents();
    }
    if (record.status === "committed" && !mutationEvents().some((event) => event.type === "WorkspaceMutationApplying")) {
      await this.appendEvent("WorkspaceMutationApplying", {
        ...basePayload,
        decision: "allow-once",
        recovered: true,
      });
      events = await this.readEvents();
    }
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
      throw new AnesuError(
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
