export interface MemoryConfig {
  readonly maxRecords: number;
  readonly maxContentBytes: number;
  readonly maxRecallResults: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = Object.freeze({
  maxRecords: 500,
  maxContentBytes: 16_384,
  maxRecallResults: 20,
});

export class MemoryConfigError extends Error {
  readonly code = "INVALID_MEMORY_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "MemoryConfigError";
  }
}

export function parseMemoryConfig(value: unknown = {}): MemoryConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxRecords", "maxContentBytes", "maxRecallResults"]);
  return Object.freeze({
    maxRecords: integerValue(record, "maxRecords", DEFAULT_MEMORY_CONFIG.maxRecords, 1, 100_000),
    maxContentBytes: integerValue(record, "maxContentBytes", DEFAULT_MEMORY_CONFIG.maxContentBytes, 1, 10_000_000),
    maxRecallResults: integerValue(record, "maxRecallResults", DEFAULT_MEMORY_CONFIG.maxRecallResults, 1, 10_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MemoryConfigError("config", "must be an object.");
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new MemoryConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new MemoryConfigError(key, "is not a supported setting.");
}
