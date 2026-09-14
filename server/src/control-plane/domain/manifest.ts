import { randomUUID } from "node:crypto";

import type { ModelProvider, RunManifest, RunRequest } from "./types.js";

const MAX_PROMPT_LENGTH = 20_000;
const DEFAULT_TEMPORAL_ENDPOINT = "localhost:7233";
const DEFAULT_TEMPORAL_NAMESPACE = "default";
const DEFAULT_TEMPORAL_TASK_QUEUE = "agentlab-temporal-baseline";
const DEFAULT_ACTIVITY_TIMEOUT_MS = 30_000;
const DEFAULT_PRE_DISPATCH_RETRY_LIMIT = 2;

export class InvalidRunRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRunRequestError";
  }
}

export interface ManifestOptions {
  readonly now?: string;
  readonly runId?: string;
  readonly serverVersion?: string;
  readonly temporalEndpoint?: string;
  readonly temporalNamespace?: string;
  readonly temporalTaskQueue?: string;
  readonly activityTimeoutMs?: number;
  readonly preDispatchRetryLimit?: number;
}

export function buildRunManifest(request: RunRequest, options: ManifestOptions = {}): Readonly<RunManifest> {
  validateRequest(request);

  const manifest: RunManifest = {
    schemaVersion: 1,
    runId: options.runId ?? randomUUID(),
    createdAt: options.now ?? new Date().toISOString(),
    serverVersion: options.serverVersion ?? "0.0.0-dev",
    platform: "temporal",
    variant: "baseline",
    task: { kind: "prompt", prompt: request.task.prompt.trim() },
    model: {
      provider: request.model.provider as ModelProvider,
      model: request.model.model.trim(),
    },
    temporal: {
      namespace: options.temporalNamespace ?? DEFAULT_TEMPORAL_NAMESPACE,
      taskQueue: options.temporalTaskQueue ?? DEFAULT_TEMPORAL_TASK_QUEUE,
      endpoint: options.temporalEndpoint ?? DEFAULT_TEMPORAL_ENDPOINT,
      activityTimeoutMs: options.activityTimeoutMs ?? DEFAULT_ACTIVITY_TIMEOUT_MS,
      preDispatchRetryLimit: options.preDispatchRetryLimit ?? DEFAULT_PRE_DISPATCH_RETRY_LIMIT,
    },
  };

  return deepFreeze(manifest);
}

/**
 * A manifest is the run's audit boundary: once dispatch starts, every effective
 * setting must remain the setting that was approved for that run. Freezing only
 * the outer object would leave nested task/model/Temporal settings mutable.
 */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
  }

  return value as Readonly<T>;
}

function validateRequest(request: RunRequest): void {
  if (request.platform !== "temporal" || request.variant !== "baseline") {
    throw new InvalidRunRequestError("Only the temporal/baseline runner is available.");
  }

  if (request.task?.kind !== "prompt") {
    throw new InvalidRunRequestError("Only prompt tasks are supported.");
  }

  const prompt = request.task.prompt.trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    throw new InvalidRunRequestError(`Prompt must contain between 1 and ${MAX_PROMPT_LENGTH} characters.`);
  }

  if (request.model.provider !== "fake" && request.model.provider !== "openrouter") {
    throw new InvalidRunRequestError("Model provider must be fake or openrouter.");
  }

  if (request.model.model.trim().length === 0 || request.model.model.trim().length > 200) {
    throw new InvalidRunRequestError("Model name must contain between 1 and 200 characters.");
  }
}
