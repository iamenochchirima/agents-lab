import { URL } from "node:url";

export const AWS_STEP_FUNCTIONS_PLATFORM = "aws-step-functions" as const;
export const AWS_STEP_FUNCTIONS_VARIANT = "baseline" as const;
export const AWS_STEP_FUNCTIONS_SDK_VERSION = "3.1132.0";
export const AWS_STEP_FUNCTIONS_SMITHY_HANDLER_VERSION = "4.12.1";
export const AWS_STEP_FUNCTIONS_DEFAULT_SERVICE_URL = "http://127.0.0.1:9093";
export const AWS_STEP_FUNCTIONS_DEFAULT_SERVICE_PORT = 9093;
export const AWS_STEP_FUNCTIONS_DEFAULT_ENDPOINT_URL = "http://127.0.0.1:8083";
export const AWS_STEP_FUNCTIONS_DEFAULT_REGION = "us-east-1";
export const AWS_STEP_FUNCTIONS_DEFAULT_ACCOUNT_ID = "012345678901";
export const AWS_STEP_FUNCTIONS_DEFAULT_STATE_MACHINE_NAME = "AgentLabAwsStepFunctionsBaseline";
export const AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_NAME = "AgentLabAwsStepFunctionsModel";
export const AWS_STEP_FUNCTIONS_DEFAULT_ROLE_ARN =
  `arn:aws:iam::${AWS_STEP_FUNCTIONS_DEFAULT_ACCOUNT_ID}:role/AgentLabStepFunctionsLocalRole`;
export const AWS_STEP_FUNCTIONS_DEFAULT_EXECUTION_TIMEOUT_SECONDS = 300;
export const AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_TIMEOUT_SECONDS = 30;
export const AWS_STEP_FUNCTIONS_DEFAULT_RETRY_INTERVAL_SECONDS = 1;
export const AWS_STEP_FUNCTIONS_DEFAULT_RETRY_MAX_ATTEMPTS = 2;
export const AWS_STEP_FUNCTIONS_DEFAULT_RETRY_BACKOFF_RATE = 2;
export const AWS_STEP_FUNCTIONS_DEFAULT_MODEL_TIMEOUT_MS = 25_000;
export const AWS_STEP_FUNCTIONS_DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
export const AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_POLL_SOCKET_TIMEOUT_MS = 65_000;
export const AWS_STEP_FUNCTIONS_DEFAULT_WORKER_POLL_DELAY_MS = 100;

export type AwsStepFunctionsProfile = "local" | "aws";

export interface AwsStepFunctionsConfig {
  readonly profile: AwsStepFunctionsProfile;
  readonly endpointUrl: string | null;
  readonly serviceUrl: string;
  readonly servicePort: number;
  readonly region: string;
  readonly accountId: string;
  readonly stateMachineName: string;
  readonly stateMachineArn: string | null;
  readonly activityName: string;
  readonly activityArn: string | null;
  readonly roleArn: string;
  readonly executionTimeoutSeconds: number;
  readonly activityTimeoutSeconds: number;
  readonly retryIntervalSeconds: number;
  readonly retryMaxAttempts: number;
  readonly retryBackoffRate: number;
  readonly modelTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly activityPollSocketTimeoutMs: number;
  readonly workerPollDelayMs: number;
  readonly workerName: string;
  readonly workerEnabled: boolean;
  readonly openRouterApiKey: string | null;
  readonly openRouterBaseUrl: string;
}

export class InvalidAwsStepFunctionsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAwsStepFunctionsConfigError";
  }
}

export function loadAwsStepFunctionsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AwsStepFunctionsConfig {
  const profile = parseProfile(environment.AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE);
  const endpointUrl = profile === "local"
    ? parseUrl(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL,
      AWS_STEP_FUNCTIONS_DEFAULT_ENDPOINT_URL,
      "AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL",
    )
    : nullableUrl(environment.AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL, "AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL");

  const config: AwsStepFunctionsConfig = {
    profile,
    endpointUrl,
    serviceUrl: parseUrl(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_URL,
      AWS_STEP_FUNCTIONS_DEFAULT_SERVICE_URL,
      "AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_URL",
    ),
    servicePort: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_PORT,
      AWS_STEP_FUNCTIONS_DEFAULT_SERVICE_PORT,
      "AGENTLAB_AWS_STEP_FUNCTIONS_SERVICE_PORT",
      1,
      65_535,
    ),
    region: parseIdentifier(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_REGION,
      AWS_STEP_FUNCTIONS_DEFAULT_REGION,
      "AGENTLAB_AWS_STEP_FUNCTIONS_REGION",
    ),
    accountId: parseAccountId(environment.AGENTLAB_AWS_STEP_FUNCTIONS_ACCOUNT_ID),
    stateMachineName: parseResourceName(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_STATE_MACHINE_NAME,
      AWS_STEP_FUNCTIONS_DEFAULT_STATE_MACHINE_NAME,
      "AGENTLAB_AWS_STEP_FUNCTIONS_STATE_MACHINE_NAME",
    ),
    stateMachineArn: nullableString(environment.AGENTLAB_AWS_STEP_FUNCTIONS_STATE_MACHINE_ARN),
    activityName: parseResourceName(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_NAME,
      AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_NAME,
      "AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_NAME",
    ),
    activityArn: nullableString(environment.AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_ARN),
    roleArn: parseArn(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_ROLE_ARN,
      AWS_STEP_FUNCTIONS_DEFAULT_ROLE_ARN,
      "AGENTLAB_AWS_STEP_FUNCTIONS_ROLE_ARN",
    ),
    executionTimeoutSeconds: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_EXECUTION_TIMEOUT_SECONDS,
      AWS_STEP_FUNCTIONS_DEFAULT_EXECUTION_TIMEOUT_SECONDS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_EXECUTION_TIMEOUT_SECONDS",
      1,
      31_536_000,
    ),
    activityTimeoutSeconds: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS,
      AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_TIMEOUT_SECONDS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS",
      1,
      31_536_000,
    ),
    retryIntervalSeconds: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_INTERVAL_SECONDS,
      AWS_STEP_FUNCTIONS_DEFAULT_RETRY_INTERVAL_SECONDS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_INTERVAL_SECONDS",
      1,
      99_999_999,
    ),
    retryMaxAttempts: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_MAX_ATTEMPTS,
      AWS_STEP_FUNCTIONS_DEFAULT_RETRY_MAX_ATTEMPTS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_MAX_ATTEMPTS",
      0,
      99_999_999,
    ),
    retryBackoffRate: parseNumber(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_BACKOFF_RATE,
      AWS_STEP_FUNCTIONS_DEFAULT_RETRY_BACKOFF_RATE,
      "AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_BACKOFF_RATE",
      0,
      99_999_999,
    ),
    modelTimeoutMs: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS,
      AWS_STEP_FUNCTIONS_DEFAULT_MODEL_TIMEOUT_MS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS",
      1,
      86_400_000,
    ),
    requestTimeoutMs: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_REQUEST_TIMEOUT_MS,
      AWS_STEP_FUNCTIONS_DEFAULT_REQUEST_TIMEOUT_MS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_REQUEST_TIMEOUT_MS",
      1,
      120_000,
    ),
    activityPollSocketTimeoutMs: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_POLL_SOCKET_TIMEOUT_MS,
      AWS_STEP_FUNCTIONS_DEFAULT_ACTIVITY_POLL_SOCKET_TIMEOUT_MS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_POLL_SOCKET_TIMEOUT_MS",
      65_000,
      120_000,
    ),
    workerPollDelayMs: parseInteger(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_POLL_DELAY_MS,
      AWS_STEP_FUNCTIONS_DEFAULT_WORKER_POLL_DELAY_MS,
      "AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_POLL_DELAY_MS",
      1,
      60_000,
    ),
    workerName: parseResourceName(
      environment.AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_NAME,
      "agentlab-baseline-worker",
      "AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_NAME",
    ),
    workerEnabled: parseBoolean(environment.AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED, true),
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: parseUrl(
      environment.AGENTLAB_OPENROUTER_BASE_URL,
      "https://openrouter.ai/api/v1",
      "AGENTLAB_OPENROUTER_BASE_URL",
    ),
  };

  if (config.profile === "aws" && (!config.stateMachineArn || !config.activityArn)) {
    throw new InvalidAwsStepFunctionsConfigError(
      "The aws profile requires AGENTLAB_AWS_STEP_FUNCTIONS_STATE_MACHINE_ARN and AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_ARN.",
    );
  }
  if (config.activityTimeoutSeconds > config.executionTimeoutSeconds) {
    throw new InvalidAwsStepFunctionsConfigError(
      "AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS must not exceed the execution timeout.",
    );
  }
  if (config.modelTimeoutMs > config.activityTimeoutSeconds * 1_000) {
    throw new InvalidAwsStepFunctionsConfigError(
      "AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS must not exceed the Activity timeout.",
    );
  }

  return Object.freeze(config);
}

export function safeManifestConfiguration(
  config: AwsStepFunctionsConfig,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    profile: config.profile,
    endpointUrl: config.endpointUrl,
    serviceUrl: config.serviceUrl,
    region: config.region,
    accountId: config.accountId,
    stateMachineName: config.stateMachineName,
    stateMachineArn: config.stateMachineArn,
    activityName: config.activityName,
    activityArn: config.activityArn,
    roleArn: config.roleArn,
    sdk: "@aws-sdk/client-sfn",
    sdkVersion: AWS_STEP_FUNCTIONS_SDK_VERSION,
    smithyHandlerVersion: AWS_STEP_FUNCTIONS_SMITHY_HANDLER_VERSION,
    executionType: "STANDARD",
    executionTimeoutSeconds: config.executionTimeoutSeconds,
    activityTimeoutSeconds: config.activityTimeoutSeconds,
    retryIntervalSeconds: config.retryIntervalSeconds,
    retryMaxAttempts: config.retryMaxAttempts,
    retryBackoffRate: config.retryBackoffRate,
    modelTimeoutMs: config.modelTimeoutMs,
    workerName: config.workerName,
    workerEnabled: config.workerEnabled,
    modelProvider: "fake-by-default",
  });
}

function parseProfile(value: string | undefined): AwsStepFunctionsProfile {
  const profile = value?.trim() || "local";
  if (profile !== "local" && profile !== "aws") {
    throw new InvalidAwsStepFunctionsConfigError(
      "AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE must be local or aws.",
    );
  }
  return profile;
}

function parseAccountId(value: string | undefined): string {
  const accountId = value?.trim() || AWS_STEP_FUNCTIONS_DEFAULT_ACCOUNT_ID;
  if (!/^\d{12}$/.test(accountId)) {
    throw new InvalidAwsStepFunctionsConfigError(
      "AGENTLAB_AWS_STEP_FUNCTIONS_ACCOUNT_ID must contain exactly 12 digits.",
    );
  }
  return accountId;
}

function parseResourceName(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(resolved)) {
    throw new InvalidAwsStepFunctionsConfigError(
      `${name} must contain only letters, numbers, hyphens, and underscores and be at most 80 characters.`,
    );
  }
  return resolved;
}

function parseIdentifier(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(resolved)) {
    throw new InvalidAwsStepFunctionsConfigError(`${name} is not a valid identifier.`);
  }
  return resolved;
}

function parseArn(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  if (!/^arn:[A-Za-z0-9-]+:[^\s]+$/.test(resolved)) {
    throw new InvalidAwsStepFunctionsConfigError(`${name} must be an ARN.`);
  }
  return resolved;
}

function nullableString(value: string | undefined): string | null {
  const resolved = value?.trim();
  return resolved ? resolved : null;
}

function nullableUrl(value: string | undefined, name: string): string | null {
  const resolved = nullableString(value);
  return resolved === null ? null : parseUrl(resolved, resolved, name);
}

function parseUrl(value: string | undefined, fallback: string, name: string): string {
  const resolved = (value ?? fallback).trim();
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new InvalidAwsStepFunctionsConfigError(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) throw new InvalidAwsStepFunctionsConfigError(`${name} must be an integer.`);
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidAwsStepFunctionsConfigError(`${name} must be between ${minimum} and ${maximum}.`);
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
  const parsed = Number(resolved);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidAwsStepFunctionsConfigError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidAwsStepFunctionsConfigError("AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED must be true or false.");
}
