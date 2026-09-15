import { randomUUID } from "node:crypto";

import type { ModelProvider, RunManifest, RunRequest } from "./types.js";

const MAX_PROMPT_LENGTH = 20_000;
const DEFAULT_SYSTEM_INSTRUCTION =
  "You are the Agent Harness Lab baseline agent. Answer the user's prompt directly and concisely.";

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
  readonly platformConfig?: Readonly<Record<string, unknown>>;
}

export function buildRunManifest(request: RunRequest, options: ManifestOptions = {}): Readonly<RunManifest> {
  validateRunRequest(request);

  const manifest: RunManifest = {
    schemaVersion: 1,
    runId: options.runId ?? randomUUID(),
    createdAt: options.now ?? new Date().toISOString(),
    serverVersion: options.serverVersion ?? "0.0.0-dev",
    platform: request.platform.trim(),
    variant: request.variant.trim(),
    task: { kind: "prompt", prompt: request.task.prompt.trim() },
    context: { systemInstruction: DEFAULT_SYSTEM_INSTRUCTION },
    platformConfig: options.platformConfig ?? {},
    model: {
      provider: request.model.provider as ModelProvider,
      model: request.model.model.trim(),
    },
  };

  return deepFreeze(manifest);
}

/**
 * A manifest is the run's audit boundary: once dispatch starts, every effective
 * setting must remain the setting that was approved for that run. Freezing only
 * the outer object would leave nested task/model/platform settings mutable.
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

export function validateRunRequest(request: RunRequest): void {
  if (!isIdentifier(request.platform, "platform") || !isIdentifier(request.variant, "variant")) {
    throw new InvalidRunRequestError("platform and variant must use lowercase letters, numbers, and hyphens.");
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

function isIdentifier(value: string, name: string): boolean {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new InvalidRunRequestError(`${name} must use lowercase letters, numbers, and hyphens.`);
  }
  return true;
}
