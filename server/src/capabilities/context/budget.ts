import type {
  ContextBudget,
  ContextBudgetPolicy,
  ContextPressure,
  TokenCount,
} from "./contracts.js";

export const DEFAULT_CONTEXT_COMPACTION_THRESHOLD_PERCENT = 20;
export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_096;

export function calculateContextBudget(
  contextWindowTokens: number | null,
  input: TokenCount,
  policy: ContextBudgetPolicy,
): ContextBudget {
  validatePolicy(policy);
  if (contextWindowTokens !== null) validateContextWindow(contextWindowTokens);

  const reservedOutputTokens = policy.reservedOutputTokens;
  const safetyMarginTokens = policy.safetyMarginTokens;
  const remainingTokens = contextWindowTokens === null || input.tokens === null
    ? null
    : contextWindowTokens - input.tokens - reservedOutputTokens - safetyMarginTokens;
  const remainingPercent = contextWindowTokens === null || remainingTokens === null
    ? null
    : clampInteger(Math.floor((remainingTokens / contextWindowTokens) * 100), 0, 100);

  return {
    contextWindowTokens,
    inputTokens: input.tokens,
    reservedOutputTokens,
    safetyMarginTokens,
    remainingTokens,
    remainingPercent,
    quality: input.quality,
    tokenizerBasis: input.basis,
    pressure: classifyPressure(remainingTokens, remainingPercent, policy.compactionThresholdPercent, input.quality),
  };
}

export function classifyPressure(
  remainingTokens: number | null,
  remainingPercent: number | null,
  thresholdPercent: number,
  quality: TokenCount["quality"],
): ContextPressure {
  if (quality === "unknown" || remainingTokens === null || remainingPercent === null) return "unknown";
  if (remainingTokens <= 0) return "exhausted";
  if (remainingPercent <= thresholdPercent) return "compaction_due";
  return "normal";
}

function validatePolicy(policy: ContextBudgetPolicy): void {
  if (!Number.isInteger(policy.reservedOutputTokens) || policy.reservedOutputTokens < 0) {
    throw new Error("reservedOutputTokens must be a non-negative integer.");
  }
  if (!Number.isInteger(policy.safetyMarginTokens) || policy.safetyMarginTokens < 0) {
    throw new Error("safetyMarginTokens must be a non-negative integer.");
  }
  if (!Number.isInteger(policy.compactionThresholdPercent) || policy.compactionThresholdPercent < 0 || policy.compactionThresholdPercent > 100) {
    throw new Error("compactionThresholdPercent must be an integer between 0 and 100.");
  }
  if (policy.recentMessageGroups !== undefined && (!Number.isInteger(policy.recentMessageGroups) || policy.recentMessageGroups < 0)) {
    throw new Error("recentMessageGroups must be a non-negative integer when provided.");
  }
}

function validateContextWindow(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("contextWindowTokens must be a positive integer or null.");
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
