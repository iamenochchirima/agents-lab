import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, sep as pathSeparator } from "node:path";

import {
  DEFAULT_CONTEXT_SESSION_LIMITS,
  type ContextMessage,
  type ContextProjection,
  type ContextSessionLimits,
  type ContextSnapshot,
} from "./contracts.js";

const SESSION_SCHEMA_VERSION = 1 as const;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_AFTER_MS = 30_000;

export interface ContextSession {
  readonly schemaVersion: typeof SESSION_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly platform: string;
  readonly variant: string;
  readonly model: string;
  readonly systemInstruction: string;
  readonly contextWindowTokens: number | null;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly compactionThresholdPercent: number;
  readonly recentMessageGroups: number;
  readonly maxSessionBytes: number;
  readonly maxTranscriptBytes: number;
  readonly revision: number;
  readonly activeTurnId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateContextSessionInput {
  readonly sessionId?: string;
  readonly platform: string;
  readonly variant: string;
  readonly model: string;
  readonly systemInstruction: string;
  readonly contextWindowTokens: number | null;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly compactionThresholdPercent: number;
  readonly recentMessageGroups?: number;
  readonly now?: string;
}

export type ContextTurnStatus = "admitted" | "running" | "completed" | "failed" | "cancelled";

export interface ContextTurn {
  readonly schemaVersion: typeof SESSION_SCHEMA_VERSION;
  readonly turnId: string;
  readonly sessionId: string;
  readonly runId: string;
  /** Stable client key for retrying this turn, or null for legacy callers. */
  readonly clientTurnId: string | null;
  readonly status: ContextTurnStatus;
  readonly userMessageId: string;
  readonly assistantMessageId: string | null;
  readonly sessionRevision: number;
  readonly contextSnapshotId: string | null;
  readonly output: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdmittedContextTurn {
  readonly session: ContextSession;
  readonly turn: ContextTurn;
  readonly userMessage: ContextMessage;
  readonly transcript: readonly ContextMessage[];
}

export class ContextSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Context session was not found: ${sessionId}`);
    this.name = "ContextSessionNotFoundError";
  }
}

export class ContextSessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextSessionConflictError";
  }
}

export class ContextSessionLimitError extends Error {
  constructor(
    readonly kind: "session" | "transcript",
    readonly limitBytes: number,
    readonly attemptedBytes: number,
  ) {
    super(`Context ${kind} size limit exceeded: ${attemptedBytes} bytes would exceed the ${limitBytes}-byte limit.`);
    this.name = "ContextSessionLimitError";
  }
}

export class ContextSessionBusyError extends Error {
  constructor(readonly sessionId: string, readonly turnId: string) {
    super(`Context session ${sessionId} already has an active turn: ${turnId}`);
    this.name = "ContextSessionBusyError";
  }
}

export class ContextSessionStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly rootDirectory: string,
    private readonly limits: ContextSessionLimits = DEFAULT_CONTEXT_SESSION_LIMITS,
  ) {
    validateSessionLimits(limits);
  }

  async create(input: CreateContextSessionInput): Promise<ContextSession> {
    const sessionId = input.sessionId ?? `session-${randomUUID()}`;
    assertSafeSessionId(sessionId);
    validateSessionInput(input);
    const sessionDirectory = this.sessionDirectory(sessionId);
    await mkdir(sessionDirectory, { recursive: true });

    const session = await this.withLock(sessionId, async () => {
      const existing = await this.readOptionalJson<ContextSession>(this.sessionPath(sessionId));
      if (existing) {
        const normalized = normalizeSession(existing, this.limits);
        if (!sameSessionConfiguration(normalized, input, this.limits)) {
          throw new ContextSessionConflictError(`Session already exists with different configuration: ${sessionId}`);
        }
        return normalized;
      }

      const now = input.now ?? new Date().toISOString();
      const created: ContextSession = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        platform: input.platform,
        variant: input.variant,
        model: input.model,
        systemInstruction: input.systemInstruction,
        contextWindowTokens: input.contextWindowTokens,
        reservedOutputTokens: input.reservedOutputTokens,
        safetyMarginTokens: input.safetyMarginTokens,
        compactionThresholdPercent: input.compactionThresholdPercent,
        recentMessageGroups: input.recentMessageGroups ?? 0,
        maxSessionBytes: this.limits.maxSessionBytes,
        maxTranscriptBytes: this.limits.maxTranscriptBytes,
        revision: 0,
        activeTurnId: null,
        createdAt: now,
        updatedAt: now,
      };
      await mkdir(join(sessionDirectory, "snapshots"), { recursive: true });
      const transcriptPath = join(sessionDirectory, "transcript.jsonl");
      const turnsPath = join(sessionDirectory, "turns.jsonl");
      const revisionsPath = join(sessionDirectory, "context-revisions.jsonl");
      await assertSessionWritesWithinLimits(sessionDirectory, this.limits, [
        { path: this.sessionPath(sessionId), contents: serializeJson(created) },
        { path: transcriptPath, contents: "", transcript: true },
        { path: turnsPath, contents: "" },
        { path: revisionsPath, contents: "" },
      ]);
      await writeFile(transcriptPath, "", { encoding: "utf8", flag: "wx" });
      await writeFile(turnsPath, "", { encoding: "utf8", flag: "wx" });
      await writeFile(revisionsPath, "", { encoding: "utf8", flag: "wx" });
      await atomicWriteText(this.sessionPath(sessionId), serializeJson(created));
      return created;
    });
    return session;
  }

  async read(sessionId: string): Promise<ContextSession> {
    assertSafeSessionId(sessionId);
    try {
      return normalizeSession(await this.readJson<ContextSession>(this.sessionPath(sessionId)), this.limits);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new ContextSessionNotFoundError(sessionId);
      throw error;
    }
  }

  async readTranscript(sessionId: string): Promise<readonly ContextMessage[]> {
    const session = await this.read(sessionId);
    const path = join(this.sessionDirectory(sessionId), "transcript.jsonl");
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new ContextSessionNotFoundError(sessionId);
      throw error;
    }
    assertTranscriptSize(contents, session.maxTranscriptBytes);
    if (!contents) return [];
    const messages: ContextMessage[] = [];
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (index === lines.length - 1 && line === "") continue;
      if (!line.trim()) throw new ContextSessionConflictError(`Blank context message at transcript line ${index + 1}.`);
      const message = JSON.parse(line) as ContextMessage;
      validateStoredMessage(message, sessionId, messages.at(-1));
      messages.push(message);
    }
    return messages;
  }

  async admitTurn(
    sessionId: string,
    runId: string,
    prompt: string,
    now = new Date().toISOString(),
    clientTurnId?: string,
  ): Promise<AdmittedContextTurn> {
    assertSafeSessionId(sessionId);
    if (!runId.trim()) throw new ContextSessionConflictError("A context turn requires a run ID.");
    if (!prompt.trim()) throw new ContextSessionConflictError("A context turn requires a non-empty prompt.");
    validateClientTurnId(clientTurnId);
    const normalizedPrompt = prompt.trim();

    return this.serialized(sessionId, async () => this.withLock(sessionId, async () => {
      const session = await this.read(sessionId);
      const turns = await this.readTurnRecords(sessionId);
      const existingByRun = turns.find((turn) => turn.runId === runId);
      const existingByClient = clientTurnId === undefined
        ? undefined
        : turns.find((turn) => turn.clientTurnId === clientTurnId);
      if (existingByRun && existingByClient && existingByRun.turnId !== existingByClient.turnId) {
        throw new ContextSessionConflictError(`Run ${runId} and clientTurnId ${clientTurnId} identify different context turns.`);
      }
      const existing = existingByClient ?? existingByRun;
      if (existing) {
        const transcript = await this.readTranscript(sessionId);
        const userMessage = transcript.find((message) => message.messageId === existing.userMessageId);
        if (!userMessage) throw new ContextSessionConflictError(`Turn ${existing.turnId} has no persisted user message.`);
        if (userMessage.content !== normalizedPrompt) {
          throw new ContextSessionConflictError(`Context turn ${existing.turnId} already has a different prompt.`);
        }
        if (clientTurnId !== undefined && existing.clientTurnId !== clientTurnId) {
          throw new ContextSessionConflictError(`Run ${existing.runId} already has a different clientTurnId.`);
        }
        if (session.activeTurnId === null && existing.status !== "completed" && existing.status !== "failed" && existing.status !== "cancelled") {
          const repairedSession = { ...session, revision: Math.max(session.revision, userMessage.sequence), activeTurnId: existing.turnId, updatedAt: now };
          await this.writeSessionJson(sessionId, repairedSession, session);
          return { session: repairedSession, turn: existing, userMessage, transcript };
        }
        return { session, turn: existing, userMessage, transcript };
      }
      if (session.activeTurnId) throw new ContextSessionBusyError(sessionId, session.activeTurnId);

      const transcript = await this.readTranscript(sessionId);
      const partiallyAdmitted = transcript.find((message) => message.role === "user" && message.metadata?.runId === runId);
      if (partiallyAdmitted) {
        const turnId = partiallyAdmitted.metadata?.turnId;
        if (!turnId) throw new ContextSessionConflictError(`Partially admitted turn has no turn ID: ${runId}`);
        const repairedTurn: ContextTurn = {
          schemaVersion: SESSION_SCHEMA_VERSION,
          turnId,
          sessionId,
          runId,
          clientTurnId: partiallyAdmitted.metadata?.clientTurnId ?? clientTurnId ?? null,
          status: "admitted",
          userMessageId: partiallyAdmitted.messageId,
          assistantMessageId: null,
          sessionRevision: partiallyAdmitted.sequence,
          contextSnapshotId: null,
          output: null,
          error: null,
          createdAt: partiallyAdmitted.createdAt,
          updatedAt: now,
        };
        const repairedSession = { ...session, revision: Math.max(session.revision, partiallyAdmitted.sequence), activeTurnId: turnId, updatedAt: now };
        await this.writeSessionRecords(sessionId, [
          { path: join(this.sessionDirectory(sessionId), "turns.jsonl"), value: repairedTurn },
          { path: this.sessionPath(sessionId), value: repairedSession, replace: true },
        ], session);
        return { session: repairedSession, turn: repairedTurn, userMessage: partiallyAdmitted, transcript };
      }

      const turnId = `turn-${randomUUID()}`;
      const userMessage: ContextMessage = {
        schemaVersion: 1,
        messageId: `message-${randomUUID()}`,
        sessionId,
        sequence: session.revision + 1,
        role: "user",
        content: normalizedPrompt,
        source: "transcript",
        createdAt: now,
        metadata: {
          turnId,
          runId,
          ...(clientTurnId === undefined ? {} : { clientTurnId }),
        },
      };
      const turn: ContextTurn = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        turnId,
        sessionId,
        runId,
        clientTurnId: clientTurnId ?? null,
        status: "admitted",
        userMessageId: userMessage.messageId,
        assistantMessageId: null,
        sessionRevision: userMessage.sequence,
        contextSnapshotId: null,
        output: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      const updatedSession = { ...session, revision: userMessage.sequence, activeTurnId: turnId, updatedAt: now };
      await this.writeSessionRecords(sessionId, [
        { path: join(this.sessionDirectory(sessionId), "transcript.jsonl"), value: userMessage, transcript: true },
        { path: join(this.sessionDirectory(sessionId), "turns.jsonl"), value: turn },
        { path: this.sessionPath(sessionId), value: updatedSession, replace: true },
      ], session);
      return { session: updatedSession, turn, userMessage, transcript: [...transcript, userMessage] };
    }));
  }

  async markRunning(sessionId: string, turnId: string, contextSnapshotId: string, now = new Date().toISOString()): Promise<ContextTurn> {
    return this.updateTurn(sessionId, turnId, (turn) => {
      if (turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled") {
        throw new ContextSessionConflictError(`A terminal context turn cannot be marked running: ${turnId}`);
      }
      if (turn.status === "running" && turn.contextSnapshotId === contextSnapshotId) return turn;
      return { ...turn, status: "running", contextSnapshotId, updatedAt: now };
    });
  }

  async readTurn(sessionId: string, turnId: string): Promise<ContextTurn | null> {
    assertSafeSessionId(sessionId);
    await this.read(sessionId);
    const turns = await this.readTurnRecords(sessionId);
    return turns.find((turn) => turn.turnId === turnId) ?? null;
  }

  async settleTurn(
    sessionId: string,
    turnId: string,
    outcome: { readonly status: Exclude<ContextTurnStatus, "admitted" | "running">; readonly output?: string | null; readonly error?: string | null },
    now = new Date().toISOString(),
  ): Promise<ContextTurn> {
    return this.serialized(sessionId, async () => this.withLock(sessionId, async () => {
      const session = await this.read(sessionId);
      const turns = await this.readTurnRecords(sessionId);
      const turn = turns.find((candidate) => candidate.turnId === turnId);
      if (!turn) throw new ContextSessionConflictError(`Context turn was not found: ${turnId}`);
      if (turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled") {
        if (turn.status !== outcome.status || turn.output !== (outcome.output ?? null) || turn.error !== (outcome.error ?? null)) {
          throw new ContextSessionConflictError(`Context turn already settled differently: ${turnId}`);
        }
        const transcript = await this.readTranscript(sessionId);
        const repairedRevision = Math.max(session.revision, transcript.at(-1)?.sequence ?? 0);
        if (session.activeTurnId !== turnId && session.revision === repairedRevision) return turn;
        await this.writeSessionJson(sessionId, {
          ...session,
          revision: repairedRevision,
          activeTurnId: session.activeTurnId === turnId ? null : session.activeTurnId,
          updatedAt: now,
        }, session);
        return turn;
      }

      let assistantMessageId: string | null = turn.assistantMessageId;
      let transcript: readonly ContextMessage[] | null = null;
      let transcriptContents: string | null = null;
      if (outcome.status === "completed") {
        const output = outcome.output?.trim() ?? "";
        if (!output) throw new ContextSessionConflictError("A completed context turn requires non-empty output.");
        transcript = await this.readTranscript(sessionId);
        const existingAssistant = transcript.find((message) => message.role === "assistant" && message.metadata?.turnId === turnId);
        assistantMessageId = existingAssistant?.messageId ?? `message-${randomUUID()}`;
        if (!existingAssistant) {
          const assistantMessage = {
            schemaVersion: 1,
            messageId: assistantMessageId,
            sessionId,
            sequence: session.revision + 1,
            role: "assistant",
            content: output,
            source: "transcript",
            createdAt: now,
            metadata: { turnId },
          } satisfies ContextMessage;
          transcriptContents = await appendedJsonLineContents(
            join(this.sessionDirectory(sessionId), "transcript.jsonl"),
            assistantMessage,
          );
        } else if (existingAssistant.content !== output) {
          throw new ContextSessionConflictError(`Context turn already has different assistant output: ${turnId}`);
        }
      }
      const settled: ContextTurn = {
        ...turn,
        status: outcome.status,
        assistantMessageId,
        output: outcome.output ?? null,
        error: outcome.error ?? null,
        updatedAt: now,
      };
      const updatedSession = {
        ...session,
        revision: outcome.status === "completed" ? session.revision + 1 : session.revision,
        activeTurnId: session.activeTurnId === turnId ? null : session.activeTurnId,
        updatedAt: now,
      };
      await this.writeSessionRecords(sessionId, [
        ...(transcriptContents === null ? [] : [{
          path: join(this.sessionDirectory(sessionId), "transcript.jsonl"),
          contents: transcriptContents,
          transcript: true,
        }]),
        { path: join(this.sessionDirectory(sessionId), "turns.jsonl"), value: settled },
        { path: this.sessionPath(sessionId), value: updatedSession, replace: true },
      ], session);
      return settled;
    }));
  }

  async writeSnapshot(snapshot: ContextSnapshot): Promise<void> {
    assertSafeSessionId(snapshot.sessionId);
    await this.serialized(snapshot.sessionId, async () => this.withLock(snapshot.sessionId, async () => {
      const session = await this.read(snapshot.sessionId);
      const path = join(this.sessionDirectory(snapshot.sessionId), "snapshots", `${safeFileName(snapshot.snapshotId)}.json`);
      const existing = await this.readOptionalJson<ContextSnapshot>(path);
      if (existing) {
        if (!deepEqual(existing, snapshot)) throw new ContextSessionConflictError(`Context snapshot already exists with different content: ${snapshot.snapshotId}`);
        await appendContextRevisionIfMissing(this.sessionDirectory(snapshot.sessionId), snapshot, session);
        return;
      }
      if (snapshot.sessionRevision > session.revision) throw new ContextSessionConflictError("Context snapshot references a future session revision.");
      await this.writeSessionRecords(snapshot.sessionId, [
        { path, value: snapshot, replace: true },
        { path: join(this.sessionDirectory(snapshot.sessionId), "context-revisions.jsonl"), value: {
        snapshotId: snapshot.snapshotId,
        sessionId: snapshot.sessionId,
        sessionRevision: snapshot.sessionRevision,
        compactionRevision: snapshot.compactionRevision,
        budget: snapshot.budget,
        compaction: snapshot.compaction,
        createdAt: snapshot.createdAt,
        } },
      ], session);
    }));
  }

  async readSnapshot(sessionId: string, snapshotId: string): Promise<ContextSnapshot> {
    assertSafeSessionId(sessionId);
    const path = join(this.sessionDirectory(sessionId), "snapshots", `${safeFileName(snapshotId)}.json`);
    try {
      return await this.readJson<ContextSnapshot>(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new ContextSessionNotFoundError(sessionId);
      throw error;
    }
  }

  async latestSnapshot(sessionId: string): Promise<ContextSnapshot | null> {
    await this.read(sessionId);
    const snapshotDirectory = join(this.sessionDirectory(sessionId), "snapshots");
    let entries;
    try {
      entries = await readdir(snapshotDirectory);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    const snapshots = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.readJson<ContextSnapshot>(join(snapshotDirectory, entry))));
    return snapshots.sort((left, right) => (
      right.sessionRevision - left.sessionRevision
      || right.compactionRevision - left.compactionRevision
      || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    ))[0] ?? null;
  }

  async projection(sessionId: string): Promise<ContextProjection | null> {
    const snapshot = await this.latestSnapshot(sessionId);
    if (!snapshot) return null;
    return {
      scope: "session",
      sessionId: snapshot.sessionId,
      sessionRevision: snapshot.sessionRevision,
      compactionRevision: snapshot.compactionRevision,
      budget: snapshot.budget,
      updatedAt: snapshot.createdAt,
    };
  }

  private async writeSessionJson(sessionId: string, value: unknown, limits: ContextSessionLimits | ContextSession = this.limits): Promise<void> {
    await this.writeSessionRecords(sessionId, [{
      path: this.sessionPath(sessionId),
      value,
      replace: true,
    }], limits);
  }

  private async writeSessionRecords(
    sessionId: string,
    records: readonly SessionRecordWrite[],
    limits: ContextSessionLimits | ContextSession = this.limits,
  ): Promise<void> {
    const pending = await Promise.all(records.map(async (record) => {
      const contents = record.contents ?? (record.replace
        ? serializeJson(record.value)
        : `${await readTextIfPresent(record.path)}${serializeJsonLine(record.value)}`);
      return {
        path: record.path,
        contents,
        transcript: record.transcript === true,
      } satisfies SessionFileWrite;
    }));
    await assertSessionWritesWithinLimits(this.sessionDirectory(sessionId), limits, pending);
    for (const record of pending) {
      await atomicWriteText(record.path, record.contents);
    }
  }

  private async updateTurn(sessionId: string, turnId: string, update: (turn: ContextTurn) => ContextTurn): Promise<ContextTurn> {
    return this.serialized(sessionId, async () => this.withLock(sessionId, async () => {
      const session = await this.read(sessionId);
      const turns = await this.readTurnRecords(sessionId);
      const current = turns.find((turn) => turn.turnId === turnId);
      if (!current) throw new ContextSessionConflictError(`Context turn was not found: ${turnId}`);
      const next = update(current);
      await this.writeSessionRecords(sessionId, [{ path: join(this.sessionDirectory(sessionId), "turns.jsonl"), value: next }], session);
      return next;
    }));
  }

  private async readTurnRecords(sessionId: string): Promise<ContextTurn[]> {
    const path = join(this.sessionDirectory(sessionId), "turns.jsonl");
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new ContextSessionNotFoundError(sessionId);
      throw error;
    }
    const latest = new Map<string, ContextTurn>();
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      const turn = JSON.parse(line) as ContextTurn;
      if (turn.sessionId !== sessionId || !turn.turnId) throw new ContextSessionConflictError("Invalid context turn record.");
      latest.set(turn.turnId, normalizeTurn(turn));
    }
    return [...latest.values()];
  }

  private sessionDirectory(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return join(this.rootDirectory, sessionId);
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionDirectory(sessionId), "session.json");
  }

  private async serialized<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(sessionId) === current) this.queues.delete(sessionId);
    }
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const directory = this.sessionDirectory(sessionId);
    const lockDirectory = join(directory, ".lock");
    const owner = join(lockDirectory, "owner");
    const started = Date.now();
    while (true) {
      try {
        await mkdir(lockDirectory);
        await writeFile(owner, `${process.pid}:${Date.now()}`, "utf8");
        break;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        try {
          const lockStats = await stat(lockDirectory);
          if (Date.now() - lockStats.mtimeMs > LOCK_STALE_AFTER_MS) {
            await unlink(owner).catch(() => undefined);
            await rmdir(lockDirectory).catch(() => undefined);
          }
        } catch (lockError) {
          if (!isNodeError(lockError, "ENOENT")) throw lockError;
        }
        if (Date.now() - started >= LOCK_TIMEOUT_MS) {
          throw new ContextSessionConflictError(`Timed out waiting for the context session lock: ${sessionId}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await operation();
    } finally {
      await readFile(owner, "utf8").then(async () => {
        await unlink(owner).catch(() => undefined);
        await rmdir(lockDirectory).catch(() => undefined);
      }).catch(() => undefined);
    }
  }

  private async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }

  private async readOptionalJson<T>(path: string): Promise<T | null> {
    try {
      return await this.readJson<T>(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }
}

interface SessionRecordWrite {
  readonly path: string;
  readonly value?: unknown;
  readonly contents?: string;
  readonly replace?: boolean;
  readonly transcript?: boolean;
}

interface SessionFileWrite {
  readonly path: string;
  readonly contents: string;
  readonly transcript?: boolean;
}

async function appendContextRevisionIfMissing(
  sessionDirectory: string,
  snapshot: ContextSnapshot,
  limits: ContextSessionLimits,
): Promise<void> {
  const path = join(sessionDirectory, "context-revisions.jsonl");
  let existingContents = "";
  try {
    existingContents = await readFile(path, "utf8");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  for (const [index, line] of existingContents.split("\n").entries()) {
    if (!line.trim()) continue;
    let record: { readonly snapshotId?: string };
    try {
      record = JSON.parse(line) as { readonly snapshotId?: string };
    } catch {
      throw new ContextSessionConflictError(`Invalid context revision at line ${index + 1}.`);
    }
    if (record.snapshotId === snapshot.snapshotId) return;
  }
  const nextContents = `${existingContents}${serializeJsonLine({
    snapshotId: snapshot.snapshotId,
    sessionId: snapshot.sessionId,
    sessionRevision: snapshot.sessionRevision,
    compactionRevision: snapshot.compactionRevision,
    budget: snapshot.budget,
    compaction: snapshot.compaction,
    createdAt: snapshot.createdAt,
  })}`;
  await assertSessionWritesWithinLimits(sessionDirectory, limits, [{ path, contents: nextContents }]);
  await atomicWriteText(path, nextContents);
}

async function appendedJsonLineContents(path: string, value: unknown): Promise<string> {
  return `${await readTextIfPresent(path)}${serializeJsonLine(value)}`;
}

async function readTextIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return "";
    throw error;
  }
}

async function atomicWriteText(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, path);
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function assertSessionWritesWithinLimits(
  sessionDirectory: string,
  limits: ContextSessionLimits,
  writes: readonly SessionFileWrite[],
): Promise<void> {
  const existingFiles = await collectSessionFileSizes(sessionDirectory);
  const updates = new Map<string, SessionFileWrite>();
  for (const write of writes) {
    const pathRelative = relative(sessionDirectory, write.path);
    if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${pathSeparator}`)) {
      throw new ContextSessionConflictError("A session write targeted a path outside the session directory.");
    }
    const existing = updates.get(write.path);
    if (existing && existing.contents !== write.contents) {
      throw new ContextSessionConflictError(`A session write targeted the same file with different content: ${write.path}`);
    }
    updates.set(write.path, write);
  }

  const existingBytes = [...existingFiles.values()].reduce((total, size) => total + size, 0);
  let projectedBytes = existingBytes;
  for (const write of updates.values()) {
    projectedBytes -= existingFiles.get(write.path) ?? 0;
    projectedBytes += Buffer.byteLength(write.contents, "utf8");
    if (write.transcript) {
      assertTranscriptSize(write.contents, limits.maxTranscriptBytes);
    }
  }
  if (projectedBytes > limits.maxSessionBytes) {
    throw new ContextSessionLimitError("session", limits.maxSessionBytes, projectedBytes);
  }
}

async function collectSessionFileSizes(directory: string, result = new Map<string, number>()): Promise<Map<string, number>> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return result;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === ".lock" || entry.name.endsWith(".tmp")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSessionFileSizes(path, result);
    } else if (entry.isFile()) {
      result.set(path, (await stat(path)).size);
    }
  }
  return result;
}

function assertTranscriptSize(contents: string, limitBytes: number): void {
  const attemptedBytes = Buffer.byteLength(contents, "utf8");
  if (attemptedBytes > limitBytes) {
    throw new ContextSessionLimitError("transcript", limitBytes, attemptedBytes);
  }
}

function validateSessionInput(input: CreateContextSessionInput): void {
  for (const [name, value] of Object.entries({ platform: input.platform, variant: input.variant, model: input.model, systemInstruction: input.systemInstruction })) {
    if (!value.trim()) throw new ContextSessionConflictError(`${name} must not be empty.`);
  }
  if (input.contextWindowTokens !== null && (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens <= 0)) throw new ContextSessionConflictError("contextWindowTokens must be positive or null.");
  for (const [name, value] of Object.entries({ reservedOutputTokens: input.reservedOutputTokens, safetyMarginTokens: input.safetyMarginTokens, recentMessageGroups: input.recentMessageGroups ?? 0 })) {
    if (!Number.isInteger(value) || value < 0) throw new ContextSessionConflictError(`${name} must be a non-negative integer.`);
  }
  if (!Number.isInteger(input.compactionThresholdPercent) || input.compactionThresholdPercent < 0 || input.compactionThresholdPercent > 100) throw new ContextSessionConflictError("compactionThresholdPercent must be between 0 and 100.");
}

function sameSessionConfiguration(session: ContextSession, input: CreateContextSessionInput, limits: ContextSessionLimits): boolean {
  return session.platform === input.platform
    && session.variant === input.variant
    && session.model === input.model
    && session.systemInstruction === input.systemInstruction
    && session.contextWindowTokens === input.contextWindowTokens
    && session.reservedOutputTokens === input.reservedOutputTokens
    && session.safetyMarginTokens === input.safetyMarginTokens
    && session.compactionThresholdPercent === input.compactionThresholdPercent
    && session.recentMessageGroups === (input.recentMessageGroups ?? 0)
    && session.maxSessionBytes === limits.maxSessionBytes
    && session.maxTranscriptBytes === limits.maxTranscriptBytes;
}

function normalizeSession(session: ContextSession, limits: ContextSessionLimits): ContextSession {
  const normalized = {
    ...session,
    maxSessionBytes: session.maxSessionBytes ?? limits.maxSessionBytes,
    maxTranscriptBytes: session.maxTranscriptBytes ?? limits.maxTranscriptBytes,
  };
  validateSessionLimits({ maxSessionBytes: normalized.maxSessionBytes, maxTranscriptBytes: normalized.maxTranscriptBytes });
  return normalized;
}

function normalizeTurn(turn: ContextTurn): ContextTurn {
  return { ...turn, clientTurnId: turn.clientTurnId ?? null };
}

function validateSessionLimits(limits: ContextSessionLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ContextSessionConflictError(`${name} must be a positive safe integer.`);
    }
  }
}

function validateClientTurnId(clientTurnId: string | undefined): void {
  if (clientTurnId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(clientTurnId)) {
    throw new ContextSessionConflictError("clientTurnId must use letters, numbers, dots, colons, hyphens, or underscores.");
  }
}

function validateStoredMessage(message: ContextMessage, sessionId: string, previous: ContextMessage | undefined): void {
  if (message.schemaVersion !== 1 || message.sessionId !== sessionId || !message.messageId || !message.content) throw new ContextSessionConflictError("Invalid context message record.");
  if (!Number.isInteger(message.sequence) || (previous && message.sequence <= previous.sequence)) throw new ContextSessionConflictError("Context transcript sequence is not strictly increasing.");
}

function assertSafeSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new ContextSessionConflictError(`Invalid context session ID: ${sessionId}`);
}

function safeFileName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new ContextSessionConflictError("Invalid context snapshot ID.");
  return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
