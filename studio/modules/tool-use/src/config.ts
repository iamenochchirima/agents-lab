export interface ToolUseConfig {
  readonly maxCallsPerTurn: number;
  readonly maxArgumentBytes: number;
  readonly maxResultBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_TOOL_USE_CONFIG: ToolUseConfig = Object.freeze({
  maxCallsPerTurn: 12,
  maxArgumentBytes: 16_384,
  maxResultBytes: 65_536,
  timeoutMs: 30_000,
});

export class ToolUseConfigError extends Error {
  readonly code = "INVALID_TOOL_USE_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ToolUseConfigError";
  }
}

export function parseToolUseConfig(value: unknown = {}): ToolUseConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxCallsPerTurn", "maxArgumentBytes", "maxResultBytes", "timeoutMs"]);
  return Object.freeze({
    maxCallsPerTurn: integerValue(record, "maxCallsPerTurn", DEFAULT_TOOL_USE_CONFIG.maxCallsPerTurn, 1, 10_000),
    maxArgumentBytes: integerValue(record, "maxArgumentBytes", DEFAULT_TOOL_USE_CONFIG.maxArgumentBytes, 1, 10_000_000),
    maxResultBytes: integerValue(record, "maxResultBytes", DEFAULT_TOOL_USE_CONFIG.maxResultBytes, 1, 100_000_000),
    timeoutMs: integerValue(record, "timeoutMs", DEFAULT_TOOL_USE_CONFIG.timeoutMs, 1, 3_600_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ToolUseConfigError("config", "must be an object.");
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolUseConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ToolUseConfigError(key, "is not a supported setting.");
}
