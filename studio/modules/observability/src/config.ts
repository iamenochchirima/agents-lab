export interface ObservabilityConfig {
  readonly maxBufferedEvents: number;
  readonly maxBufferedBytes: number;
  readonly flushEveryEvents: number;
  readonly maxEventBytes: number;
  readonly maxModuleDetailBytes: number;
  readonly maxTrackedEvents: number;
  readonly maxStoredBytes: number;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = Object.freeze({
  maxBufferedEvents: 1_000,
  maxBufferedBytes: 8_388_608,
  flushEveryEvents: 25,
  maxEventBytes: 1_048_576,
  maxModuleDetailBytes: 65_536,
  maxTrackedEvents: 100_000,
  maxStoredBytes: 33_554_432,
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
  rejectUnknownKeys(input, ["maxBufferedEvents", "maxBufferedBytes", "flushEveryEvents", "maxEventBytes", "maxModuleDetailBytes", "maxTrackedEvents", "maxStoredBytes"]);
  const maxBufferedEvents = input.maxBufferedEvents === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxBufferedEvents : input.maxBufferedEvents;
  const maxBufferedBytes = input.maxBufferedBytes === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxBufferedBytes : input.maxBufferedBytes;
  const flushEveryEvents = input.flushEveryEvents === undefined ? DEFAULT_OBSERVABILITY_CONFIG.flushEveryEvents : input.flushEveryEvents;
  const maxEventBytes = input.maxEventBytes === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxEventBytes : input.maxEventBytes;
  const maxModuleDetailBytes = input.maxModuleDetailBytes === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxModuleDetailBytes : input.maxModuleDetailBytes;
  const maxTrackedEvents = input.maxTrackedEvents === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxTrackedEvents : input.maxTrackedEvents;
  const maxStoredBytes = input.maxStoredBytes === undefined ? DEFAULT_OBSERVABILITY_CONFIG.maxStoredBytes : input.maxStoredBytes;
  if (!isIntegerInRange(maxBufferedEvents, 1, 100_000)) {
    throw new ObservabilityConfigError("maxBufferedEvents must be an integer from 1 through 100000.");
  }
  if (!isIntegerInRange(maxBufferedBytes, 1, 268_435_456)) {
    throw new ObservabilityConfigError("maxBufferedBytes must be an integer from 1 through 268435456.");
  }
  if (!isIntegerInRange(flushEveryEvents, 1, 10_000)) {
    throw new ObservabilityConfigError("flushEveryEvents must be an integer from 1 through 10000.");
  }
  if ((flushEveryEvents as number) > (maxBufferedEvents as number)) {
    throw new ObservabilityConfigError("flushEveryEvents must not exceed maxBufferedEvents.");
  }
  if (!isIntegerInRange(maxEventBytes, 1, 16_777_216)) {
    throw new ObservabilityConfigError("maxEventBytes must be an integer from 1 through 16777216.");
  }
  if ((maxEventBytes as number) > (maxBufferedBytes as number)) {
    throw new ObservabilityConfigError("maxEventBytes must not exceed maxBufferedBytes.");
  }
  if (!isIntegerInRange(maxModuleDetailBytes, 0, 1_048_576)) {
    throw new ObservabilityConfigError("maxModuleDetailBytes must be an integer from 0 through 1048576.");
  }
  if ((maxModuleDetailBytes as number) > (maxEventBytes as number)) {
    throw new ObservabilityConfigError("maxModuleDetailBytes must not exceed maxEventBytes.");
  }
  if (!isIntegerInRange(maxTrackedEvents, 1, 1_000_000)) {
    throw new ObservabilityConfigError("maxTrackedEvents must be an integer from 1 through 1000000.");
  }
  if ((maxTrackedEvents as number) < (maxBufferedEvents as number)) {
    throw new ObservabilityConfigError("maxTrackedEvents must be at least maxBufferedEvents.");
  }
  if (!isIntegerInRange(maxStoredBytes, 1, 67_108_864)) {
    throw new ObservabilityConfigError("maxStoredBytes must be an integer from 1 through 67108864.");
  }
  if ((maxEventBytes as number) + 1 > (maxStoredBytes as number)) {
    throw new ObservabilityConfigError("maxStoredBytes must fit at least one maximum-size event and its newline.");
  }
  return Object.freeze({
    maxBufferedEvents: maxBufferedEvents as number,
    maxBufferedBytes: maxBufferedBytes as number,
    flushEveryEvents: flushEveryEvents as number,
    maxEventBytes: maxEventBytes as number,
    maxModuleDetailBytes: maxModuleDetailBytes as number,
    maxTrackedEvents: maxTrackedEvents as number,
    maxStoredBytes: maxStoredBytes as number,
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
