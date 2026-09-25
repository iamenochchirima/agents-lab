export interface ComputerUseConfig {
  readonly maxActionsPerTurn: number;
  readonly maxObservationBytes: number;
  readonly actionTimeoutMs: number;
}

export const DEFAULT_COMPUTER_USE_CONFIG: ComputerUseConfig = Object.freeze({
  maxActionsPerTurn: 20,
  maxObservationBytes: 2_000_000,
  actionTimeoutMs: 30_000,
});

export class ComputerUseConfigError extends Error {
  readonly code = "INVALID_COMPUTER_USE_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ComputerUseConfigError";
  }
}

export function parseComputerUseConfig(value: unknown = {}): ComputerUseConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxActionsPerTurn", "maxObservationBytes", "actionTimeoutMs"]);
  return Object.freeze({
    maxActionsPerTurn: integerValue(record, "maxActionsPerTurn", DEFAULT_COMPUTER_USE_CONFIG.maxActionsPerTurn, 1, 10_000),
    maxObservationBytes: integerValue(record, "maxObservationBytes", DEFAULT_COMPUTER_USE_CONFIG.maxObservationBytes, 1, 100_000_000),
    actionTimeoutMs: integerValue(record, "actionTimeoutMs", DEFAULT_COMPUTER_USE_CONFIG.actionTimeoutMs, 1, 3_600_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ComputerUseConfigError("config", "must be an object.");
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ComputerUseConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ComputerUseConfigError(key, "is not a supported setting.");
}
