import type { ContextBudget, ContextMessage, ContextPressure } from "../../capabilities/context/contracts.js";

export const STUDIO_CONTEXT_RESEARCH_SCHEMA_VERSION = 1 as const;

export type StudioContextSourceClass = "instruction" | "active-turn" | "transcript" | "memory" | "tool-result" | "summary";
export type StudioContextTrust = "trusted" | "untrusted";
export type StudioContextGroupDecisionKind = "retained" | "omitted" | "summarized";

/**
 * A source group is the smallest unit a Context strategy may retain or omit
 * atomically. Message IDs remain the canonical model input; this contract adds
 * the experimental metadata needed to compare source-class decisions.
 */
export interface StudioContextSourceGroup {
  readonly schemaVersion: typeof STUDIO_CONTEXT_RESEARCH_SCHEMA_VERSION;
  readonly groupId: string;
  readonly sourceClass: StudioContextSourceClass;
  readonly trust: StudioContextTrust;
  readonly messageIds: readonly string[];
  readonly priority: number;
  readonly summaryEligible: boolean;
  readonly tokenContribution: number | null;
  readonly provenance: Readonly<Record<string, string>>;
}

export interface StudioContextGroupDecision {
  readonly groupId: string;
  readonly sourceClass: StudioContextSourceClass;
  readonly decision: StudioContextGroupDecisionKind;
  readonly score: number | null;
  readonly reason: string;
}

export interface StudioContextAllocation {
  readonly availableInputTokens: number | null;
  readonly allocations: readonly {
    readonly sourceClass: StudioContextSourceClass;
    readonly requestedTokens: number | null;
    readonly allocatedTokens: number | null;
    readonly usedTokens: number | null;
    readonly overflowTokens: number | null;
  }[];
  readonly reserveConsumedBy: StudioContextSourceClass | null;
  readonly overflowDecision: "none" | "class-limit" | "global-limit" | "unknown";
}

export interface StudioContextCompactionEvidence {
  readonly trigger: "none" | "pressure" | "provider-overflow";
  readonly policyId: string | null;
  readonly policyVersion: string | null;
  readonly sourceMessageIds: readonly string[];
  readonly retainedMessageIds: readonly string[];
  readonly summaryMessageId: string | null;
  readonly summaryIdentity: string | null;
  readonly coverage: readonly string[];
  readonly limitations: readonly string[];
}

export interface StudioContextDecisionEvidence {
  readonly schemaVersion: typeof STUDIO_CONTEXT_RESEARCH_SCHEMA_VERSION;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyParameters: Readonly<Record<string, string>>;
  readonly sourceGroups: readonly StudioContextSourceGroup[];
  readonly groupDecisions: readonly StudioContextGroupDecision[];
  readonly retainedSourceIds: readonly string[];
  readonly omittedSourceIds: readonly string[];
  readonly summarizedSourceIds: readonly string[];
  readonly modelBoundMessageIds: readonly string[];
  readonly memoryRecordIdsConsidered: readonly string[];
  readonly memoryRecordIdsModelBound: readonly string[];
  readonly allocation: StudioContextAllocation | null;
  readonly compaction: StudioContextCompactionEvidence;
  readonly pressure: {
    readonly before: ContextPressure;
    readonly after: ContextPressure;
    readonly trigger: "none" | "threshold" | "overflow" | "unknown";
  };
}

export interface StudioContextResearchInput {
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly budget: ContextBudget;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyParameters: Readonly<Record<string, string>>;
  readonly sourceGroups: readonly StudioContextSourceGroup[];
}

export function sourceGroupsForMessages(
  messages: readonly ContextMessage[],
  tokenCounter: { count(messages: readonly ContextMessage[]): { tokens: number | null } },
): readonly StudioContextSourceGroup[] {
  const grouped = new Map<string, ContextMessage[]>();
  for (const message of messages) {
    const groupId = message.groupId ?? message.messageId;
    const group = grouped.get(groupId) ?? [];
    group.push(message);
    grouped.set(groupId, group);
  }
  return [...grouped.entries()].map(([groupId, group]) => {
    const first = group[0]!;
    const sourceClass = sourceClassFor(first);
    return {
      schemaVersion: STUDIO_CONTEXT_RESEARCH_SCHEMA_VERSION,
      groupId,
      sourceClass,
      trust: trustFor(first),
      messageIds: group.map((message) => message.messageId),
      priority: priorityFor(sourceClass, first.metadata?.priority),
      summaryEligible: sourceClass !== "instruction" && sourceClass !== "active-turn",
      tokenContribution: tokenCounter.count(group).tokens,
      provenance: {
        sessionId: first.sessionId,
        source: first.source,
        ...(first.metadata ?? {}),
      },
    };
  });
}

export function decisionEvidenceFor(
  input: StudioContextResearchInput,
  retained: readonly ContextMessage[],
  omitted: readonly ContextMessage[],
  summarized: readonly ContextMessage[],
  groupDecisions: readonly StudioContextGroupDecision[],
  options: {
    readonly allocation?: StudioContextAllocation | null;
    readonly compaction?: StudioContextCompactionEvidence;
    readonly pressureTrigger?: "none" | "threshold" | "overflow" | "unknown";
  } = {},
): StudioContextDecisionEvidence {
  const retainedIds = new Set(retained.map((message) => message.messageId));
  const omittedIds = new Set(omitted.map((message) => message.messageId));
  const summarizedIds = new Set(summarized.map((message) => message.messageId));
  const memoryRecordIdsConsidered = input.sourceGroups
    .filter((group) => group.sourceClass === "memory")
    .map((group) => group.provenance.memoryRecordId)
    .filter((recordId): recordId is string => recordId !== undefined);
  const memoryRecordIdsModelBound = input.sourceGroups
    .filter((group) => group.sourceClass === "memory" && group.messageIds.some((messageId) => retainedIds.has(messageId)))
    .map((group) => group.provenance.memoryRecordId)
    .filter((recordId): recordId is string => recordId !== undefined);
  return {
    schemaVersion: STUDIO_CONTEXT_RESEARCH_SCHEMA_VERSION,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    strategyParameters: input.strategyParameters,
    sourceGroups: input.sourceGroups,
    groupDecisions,
    retainedSourceIds: [...retainedIds],
    omittedSourceIds: [...omittedIds],
    summarizedSourceIds: [...summarizedIds],
    modelBoundMessageIds: retained.map((message) => message.messageId),
    memoryRecordIdsConsidered,
    memoryRecordIdsModelBound,
    allocation: options.allocation ?? null,
    compaction: options.compaction ?? {
      trigger: "none",
      policyId: null,
      policyVersion: null,
      sourceMessageIds: [],
      retainedMessageIds: [],
      summaryMessageId: null,
      summaryIdentity: null,
      coverage: [],
      limitations: [],
    },
    pressure: {
      before: input.budget.pressure,
      after: input.budget.pressure,
      trigger: options.pressureTrigger ?? (input.budget.pressure === "unknown" ? "unknown" : input.budget.pressure === "compaction_due" ? "threshold" : "none"),
    },
  };
}

function sourceClassFor(message: ContextMessage): StudioContextSourceClass {
  const declared = message.metadata?.sourceClass;
  if (declared === "instruction" || declared === "active-turn" || declared === "transcript" || declared === "memory" || declared === "tool-result" || declared === "summary") return declared;
  if (message.source === "memory") return "memory";
  if (message.source === "tools" || message.role === "tool") return "tool-result";
  if (message.source === "compaction-summary") return "summary";
  if (message.role === "system" || message.role === "developer") return "instruction";
  return "transcript";
}

function trustFor(message: ContextMessage): StudioContextTrust {
  return message.metadata?.memoryTrust === "retrieved-untrusted" || message.metadata?.trust === "untrusted" || message.source === "memory" || message.source === "tools"
    ? "untrusted"
    : "trusted";
}

function priorityFor(sourceClass: StudioContextSourceClass, declared: string | undefined): number {
  if (declared !== undefined && /^\d+$/.test(declared)) return Math.min(Number(declared), 100);
  return sourceClass === "instruction" ? 100 : sourceClass === "active-turn" ? 95 : sourceClass === "summary" ? 60 : sourceClass === "tool-result" ? 50 : sourceClass === "memory" ? 40 : 30;
}
