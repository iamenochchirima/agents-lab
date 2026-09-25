export interface OutputActionsConfig {
  readonly maxPayloadBytes: number;
  readonly requireIdempotencyKey: boolean;
}

export const DEFAULT_OUTPUT_ACTIONS_CONFIG: OutputActionsConfig = Object.freeze({
  maxPayloadBytes: 65_536,
  requireIdempotencyKey: true,
});

export class OutputActionsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputActionsConfigError";
  }
}

/** Parses payload bounds and delivery identity requirements. */
export function parseOutputActionsConfig(input: unknown = {}): OutputActionsConfig {
  if (!isRecord(input)) throw new OutputActionsConfigError("Output actions config must be an object.");
  rejectUnknownKeys(input, ["maxPayloadBytes", "requireIdempotencyKey"]);
  const maxPayloadBytes = input.maxPayloadBytes === undefined ? DEFAULT_OUTPUT_ACTIONS_CONFIG.maxPayloadBytes : input.maxPayloadBytes;
  if (!Number.isInteger(maxPayloadBytes) || (maxPayloadBytes as number) < 1 || (maxPayloadBytes as number) > 1_048_576) {
    throw new OutputActionsConfigError("maxPayloadBytes must be an integer from 1 through 1048576.");
  }
  const requireIdempotencyKey = input.requireIdempotencyKey === undefined ? DEFAULT_OUTPUT_ACTIONS_CONFIG.requireIdempotencyKey : input.requireIdempotencyKey;
  if (typeof requireIdempotencyKey !== "boolean") {
    throw new OutputActionsConfigError("requireIdempotencyKey must be a boolean.");
  }
  return Object.freeze({ maxPayloadBytes: maxPayloadBytes as number, requireIdempotencyKey });
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new OutputActionsConfigError(`Unknown output actions config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
