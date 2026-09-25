export interface InputConfig {
  readonly maxTextBytes: number;
  readonly maxAttachments: number;
}

export const DEFAULT_INPUT_CONFIG: InputConfig = Object.freeze({
  maxTextBytes: 64_000,
  maxAttachments: 16,
});

export class InputConfigError extends Error {
  readonly code = "INVALID_INPUT_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "InputConfigError";
  }
}

export function parseInputConfig(value: unknown = {}): InputConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxTextBytes", "maxAttachments"]);
  return Object.freeze({
    maxTextBytes: integerValue(record, "maxTextBytes", DEFAULT_INPUT_CONFIG.maxTextBytes, 1, 10_000_000),
    maxAttachments: integerValue(record, "maxAttachments", DEFAULT_INPUT_CONFIG.maxAttachments, 0, 1_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InputConfigError("config", "must be an object.");
  }
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new InputConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new InputConfigError(key, "is not a supported setting.");
  }
}
