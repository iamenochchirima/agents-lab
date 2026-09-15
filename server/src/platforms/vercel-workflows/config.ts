import { URL } from "node:url";

export const VERCEL_WORKFLOWS_PLATFORM = "vercel-workflows" as const;
export const VERCEL_WORKFLOWS_VARIANT = "baseline" as const;
export const VERCEL_WORKFLOW_SDK_VERSION = "5.0.0-beta.52" as const;
export const VERCEL_WORKFLOW_LOCAL_WORLD_VERSION = "5.0.0-beta.45" as const;
export const VERCEL_WORKFLOW_NAME = "agentLabPrompt" as const;
export const VERCEL_WORKFLOW_DEFAULT_HOST = "127.0.0.1" as const;
// Keep the local Vercel service separate from the AWS Step Functions service,
// which uses 9093 in the shared development setup.
export const VERCEL_WORKFLOW_DEFAULT_PORT = 9094;
export const VERCEL_WORKFLOW_DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
export const VERCEL_WORKFLOW_DEFAULT_MODEL_TIMEOUT_MS = 30_000;
export const VERCEL_WORKFLOW_DEFAULT_DATA_DIR = ".local/workflow-data";
export const VERCEL_WORKFLOW_DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface VercelWorkflowsConfig {
  readonly host: string;
  readonly port: number;
  readonly serviceUrl: string;
  readonly dataDir: string;
  readonly requestTimeoutMs: number;
  readonly modelTimeoutMs: number;
  readonly workflowName: string;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
}

export class InvalidVercelWorkflowsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVercelWorkflowsConfigError";
  }
}

export function loadVercelWorkflowsConfig(environment: NodeJS.ProcessEnv = process.env): VercelWorkflowsConfig {
  const host = parseHost(environment.AGENTLAB_VERCEL_WORKFLOWS_HOST, VERCEL_WORKFLOW_DEFAULT_HOST);
  const port = parseInteger(environment.AGENTLAB_VERCEL_WORKFLOWS_PORT, VERCEL_WORKFLOW_DEFAULT_PORT, "AGENTLAB_VERCEL_WORKFLOWS_PORT", 1, 65_535);
  const serviceUrl = parseUrl(
    environment.AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL,
    `http://${host}:${port}`,
    "AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL",
  );

  return Object.freeze({
    host,
    port,
    serviceUrl,
    dataDir: (environment.AGENTLAB_VERCEL_WORKFLOWS_DATA_DIR ?? VERCEL_WORKFLOW_DEFAULT_DATA_DIR).trim(),
    requestTimeoutMs: parseInteger(
      environment.AGENTLAB_VERCEL_WORKFLOWS_REQUEST_TIMEOUT_MS,
      VERCEL_WORKFLOW_DEFAULT_REQUEST_TIMEOUT_MS,
      "AGENTLAB_VERCEL_WORKFLOWS_REQUEST_TIMEOUT_MS",
      1,
      300_000,
    ),
    modelTimeoutMs: parseInteger(
      environment.AGENTLAB_VERCEL_WORKFLOWS_MODEL_TIMEOUT_MS,
      VERCEL_WORKFLOW_DEFAULT_MODEL_TIMEOUT_MS,
      "AGENTLAB_VERCEL_WORKFLOWS_MODEL_TIMEOUT_MS",
      1,
      600_000,
    ),
    workflowName: parseIdentifier(
      environment.AGENTLAB_VERCEL_WORKFLOWS_NAME,
      VERCEL_WORKFLOW_NAME,
      "AGENTLAB_VERCEL_WORKFLOWS_NAME",
    ),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      VERCEL_WORKFLOW_DEFAULT_OPENROUTER_BASE_URL,
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
  });
}

export function safeManifestConfiguration(config: VercelWorkflowsConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    serviceUrl: config.serviceUrl,
    dataDir: config.dataDir,
    requestTimeoutMs: config.requestTimeoutMs,
    modelTimeoutMs: config.modelTimeoutMs,
    workflowName: config.workflowName,
    sdk: "workflow",
    sdkVersion: VERCEL_WORKFLOW_SDK_VERSION,
    localWorldPackage: "@workflow/world-local",
    localWorldVersion: VERCEL_WORKFLOW_LOCAL_WORLD_VERSION,
    world: "local",
    modelProvider: "fake-by-default",
  });
}

function parseHost(value: string | undefined, fallback: string): string {
  const resolved = (value ?? fallback).trim();
  if (!resolved || /[^a-zA-Z0-9.:[\]-]/.test(resolved)) {
    throw new InvalidVercelWorkflowsConfigError("AGENTLAB_VERCEL_WORKFLOWS_HOST must be a host name or IP address.");
  }
  return resolved;
}

function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidVercelWorkflowsConfigError(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}

function parseInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) throw new InvalidVercelWorkflowsConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidVercelWorkflowsConfigError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseIdentifier(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(resolved)) {
    throw new InvalidVercelWorkflowsConfigError(`${name} must be a valid workflow name.`);
  }
  return resolved;
}
