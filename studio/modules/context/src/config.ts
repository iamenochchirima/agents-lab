export interface ContextConfig {
  readonly maxMessages: number;
  readonly maxSourceBytes: number;
  readonly minAvailableInputTokens: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = Object.freeze({
  maxMessages: 200,
  maxSourceBytes: 2_000_000,
  minAvailableInputTokens: 1,
});

export class ContextConfigError extends Error {
  readonly code = "INVALID_CONTEXT_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ContextConfigError";
  }
}

export function parseContextConfig(value: unknown = {}): ContextConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxMessages", "maxSourceBytes", "minAvailableInputTokens"]);
  return Object.freeze({
    maxMessages: integerValue(record, "maxMessages", DEFAULT_CONTEXT_CONFIG.maxMessages, 1, 100_000),
    maxSourceBytes: integerValue(record, "maxSourceBytes", DEFAULT_CONTEXT_CONFIG.maxSourceBytes, 1, 100_000_000),
    minAvailableInputTokens: integerValue(record, "minAvailableInputTokens", DEFAULT_CONTEXT_CONFIG.minAvailableInputTokens, 0, 1_000_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ContextConfigError("config", "must be an object.");
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ContextConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ContextConfigError(key, "is not a supported setting.");
}
