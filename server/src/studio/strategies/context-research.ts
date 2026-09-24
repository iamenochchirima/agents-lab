import { createHash } from "node:crypto";

import { calculateContextBudget } from "../../capabilities/context/budget.js";
import type {
  ContextBudget,
  ContextMessage,
  ContextTokenCounter,
} from "../../capabilities/context/contracts.js";
import type {
  StudioContextAllocation,
  StudioContextCompactionEvidence,
  StudioContextGroupDecision,
  StudioContextSourceClass,
  StudioContextSourceGroup,
} from "./context-research-contracts.js";
import {
  decisionEvidenceFor,
  sourceGroupsForMessages,
} from "./context-research-contracts.js";
import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
  ContextStrategy,
} from "./context-strategy.js";

const SOURCE_CLASSES: readonly StudioContextSourceClass[] = [
  "instruction",
  "active-turn",
  "transcript",
  "memory",
  "tool-result",
  "summary",
];

const DEFAULT_ALLOCATION_PERCENTAGES: Readonly<Record<StudioContextSourceClass, number>> = {
  instruction: 20,
  "active-turn": 25,
  transcript: 25,
  memory: 15,
  "tool-result": 15,
  summary: 0,
};

const MAX_GROUPS = 10_000;
const DEFAULT_RECENT_GROUPS = 2;
const DEFAULT_MAX_SUMMARY_CHARACTERS = 1_200;
const DEFAULT_COMPACTION_POLICY_VERSION = "deterministic-rolling-summary-v1";
const DEFAULT_HIERARCHICAL_POLICY_VERSION = "deterministic-hierarchical-summary-v1";

export interface ContextMessageGroup {
  readonly groupId: string;
  readonly index: number;
  readonly messages: readonly ContextMessage[];
  readonly sourceGroup: StudioContextSourceGroup;
}

export interface ResearchResultOptions {
  readonly summarizedMessages?: readonly ContextMessage[];
  readonly groupDecisions?: ReadonlyMap<string, StudioContextGroupDecision>;
  readonly allocation?: StudioContextAllocation | null;
  readonly compaction?: StudioContextCompactionEvidence;
  readonly pressureTrigger?: "none" | "threshold" | "overflow" | "unknown";
  readonly evidenceMessages?: readonly ContextMessage[];
}

/**
 * Build the canonical source groups used by research strategies. A declared
 * group is metadata about the same message group; the message list remains
 * authoritative so callers cannot accidentally make evidence describe a
 * group that the model did not receive.
 */
export function contextMessageGroups(
  input: ContextAssemblyInput,
  messages: readonly ContextMessage[] = input.messages,
): readonly ContextMessageGroup[] {
  const derived = sourceGroupsForMessages(messages, input.tokenCounter);
  const declared = new Map((input.sourceGroups ?? []).map((group) => [group.groupId, group]));
  const byGroup = new Map<string, ContextMessage[]>();

  for (const message of messages) {
    const groupId = message.groupId ?? message.messageId;
    const group = byGroup.get(groupId) ?? [];
    group.push(message);
    byGroup.set(groupId, group);
  }

  return [...byGroup.entries()].map(([groupId, group], index) => {
    const derivedGroup = derived.find((candidate) => candidate.groupId === groupId)!;
    const declaredGroup = declared.get(groupId);
    const sourceGroup: StudioContextSourceGroup = declaredGroup
      ? {
          ...declaredGroup,
          messageIds: derivedGroup.messageIds,
          tokenContribution: declaredGroup.tokenContribution ?? derivedGroup.tokenContribution,
        }
      : derivedGroup;
    return { groupId, index, messages: group, sourceGroup };
  });
}

export function flattenGroups(groups: readonly ContextMessageGroup[], selectedGroupIds: ReadonlySet<string>): readonly ContextMessage[] {
  return groups
    .filter((group) => selectedGroupIds.has(group.groupId))
    .flatMap((group) => group.messages);
}

export function selectGroupAwareRecentMessages(
  input: ContextAssemblyInput,
  recentGroupsValue: string | undefined,
): { readonly messages: readonly ContextMessage[]; readonly selectedGroupIds: ReadonlySet<string> } {
  const groups = contextMessageGroups(input);
  const recentGroups = parseIntegerParameter(
    "group-aware-sliding-window",
    "recentGroups",
    recentGroupsValue ?? input.budgetPolicy.recentMessageGroups?.toString() ?? String(DEFAULT_RECENT_GROUPS),
    0,
    MAX_GROUPS,
  );
  const mandatory = groups.filter(isMandatoryGroup);
  const optional = groups.filter((group) => !isMandatoryGroup(group));
  const selectedGroupIds = new Set([
    ...mandatory.map((group) => group.groupId),
    ...optional.slice(-recentGroups).map((group) => group.groupId),
  ]);
  return { messages: flattenGroups(groups, selectedGroupIds), selectedGroupIds };
}

export interface RankedContextGroup {
  readonly group: ContextMessageGroup;
  readonly score: number;
}

export function rankGroupAwareMessages(
  input: ContextAssemblyInput,
  maxGroupsValue: string | undefined,
): { readonly messages: readonly ContextMessage[]; readonly selectedGroupIds: ReadonlySet<string>; readonly scores: ReadonlyMap<string, number> } {
  const groups = contextMessageGroups(input);
  const maxGroups = parseIntegerParameter(
    "relevance-ranked-groups",
    "maxGroups",
    maxGroupsValue ?? String(DEFAULT_RECENT_GROUPS),
    1,
    MAX_GROUPS,
  );
  const taskTerms = terms(input.task);
  const mandatory = groups.filter(isMandatoryGroup);
  const optional: RankedContextGroup[] = groups
    .filter((group) => !isMandatoryGroup(group))
    .map((group) => ({
      group,
      score: group.messages.reduce((total, message) => total + overlapScore(taskTerms, terms(message.content)), 0),
    }))
    .sort((left, right) => right.score - left.score || right.group.messages.at(-1)!.sequence - left.group.messages.at(-1)!.sequence || right.group.index - left.group.index);
  const selectedGroupIds = new Set([
    ...mandatory.map((group) => group.groupId),
    ...optional.slice(0, maxGroups).map(({ group }) => group.groupId),
  ]);
  const scores = new Map(optional.map(({ group, score }) => [group.groupId, score]));
  return { messages: flattenGroups(groups, selectedGroupIds), selectedGroupIds, scores };
}

export function resultForResearch(
  input: ContextAssemblyInput,
  retainedMessages: readonly ContextMessage[],
  options: ResearchResultOptions = {},
): ContextAssemblyResult {
  const summarizedMessages = options.summarizedMessages ?? [];
  const retainedIds = new Set(retainedMessages.map((message) => message.messageId));
  const summarizedIds = new Set(summarizedMessages.map((message) => message.messageId));
  const omittedMessages = input.messages.filter((message) => !retainedIds.has(message.messageId) && !summarizedIds.has(message.messageId));
  const budget = calculateContextBudget(
    input.contextWindowTokens,
    input.tokenCounter.count(retainedMessages),
    input.budgetPolicy,
  );
  const beforeBudget = calculateContextBudget(
    input.contextWindowTokens,
    input.tokenCounter.count(input.messages),
    input.budgetPolicy,
  );
  const evidenceMessages = options.evidenceMessages ?? input.messages;
  const groups = contextMessageGroups(input, evidenceMessages);
  const groupDecisions = groups.map((group) => options.groupDecisions?.get(group.groupId) ?? defaultGroupDecision(group, retainedIds, summarizedIds));
  const evidence = decisionEvidenceFor(
    {
      task: input.task,
      messages: evidenceMessages,
      budget: beforeBudget,
      strategyId: input.strategy.id,
      strategyVersion: input.strategy.version,
      strategyParameters: input.strategy.parameters,
      sourceGroups: groups.map((group) => group.sourceGroup),
    },
    retainedMessages,
    omittedMessages,
    summarizedMessages,
    groupDecisions,
    {
      allocation: options.allocation,
      compaction: options.compaction,
      pressureTrigger: options.pressureTrigger ?? (beforeBudget.pressure === "unknown" ? "unknown" : "none"),
    },
  );
  return {
    messages: retainedMessages,
    retainedMessageIds: retainedMessages.map((message) => message.messageId),
    omittedMessageIds: omittedMessages.map((message) => message.messageId),
    summarizedMessageIds: summarizedMessages.map((message) => message.messageId),
    budget,
    decision: decisionForBudget(budget),
    research: {
      ...evidence,
      pressure: {
        ...evidence.pressure,
        after: budget.pressure,
      },
    },
  };
}

export class GroupAwareSlidingWindowStrategy implements ContextStrategy {
  readonly id = "group-aware-sliding-window";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const selection = selectGroupAwareRecentMessages(input, input.strategy.parameters.recentGroups);
    const groupDecisions = new Map<string, StudioContextGroupDecision>();
    for (const group of contextMessageGroups(input)) {
      groupDecisions.set(group.groupId, {
        groupId: group.groupId,
        sourceClass: group.sourceGroup.sourceClass,
        decision: selection.selectedGroupIds.has(group.groupId) ? "retained" : "omitted",
        score: null,
        reason: selection.selectedGroupIds.has(group.groupId)
          ? isMandatoryGroup(group) ? "mandatory instruction or active-turn group" : "selected as a complete recent source group"
          : "outside the configured recent group window",
      });
    }
    return resultForResearch(input, selection.messages, { groupDecisions });
  }
}

export class RelevanceRankedGroupsStrategy implements ContextStrategy {
  readonly id = "relevance-ranked-groups";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const selection = rankGroupAwareMessages(input, input.strategy.parameters.maxGroups);
    const groupDecisions = new Map<string, StudioContextGroupDecision>();
    for (const group of contextMessageGroups(input)) {
      const selected = selection.selectedGroupIds.has(group.groupId);
      groupDecisions.set(group.groupId, {
        groupId: group.groupId,
        sourceClass: group.sourceGroup.sourceClass,
        decision: selected ? "retained" : "omitted",
        score: selection.scores.get(group.groupId) ?? null,
        reason: selected
          ? isMandatoryGroup(group) ? "mandatory instruction or active-turn group" : "highest deterministic group score within the limit"
          : "group score fell outside the deterministic selection limit",
      });
    }
    return resultForResearch(input, selection.messages, { groupDecisions });
  }
}

export class DeterministicCompactionStrategy implements ContextStrategy {
  readonly id = "deterministic-compaction";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    return compactWithDeterministicSummary(input, {
      strategyId: this.id,
      policyId: "deterministic-rolling-summary",
      policyVersion: input.strategy.parameters.policyVersion ?? DEFAULT_COMPACTION_POLICY_VERSION,
      heading: "Deterministic rolling summary",
    });
  }
}

export class HierarchicalSummaryStrategy implements ContextStrategy {
  readonly id = "hierarchical-summary";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    return compactWithDeterministicSummary(input, {
      strategyId: this.id,
      policyId: "deterministic-hierarchical-summary",
      policyVersion: input.strategy.parameters.policyVersion ?? DEFAULT_HIERARCHICAL_POLICY_VERSION,
      heading: "Deterministic hierarchical summary",
      hierarchical: true,
    });
  }
}

export class TokenBudgetAllocationStrategy implements ContextStrategy {
  readonly id = "token-budget-allocation";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const groups = contextMessageGroups(input);
    const allocation = allocationFor(input, groups);
    const groupDecisions = new Map<string, StudioContextGroupDecision>();
    for (const group of groups) {
      const decision = allocation.selectedGroupIds.has(group.groupId) ? "retained" : "omitted";
      groupDecisions.set(group.groupId, {
        groupId: group.groupId,
        sourceClass: group.sourceGroup.sourceClass,
        decision,
        score: null,
        reason: decision === "retained" ? "fits the explicit source-class allocation" : allocation.unknown
          ? "token contribution is unknown; allocation cannot safely retain this group"
          : "source-class allocation was exhausted without splitting the group",
      });
    }
    return resultForResearch(input, flattenGroups(groups, allocation.selectedGroupIds), {
      allocation: allocation.evidence,
      groupDecisions,
    });
  }
}

/**
 * Provider overflow is a runtime signal, not proof that the original Context
 * strategy was wrong. Recovery deliberately uses a separate, bounded fixture
 * policy and leaves the first decision visible to the caller.
 */
export function recoverContextAfterProviderOverflow(
  input: ContextAssemblyInput,
  previous: ContextAssemblyResult,
): ContextAssemblyResult | null {
  const recovery = new DeterministicCompactionStrategy().assemble({
    ...input,
    strategy: {
      id: "deterministic-compaction",
      version: "1",
      parameters: {
        force: "true",
        recentGroups: "2",
        maxSummaryCharacters: "512",
      },
    },
  });
  if (recovery.messages.length >= previous.messages.length && recovery.retainedMessageIds.join("\0") === previous.retainedMessageIds.join("\0")) {
    return null;
  }
  if (!recovery.research) return null;
  return {
    ...recovery,
    research: {
      ...recovery.research,
      compaction: {
        ...recovery.research.compaction,
        trigger: "provider-overflow",
        limitations: [
          ...recovery.research.compaction.limitations,
          "Recovery was requested after the provider rejected the first model-bound context.",
        ],
      },
      pressure: {
        ...recovery.research.pressure,
        trigger: "overflow",
      },
    },
  };
}

function compactWithDeterministicSummary(
  input: ContextAssemblyInput,
  configuration: {
    readonly strategyId: string;
    readonly policyId: string;
    readonly policyVersion: string;
    readonly heading: string;
    readonly hierarchical?: boolean;
  },
): ContextAssemblyResult {
  const groups = contextMessageGroups(input);
  const beforeBudget = calculateContextBudget(
    input.contextWindowTokens,
    input.tokenCounter.count(input.messages),
    input.budgetPolicy,
  );
  const shouldCompact = input.strategy.parameters.force === "true" || beforeBudget.pressure === "compaction_due" || beforeBudget.pressure === "exhausted";
  if (!shouldCompact) {
    return resultForResearch(input, input.messages, {
      pressureTrigger: beforeBudget.pressure === "unknown" ? "unknown" : "none",
    });
  }

  const recentGroups = parseIntegerParameter(
    configuration.strategyId,
    "recentGroups",
    input.strategy.parameters.recentGroups ?? input.budgetPolicy.recentMessageGroups?.toString() ?? String(DEFAULT_RECENT_GROUPS),
    0,
    MAX_GROUPS,
  );
  const mandatory = groups.filter(isMandatoryGroup);
  const optional = groups.filter((group) => !isMandatoryGroup(group));
  const recent = optional.slice(-recentGroups);
  // A recent group is not automatically safe to retain: a verbose tool result
  // can consume the entire window. Move such groups into the summary boundary
  // until the mandatory context plus recent groups is not already exhausted.
  while (recent.length > 0) {
    const recentBudget = calculateContextBudget(
      input.contextWindowTokens,
      input.tokenCounter.count([...mandatory.flatMap((group) => group.messages), ...recent.flatMap((group) => group.messages)]),
      input.budgetPolicy,
    );
    if (recentBudget.pressure !== "exhausted") break;
    recent.shift();
  }
  const compacted = optional.slice(0, Math.max(0, optional.length - recent.length));
  if (compacted.length === 0) {
    return resultForResearch(input, input.messages, {
      pressureTrigger: "threshold",
      compaction: {
        trigger: "pressure",
        policyId: configuration.policyId,
        policyVersion: configuration.policyVersion,
        sourceMessageIds: [],
        retainedMessageIds: input.messages.map((message) => message.messageId),
        summaryMessageId: null,
        summaryIdentity: null,
        coverage: [],
        limitations: ["No eligible non-mandatory source group was available for compaction."],
      },
    });
  }

  const summary = deterministicSummaryMessage(compacted, configuration, input.strategy.parameters.maxSummaryCharacters);
  const selectedGroupIds = new Set([...mandatory, ...recent].map((group) => group.groupId));
  const firstCompactedIndex = compacted[0]!.index;
  const retainedWithoutSummary: ContextMessage[] = [];
  for (const group of groups) {
    if (selectedGroupIds.has(group.groupId)) retainedWithoutSummary.push(...group.messages);
  }
  const fittedSummary = fitSummaryToBudget(input, summary, retainedWithoutSummary);
  const retainedMessages: ContextMessage[] = [];
  for (const group of groups) {
    if (group.index === firstCompactedIndex) retainedMessages.push(fittedSummary);
    if (selectedGroupIds.has(group.groupId)) retainedMessages.push(...group.messages);
  }
  const summaryGroupDecision = new Map<string, StudioContextGroupDecision>();
  for (const group of groups) {
    const isCompacted = compacted.some((candidate) => candidate.groupId === group.groupId);
    const retained = selectedGroupIds.has(group.groupId);
    summaryGroupDecision.set(group.groupId, {
      groupId: group.groupId,
      sourceClass: group.sourceGroup.sourceClass,
      decision: isCompacted ? "summarized" : retained ? "retained" : "omitted",
      score: null,
      reason: isCompacted
        ? "represented by the bounded deterministic summary"
        : retained
          ? isMandatoryGroup(group) ? "mandatory instruction or active-turn group" : "kept outside the rolling summary window"
          : "omitted by the compaction boundary",
    });
  }
  summaryGroupDecision.set(fittedSummary.groupId!, {
    groupId: fittedSummary.groupId!,
    sourceClass: "summary",
    decision: "retained",
    score: null,
    reason: "deterministic summary represents compacted source groups",
  });

  const summarizedMessages = compacted.flatMap((group) => group.messages);
  const compactedIds = summarizedMessages.map((message) => message.messageId);
  const summaryIdentity = fittedSummary.metadata?.summaryIdentity ?? null;
  return resultForResearch(input, retainedMessages, {
    summarizedMessages,
    groupDecisions: summaryGroupDecision,
    evidenceMessages: [...input.messages, fittedSummary],
    pressureTrigger: "threshold",
    compaction: {
      trigger: "pressure",
      policyId: configuration.policyId,
      policyVersion: configuration.policyVersion,
      sourceMessageIds: compactedIds,
      retainedMessageIds: [...retainedMessages.map((message) => message.messageId)],
      summaryMessageId: fittedSummary.messageId,
      summaryIdentity,
      coverage: compacted.map((group) => group.groupId),
      limitations: [
        "This is a bounded rule-based summary fixture, not a model-generated summary.",
        "The summary preserves source coverage identifiers but does not establish semantic equivalence.",
        ...(fittedSummary.content.length < summary.content.length ? ["The summary was shortened to fit the configured input budget."] : []),
      ],
    },
  });
}

function fitSummaryToBudget(
  input: ContextAssemblyInput,
  summary: ContextMessage,
  retainedWithoutSummary: readonly ContextMessage[],
): ContextMessage {
  const initialBudget = calculateContextBudget(
    input.contextWindowTokens,
    input.tokenCounter.count([...retainedWithoutSummary, summary]),
    input.budgetPolicy,
  );
  if (initialBudget.pressure === "normal" || initialBudget.quality === "unknown") return summary;

  let low = 1;
  let high = summary.content.length;
  let best: ContextMessage | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = summaryWithContentBudget(summary, summary.content.slice(0, middle));
    const budget = calculateContextBudget(
      input.contextWindowTokens,
      input.tokenCounter.count([...retainedWithoutSummary, candidate]),
      input.budgetPolicy,
    );
    if (budget.pressure === "normal") {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best ?? summary;
}

function summaryWithContentBudget(summary: ContextMessage, content: string): ContextMessage {
  return {
    ...summary,
    content,
    metadata: {
      ...(summary.metadata ?? {}),
      tokenContribution: String(Math.max(1, Math.ceil(content.length / 12))),
    },
  };
}

function deterministicSummaryMessage(
  groups: readonly ContextMessageGroup[],
  configuration: { readonly policyId: string; readonly policyVersion: string; readonly heading: string; readonly hierarchical?: boolean },
  maxCharactersValue: string | undefined,
): ContextMessage {
  const maxCharacters = parseIntegerParameter(configuration.policyId, "maxSummaryCharacters", maxCharactersValue ?? String(DEFAULT_MAX_SUMMARY_CHARACTERS), 64, 8_000);
  const coverage = groups.map((group) => group.groupId);
  const levelOne = groups
    .flatMap((group) => group.messages.map((message) => `[level-1:${group.groupId}] ${singleLine(message.content)}`))
    .join("\n");
  const sourceText = configuration.hierarchical
    ? `Level 2 roll-up: ${coverage.join(", ")}\n${levelOne}`.slice(0, maxCharacters)
    : levelOne.slice(0, maxCharacters);
  const identity = createHash("sha256")
    .update(configuration.policyId)
    .update("\0")
    .update(configuration.policyVersion)
    .update("\0")
    .update(groups.flatMap((group) => group.messages.map((message) => `${message.messageId}:${message.content}`)).join("\0"))
    .digest("hex")
    .slice(0, 20);
  const content = `${configuration.heading} (${configuration.policyVersion})\nCoverage: ${coverage.join(", ")}\n${sourceText}`.slice(0, maxCharacters + 160);
  const first = groups[0]!.messages[0]!;
  return {
    schemaVersion: 1,
    messageId: `summary-${identity}`,
    sessionId: first.sessionId,
    sequence: first.sequence,
    role: "system",
    content,
    source: "compaction-summary",
    createdAt: first.createdAt,
    groupId: `summary-${identity}`,
    metadata: {
      sourceClass: "summary",
      trust: "trusted",
      summaryIdentity: identity,
      summaryPolicy: configuration.policyId,
      summaryCoverage: coverage.join(","),
      summaryMode: configuration.hierarchical ? "hierarchical" : "rolling",
      ...(configuration.hierarchical ? { summaryLevels: "1,2" } : {}),
      tokenContribution: String(Math.max(1, Math.ceil(content.length / 12))),
    },
  };
}

function allocationFor(
  input: ContextAssemblyInput,
  groups: readonly ContextMessageGroup[],
): {
  readonly selectedGroupIds: ReadonlySet<string>;
  readonly evidence: StudioContextAllocation;
  readonly unknown: boolean;
} {
  const percentages = allocationPercentages(input.strategy.parameters);
  const availableInputTokens = input.contextWindowTokens === null
    ? null
    : Math.max(0, input.contextWindowTokens - input.budgetPolicy.reservedOutputTokens - input.budgetPolicy.safetyMarginTokens);
  const groupTokens = new Map<string, number | null>();
  let unknown = false;
  for (const group of groups) {
    const tokens = input.tokenCounter.count(group.messages).tokens;
    groupTokens.set(group.groupId, tokens);
    if (tokens === null) unknown = true;
  }

  const requestedByClass = new Map<StudioContextSourceClass, number | null>();
  for (const sourceClass of SOURCE_CLASSES) {
    const classGroups = groups.filter((group) => group.sourceGroup.sourceClass === sourceClass);
    const values = classGroups.map((group) => groupTokens.get(group.groupId));
    const knownValues = values.filter((value): value is number => value !== null && value !== undefined);
    requestedByClass.set(sourceClass, knownValues.length === values.length ? knownValues.reduce<number>((total, value) => total + value, 0) : null);
  }

  const caps = allocationCaps(availableInputTokens, percentages);
  const selectedGroupIds = new Set<string>();
  let classOverflow = false;
  if (availableInputTokens === null || unknown) {
    for (const group of groups) selectedGroupIds.add(group.groupId);
  } else {
    for (const sourceClass of SOURCE_CLASSES) {
      let used = 0;
      const cap = caps.get(sourceClass) ?? 0;
      const candidates = groups
        .filter((group) => group.sourceGroup.sourceClass === sourceClass)
        .sort((left, right) => right.sourceGroup.priority - left.sourceGroup.priority || left.index - right.index);
      for (const group of candidates) {
        const tokens = groupTokens.get(group.groupId)!;
        if (tokens <= cap - used) {
          selectedGroupIds.add(group.groupId);
          used += tokens;
        } else {
          classOverflow = true;
        }
      }
    }
  }

  const allocations = SOURCE_CLASSES.map((sourceClass) => {
    const classGroups = groups.filter((group) => group.sourceGroup.sourceClass === sourceClass);
    const selected = classGroups.filter((group) => selectedGroupIds.has(group.groupId));
    const selectedValues = selected.map((group) => groupTokens.get(group.groupId));
    const knownSelectedValues = selectedValues.filter((value): value is number => value !== null && value !== undefined);
    return {
      sourceClass,
      requestedTokens: requestedByClass.get(sourceClass) ?? null,
      allocatedTokens: caps.get(sourceClass) ?? null,
      usedTokens: knownSelectedValues.length === selectedValues.length ? knownSelectedValues.reduce<number>((total, value) => total + value, 0) : null,
      overflowTokens: requestedByClass.get(sourceClass) === null || caps.get(sourceClass) === null
        ? null
        : Math.max(0, (requestedByClass.get(sourceClass) ?? 0) - (caps.get(sourceClass) ?? 0)),
    };
  });
  return {
    selectedGroupIds,
    unknown,
    evidence: {
      availableInputTokens,
      allocations,
      reserveConsumedBy: null,
      overflowDecision: unknown || availableInputTokens === null ? "unknown" : classOverflow ? "class-limit" : "none",
    },
  };
}

function allocationPercentages(parameters: Readonly<Record<string, string>>): Readonly<Record<StudioContextSourceClass, number>> {
  const percentages = Object.fromEntries(SOURCE_CLASSES.map((sourceClass) => [
    sourceClass,
    parseIntegerParameter(
      "token-budget-allocation",
      allocationParameterName(sourceClass),
      parameters[allocationParameterName(sourceClass)] ?? String(DEFAULT_ALLOCATION_PERCENTAGES[sourceClass]),
      0,
      100,
    ),
  ])) as Record<StudioContextSourceClass, number>;
  const total = SOURCE_CLASSES.reduce((sum, sourceClass) => sum + percentages[sourceClass], 0);
  if (total !== 100) throw new Error("token-budget-allocation percentages must sum to 100.");
  return percentages;
}

function allocationParameterName(sourceClass: StudioContextSourceClass): string {
  return {
    instruction: "instructionPercent",
    "active-turn": "activeTurnPercent",
    transcript: "transcriptPercent",
    memory: "memoryPercent",
    "tool-result": "toolResultPercent",
    summary: "summaryPercent",
  }[sourceClass];
}

function allocationCaps(
  availableInputTokens: number | null,
  percentages: Readonly<Record<StudioContextSourceClass, number>>,
): ReadonlyMap<StudioContextSourceClass, number | null> {
  if (availableInputTokens === null) return new Map(SOURCE_CLASSES.map((sourceClass) => [sourceClass, null]));
  const caps = new Map<StudioContextSourceClass, number>();
  let assigned = 0;
  for (const sourceClass of SOURCE_CLASSES) {
    const cap = Math.floor(availableInputTokens * percentages[sourceClass] / 100);
    caps.set(sourceClass, cap);
    assigned += cap;
  }
  let remainder = availableInputTokens - assigned;
  for (const sourceClass of SOURCE_CLASSES) {
    if (remainder <= 0) break;
    if (percentages[sourceClass] > 0) {
      caps.set(sourceClass, (caps.get(sourceClass) ?? 0) + 1);
      remainder -= 1;
    }
  }
  return caps;
}

function defaultGroupDecision(
  group: ContextMessageGroup,
  retainedIds: ReadonlySet<string>,
  summarizedIds: ReadonlySet<string>,
): StudioContextGroupDecision {
  const retained = group.messages.every((message) => retainedIds.has(message.messageId));
  const summarized = group.messages.every((message) => summarizedIds.has(message.messageId));
  return {
    groupId: group.groupId,
    sourceClass: group.sourceGroup.sourceClass,
    decision: retained ? "retained" : summarized ? "summarized" : "omitted",
    score: null,
    reason: retained ? "retained as a complete source group" : summarized ? "represented by a deterministic summary" : "not selected by the strategy",
  };
}

function isMandatoryGroup(group: ContextMessageGroup): boolean {
  return group.sourceGroup.sourceClass === "instruction" || group.sourceGroup.sourceClass === "active-turn";
}

function decisionForBudget(budget: ContextBudget): ContextAssemblyResult["decision"] {
  if (budget.quality === "unknown") return "unknown-budget";
  if (budget.pressure === "exhausted") return "over-budget";
  return "within-budget";
}

function parseIntegerParameter(strategyId: string, parameterId: string, value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${strategyId} ${parameterId} must be an integer.`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new Error(`${strategyId} ${parameterId} must be between ${minimum} and ${maximum}.`);
  return parsed;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function terms(value: string): ReadonlySet<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !STOP_WORDS.has(term)) ?? []);
}

function overlapScore(taskTerms: ReadonlySet<string>, messageTerms: ReadonlySet<string>): number {
  let score = 0;
  for (const term of messageTerms) if (taskTerms.has(term)) score += 1;
  return score;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "should",
  "this",
  "that",
  "from",
  "are",
  "was",
  "use",
]);
