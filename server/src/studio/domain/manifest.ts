import { createHash, randomUUID } from "node:crypto";

import type {
  StudioComparisonManifest,
  StudioComparisonRequest,
  StudioEnvironmentProfile,
  StudioExperimentDefinition,
  StudioScenarioCase,
  StudioStrategyVariant,
  StudioSystemDefinition,
} from "./types.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEED = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class InvalidStudioRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStudioRequestError";
  }
}

export function buildStudioManifest(
  request: StudioComparisonRequest,
  definitions: {
    readonly system: StudioSystemDefinition;
    readonly environment: StudioEnvironmentProfile;
    readonly experiment: StudioExperimentDefinition;
    readonly scenario: StudioScenarioCase;
  },
  options: { readonly comparisonId?: string; readonly now?: string } = {},
): Readonly<StudioComparisonManifest> {
  validateStudioComparisonRequest(request);
  const idempotencyKeyHash = sha256(request.idempotencyKey);
  const manifest: StudioComparisonManifest = {
    schemaVersion: 1,
    comparisonId: options.comparisonId ?? `studio-${randomUUID()}`,
    createdAt: options.now ?? new Date().toISOString(),
    seed: request.seed,
    idempotencyKeyHash,
    system: definitions.system,
    environment: definitions.environment,
    experiment: definitions.experiment,
    fixedEnvelope: {
      scenarioId: definitions.scenario.id,
      scenarioVersion: definitions.scenario.version,
      modelProvider: definitions.environment.model.provider,
      model: definitions.environment.model.model,
      contextWindowTokens: definitions.environment.contextWindowTokens,
      reservedOutputTokens: definitions.environment.reservedOutputTokens,
      safetyMarginTokens: definitions.environment.safetyMarginTokens,
    },
  };

  return deepFreeze(manifest);
}

export function validateStudioComparisonRequest(request: StudioComparisonRequest): void {
  assertIdentifier(request.system.id, "system.id");
  assertVersion(request.system.version, "system.version");
  assertIdentifier(request.environment.id, "environment.id");
  assertVersion(request.environment.version, "environment.version");
  assertIdentifier(request.experiment.id, "experiment.id");
  assertVersion(request.experiment.version, "experiment.version");
  assertIdentifier(request.experiment.scenario.id, "experiment.scenario.id");
  assertVersion(request.experiment.scenario.version, "experiment.scenario.version");

  if (request.experiment.subject.component !== "context-management") {
    throw new InvalidStudioRequestError("Only context-management is available in the first Studio slice.");
  }

  const strategies = request.experiment.subject.strategies;
  if (!Array.isArray(strategies) || strategies.length < 2 || strategies.length > 3) {
    throw new InvalidStudioRequestError("A Studio comparison must contain between 2 and 3 strategies.");
  }
  const strategyIds = new Set<string>();
  for (const strategy of strategies) {
    assertIdentifier(strategy.id, "strategy.id");
    assertVersion(strategy.version, "strategy.version");
    if (strategyIds.has(strategy.id)) {
      throw new InvalidStudioRequestError(`Strategy is repeated: ${strategy.id}.`);
    }
    strategyIds.add(strategy.id);
    if (!isStringRecord(strategy.parameters)) {
      throw new InvalidStudioRequestError(`Strategy parameters must be string values: ${strategy.id}.`);
    }
  }

  if (typeof request.seed !== "string" || !SEED.test(request.seed)) {
    throw new InvalidStudioRequestError("seed must use letters, numbers, dots, colons, underscores, or hyphens.");
  }
  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.trim().length < 1 || request.idempotencyKey.length > 200) {
    throw new InvalidStudioRequestError("idempotencyKey must contain between 1 and 200 characters.");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Produces a key-order-independent representation for fingerprints. Request
 * idempotency must not depend on how a client orders JSON object properties.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new InvalidStudioRequestError(`${name} must use lowercase letters, numbers, and hyphens.`);
  }
}

function assertVersion(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !VERSION.test(value)) {
    throw new InvalidStudioRequestError(`${name} must use letters, numbers, dots, underscores, or hyphens.`);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string" && entry.length <= 200);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value as Readonly<T>;
}
