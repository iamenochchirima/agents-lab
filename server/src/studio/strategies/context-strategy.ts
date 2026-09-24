import type {
  ContextBudget,
  ContextBudgetPolicy,
  ContextMessage,
  ContextTokenCounter,
} from "../../capabilities/context/contracts.js";
import type { StudioContextDecisionEvidence, StudioContextSourceGroup } from "./context-research-contracts.js";
import type { StudioContextEvidence, StudioStrategyVariant } from "../domain/types.js";
import {
  DeterministicCompactionStrategy,
  GroupAwareSlidingWindowStrategy,
  HierarchicalSummaryStrategy,
  RelevanceRankedGroupsStrategy,
  selectGroupAwareRecentMessages,
  TokenBudgetAllocationStrategy,
  recoverContextAfterProviderOverflow,
  resultForResearch,
} from "./context-research.js";

export interface ContextAssemblyInput {
  readonly trialId: string;
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly contextWindowTokens: number;
  readonly budgetPolicy: ContextBudgetPolicy;
  readonly tokenCounter: ContextTokenCounter;
  readonly strategy: StudioStrategyVariant;
  /** Optional richer source metadata; message grouping remains backward compatible. */
  readonly sourceGroups?: readonly StudioContextSourceGroup[];
}

export interface ContextAssemblyResult {
  readonly messages: readonly ContextMessage[];
  readonly retainedMessageIds: readonly string[];
  readonly omittedMessageIds: readonly string[];
  readonly summarizedMessageIds: readonly string[];
  readonly budget: ContextBudget;
  readonly decision: StudioContextEvidence["decision"];
  /** Additive research projection; legacy callers can ignore it. */
  readonly research?: StudioContextDecisionEvidence;
}

export interface ContextStrategy {
  readonly id: string;
  readonly version: string;
  assemble(input: ContextAssemblyInput): ContextAssemblyResult;
}

export class UnknownContextStrategyError extends Error {
  constructor(readonly strategyId: string) {
    super(`Context strategy is not registered: ${strategyId}`);
    this.name = "UnknownContextStrategyError";
  }
}

export class InvalidContextStrategyParametersError extends Error {
  constructor(readonly strategyId: string, message: string) {
    super(message);
    this.name = "InvalidContextStrategyParametersError";
  }
}

export class ContextStrategyRegistry {
  private readonly strategies = new Map<string, ContextStrategy>();

  constructor(strategies: readonly ContextStrategy[]) {
    for (const strategy of strategies) {
      if (this.strategies.has(strategy.id)) throw new Error(`Context strategy is registered twice: ${strategy.id}`);
      this.strategies.set(strategy.id, strategy);
    }
  }

  get(id: string): ContextStrategy {
    const strategy = this.strategies.get(id);
    if (!strategy) throw new UnknownContextStrategyError(id);
    return strategy;
  }
}

export class FullHistoryStrategy implements ContextStrategy {
  readonly id = "full-history";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const messages = [...input.messages];
    return resultForResearch(input, messages);
  }
}

export class SlidingWindowStrategy implements ContextStrategy {
  readonly id = "sliding-window";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const recentMessages = parseBoundedParameter(
      "sliding-window",
      "recentMessages",
      input.strategy.parameters.recentMessages,
      4,
    );
    const groupAtomic = input.strategy.parameters.groupAtomic === "true" && input.messages.some((message) => message.groupId !== undefined);
    const messages = groupAtomic
      ? selectGroupAwareRecentMessages(input, input.strategy.parameters.recentGroups ?? String(recentMessages)).messages
      : [...input.messages.filter((message) => message.role === "system"), ...input.messages.filter((message) => message.role !== "system").slice(-recentMessages)];
    return resultForResearch(input, messages);
  }
}

export class RelevanceRankedStrategy implements ContextStrategy {
  readonly id = "relevance-ranked";
  readonly version = "1";

  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const maxMessages = parseBoundedParameter(
      "relevance-ranked",
      "maxMessages",
      input.strategy.parameters.maxMessages,
      4,
    );
    const systemMessages = input.messages.filter((message) => message.role === "system");
    const nonSystemMessages = input.messages.filter((message) => message.role !== "system");
    const taskTerms = terms(input.task);
    const rankedMessages = nonSystemMessages
      .map((message, index) => ({
        message,
        index,
        score: overlapScore(taskTerms, terms(message.content)),
      }))
      .sort((left, right) => right.score - left.score || right.message.sequence - left.message.sequence || right.index - left.index)
      .slice(0, maxMessages)
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.message);
    const messages = [...systemMessages, ...rankedMessages];
    return resultForResearch(input, messages);
  }
}

function parseBoundedParameter(strategyId: string, parameterId: string, value: string | undefined, defaultValue: number): number {
  const resolved = value ?? String(defaultValue);
  if (!/^\d+$/.test(resolved)) throw new InvalidContextStrategyParametersError(strategyId, `${strategyId} ${parameterId} must be an integer.`);
  const count = Number(resolved);
  if (count < 1 || count > 100) throw new InvalidContextStrategyParametersError(strategyId, `${strategyId} ${parameterId} must be between 1 and 100.`);
  return count;
}

function terms(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((term) => term.length > 2 && !STOP_WORDS.has(term)) ?? [],
  );
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

export {
  DeterministicCompactionStrategy,
  GroupAwareSlidingWindowStrategy,
  HierarchicalSummaryStrategy,
  RelevanceRankedGroupsStrategy,
  TokenBudgetAllocationStrategy,
  recoverContextAfterProviderOverflow,
} from "./context-research.js";
