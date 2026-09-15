import { URL } from "node:url";

export const HATCHET_PLATFORM = "hatchet" as const;
export const HATCHET_VARIANT = "baseline" as const;
export const HATCHET_SDK_VERSION = "1.33.1" as const;
export const HATCHET_SERVER_VERSION = "v0.106.5" as const;
export const HATCHET_TASK_NAME = "agentlab-hatchet-baseline" as const;
export const HATCHET_WORKER_NAME = "agentlab-hatchet-baseline-worker" as const;
export const HATCHET_DEFAULT_API_URL = "http://127.0.0.1:8080";
export const HATCHET_DEFAULT_HOST_PORT = "127.0.0.1:7077";
export const HATCHET_DEFAULT_TENANT_ID = "707d0855-80ab-4e1f-a156-f1c4546cbf52";
export const HATCHET_DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;
export const HATCHET_DEFAULT_SCHEDULE_TIMEOUT_MS = 5 * 60_000;
export const HATCHET_DEFAULT_RETRIES = 2;
export const HATCHET_DEFAULT_RETRY_BACKOFF_FACTOR = 2;
export const HATCHET_DEFAULT_RETRY_BACKOFF_MAX_SECONDS = 30;
export const HATCHET_DEFAULT_IDEMPOTENCY_FALLBACK_TTL_MS = 24 * 60 * 60 * 1_000;
export const HATCHET_DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
export const HATCHET_DEFAULT_WORKER_SLOTS = 2;

export type HatchetTlsStrategy = "none" | "tls" | "mtls";

export interface HatchetConfig {
  readonly apiUrl: string;
  readonly hostPort: string;
  readonly tenantId: string;
  readonly clientToken: string | null;
  readonly tlsStrategy: HatchetTlsStrategy;
  readonly taskName: typeof HATCHET_TASK_NAME;
  readonly workerName: typeof HATCHET_WORKER_NAME;
  readonly executionTimeoutMs: number;
  readonly scheduleTimeoutMs: number;
  readonly retries: number;
  readonly retryBackoffFactor: number;
  readonly retryBackoffMaxSeconds: number;
  readonly idempotencyFallbackTtlMs: number;
  readonly requestTimeoutMs: number;
  readonly workerSlots: number;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
  readonly sdkVersion: typeof HATCHET_SDK_VERSION;
  readonly serverVersion: typeof HATCHET_SERVER_VERSION;
}

export class InvalidHatchetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHatchetConfigError";
  }
}

export function loadHatchetConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HatchetConfig {
  const config: HatchetConfig = {
    apiUrl: parseUrl(
      environment.AGENTLAB_HATCHET_API_URL,
      HATCHET_DEFAULT_API_URL,
      "AGENTLAB_HATCHET_API_URL",
    ),
    hostPort: parseHostPort(
      environment.AGENTLAB_HATCHET_HOST_PORT,
      HATCHET_DEFAULT_HOST_PORT,
    ),
    tenantId: parseTenantId(
      environment.AGENTLAB_HATCHET_TENANT_ID,
      HATCHET_DEFAULT_TENANT_ID,
    ),
    clientToken: environment.HATCHET_CLIENT_TOKEN?.trim() || null,
    tlsStrategy: parseTlsStrategy(environment.AGENTLAB_HATCHET_TLS_STRATEGY),
    taskName: HATCHET_TASK_NAME,
    workerName: HATCHET_WORKER_NAME,
    executionTimeoutMs: parseInteger(
      environment.AGENTLAB_HATCHET_EXECUTION_TIMEOUT_MS,
      HATCHET_DEFAULT_EXECUTION_TIMEOUT_MS,
      "AGENTLAB_HATCHET_EXECUTION_TIMEOUT_MS",
      1_000,
      24 * 60 * 60 * 1_000,
    ),
    scheduleTimeoutMs: parseInteger(
      environment.AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS,
      HATCHET_DEFAULT_SCHEDULE_TIMEOUT_MS,
      "AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS",
      1_000,
      7 * 24 * 60 * 60 * 1_000,
    ),
    retries: parseInteger(
      environment.AGENTLAB_HATCHET_RETRIES,
      HATCHET_DEFAULT_RETRIES,
      "AGENTLAB_HATCHET_RETRIES",
      0,
      10,
    ),
    retryBackoffFactor: parseNumber(
      environment.AGENTLAB_HATCHET_RETRY_BACKOFF_FACTOR,
      HATCHET_DEFAULT_RETRY_BACKOFF_FACTOR,
      "AGENTLAB_HATCHET_RETRY_BACKOFF_FACTOR",
      1,
      10,
    ),
    retryBackoffMaxSeconds: parseInteger(
      environment.AGENTLAB_HATCHET_RETRY_BACKOFF_MAX_SECONDS,
      HATCHET_DEFAULT_RETRY_BACKOFF_MAX_SECONDS,
      "AGENTLAB_HATCHET_RETRY_BACKOFF_MAX_SECONDS",
      1,
      86_400,
    ),
    idempotencyFallbackTtlMs: parseInteger(
      environment.AGENTLAB_HATCHET_IDEMPOTENCY_FALLBACK_TTL_MS,
      HATCHET_DEFAULT_IDEMPOTENCY_FALLBACK_TTL_MS,
      "AGENTLAB_HATCHET_IDEMPOTENCY_FALLBACK_TTL_MS",
      1_000,
      30 * 24 * 60 * 60 * 1_000,
    ),
    requestTimeoutMs: parseInteger(
      environment.AGENTLAB_HATCHET_REQUEST_TIMEOUT_MS,
      HATCHET_DEFAULT_REQUEST_TIMEOUT_MS,
      "AGENTLAB_HATCHET_REQUEST_TIMEOUT_MS",
      100,
      60_000,
    ),
    workerSlots: parseInteger(
      environment.AGENTLAB_HATCHET_WORKER_SLOTS,
      HATCHET_DEFAULT_WORKER_SLOTS,
      "AGENTLAB_HATCHET_WORKER_SLOTS",
      1,
      100,
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      "https://openrouter.ai/api/v1",
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
    sdkVersion: HATCHET_SDK_VERSION,
    serverVersion: HATCHET_SERVER_VERSION,
  };

  if (config.scheduleTimeoutMs < config.executionTimeoutMs) {
    throw new InvalidHatchetConfigError(
      "AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS must be at least the execution timeout.",
    );
  }

  return Object.freeze(config);
}

export function safeManifestConfiguration(
  config: HatchetConfig,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    apiUrl: config.apiUrl,
    hostPort: config.hostPort,
    tenantId: config.tenantId,
    taskName: config.taskName,
    workerName: config.workerName,
    executionTimeoutMs: config.executionTimeoutMs,
    scheduleTimeoutMs: config.scheduleTimeoutMs,
    retries: config.retries,
    retryBackoffFactor: config.retryBackoffFactor,
    retryBackoffMaxSeconds: config.retryBackoffMaxSeconds,
    idempotency: {
      strategy: "status",
      expression: "input.runId",
      fallbackTtlMs: config.idempotencyFallbackTtlMs,
    },
    workerSlots: config.workerSlots,
    sdkVersion: config.sdkVersion,
    serverVersion: config.serverVersion,
    runtime: "node",
    clientTokenConfigured: config.clientToken !== null,
    openRouterConfigured: config.openRouterApiKey !== null,
  });
}

export function formatHatchetDuration(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 1_000) {
    throw new InvalidHatchetConfigError(
      "Hatchet durations must be positive whole seconds.",
    );
  }
  return `${Math.ceil(milliseconds / 1_000)}s`;
}

function parseUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("unsupported protocol");
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("credentials or query are not allowed");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidHatchetConfigError(
      `${name} must be an absolute HTTP or HTTPS URL without credentials or query parameters.`,
    );
  }
}

function parseHostPort(value: string | undefined, fallback: string): string {
  const resolved = (value ?? fallback).trim();
  const match = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):(\d{1,5})$/.exec(
    resolved,
  );
  const port = match ? Number(match[1]) : Number.NaN;
  if (!match || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new InvalidHatchetConfigError(
      "AGENTLAB_HATCHET_HOST_PORT must be a host and port such as 127.0.0.1:7077.",
    );
  }
  return resolved;
}

function parseTenantId(value: string | undefined, fallback: string): string {
  const resolved = (value ?? fallback).trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      resolved,
    )
  ) {
    throw new InvalidHatchetConfigError(
      "AGENTLAB_HATCHET_TENANT_ID must be a UUID.",
    );
  }
  return resolved;
}

function parseTlsStrategy(value: string | undefined): HatchetTlsStrategy {
  const resolved = (value ?? "none").trim().toLowerCase();
  if (resolved !== "none" && resolved !== "tls" && resolved !== "mtls") {
    throw new InvalidHatchetConfigError(
      "AGENTLAB_HATCHET_TLS_STRATEGY must be none, tls, or mtls.",
    );
  }
  return resolved;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved))
    throw new InvalidHatchetConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidHatchetConfigError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(resolved))
    throw new InvalidHatchetConfigError(`${name} must be a number.`);
  const parsed = Number(resolved);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidHatchetConfigError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}
