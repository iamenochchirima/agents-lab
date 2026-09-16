import { createHash } from "node:crypto";

import { calculateContextBudget } from "./budget.js";
import { compactContext, ContextCompactionError } from "./compaction.js";
import type {
  ContextBudgetPolicy,
  ContextMessage,
  ContextProjection,
  ContextSnapshot,
  ContextSummaryGenerator,
  ContextTokenCounter,
} from "./contracts.js";
import { ContextSessionStore, type ContextSession, type ContextTurn } from "./session-store.js";

export interface PreparedContextTurn {
  readonly session: ContextSession;
  readonly turn: ContextTurn;
  readonly snapshot: ContextSnapshot;
}

export interface PrepareContextOptions {
  readonly forceCompaction?: boolean;
  readonly trigger?: "preflight" | "provider_overflow" | "manual";
}

/**
 * Coordinates transcript admission and request-context preparation. It keeps
 * the store and the budget/compaction implementation behind one small seam so
 * platform adapters do not need to know the on-disk layout.
 */
export class ContextService {
  constructor(
    private readonly store: ContextSessionStore,
    private readonly tokenCounter: ContextTokenCounter,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get sessions(): ContextSessionStore {
    return this.store;
  }

  async readSnapshot(sessionId: string, snapshotId: string): Promise<ContextSnapshot> {
    return this.store.readSnapshot(sessionId, snapshotId);
  }

  async prepareTurn(
    sessionId: string,
    turnId: string,
    summarizer: ContextSummaryGenerator,
    options: PrepareContextOptions = {},
  ): Promise<PreparedContextTurn> {
    const session = await this.store.read(sessionId);
    const transcript = await this.store.readTranscript(sessionId);
    const turns = await readTurnById(this.store, sessionId, turnId);
    if (!turns) throw new Error(`Context turn was not found: ${turnId}`);
    if (turns.contextSnapshotId && !options.forceCompaction) {
      const snapshot = await this.store.readSnapshot(sessionId, turns.contextSnapshotId);
      return { session, turn: turns, snapshot };
    }

    const currentMessage = transcript.find((message) => message.messageId === turns.userMessageId);
    if (!currentMessage) throw new Error(`Context turn has no user message: ${turnId}`);
    const messages = [systemMessage(session), ...transcript];
    const policy = policyFromSession(session);
    const initialBudget = calculateContextBudget(session.contextWindowTokens, this.tokenCounter.count(messages), policy);
    if (initialBudget.pressure === "unknown") {
      throw new ContextCompactionError("Context preparation requires a known model window and token count.");
    }
    let contextMessages: readonly ContextMessage[] = messages;
    let compaction = null;
    let compactionRevision = 0;

    if (options.forceCompaction || initialBudget.pressure === "compaction_due" || initialBudget.pressure === "exhausted") {
      const latest = await this.store.latestSnapshot(sessionId);
      compactionRevision = (latest?.compactionRevision ?? 0) + 1;
      const compacted = await compactContext(
        messages,
        this.tokenCounter,
        session.contextWindowTokens,
        policy,
        {
          sessionId,
          sessionRevision: turns.sessionRevision,
          sourceRevision: turns.sessionRevision,
          currentMessageId: currentMessage.messageId,
          // This service runs before the provider request. An exhausted local
          // estimate is still a preflight condition; provider_overflow is
          // reserved for a later bounded recovery path.
          trigger: options.trigger ?? "preflight",
          now: this.now,
        },
        summarizer,
      );
      contextMessages = compacted.messages;
      compaction = compacted.record;
    }

    const budget = calculateContextBudget(session.contextWindowTokens, this.tokenCounter.count(contextMessages), policy);
    if (budget.pressure === "unknown" || budget.pressure === "exhausted") {
      throw new ContextCompactionError("The prepared context exceeds the safe model budget.");
    }
    const snapshot: ContextSnapshot = {
      schemaVersion: 1,
      snapshotId: snapshotIdFor(sessionId, turns.sessionRevision, compactionRevision),
      sessionId,
      sessionRevision: turns.sessionRevision,
      compactionRevision,
      model: session.model,
      messages: contextMessages,
      sources: [...new Set(contextMessages.map((message) => message.source))],
      budget,
      compaction,
      createdAt: this.now(),
    };
    await this.store.writeSnapshot(snapshot);
    const runningTurn = await this.store.markRunning(sessionId, turnId, snapshot.snapshotId, this.now());
    return { session, turn: runningTurn, snapshot };
  }

  async projection(sessionId: string): Promise<ContextProjection | null> {
    const projection = await this.store.projection(sessionId);
    if (!projection) return null;

    // The latest snapshot describes the last model request. The UI needs the
    // budget for the next request, which also includes a completed assistant
    // response and any newly admitted user turn. Recalculate that projection
    // from the canonical transcript without publishing a new snapshot.
    const session = await this.store.read(sessionId);
    const transcript = await this.store.readTranscript(sessionId);
    const latestSnapshot = await this.store.latestSnapshot(sessionId);
    const activeTurn = session.activeTurnId ? await this.store.readTurn(sessionId, session.activeTurnId) : null;
    if (activeTurn?.contextSnapshotId && latestSnapshot?.snapshotId === activeTurn.contextSnapshotId) {
      return projection;
    }
    const budget = calculateContextBudget(
      session.contextWindowTokens,
      this.tokenCounter.count([systemMessage(session), ...transcript]),
      policyFromSession(session),
    );
    const pressure = activeTurn && (budget.pressure === "compaction_due" || budget.pressure === "exhausted")
      ? "compacting"
      : budget.pressure;
    return {
      scope: "session",
      ...projection,
      budget: { ...budget, pressure },
    };
  }
}

function systemMessage(session: ContextSession): ContextMessage {
  return {
    schemaVersion: 1,
    messageId: `system-${session.sessionId}`,
    sessionId: session.sessionId,
    sequence: 0,
    role: "system",
    content: session.systemInstruction,
    source: "system",
    createdAt: session.createdAt,
  };
}

function policyFromSession(session: ContextSession): ContextBudgetPolicy {
  return {
    reservedOutputTokens: session.reservedOutputTokens,
    safetyMarginTokens: session.safetyMarginTokens,
    compactionThresholdPercent: session.compactionThresholdPercent,
    recentMessageGroups: session.recentMessageGroups,
  };
}

async function readTurnById(store: ContextSessionStore, sessionId: string, turnId: string): Promise<ContextTurn | null> {
  // The store intentionally exposes turn mutation rather than its log format.
  // This read path is kept behind a narrow optional inspection method until the
  // public session view is added.
  return store.readTurn(sessionId, turnId);
}

function snapshotIdFor(sessionId: string, sessionRevision: number, compactionRevision: number): string {
  return `snapshot-${createHash("sha256").update(`${sessionId}:${sessionRevision}:${compactionRevision}`).digest("hex").slice(0, 24)}`;
}
