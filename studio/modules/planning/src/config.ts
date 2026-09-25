export interface PlanningConfig {
  readonly maxSteps: number;
  readonly maxDescriptionBytes: number;
  readonly maxAssumptions: number;
}

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = Object.freeze({
  maxSteps: 12,
  maxDescriptionBytes: 4_096,
  maxAssumptions: 20,
});

export class PlanningConfigError extends Error {
  readonly code = "INVALID_PLANNING_CONFIG" as const;

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "PlanningConfigError";
  }
}

export function parsePlanningConfig(value: unknown = {}): PlanningConfig {
  const record = objectValue(value);
  rejectUnknownKeys(record, ["maxSteps", "maxDescriptionBytes", "maxAssumptions"]);
  return Object.freeze({
    maxSteps: integerValue(record, "maxSteps", DEFAULT_PLANNING_CONFIG.maxSteps, 1, 1_000),
    maxDescriptionBytes: integerValue(record, "maxDescriptionBytes", DEFAULT_PLANNING_CONFIG.maxDescriptionBytes, 1, 1_000_000),
    maxAssumptions: integerValue(record, "maxAssumptions", DEFAULT_PLANNING_CONFIG.maxAssumptions, 0, 1_000),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PlanningConfigError("config", "must be an object.");
  return value as Record<string, unknown>;
}

function integerValue(record: Record<string, unknown>, field: string, fallback: number, min: number, max: number): number {
  const value = record[field] === undefined ? fallback : record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PlanningConfigError(field, `must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new PlanningConfigError(key, "is not a supported setting.");
}
