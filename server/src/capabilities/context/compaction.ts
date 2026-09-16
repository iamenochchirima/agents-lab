import { createHash } from "node:crypto";

import { calculateContextBudget } from "./budget.js";
import type {
  CompactedContext,
  ContextBudgetPolicy,
  ContextCompactionOptions,
  ContextMessage,
  ContextSummaryGenerator,
  ContextTokenCounter,
  ContextCompactionRecord,
} from "./contracts.js";

export class ContextCompactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextCompactionError";
  }
}

/**
 * Compacts a request-local message list. Canonical session messages are never
 * modified. The caller supplies the summary implementation because a model
 * call belongs to the selected platform/provider adapter.
 */
export async function compactContext(
  messages: readonly ContextMessage[],
  counter: ContextTokenCounter,
  contextWindowTokens: number | null,
  policy: ContextBudgetPolicy,
  options: ContextCompactionOptions,
  summarizer: ContextSummaryGenerator,
): Promise<CompactedContext> {
  validateMessages(messages, options);
  const now = options.now ?? (() => new Date().toISOString());
  const before = calculateContextBudget(contextWindowTokens, counter.count(messages), policy);
  const candidates = compactableCandidates(messages, options.currentMessageId, policy.recentMessageGroups);
  // If the context is already unsafe and the configured recent tail contains
  // every historical group, there is no older group to compact. Fall back to
  // the complete pre-turn history rather than failing while a safe summary is
  // still possible; the active turn remains protected in either case.
  const effectiveCandidates = candidates.length > 0
    ? candidates
    : compactableCandidates(messages, options.currentMessageId, 0);
  if (effectiveCandidates.length === 0) {
    throw new ContextCompactionError("The context has no safe history to compact while preserving the active turn.");
  }

  const startedAt = now();
  const summaryContent = (await summarizer.summarize({
    sessionId: options.sessionId,
    sourceRevision: options.sourceRevision,
    messages: effectiveCandidates,
  })).trim();
  if (summaryContent.length === 0) {
    throw new ContextCompactionError("The context summarizer returned an empty summary.");
  }

  const summaryMessageId = deterministicId(options.sessionId, options.sourceRevision, options.policyVersion ?? "context-policy-v1");
  const summaryMessage: ContextMessage = {
    schemaVersion: 1,
    messageId: summaryMessageId,
    sessionId: options.sessionId,
    sequence: Math.min(...messages.map((message) => message.sequence)),
    role: "system",
    content: `Conversation summary for context continuity:\n${summaryContent}`,
    source: "compaction-summary",
    createdAt: now(),
    metadata: { sourceRevision: String(options.sourceRevision) },
  };
  const candidateIds = new Set(effectiveCandidates.map((message) => message.messageId));
  const retained = messages.filter((message) => !candidateIds.has(message.messageId));
  const compactedMessages = insertSummary(retained, summaryMessage);
  const after = calculateContextBudget(contextWindowTokens, counter.count(compactedMessages), policy);
  if (after.pressure === "exhausted") {
    throw new ContextCompactionError("Context compaction completed, but the resulting request still exceeds its safe budget.");
  }

  const finishedAt = now();
  const record: ContextCompactionRecord = {
    schemaVersion: 1,
    compactionId: deterministicId(options.sessionId, options.sourceRevision, `${options.policyVersion ?? "context-policy-v1"}:${options.trigger}`),
    sessionId: options.sessionId,
    sourceRevision: options.sourceRevision,
    policyVersion: options.policyVersion ?? "context-policy-v1",
    trigger: options.trigger,
    sourceMessageIds: effectiveCandidates.map((message) => message.messageId),
    retainedMessageIds: retained.map((message) => message.messageId),
    summaryMessageId,
    startedAt,
    finishedAt,
    before,
    after,
  };
  return { messages: compactedMessages, record };
}

function compactableCandidates(messages: readonly ContextMessage[], currentMessageId: string, recentMessageGroups = 0): ContextMessage[] {
  const currentIndex = messages.findIndex((message) => message.messageId === currentMessageId);
  if (currentIndex < 0) throw new ContextCompactionError("The active message is not present in the context.");

  const groups = new Map<string, ContextMessage[]>();
  for (const message of messages.slice(0, currentIndex)) {
    if (message.role === "system" || message.role === "developer" || message.source === "compaction-summary") continue;
    const groupId = message.groupId ?? message.messageId;
    const group = groups.get(groupId) ?? [];
    group.push(message);
    groups.set(groupId, group);
  }

  const grouped = [...groups.values()];
  const recentGroupCount = recentMessageGroups;
  const compactedGroups = recentGroupCount === 0 ? grouped : grouped.slice(0, Math.max(0, grouped.length - recentGroupCount));
  const all = compactedGroups.flat();
  if (all.length === 0) return [];
  // The summary retains the meaning of every selected group. Keeping an
  // arbitrary newest group would be unsafe because tool groups and dialogue
  // groups have different IDs and do not necessarily align by position.
  return all;
}

function insertSummary(messages: readonly ContextMessage[], summary: ContextMessage): readonly ContextMessage[] {
  const firstNonInstruction = messages.findIndex((message) => message.role !== "system" && message.role !== "developer");
  if (firstNonInstruction < 0) return [...messages, summary];
  return [...messages.slice(0, firstNonInstruction), summary, ...messages.slice(firstNonInstruction)];
}

function validateMessages(messages: readonly ContextMessage[], options: ContextCompactionOptions): void {
  if (messages.length === 0) throw new ContextCompactionError("Cannot compact an empty context.");
  const ids = new Set<string>();
  let previousSequence = -1;
  for (const message of messages) {
    if (message.sessionId !== options.sessionId) throw new ContextCompactionError("Context messages belong to different sessions.");
    if (ids.has(message.messageId)) throw new ContextCompactionError(`Duplicate context message: ${message.messageId}`);
    if (!Number.isInteger(message.sequence) || message.sequence <= previousSequence) {
      throw new ContextCompactionError("Context message sequence must be strictly increasing.");
    }
    ids.add(message.messageId);
    previousSequence = message.sequence;
  }
}

function deterministicId(sessionId: string, sourceRevision: number, suffix: string): string {
  return `ctx-${createHash("sha256").update(`${sessionId}:${sourceRevision}:${suffix}`).digest("hex").slice(0, 24)}`;
}
