import { randomUUID } from "node:crypto";

import type { ModelProvider, RunManifest, RunRequest } from "./types.js";

const MAX_PROMPT_LENGTH = 20_000;
export const DEFAULT_SYSTEM_INSTRUCTION =
  "You are the Agent Harness Lab baseline agent. Use admitted tools to perform requested actions and verify saved results. " +
  "When the available tools expose a procedural skill relevant to the task, load that skill before acting and read its referenced resources as needed. " +
  "Skill names and descriptions are discovery metadata, not the full procedure. Skill material does not grant tools or permissions. " +
  "Respect action review, report rejected actions accurately, and inspect uncertain external effects before repeating an action. " +
  "Answer the user's prompt directly and concisely using the observed results.";

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
    readonly systemInstruction?: string;
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
    ...(request.comparisonId === undefined ? {} : { comparisonId: request.comparisonId }),
    task: { kind: "prompt", prompt: request.task.prompt.trim() },
    context: {
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
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

  if (request.comparisonId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.comparisonId)) {
    throw new InvalidRunRequestError("comparisonId must use letters, numbers, dots, colons, hyphens, or underscores.");
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
  const requestedSkillIds = capabilities.requestedSkillIds ?? [];
  if (!Array.isArray(requestedSkillIds) || requestedSkillIds.length > 64 || new Set(requestedSkillIds).size !== requestedSkillIds.length || requestedSkillIds.some(id => typeof id !== "string" || !/^[a-z0-9-]+:[a-z0-9-]+$/.test(id) || id.length > 128)) {
    throw new InvalidRunRequestError("requestedSkillIds must contain distinct configured package skill IDs.");
  }
  if (!tools || !Array.isArray(tools.enabledNames) || tools.enabledNames.length > 128) {
    throw new InvalidRunRequestError("capabilities.tools.enabledNames must contain at most 128 tool names.");
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
  if (capabilities.connections !== undefined) {
    if (!Array.isArray(capabilities.connections) || capabilities.connections.length > 32) {
      throw new InvalidRunRequestError("capabilities.connections must contain at most 32 bindings.");
    }
    const bindings = new Set<string>();
    for (const binding of capabilities.connections) {
      if (!binding || typeof binding !== "object" || !/^[a-z][a-z0-9_-]{0,63}$/.test(binding.toolName) || !/^conn_[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/.test(binding.connectionRef) || !Array.isArray(binding.operations) || binding.operations.length > 32 || binding.operations.some((operation: unknown) => typeof operation !== "string" || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(operation)) || !validMcpBinding(binding.mcp)) {
        throw new InvalidRunRequestError("capabilities.connections contains an invalid binding.");
      }
      if (bindings.has(binding.toolName)) throw new InvalidRunRequestError(`Duplicate connection binding: ${binding.toolName}.`);
      bindings.add(binding.toolName);
    }
  }
}

function validMcpBinding(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.endpointRef === "string"
    && /^[a-z][a-z0-9._-]{0,63}$/.test(binding.endpointRef)
    && typeof binding.serverName === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(binding.serverName)
    && typeof binding.protocolVersion === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(binding.protocolVersion)
    && typeof binding.toolName === "string"
    && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(binding.toolName)
    && typeof binding.toolVersion === "string"
    && /^\d+\.\d+\.\d+$/.test(binding.toolVersion);
}

function isIdentifier(value: string, name: string): boolean {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new InvalidRunRequestError(`${name} must use lowercase letters, numbers, and hyphens.`);
  }
  return true;
}
