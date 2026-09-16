import { URL } from "node:url";

export const TRIGGER_DEV_PLATFORM = "trigger-dev" as const;
export const TRIGGER_DEV_VARIANT = "baseline" as const;
export const TRIGGER_DEV_VERSION = "4.5.14" as const;
export const TRIGGER_TASK_IDENTIFIER = "agentlab-trigger-dev-baseline" as const;
export const DEFAULT_TRIGGER_API_URL = "http://127.0.0.1:3040";
export const DEFAULT_TRIGGER_MAX_ATTEMPTS = 2;
export const DEFAULT_TRIGGER_MAX_DURATION_SECONDS = 60;
export const DEFAULT_TRIGGER_IDEMPOTENCY_TTL = "1h";
export const DEFAULT_TRIGGER_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface TriggerDevConfig {
  readonly apiUrl: string;
  readonly secretKey: string | null;
  readonly projectRef: string;
  readonly taskIdentifier: string;
  readonly maxAttempts: number;
  readonly maxDurationSeconds: number;
  readonly idempotencyKeyTtl: string;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
  readonly sdkVersion: typeof TRIGGER_DEV_VERSION;
  readonly cliVersion: typeof TRIGGER_DEV_VERSION;
}

export class InvalidTriggerDevConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTriggerDevConfigError";
  }
}

export function loadTriggerDevConfig(environment: NodeJS.ProcessEnv = process.env): TriggerDevConfig {
  const config = {
    apiUrl: parseUrl(environment.TRIGGER_API_URL, DEFAULT_TRIGGER_API_URL, "TRIGGER_API_URL"),
    secretKey: environment.TRIGGER_SECRET_KEY?.trim() || null,
    projectRef: parseProjectRef(environment.TRIGGER_PROJECT_REF),
    taskIdentifier: TRIGGER_TASK_IDENTIFIER,
    maxAttempts: parseInteger(
      environment.AGENTLAB_TRIGGER_MAX_ATTEMPTS,
      DEFAULT_TRIGGER_MAX_ATTEMPTS,
      "AGENTLAB_TRIGGER_MAX_ATTEMPTS",
      1,
      10,
    ),
    maxDurationSeconds: parseInteger(
      environment.AGENTLAB_TRIGGER_MAX_DURATION_SECONDS,
      DEFAULT_TRIGGER_MAX_DURATION_SECONDS,
      "AGENTLAB_TRIGGER_MAX_DURATION_SECONDS",
      5,
      86_400,
    ),
    idempotencyKeyTtl: parseDuration(
      environment.AGENTLAB_TRIGGER_IDEMPOTENCY_KEY_TTL,
      DEFAULT_TRIGGER_IDEMPOTENCY_TTL,
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      DEFAULT_TRIGGER_OPENROUTER_BASE_URL,
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
    sdkVersion: TRIGGER_DEV_VERSION,
    cliVersion: TRIGGER_DEV_VERSION,
  } satisfies TriggerDevConfig;

  return Object.freeze(config);
}

export function safeManifestConfiguration(config: TriggerDevConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    apiUrl: config.apiUrl,
    projectRef: config.projectRef,
    taskIdentifier: config.taskIdentifier,
    maxAttempts: config.maxAttempts,
    maxDurationSeconds: config.maxDurationSeconds,
    idempotencyKeyTtl: config.idempotencyKeyTtl,
    sdkVersion: config.sdkVersion,
    cliVersion: config.cliVersion,
    runtime: "node",
    localExecution: true,
    secretConfigured: config.secretKey !== null,
    openRouterConfigured: config.openRouterApiKey !== null,
  });
}

function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidTriggerDevConfigError(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}

function parseProjectRef(value: string | undefined): string {
  const resolved = (value ?? "proj_agentlab").trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(resolved)) {
    throw new InvalidTriggerDevConfigError("TRIGGER_PROJECT_REF must be a safe project reference.");
  }
  return resolved;
}

function parseInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) throw new InvalidTriggerDevConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidTriggerDevConfigError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseDuration(value: string | undefined, fallback: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^\d+(?:s|m|h|d)$/.test(resolved)) {
    throw new InvalidTriggerDevConfigError("AGENTLAB_TRIGGER_IDEMPOTENCY_KEY_TTL must be a duration such as 1h.");
  }
  return resolved;
}
