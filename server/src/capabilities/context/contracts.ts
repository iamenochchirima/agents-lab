/**
 * Common context semantics. Platform variants may store and execute these
 * records differently, but they must not change what the records mean.
 */

export const CONTEXT_SCHEMA_VERSION = 1 as const;

export type ContextRole = "system" | "developer" | "user" | "assistant" | "tool";
export type ContextSourceKind = "system" | "transcript" | "memory" | "skills" | "tools" | "compaction-summary";
export type TokenCountQuality = "exact" | "estimated" | "unknown";
export type ContextPressure = "normal" | "compaction_due" | "compacting" | "exhausted" | "unknown";

/**
 * Durable filesystem ceilings for one context session. These are byte limits,
 * measured from the UTF-8 records written to the session directory.
 */
export interface ContextSessionLimits {
  readonly maxSessionBytes: number;
  readonly maxTranscriptBytes: number;
}

export const DEFAULT_CONTEXT_SESSION_LIMITS: ContextSessionLimits = Object.freeze({
  maxSessionBytes: 50 * 1024 * 1024,
  maxTranscriptBytes: 10 * 1024 * 1024,
});

export interface ContextMessage {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  readonly messageId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly role: ContextRole;
  readonly content: string;
  readonly source: ContextSourceKind;
  readonly createdAt: string;
  /** Messages in one tool round share a group ID and must compact together. */
  readonly groupId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface TokenCount {
  readonly tokens: number | null;
  readonly quality: TokenCountQuality;
  /** Identifies the tokenizer or estimator used to produce the count. */
  readonly basis: string;
}

export interface ContextTokenCounter {
  count(messages: readonly ContextMessage[]): TokenCount;
}

export interface ContextBudgetPolicy {
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  /** Compaction is due at or below this remaining percentage. */
  readonly compactionThresholdPercent: number;
  /** Keep the newest complete message groups outside the summary. */
  readonly recentMessageGroups?: number;
}

export interface ContextBudget {
  readonly contextWindowTokens: number | null;
  readonly inputTokens: number | null;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly remainingTokens: number | null;
  readonly remainingPercent: number | null;
  readonly quality: TokenCountQuality;
  readonly tokenizerBasis: string;
  readonly pressure: ContextPressure;
}

export interface ContextCompactionRecord {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  readonly compactionId: string;
  readonly sessionId: string;
  readonly sourceRevision: number;
  readonly policyVersion: string;
  readonly trigger: "preflight" | "provider_overflow" | "manual";
  readonly sourceMessageIds: readonly string[];
  readonly retainedMessageIds: readonly string[];
  readonly summaryMessageId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly before: ContextBudget;
  readonly after: ContextBudget;
}

export interface ContextSnapshot {
  readonly schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly compactionRevision: number;
  readonly model: string;
  readonly messages: readonly ContextMessage[];
  readonly sources: readonly ContextSourceKind[];
  readonly budget: ContextBudget;
  readonly compaction: ContextCompactionRecord | null;
  readonly createdAt: string;
}

export interface ContextSummaryRequest {
  readonly sessionId: string;
  readonly sourceRevision: number;
  readonly messages: readonly ContextMessage[];
  readonly signal?: AbortSignal;
}

export interface ContextSummaryGenerator {
  summarize(request: ContextSummaryRequest): Promise<string>;
}

export interface ContextCompactionOptions {
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly sourceRevision: number;
  readonly currentMessageId: string;
  readonly trigger: ContextCompactionRecord["trigger"];
  readonly policyVersion?: string;
  readonly now?: () => string;
}

export interface CompactedContext {
  readonly messages: readonly ContextMessage[];
  readonly record: ContextCompactionRecord;
}

export interface ContextProjection {
  /** Session projections are canonical context state; run projections are a
   * provider-reported view for one-shot platform requests. */
  readonly scope?: "session" | "run";
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly compactionRevision: number;
  readonly budget: ContextBudget;
  readonly updatedAt: string;
}
