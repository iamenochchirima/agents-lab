import type { CapabilityDescriptor } from "@agent-harness-lab/agent-protocol";

export type SafetyDecisionKind = "allow" | "deny" | "approval-required";

export interface SafetyConfig {
  /** Fallback for known checkpoints without an allow rule; this implementation requires deny. */
  readonly defaultDecision: SafetyDecisionKind;
  readonly maxCheckpointBytes: number;
  /** Exact pure tool capabilities and operations that this implementation may permit. */
  readonly allowedToolCapabilities: readonly CapabilityDescriptor[];
  /** Exact non-pure capability descriptors for environment operations such as computer actions. */
  readonly allowedEnvironmentCapabilities: readonly CapabilityDescriptor[];
  /** Exact output action kinds a host sink may receive after Safety approval. */
  readonly allowedOutputActionKinds: readonly string[];
  /** Exact Memory observation kinds this policy permits the kernel to persist. */
  readonly allowedMemoryWriteKinds: readonly string[];
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = Object.freeze({
  defaultDecision: "deny",
  maxCheckpointBytes: 32_768,
  allowedToolCapabilities: Object.freeze([]),
  allowedEnvironmentCapabilities: Object.freeze([]),
  allowedOutputActionKinds: Object.freeze([]),
  allowedMemoryWriteKinds: Object.freeze([]),
});

export class SafetyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyConfigError";
  }
}

/** Parses fail-closed behavior, checkpoint limits, and exact side-effect grants. */
export function parseSafetyConfig(input: unknown = {}): SafetyConfig {
  if (!isRecord(input)) throw new SafetyConfigError("Safety config must be an object.");
  rejectUnknownKeys(input, ["defaultDecision", "maxCheckpointBytes", "allowedToolCapabilities", "allowedEnvironmentCapabilities", "allowedOutputActionKinds", "allowedMemoryWriteKinds"]);
  const defaultDecision = input.defaultDecision === undefined ? DEFAULT_SAFETY_CONFIG.defaultDecision : input.defaultDecision;
  if (defaultDecision !== "allow" && defaultDecision !== "deny" && defaultDecision !== "approval-required") {
    throw new SafetyConfigError('defaultDecision must be "allow", "deny", or "approval-required".');
  }
  const maxCheckpointBytes = input.maxCheckpointBytes === undefined ? DEFAULT_SAFETY_CONFIG.maxCheckpointBytes : input.maxCheckpointBytes;
  if (!Number.isInteger(maxCheckpointBytes) || (maxCheckpointBytes as number) < 1 || (maxCheckpointBytes as number) > 1_048_576) {
    throw new SafetyConfigError("maxCheckpointBytes must be an integer from 1 through 1048576.");
  }
  const rawToolCapabilities = input.allowedToolCapabilities === undefined ? DEFAULT_SAFETY_CONFIG.allowedToolCapabilities : input.allowedToolCapabilities;
  if (!Array.isArray(rawToolCapabilities) || rawToolCapabilities.length > 32) {
    throw new SafetyConfigError("allowedToolCapabilities must be an array with at most 32 entries.");
  }
  const allowedToolCapabilities = rawToolCapabilities.map((value, index) => parseAllowedCapability(value, index, "pure"));
  if (new Set(allowedToolCapabilities.map((capability) => capability.id)).size !== allowedToolCapabilities.length) {
    throw new SafetyConfigError("allowedToolCapabilities must not repeat a capability ID.");
  }
  const rawEnvironmentCapabilities = input.allowedEnvironmentCapabilities === undefined
    ? DEFAULT_SAFETY_CONFIG.allowedEnvironmentCapabilities
    : input.allowedEnvironmentCapabilities;
  if (!Array.isArray(rawEnvironmentCapabilities) || rawEnvironmentCapabilities.length > 32) {
    throw new SafetyConfigError("allowedEnvironmentCapabilities must be an array with at most 32 entries.");
  }
  const allowedEnvironmentCapabilities = rawEnvironmentCapabilities.map((value, index) => parseAllowedCapability(value, index, "non-pure"));
  if (new Set(allowedEnvironmentCapabilities.map((capability) => capability.id)).size !== allowedEnvironmentCapabilities.length) {
    throw new SafetyConfigError("allowedEnvironmentCapabilities must not repeat a capability ID.");
  }
  if (allowedEnvironmentCapabilities.some((capability) => allowedToolCapabilities.some((tool) => tool.id === capability.id))) {
    throw new SafetyConfigError("Tool and environment capabilities must use distinct IDs.");
  }
  const rawOutputKinds = input.allowedOutputActionKinds === undefined ? DEFAULT_SAFETY_CONFIG.allowedOutputActionKinds : input.allowedOutputActionKinds;
  if (!Array.isArray(rawOutputKinds) || rawOutputKinds.length > 32) {
    throw new SafetyConfigError("allowedOutputActionKinds must be an array with at most 32 entries.");
  }
  const allowedOutputActionKinds = rawOutputKinds.map((kind, index) => configIdentifier(kind, `allowedOutputActionKinds[${index}]`, /^[a-z][a-z0-9-]*$/));
  if (new Set(allowedOutputActionKinds).size !== allowedOutputActionKinds.length) {
    throw new SafetyConfigError("allowedOutputActionKinds must not contain duplicates.");
  }
  const rawMemoryWriteKinds = input.allowedMemoryWriteKinds === undefined ? DEFAULT_SAFETY_CONFIG.allowedMemoryWriteKinds : input.allowedMemoryWriteKinds;
  if (!Array.isArray(rawMemoryWriteKinds) || rawMemoryWriteKinds.length > 32) {
    throw new SafetyConfigError("allowedMemoryWriteKinds must be an array with at most 32 entries.");
  }
  const allowedMemoryWriteKinds = rawMemoryWriteKinds.map((kind, index) => configIdentifier(kind, `allowedMemoryWriteKinds[${index}]`, /^[a-z][a-z0-9-]*$/));
  if (new Set(allowedMemoryWriteKinds).size !== allowedMemoryWriteKinds.length) {
    throw new SafetyConfigError("allowedMemoryWriteKinds must not contain duplicates.");
  }
  return Object.freeze({
    defaultDecision,
    maxCheckpointBytes: maxCheckpointBytes as number,
    allowedToolCapabilities: Object.freeze(allowedToolCapabilities),
    allowedEnvironmentCapabilities: Object.freeze(allowedEnvironmentCapabilities),
    allowedOutputActionKinds: Object.freeze(allowedOutputActionKinds),
    allowedMemoryWriteKinds: Object.freeze(allowedMemoryWriteKinds),
  });
}

function parseAllowedCapability(value: unknown, index: number, expectedKind: "pure" | "non-pure"): CapabilityDescriptor {
  const field = expectedKind === "pure" ? "allowedToolCapabilities" : "allowedEnvironmentCapabilities";
  if (!isRecord(value)) throw new SafetyConfigError(`${field}[${index}] must be an object.`);
  rejectUnknownKeys(value, ["id", "version", "kind", "operations"]);
  const id = configIdentifier(value.id, `${field}[${index}].id`, /^[a-z][a-z0-9-]*$/);
  const version = configIdentifier(value.version, `${field}[${index}].version`, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
  if (typeof value.kind !== "string" || value.kind.trim().length === 0) {
    throw new SafetyConfigError(`${field}[${index}].kind must be non-empty text.`);
  }
  if (expectedKind === "pure" ? value.kind !== "pure" : value.kind === "pure") {
    throw new SafetyConfigError(`${field}[${index}].kind must be ${expectedKind === "pure" ? '"pure"' : "non-pure"}.`);
  }
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 32) {
    throw new SafetyConfigError(`${field}[${index}].operations must contain 1 through 32 entries.`);
  }
  const operations = value.operations.map((operation, operationIndex) => configIdentifier(
    operation,
    `${field}[${index}].operations[${operationIndex}]`,
    /^[a-z][a-z0-9-]*$/,
  ));
  if (new Set(operations).size !== operations.length) {
    throw new SafetyConfigError(`allowedToolCapabilities[${index}].operations must not contain duplicates.`);
  }
  return Object.freeze({ id, version, kind: value.kind as string, operations: Object.freeze(operations) });
}

function configIdentifier(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || value.length > 128 || !pattern.test(value)) {
    throw new SafetyConfigError(`${field} must be a valid identifier of at most 128 characters.`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new SafetyConfigError(`Unknown safety config field: ${unknown}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
