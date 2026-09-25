export type SafetyDecisionKind = "allow" | "deny" | "approval-required";

export interface SafetyConfig {
  /** Used when a checkpoint has no matching policy rule or cannot be assessed. */
  readonly defaultDecision: SafetyDecisionKind;
  readonly maxCheckpointBytes: number;
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = Object.freeze({
  defaultDecision: "deny",
  maxCheckpointBytes: 32_768,
});

export class SafetyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyConfigError";
  }
}

/** Parses fail-closed fallback behavior and checkpoint size limits. */
export function parseSafetyConfig(input: unknown = {}): SafetyConfig {
  if (!isRecord(input)) throw new SafetyConfigError("Safety config must be an object.");
  rejectUnknownKeys(input, ["defaultDecision", "maxCheckpointBytes"]);
  const defaultDecision = input.defaultDecision === undefined ? DEFAULT_SAFETY_CONFIG.defaultDecision : input.defaultDecision;
  if (defaultDecision !== "allow" && defaultDecision !== "deny" && defaultDecision !== "approval-required") {
    throw new SafetyConfigError('defaultDecision must be "allow", "deny", or "approval-required".');
  }
  const maxCheckpointBytes = input.maxCheckpointBytes === undefined ? DEFAULT_SAFETY_CONFIG.maxCheckpointBytes : input.maxCheckpointBytes;
  if (!Number.isInteger(maxCheckpointBytes) || (maxCheckpointBytes as number) < 1 || (maxCheckpointBytes as number) > 1_048_576) {
    throw new SafetyConfigError("maxCheckpointBytes must be an integer from 1 through 1048576.");
  }
  return Object.freeze({ defaultDecision, maxCheckpointBytes: maxCheckpointBytes as number });
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new SafetyConfigError(`Unknown safety config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
