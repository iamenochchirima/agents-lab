import { URL } from "node:url";

export const DBOS_SDK_VERSION = "4.27.6";
export const DBOS_PLATFORM = "dbos" as const;
export const DBOS_VARIANT = "baseline" as const;
export const DBOS_WORKFLOW_NAME = "AgentLabDbosBaseline";
export const DBOS_DEFAULT_SYSTEM_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/agentlab_dbos";
export const DBOS_DEFAULT_SCHEMA = "dbos";
export const DBOS_DEFAULT_APPLICATION_NAME = "agentlab-dbos-baseline";
export const DBOS_DEFAULT_APPLICATION_VERSION = "0.0.0-dev";
export const DBOS_DEFAULT_HOST = "127.0.0.1";
export const DBOS_DEFAULT_PORT = 9091;
export const DBOS_DEFAULT_WORKFLOW_TIMEOUT_MS = 60_000;
export const DBOS_DEFAULT_MODEL_STEP_TIMEOUT_MS = 30_000;
export const DBOS_DEFAULT_MODEL_STEP_MAX_ATTEMPTS = 2;

export interface DbosConfig {
  readonly systemDatabaseUrl: string;
  readonly systemDatabaseSchema: string;
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly host: string;
  readonly port: number;
  readonly workflowName: string;
  readonly workflowTimeoutMs: number;
  readonly modelStepTimeoutMs: number;
  readonly modelStepMaxAttempts: number;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
}

export class InvalidDbosConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDbosConfigError";
  }
}

export function loadDbosConfig(environment: NodeJS.ProcessEnv = process.env): DbosConfig {
  const systemDatabaseUrl = requiredDatabaseUrl(
    environment.AGENTLAB_DBOS_SYSTEM_DATABASE_URL ?? environment.DBOS_SYSTEM_DATABASE_URL ?? DBOS_DEFAULT_SYSTEM_DATABASE_URL,
  );
  const config: DbosConfig = {
    systemDatabaseUrl,
    systemDatabaseSchema: identifier(environment.AGENTLAB_DBOS_SYSTEM_DATABASE_SCHEMA, DBOS_DEFAULT_SCHEMA, "AGENTLAB_DBOS_SYSTEM_DATABASE_SCHEMA"),
    applicationName: identifier(environment.AGENTLAB_DBOS_APPLICATION_NAME, DBOS_DEFAULT_APPLICATION_NAME, "AGENTLAB_DBOS_APPLICATION_NAME"),
    applicationVersion: requiredString(
      environment.AGENTLAB_DBOS_APPLICATION_VERSION,
      DBOS_DEFAULT_APPLICATION_VERSION,
      "AGENTLAB_DBOS_APPLICATION_VERSION",
    ),
    host: requiredString(environment.AGENTLAB_DBOS_HOST, DBOS_DEFAULT_HOST, "AGENTLAB_DBOS_HOST"),
    port: parsePort(environment.AGENTLAB_DBOS_PORT, DBOS_DEFAULT_PORT),
    workflowName: identifier(environment.AGENTLAB_DBOS_WORKFLOW_NAME, DBOS_WORKFLOW_NAME, "AGENTLAB_DBOS_WORKFLOW_NAME"),
    workflowTimeoutMs: parsePositiveInteger(
      environment.AGENTLAB_DBOS_WORKFLOW_TIMEOUT_MS,
      DBOS_DEFAULT_WORKFLOW_TIMEOUT_MS,
      "AGENTLAB_DBOS_WORKFLOW_TIMEOUT_MS",
    ),
    modelStepTimeoutMs: parsePositiveInteger(
      environment.AGENTLAB_DBOS_MODEL_STEP_TIMEOUT_MS,
      DBOS_DEFAULT_MODEL_STEP_TIMEOUT_MS,
      "AGENTLAB_DBOS_MODEL_STEP_TIMEOUT_MS",
    ),
    modelStepMaxAttempts: parsePositiveInteger(
      environment.AGENTLAB_DBOS_MODEL_STEP_MAX_ATTEMPTS,
      DBOS_DEFAULT_MODEL_STEP_MAX_ATTEMPTS,
      "AGENTLAB_DBOS_MODEL_STEP_MAX_ATTEMPTS",
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: requiredUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      "https://openrouter.ai/api/v1",
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
  };

  return Object.freeze(config);
}

export function safeDatabaseProfile(config: Pick<DbosConfig, "systemDatabaseUrl" | "systemDatabaseSchema">): Readonly<Record<string, unknown>> {
  const url = new URL(config.systemDatabaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.slice(1)),
    schema: config.systemDatabaseSchema,
  };
}

export function safeManifestConfiguration(config: DbosConfig): Readonly<Record<string, unknown>> {
  return {
    sdk: "@dbos-inc/dbos-sdk",
    sdkVersion: DBOS_SDK_VERSION,
    workflowName: config.workflowName,
    applicationName: config.applicationName,
    applicationVersion: config.applicationVersion,
    systemDatabase: safeDatabaseProfile(config),
    workflowTimeoutMs: config.workflowTimeoutMs,
    modelStepTimeoutMs: config.modelStepTimeoutMs,
    modelStepMaxAttempts: config.modelStepMaxAttempts,
    serviceHost: config.host,
    servicePort: config.port,
  };
}

function requiredDatabaseUrl(value: string): string {
  const resolved = value.trim();
  if (resolved.length === 0) throw new InvalidDbosConfigError("AGENTLAB_DBOS_SYSTEM_DATABASE_URL must not be empty.");
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    throw new InvalidDbosConfigError("AGENTLAB_DBOS_SYSTEM_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new InvalidDbosConfigError("AGENTLAB_DBOS_SYSTEM_DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (!url.hostname || !url.pathname.slice(1)) {
    throw new InvalidDbosConfigError("AGENTLAB_DBOS_SYSTEM_DATABASE_URL must include a host and database name.");
  }
  return resolved;
}

function requiredUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = value === undefined ? fallback : value.trim();
  try {
    const url = new URL(resolved);
    if (!url.hostname || (url.protocol !== "http:" && url.protocol !== "https:")) throw new Error();
  } catch {
    throw new InvalidDbosConfigError(`${name} must be an HTTP(S) URL.`);
  }
  return resolved.replace(/\/$/, "");
}

function requiredString(value: string | undefined, fallback: string, name: string): string {
  const resolved = value === undefined ? fallback : value.trim();
  if (resolved.length === 0) throw new InvalidDbosConfigError(`${name} must not be empty.`);
  return resolved;
}

function identifier(value: string | undefined, fallback: string, name: string): string {
  const resolved = requiredString(value, fallback, name);
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(resolved)) {
    throw new InvalidDbosConfigError(`${name} must be a safe identifier.`);
  }
  return resolved;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = parsePositiveInteger(value, fallback, "AGENTLAB_DBOS_PORT");
  if (port > 65_535) throw new InvalidDbosConfigError("AGENTLAB_DBOS_PORT must be between 1 and 65535.");
  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved) || Number(resolved) < 1) {
    throw new InvalidDbosConfigError(`${name} must be a positive integer.`);
  }
  return Number(resolved);
}
