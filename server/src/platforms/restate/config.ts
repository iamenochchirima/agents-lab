import { URL } from "node:url";
import { resolve } from "node:path";

import { calculatorTool } from "../../capabilities/tools/calculator.js";
import { TOOL_SCHEMA_VERSION } from "../../capabilities/tools/contracts.js";

export const RESTATE_SERVICE_NAME = "AgentLabRestateBaseline";
export const RESTATE_WORKFLOW_HANDLER = "run";
export const RESTATE_PLATFORM = "restate" as const;
export const RESTATE_VARIANT = "baseline" as const;
export const RESTATE_DEFAULT_INGRESS_URL = "http://127.0.0.1:8080";
export const RESTATE_DEFAULT_ADMIN_URL = "http://127.0.0.1:9070";
export const RESTATE_DEFAULT_SERVICE_URL = "http://127.0.0.1:9080";
export const RESTATE_DEFAULT_SERVICE_PORT = 9080;
export const RESTATE_DEFAULT_WORKFLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const RESTATE_DEFAULT_MAX_ATTEMPTS = 3;
export const RESTATE_DEFAULT_RUN_MAX_RETRY_ATTEMPTS = 3;
export const RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS = 250;
export const RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS = 3_000;
export const RESTATE_DEFAULT_INGRESS_RETRY_ATTEMPTS = 3;
export const RESTATE_DEFAULT_TOOL_ROUNDS = 6;
export const RESTATE_DEFAULT_TOOL_CALLS = 8;

export interface RestateConfig {
  readonly contextRoot: string;
  readonly ingressUrl: string;
  readonly adminUrl: string;
  readonly serviceUrl: string;
  readonly servicePort: number;
  readonly serviceName: string;
  readonly workflowRetentionMs: number;
  readonly maxAttempts: number;
  readonly runMaxRetryAttempts: number;
  readonly runRetryIntervalMs: number;
  readonly runMaxRetryIntervalMs: number;
  readonly ingressRetryAttempts: number;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
}

export class InvalidRestateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRestateConfigError";
  }
}

export function loadRestateConfig(environment: NodeJS.ProcessEnv = process.env): RestateConfig {
  const config: RestateConfig = {
    contextRoot: resolve(process.cwd(), environment.AGENTLAB_CONTEXT_ROOT?.trim() || "lab/sessions"),
    ingressUrl: parseUrl(environment.AGENTLAB_RESTATE_INGRESS_URL, RESTATE_DEFAULT_INGRESS_URL, "AGENTLAB_RESTATE_INGRESS_URL"),
    adminUrl: parseUrl(environment.AGENTLAB_RESTATE_ADMIN_URL, RESTATE_DEFAULT_ADMIN_URL, "AGENTLAB_RESTATE_ADMIN_URL"),
    serviceUrl: parseUrl(environment.AGENTLAB_RESTATE_SERVICE_URL, RESTATE_DEFAULT_SERVICE_URL, "AGENTLAB_RESTATE_SERVICE_URL"),
    servicePort: parsePort(environment.AGENTLAB_RESTATE_SERVICE_PORT, RESTATE_DEFAULT_SERVICE_PORT),
    serviceName: parseIdentifier(environment.AGENTLAB_RESTATE_SERVICE_NAME, RESTATE_SERVICE_NAME, "AGENTLAB_RESTATE_SERVICE_NAME"),
    workflowRetentionMs: parsePositiveInteger(
      environment.AGENTLAB_RESTATE_WORKFLOW_RETENTION_MS,
      RESTATE_DEFAULT_WORKFLOW_RETENTION_MS,
      "AGENTLAB_RESTATE_WORKFLOW_RETENTION_MS",
    ),
    maxAttempts: parsePositiveInteger(environment.AGENTLAB_RESTATE_MAX_ATTEMPTS, RESTATE_DEFAULT_MAX_ATTEMPTS, "AGENTLAB_RESTATE_MAX_ATTEMPTS"),
    runMaxRetryAttempts: parsePositiveInteger(
      environment.AGENTLAB_RESTATE_RUN_MAX_RETRY_ATTEMPTS,
      RESTATE_DEFAULT_RUN_MAX_RETRY_ATTEMPTS,
      "AGENTLAB_RESTATE_RUN_MAX_RETRY_ATTEMPTS",
    ),
    runRetryIntervalMs: parsePositiveInteger(
      environment.AGENTLAB_RESTATE_RUN_RETRY_INTERVAL_MS,
      RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS,
      "AGENTLAB_RESTATE_RUN_RETRY_INTERVAL_MS",
    ),
    runMaxRetryIntervalMs: parsePositiveInteger(
      environment.AGENTLAB_RESTATE_RUN_MAX_RETRY_INTERVAL_MS,
      RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS,
      "AGENTLAB_RESTATE_RUN_MAX_RETRY_INTERVAL_MS",
    ),
    ingressRetryAttempts: parsePositiveInteger(
      environment.AGENTLAB_RESTATE_INGRESS_RETRY_ATTEMPTS,
      RESTATE_DEFAULT_INGRESS_RETRY_ATTEMPTS,
      "AGENTLAB_RESTATE_INGRESS_RETRY_ATTEMPTS",
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      "https://openrouter.ai/api/v1",
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
  };

  if (config.runMaxRetryIntervalMs < config.runRetryIntervalMs) {
    throw new InvalidRestateConfigError("AGENTLAB_RESTATE_RUN_MAX_RETRY_INTERVAL_MS must be at least the initial retry interval.");
  }

  return Object.freeze(config);
}

export function safeManifestConfiguration(config: RestateConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contextRoot: config.contextRoot,
    ingressUrl: config.ingressUrl,
    adminUrl: config.adminUrl,
    serviceUrl: config.serviceUrl,
    servicePort: config.servicePort,
    serviceName: config.serviceName,
    workflowHandler: RESTATE_WORKFLOW_HANDLER,
    workflowRetentionMs: config.workflowRetentionMs,
    maxAttempts: config.maxAttempts,
    runMaxRetryAttempts: config.runMaxRetryAttempts,
    runRetryIntervalMs: config.runRetryIntervalMs,
    runMaxRetryIntervalMs: config.runMaxRetryIntervalMs,
    ingressRetryAttempts: config.ingressRetryAttempts,
    modelProvider: "selected-run-provider",
    tools: {
      schemaVersion: TOOL_SCHEMA_VERSION,
      enabledNames: ["calculator"],
      maxRounds: RESTATE_DEFAULT_TOOL_ROUNDS,
      maxCalls: RESTATE_DEFAULT_TOOL_CALLS,
      limits: { calculator: calculatorTool.definition.limits },
      redactionPolicyVersion: "tool-redaction-v1",
    },
  });
}

function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidRestateConfigError(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  return parseInteger(value, fallback, "AGENTLAB_RESTATE_SERVICE_PORT", 1, 65_535);
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  return parseInteger(value, fallback, name, 1, Number.MAX_SAFE_INTEGER);
}

function parseInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) throw new InvalidRestateConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidRestateConfigError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseIdentifier(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(resolved)) {
    throw new InvalidRestateConfigError(`${name} must be a valid service identifier.`);
  }
  return resolved;
}
