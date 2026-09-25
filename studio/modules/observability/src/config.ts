export interface ObservabilityConfig {
  readonly maxBufferedEvents: number;
  readonly flushEveryEvents: number;
  readonly maxModuleDetailBytes: number;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = Object.freeze({
  maxBufferedEvents: 1_000,
  flushEveryEvents: 25,
  maxModuleDetailBytes: 65_536,
});

export class ObservabilityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservabilityConfigError";
  }
}

/** Parses bounded buffering and module-specific detail retention settings. */
export function parseObservabilityConfig(input: unknown = {}): ObservabilityConfig {
  if (!isRecord(input)) throw new ObservabilityConfigError("Observability config must be an object.");
  rejectUnknownKeys(input, ["maxBufferedEvents", "flushEveryEvents", "maxModuleDetailBytes"]);
  const maxBufferedEvents = input.maxBufferedEvents === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxBufferedEvents : input.maxBufferedEvents;
  const flushEveryEvents = input.flushEveryEvents === undefined ? DEFAULT_OBSERVABILITY_CONFIG.flushEveryEvents : input.flushEveryEvents;
  const maxModuleDetailBytes = input.maxModuleDetailBytes === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxModuleDetailBytes : input.maxModuleDetailBytes;
  if (!isIntegerInRange(maxBufferedEvents, 1, 100_000)) {
    throw new ObservabilityConfigError("maxBufferedEvents must be an integer from 1 through 100000.");
  }
  if (!isIntegerInRange(flushEveryEvents, 1, 10_000)) {
    throw new ObservabilityConfigError("flushEveryEvents must be an integer from 1 through 10000.");
  }
  if ((flushEveryEvents as number) > (maxBufferedEvents as number)) {
    throw new ObservabilityConfigError("flushEveryEvents must not exceed maxBufferedEvents.");
  }
  if (!isIntegerInRange(maxModuleDetailBytes, 0, 1_048_576)) {
    throw new ObservabilityConfigError("maxModuleDetailBytes must be an integer from 0 through 1048576.");
  }
  return Object.freeze({
    maxBufferedEvents: maxBufferedEvents as number,
    flushEveryEvents: flushEveryEvents as number,
    maxModuleDetailBytes: maxModuleDetailBytes as number,
  });
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ObservabilityConfigError(`Unknown observability config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
