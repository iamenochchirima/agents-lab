import { join } from "node:path";
import { URL } from "node:url";

export const INNGEST_PLATFORM = "inngest" as const;
export const INNGEST_VARIANT = "baseline" as const;
export const INNGEST_EVENT_NAME = "agentlab/run.requested";
export const INNGEST_CANCEL_EVENT_NAME = "agentlab/run.cancelled";
export const INNGEST_FUNCTION_ID = "agentlab-baseline";
export const INNGEST_SDK_VERSION = "4.20.0";
export const INNGEST_DEV_SERVER_VERSION = "1.44.0";
export const INNGEST_DEFAULT_SERVICE_URL = "http://127.0.0.1:9091";
export const INNGEST_DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:8288";
export const INNGEST_DEFAULT_SERVICE_PORT = 9091;
export const INNGEST_DEFAULT_DATA_DIRECTORY = join(
  process.cwd().endsWith("/server") ? join(process.cwd(), "..") : process.cwd(),
  "server/src/platforms/inngest/.local",
);
export const INNGEST_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const INNGEST_DEFAULT_FUNCTION_RETRIES = 2;
export const INNGEST_DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
export const INNGEST_DEFAULT_FUNCTION_TIMEOUT_MS = 5 * 60 * 1_000;

export interface InngestConfig {
  readonly serviceUrl: string;
  readonly servicePort: number;
  readonly devServerUrl: string;
  readonly dataDirectory: string;
  readonly requestTimeoutMs: number;
  readonly functionTimeoutMs: number;
  readonly functionRetries: number;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
}

export class InvalidInngestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInngestConfigError";
  }
}

export function loadInngestConfig(environment: NodeJS.ProcessEnv = process.env): InngestConfig {
  const config: InngestConfig = {
    serviceUrl: parseUrl(environment.AGENTLAB_INNGEST_SERVICE_URL, INNGEST_DEFAULT_SERVICE_URL, "AGENTLAB_INNGEST_SERVICE_URL"),
    servicePort: parseInteger(environment.AGENTLAB_INNGEST_SERVICE_PORT, INNGEST_DEFAULT_SERVICE_PORT, "AGENTLAB_INNGEST_SERVICE_PORT", 1, 65_535),
    devServerUrl: parseUrl(environment.AGENTLAB_INNGEST_DEV_SERVER_URL, INNGEST_DEFAULT_DEV_SERVER_URL, "AGENTLAB_INNGEST_DEV_SERVER_URL"),
    dataDirectory: environment.AGENTLAB_INNGEST_DATA_DIR?.trim() || INNGEST_DEFAULT_DATA_DIRECTORY,
    requestTimeoutMs: parseInteger(
      environment.AGENTLAB_INNGEST_REQUEST_TIMEOUT_MS,
      INNGEST_DEFAULT_REQUEST_TIMEOUT_MS,
      "AGENTLAB_INNGEST_REQUEST_TIMEOUT_MS",
      1,
      120_000,
    ),
    functionTimeoutMs: parseInteger(
      environment.AGENTLAB_INNGEST_FUNCTION_TIMEOUT_MS,
      INNGEST_DEFAULT_FUNCTION_TIMEOUT_MS,
      "AGENTLAB_INNGEST_FUNCTION_TIMEOUT_MS",
      1_000,
      24 * 60 * 60 * 1_000,
    ),
    functionRetries: parseInteger(
      environment.AGENTLAB_INNGEST_FUNCTION_RETRIES,
      INNGEST_DEFAULT_FUNCTION_RETRIES,
      "AGENTLAB_INNGEST_FUNCTION_RETRIES",
      0,
      20,
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      "https://openrouter.ai/api/v1",
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
  };

  return Object.freeze(config);
}

export function safeManifestConfiguration(config: InngestConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    serviceUrl: config.serviceUrl,
    devServerUrl: config.devServerUrl,
    functionId: INNGEST_FUNCTION_ID,
    eventName: INNGEST_EVENT_NAME,
    cancelEventName: INNGEST_CANCEL_EVENT_NAME,
    sdkVersion: INNGEST_SDK_VERSION,
    devServerVersion: INNGEST_DEV_SERVER_VERSION,
    eventIdempotencyRetentionMs: INNGEST_EVENT_RETENTION_MS,
    functionRetries: config.functionRetries,
    functionTimeoutMs: config.functionTimeoutMs,
    modelProvider: "fake-by-default",
  });
}

function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidInngestConfigError(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}

function parseInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) throw new InvalidInngestConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidInngestConfigError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
