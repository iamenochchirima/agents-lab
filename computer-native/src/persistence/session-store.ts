import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  asSessionId,
  asTurnId,
  isTerminalStatus,
  terminalEventType,
  type LifecycleEvent,
  type LifecycleEventType,
  type SessionId,
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
  ensureDirectory,
  readJson,
  readJsonLines,
  redactRecord,
  safePathSegment,
} from "./json.js";
import { assertTransition } from "../runtime/state.js";
import { SessionLock } from "./lock.js";
import { assertMutationTransition, type WorkspaceMutationRecord } from "../workspace/mutation.js";
import { assertProcessTransition, type ProcessExecutionRecord } from "../process/process.js";
import { assertBrowserActionTransition, type BrowserActionRecord } from "../browser/records.js";

const NON_TERMINAL_STATES: readonly TurnStatus[] = ["submitting", "streaming"];

function now(): string {
  return new Date().toISOString();
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

function turnDirectory(sessionDirectory: string, idValue: string): string {
  return path.join(sessionDirectory, "turns", safePathSegment(idValue, "Turn ID"));
}

function terminalStateFromResult(result: TurnResult): Exclude<TurnStatus, "idle"> {
  return result.status;
}

function validateRound(round: RoundEvidence, sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  if (round.schemaVersion !== 1 || round.sessionId !== sessionId || round.turnId !== turnId || !Number.isInteger(round.round) || round.round < 1) {
    throw new ComputerNativeError("persistence", `Turn '${turnId}' contains an invalid round record. Repair it before continuing.`);
  }
  if ((round.phase === "tool_requested" || round.phase === "tool_completed") && (!round.callId || !round.toolName)) {
    throw new ComputerNativeError("persistence", `Turn '${turnId}' contains a tool round without call identity. Repair it before continuing.`);
  }
}

function validateRoundOrder(rounds: readonly RoundEvidence[], sessionId: SessionId, turnId: TurnRecord["turnId"]): void {
  let previous: RoundEvidence | undefined;
  const callIds = new Set<string>();
  for (const round of rounds) {
    validateRound(round, sessionId, turnId);
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

export class SessionStore {
  private constructor(
    readonly stateDir: string,
    readonly sessionDirectory: string,
    readonly metadata: SessionMetadata,
  ) {}

  static async open(stateDir: string, requestedSessionId?: string): Promise<SessionStore> {
    await ensureDirectory(path.join(stateDir, "sessions"));
    const selectedId = requestedSessionId ? safePathSegment(requestedSessionId, "Session ID") : sessionId();
    const sessionDirectory = path.join(stateDir, "sessions", selectedId);
    const metadataPath = path.join(sessionDirectory, "session.json");
    try {
      const metadata = await readJson<SessionMetadata>(metadataPath);
      if (metadata.sessionId !== selectedId || metadata.schemaVersion !== 1) {
        throw new ComputerNativeError("persistence", "The session metadata is invalid.");
      }
      return new SessionStore(stateDir, sessionDirectory, metadata);
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
      await atomicWriteJson(metadataPath, metadata);
      return new SessionStore(stateDir, sessionDirectory, metadata);
    }
  }

  async acquireLock(): Promise<SessionLock> {
    return SessionLock.acquire(path.join(this.sessionDirectory, ".lock"));
  }

  async readTranscript(): Promise<TranscriptMessage[]> {
    return readJsonLines<TranscriptMessage>(path.join(this.sessionDirectory, "transcript.jsonl"));
  }

  async admitTurn(userPrompt: string, provider: TurnRecord["provider"], model: string): Promise<TurnStore> {
    const content = userPrompt.trim();
    if (content.length === 0) throw new ComputerNativeError("invalid-input", "A message is required.");
    const selectedTurnId = asTurnId(turnId());
    const createdAt = now();
    const directory = turnDirectory(this.sessionDirectory, selectedTurnId);
    await ensureDirectory(directory);
    const record: TurnRecord = {
      schemaVersion: 1,
      sessionId: this.metadata.sessionId,
      turnId: selectedTurnId,
      provider,
      model,
      state: "submitting",
      userMessagePersisted: false,
      createdAt,
      updatedAt: createdAt,
    };
    await atomicWriteJson(path.join(directory, "turn.json"), record);
    const message: TranscriptMessage = {
      schemaVersion: 1,
      messageId: `${selectedTurnId}_user`,
      sessionId: this.metadata.sessionId,
      turnId: selectedTurnId,
      role: "user",
      content,
      createdAt,
    };
    await appendJsonLine(path.join(this.sessionDirectory, "transcript.jsonl"), message);
    await atomicWriteJson(path.join(directory, "turn.json"), { ...record, userMessagePersisted: true, updatedAt: now() });
    return new TurnStore(this, directory, { ...record, userMessagePersisted: true });
  }

  async recoverInterruptedTurns(reconcileMutation?: (record: WorkspaceMutationRecord) => Promise<WorkspaceMutationRecord>): Promise<TurnResult[]> {
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
      } catch (error) {
        throw new ComputerNativeError("persistence", `Turn '${entry.name}' has no valid turn record. Repair it before continuing.`, { cause: error });
      }
      const resultPath = path.join(directory, "result.json");
      let result: TurnResult | undefined;
      try {
        result = await readJson<TurnResult>(resultPath);
      } catch (error) {
        if (!(error instanceof ComputerNativeError) || !error.message.startsWith("Could not read")) throw error;
      }
      const turn = new TurnStore(this, directory, record);
      for (const execution of await turn.readProcesses()) {
        if (execution.status === "prepared") {
          await turn.writeProcess({ ...execution, status: "failed", errorCode: "process-approval-unavailable", errorMessage: "The process approval ended when the parent process stopped; the command was not replayed.", finishedAt: now(), recordedAt: now() });
        } else if (execution.status === "approved") {
          await turn.writeProcess({ ...execution, status: "failed", errorCode: "process-approval-unavailable", errorMessage: "The approved process had not reached a launch record when the parent process stopped; the command was not replayed.", finishedAt: now(), recordedAt: now() });
        } else if (execution.status === "running") {
          await turn.writeProcess({ ...execution, status: "ambiguous", errorCode: "process-ambiguous", errorMessage: "The process was running when the parent process stopped; its outcome is unknown and the command was not replayed.", finishedAt: now(), recordedAt: now() });
        }
      }
      for (const action of await turn.readBrowserActions()) {
        if (action.status === "prepared") {
          await turn.writeBrowserAction({
            ...action,
            status: "failed",
            errorCode: "browser-approval-unavailable",
            errorMessage: "The browser approval ended when the parent process stopped; the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          });
        } else if (action.status === "approved") {
          await turn.writeBrowserAction({
            ...action,
            status: "failed",
            errorCode: "browser-approval-unavailable",
            errorMessage: "The approved browser action had not started when the parent process stopped; the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          });
        } else if (action.status === "running") {
          await turn.writeBrowserAction({
            ...action,
            status: "ambiguous",
            errorCode: "browser-ambiguous",
            errorMessage: "The browser action was running when the parent process stopped; its outcome is unknown and the action was not replayed.",
            finishedAt: now(),
            recordedAt: now(),
          });
        }
      }
      if (result) {
        if (!isTerminalStatus(record.state)) await turn.updateState(terminalStateFromResult(result));
        await turn.ensureTerminalEvent(result);
        continue;
      }
      if (isTerminalStatus(record.state)) {
        throw new ComputerNativeError("persistence", `Turn '${record.turnId}' is terminal but has no result record.`);
      }
      for (const mutation of await turn.readMutations()) {
        if (mutation.status === "proposed") {
          await turn.writeMutation({
            ...mutation,
            status: "denied",
            decision: "unavailable",
            errorCode: "approval-unavailable",
            reason: "The process stopped before approval was decided; the mutation was not applied.",
          });
        } else if (reconcileMutation && (mutation.status === "approved" || mutation.status === "applying")) {
          await turn.writeMutation(await reconcileMutation(mutation));
        }
      }
      const hasUserMessage = transcript.some((message) => message.turnId === record.turnId && message.role === "user");
      if (!record.userMessagePersisted && !hasUserMessage) {
        throw new ComputerNativeError("persistence", `Turn '${record.turnId}' is incomplete: its user message is missing. Repair it before continuing.`);
      }
      const interrupted: TurnResult = {
        schemaVersion: 1,
        sessionId: record.sessionId,
        turnId: record.turnId,
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
    await appendJsonLine(path.join(this.sessionDirectory, "transcript.jsonl"), message);
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

  get state(): TurnStatus {
    return this.record.state;
  }

  async appendEvent(type: LifecycleEventType, payload: Readonly<Record<string, unknown>> = {}): Promise<LifecycleEvent> {
    const eventsPath = path.join(this.directory, "events.jsonl");
    const existing = await readJsonLines<LifecycleEvent>(eventsPath);
    const event: LifecycleEvent = {
      schemaVersion: 1,
      eventId: id("event"),
      sequence: existing.length + 1,
      type,
      recordedAt: now(),
      sessionId: this.record.sessionId,
      turnId: this.record.turnId,
      payload: redactRecord(payload) as Readonly<Record<string, unknown>>,
    };
    await appendJsonLine(eventsPath, event);
    return event;
  }

  async readEvents(): Promise<LifecycleEvent[]> {
    return readJsonLines<LifecycleEvent>(path.join(this.directory, "events.jsonl"));
  }

  async appendRound(round: RoundEvidence): Promise<void> {
    const existing = await this.readRounds();
    validateRoundOrder([...existing, round], this.sessionId, this.turnId);
    await appendJsonLine(path.join(this.directory, "rounds.jsonl"), redactRecord(round));
  }

  async readRounds(): Promise<RoundEvidence[]> {
    const rounds = await readJsonLines<RoundEvidence>(path.join(this.directory, "rounds.jsonl"));
    validateRoundOrder(rounds, this.sessionId, this.turnId);
    return rounds;
  }

  async writeMutation(record: WorkspaceMutationRecord): Promise<void> {
    if (record.schemaVersion !== 1 || record.mutationId.trim().length === 0 || record.diff.length === 0) {
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' contains an invalid workspace mutation record.`);
    }
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
    if (previous) assertMutationTransition(previous, record);
    await atomicWriteJson(recordPath, record);
  }

  async writeProcess(record: ProcessExecutionRecord): Promise<void> {
    if (record.schemaVersion !== 1 || record.executionId.trim().length === 0 || record.callId.trim().length === 0) {
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' contains an invalid process execution record.`);
    }
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
      try {
        assertProcessTransition(previous, record);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Process execution '${record.executionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await atomicWriteJson(recordPath, record);
  }

  async readProcesses(): Promise<ProcessExecutionRecord[]> {
    const directory = path.join(this.directory, "executions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' process records cannot be listed.`, { cause: error });
    });
    const records: ProcessExecutionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      records.push(await readJson<ProcessExecutionRecord>(path.join(directory, entry.name)));
    }
    return records;
  }

  async writeBrowserAction(record: BrowserActionRecord): Promise<void> {
    if (record.schemaVersion !== 1 || record.actionId.trim().length === 0 || record.callId.trim().length === 0) {
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' contains an invalid browser action record.`);
    }
    if (record.turnId !== this.turnId) {
      throw new ComputerNativeError("persistence", `Browser action '${record.actionId}' does not belong to turn '${this.turnId}'.`);
    }
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
      try {
        assertBrowserActionTransition(previous, record);
      } catch (error) {
        throw new ComputerNativeError("persistence", `Browser action '${record.actionId}' has an invalid state transition: ${error instanceof Error ? error.message : "unknown transition error"}.`, { cause: error });
      }
    }
    await atomicWriteJson(recordPath, record);
  }

  async readBrowserActions(): Promise<BrowserActionRecord[]> {
    const directory = path.join(this.directory, "browser-actions");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' browser action records cannot be listed.`, { cause: error });
    });
    const records: BrowserActionRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      records.push(await readJson<BrowserActionRecord>(path.join(directory, entry.name)));
    }
    return records;
  }

  async readMutations(): Promise<WorkspaceMutationRecord[]> {
    const directory = path.join(this.directory, "mutations");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ComputerNativeError("persistence", `Turn '${this.turnId}' mutation records cannot be listed.`, { cause: error });
    });
    const records: WorkspaceMutationRecord[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      records.push(await readJson<WorkspaceMutationRecord>(path.join(directory, entry.name)));
    }
    return records;
  }

  async updateState(nextState: Exclude<TurnStatus, "idle">): Promise<void> {
    if (this.record.state !== nextState) assertTransition(this.record.state, nextState);
    this.record = { ...this.record, state: nextState, updatedAt: now() };
    await atomicWriteJson(path.join(this.directory, "turn.json"), this.record);
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
    const resultPath = path.join(this.directory, "result.json");
    try {
      const existing = await readJson<TurnResult>(resultPath);
      if (JSON.stringify(existing) !== JSON.stringify(result)) {
        throw new ComputerNativeError("persistence", `Turn '${this.turnId}' already has a different terminal result.`);
      }
      return;
    } catch (error) {
      if (error instanceof ComputerNativeError && !error.message.startsWith("Could not read")) throw error;
    }
    await atomicWriteJson(resultPath, result);
  }

  async ensureTerminalEvent(result: TurnResult): Promise<void> {
    const events = await this.readEvents();
    const expected = terminalEventType(result.status);
    if (events.some((event) => event.type === expected)) return;
    await this.appendEvent(expected, { status: result.status, recovered: true });
  }

  async commitTerminal(
    result: TurnResult,
    terminalType: LifecycleEventType,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.writeResult(result);
    await this.updateState(result.status);
    await this.appendEvent(terminalType, payload);
  }
}

export function isNonTerminalState(state: TurnStatus): boolean {
  return NON_TERMINAL_STATES.includes(state);
}

export function isTerminalResult(value: unknown): value is TurnResult {
  return Boolean(value && typeof value === "object" && isTerminalStatus((value as TurnResult).status));
}
