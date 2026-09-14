import { isAbsolute, resolve } from "node:path";

export const DEFAULTS = {
  apiHost: "127.0.0.1",
  apiPort: 4318,
  apiOrigin: "http://127.0.0.1:5173",
  temporalEndpoint: "localhost:7233",
  temporalNamespace: "default",
  temporalTaskQueue: "agentlab-temporal-baseline",
  activityTimeoutMs: 30_000,
  queryTimeoutMs: 1_000,
  preDispatchRetryLimit: 2,
  preDispatchRetryBackoffMs: 100,
  allowedModelProviders: ["fake"] as const,
} as const;

export interface ServerConfig {
  readonly serverVersion: string;
  readonly api: {
    readonly host: string;
    readonly port: number;
    readonly origin: string;
  };
  readonly runsRoot: string;
  readonly temporal: {
    readonly endpoint: string;
    readonly namespace: string;
    readonly taskQueue: string;
    readonly activityTimeoutMs: number;
    readonly queryTimeoutMs: number;
    readonly preDispatchRetryLimit: number;
    readonly preDispatchRetryBackoffMs: number;
  };
  readonly allowedModelProviders: readonly ("fake" | "openrouter")[];
}

export class InvalidServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidServerConfigError";
  }
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): ServerConfig {
  const apiHost = requiredString(environment.AGENTLAB_API_HOST, DEFAULTS.apiHost, "AGENTLAB_API_HOST");
  const apiOrigin = requiredString(environment.AGENTLAB_API_ORIGIN, DEFAULTS.apiOrigin, "AGENTLAB_API_ORIGIN");
  const temporalEndpoint = requiredString(
    environment.AGENTLAB_TEMPORAL_ENDPOINT,
    DEFAULTS.temporalEndpoint,
    "AGENTLAB_TEMPORAL_ENDPOINT",
  );
  const temporalNamespace = requiredString(
    environment.AGENTLAB_TEMPORAL_NAMESPACE,
    DEFAULTS.temporalNamespace,
    "AGENTLAB_TEMPORAL_NAMESPACE",
  );
  const temporalTaskQueue = requiredString(
    environment.AGENTLAB_TEMPORAL_TASK_QUEUE,
    DEFAULTS.temporalTaskQueue,
    "AGENTLAB_TEMPORAL_TASK_QUEUE",
  );
  const runRoot = requiredString(
    environment.AGENTLAB_RUN_ROOT,
    resolve(workingDirectory, "lab/runs"),
    "AGENTLAB_RUN_ROOT",
  );

  const config: ServerConfig = {
    serverVersion: requiredString(environment.AGENTLAB_SERVER_VERSION, "0.0.0-dev", "AGENTLAB_SERVER_VERSION"),
    api: {
      host: apiHost,
      port: parsePort(environment.AGENTLAB_API_PORT, DEFAULTS.apiPort),
      origin: apiOrigin,
    },
    runsRoot: isAbsolute(runRoot) ? runRoot : resolve(workingDirectory, runRoot),
    temporal: {
      endpoint: temporalEndpoint,
      namespace: temporalNamespace,
      taskQueue: temporalTaskQueue,
      activityTimeoutMs: parsePositiveInteger(
        "AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS",
        environment.AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS,
        DEFAULTS.activityTimeoutMs,
      ),
      queryTimeoutMs: parsePositiveInteger(
        "AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS",
        environment.AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS,
        DEFAULTS.queryTimeoutMs,
      ),
      preDispatchRetryLimit: parseNonNegativeInteger(
        "AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_LIMIT",
        environment.AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_LIMIT,
        DEFAULTS.preDispatchRetryLimit,
      ),
      preDispatchRetryBackoffMs: parsePositiveInteger(
        "AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_BACKOFF_MS",
        environment.AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_BACKOFF_MS,
        DEFAULTS.preDispatchRetryBackoffMs,
      ),
    },
    allowedModelProviders: parseModelProviders(environment.AGENTLAB_ALLOWED_MODEL_PROVIDERS),
  };

  return Object.freeze(config);
}

function requiredString(value: string | undefined, fallback: string, name: string): string {
  const resolved = value === undefined ? fallback : value.trim();
  if (resolved.length === 0) {
    throw new InvalidServerConfigError(`${name} must not be empty.`);
  }
  return resolved;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = parseInteger("AGENTLAB_API_PORT", value, fallback);
  if (port < 1 || port > 65_535) {
    throw new InvalidServerConfigError("AGENTLAB_API_PORT must be between 1 and 65535.");
  }
  return port;
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = parseInteger(name, value, fallback);
  if (parsed < 1) {
    throw new InvalidServerConfigError(`${name} must be greater than zero.`);
  }
  return parsed;
}

function parseNonNegativeInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = parseInteger(name, value, fallback);
  if (parsed < 0) {
    throw new InvalidServerConfigError(`${name} must not be negative.`);
  }
  return parsed;
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  const resolved = value === undefined ? String(fallback) : value.trim();
  if (!/^\d+$/.test(resolved)) {
    throw new InvalidServerConfigError(`${name} must be an integer.`);
  }
  return Number(resolved);
}

function parseModelProviders(value: string | undefined): readonly ("fake" | "openrouter")[] {
  const resolved = (value ?? DEFAULTS.allowedModelProviders.join(","))
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);

  if (resolved.length === 0 || resolved.some((provider) => provider !== "fake" && provider !== "openrouter")) {
    throw new InvalidServerConfigError("AGENTLAB_ALLOWED_MODEL_PROVIDERS must contain only fake and openrouter.");
  }

  return [...new Set(resolved)] as ("fake" | "openrouter")[];
}
