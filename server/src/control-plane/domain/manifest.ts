import { randomUUID } from "node:crypto";

import type { ModelProvider, RunManifest, RunRequest } from "./types.js";

const MAX_PROMPT_LENGTH = 20_000;
export const DEFAULT_SYSTEM_INSTRUCTION =
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
  readonly context?: {
    readonly sessionId?: string;
    readonly turnId?: string;
    readonly clientTurnId?: string;
    readonly snapshotId?: string;
  };
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
    context: {
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
      ...options.context,
    },
    platformConfig: options.platformConfig ?? {},
    ...(request.capabilities === undefined ? {} : { capabilities: request.capabilities }),
    selection: request.selection ?? {},
    model: {
      provider: request.model.provider as ModelProvider,
      model: request.model.model.trim(),
      ...(request.model.contextWindowTokens === undefined ? {} : { contextWindowTokens: request.model.contextWindowTokens }),
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

  if (request.sessionId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(request.sessionId)) {
    throw new InvalidRunRequestError("sessionId must use letters, numbers, hyphens, or underscores.");
  }

  if (request.clientTurnId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.clientTurnId)) {
    throw new InvalidRunRequestError("clientTurnId must use letters, numbers, dots, colons, hyphens, or underscores.");
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
  if (request.model.contextWindowTokens !== undefined && (!Number.isInteger(request.model.contextWindowTokens) || request.model.contextWindowTokens <= 0)) {
    throw new InvalidRunRequestError("Model context window must be a positive integer when provided.");
  }

  validateCapabilities(request.capabilities);

  if (request.selection !== undefined) {
    for (const [name, value] of Object.entries(request.selection)) {
      if (!/^(scenarioId|environmentId|backendProfileId|infrastructureId|experimentId)$/.test(name)) {
        throw new InvalidRunRequestError(`Unknown run selection field: ${name}.`);
      }
      if (value !== undefined && (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || value === "none" && name !== "experimentId")) {
        throw new InvalidRunRequestError(`${name} must use a valid catalog identifier.`);
      }
    }
  }
}

function validateCapabilities(capabilities: RunRequest["capabilities"]): void {
  if (capabilities === undefined) return;
  const tools = capabilities.tools;
  if (!tools || !Array.isArray(tools.enabledNames) || tools.enabledNames.length > 32) {
    throw new InvalidRunRequestError("capabilities.tools.enabledNames must contain at most 32 tool names.");
  }
  const names = new Set<string>();
  for (const name of tools.enabledNames) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new InvalidRunRequestError("Tool names must use lowercase letters, numbers, and hyphens.");
    }
    if (names.has(name)) throw new InvalidRunRequestError(`Duplicate enabled tool: ${name}.`);
    names.add(name);
  }
  if (!Number.isInteger(tools.maxRounds) || tools.maxRounds < 1 || tools.maxRounds > 32) {
    throw new InvalidRunRequestError("capabilities.tools.maxRounds must be an integer between 1 and 32.");
  }
  if (!Number.isInteger(tools.maxCalls) || tools.maxCalls < 1 || tools.maxCalls > 64) {
    throw new InvalidRunRequestError("capabilities.tools.maxCalls must be an integer between 1 and 64.");
  }
}

function isIdentifier(value: string, name: string): boolean {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new InvalidRunRequestError(`${name} must use lowercase letters, numbers, and hyphens.`);
  }
  return true;
}
