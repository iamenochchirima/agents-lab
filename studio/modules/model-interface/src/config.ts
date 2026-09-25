export interface ModelInterfaceConfig {
  readonly requestTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxAttempts: number;
}

export const DEFAULT_MODEL_INTERFACE_CONFIG: ModelInterfaceConfig = Object.freeze({
  requestTimeoutMs: 60_000,
  maxOutputTokens: 2_048,
  maxAttempts: 1,
});

export class ModelInterfaceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelInterfaceConfigError";
  }
}

/** Parses bounded request settings. Credentials and provider clients are injected by the host. */
export function parseModelInterfaceConfig(input: unknown = {}): ModelInterfaceConfig {
  if (!isRecord(input)) throw new ModelInterfaceConfigError("Model interface config must be an object.");
  rejectUnknownKeys(input, ["requestTimeoutMs", "maxOutputTokens", "maxAttempts"]);
  const requestTimeoutMs = input.requestTimeoutMs === undefined ? DEFAULT_MODEL_INTERFACE_CONFIG.requestTimeoutMs : input.requestTimeoutMs;
  const maxOutputTokens = input.maxOutputTokens === undefined ? DEFAULT_MODEL_INTERFACE_CONFIG.maxOutputTokens : input.maxOutputTokens;
  const maxAttempts = input.maxAttempts === undefined ? DEFAULT_MODEL_INTERFACE_CONFIG.maxAttempts : input.maxAttempts;
  if (!isIntegerInRange(requestTimeoutMs, 1, 300_000)) {
    throw new ModelInterfaceConfigError("requestTimeoutMs must be an integer from 1 through 300000.");
  }
  if (!isIntegerInRange(maxOutputTokens, 1, 32_768)) {
    throw new ModelInterfaceConfigError("maxOutputTokens must be an integer from 1 through 32768.");
  }
  if (!isIntegerInRange(maxAttempts, 1, 3)) {
    throw new ModelInterfaceConfigError("maxAttempts must be an integer from 1 through 3.");
  }
  return Object.freeze({ requestTimeoutMs, maxOutputTokens, maxAttempts });
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ModelInterfaceConfigError(`Unknown model interface config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
