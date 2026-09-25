import type { CapabilityDescriptor } from "@agent-harness-lab/agent-protocol";

export interface ExecutionEnvironmentConfig {
  readonly operationTimeoutMs: number;
  readonly allowedCapabilities: readonly CapabilityDescriptor[];
}

export const DEFAULT_EXECUTION_ENVIRONMENT_CONFIG: ExecutionEnvironmentConfig = Object.freeze({
  operationTimeoutMs: 30_000,
  allowedCapabilities: Object.freeze([]),
});

export class ExecutionEnvironmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionEnvironmentConfigError";
  }
}

/** Parses the environment's declared capability allowlist and operation timeout. */
export function parseExecutionEnvironmentConfig(input: unknown = {}): ExecutionEnvironmentConfig {
  if (!isRecord(input)) throw new ExecutionEnvironmentConfigError("Execution environment config must be an object.");
  rejectUnknownKeys(input, ["operationTimeoutMs", "allowedCapabilities"]);

  const timeout = input.operationTimeoutMs === undefined ? DEFAULT_EXECUTION_ENVIRONMENT_CONFIG.operationTimeoutMs : input.operationTimeoutMs;
  if (!isIntegerInRange(timeout, 1, 300_000)) {
    throw new ExecutionEnvironmentConfigError("operationTimeoutMs must be an integer from 1 through 300000.");
  }

  const rawCapabilities = input.allowedCapabilities === undefined ? DEFAULT_EXECUTION_ENVIRONMENT_CONFIG.allowedCapabilities : input.allowedCapabilities;
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length > 32) {
    throw new ExecutionEnvironmentConfigError("allowedCapabilities must be an array with at most 32 entries.");
  }
  const allowedCapabilities = rawCapabilities.map(parseCapability);
  const ids = new Set<string>();
  for (const capability of allowedCapabilities) {
    if (ids.has(capability.id)) throw new ExecutionEnvironmentConfigError(`Capability id is duplicated: ${capability.id}.`);
    ids.add(capability.id);
  }
  return Object.freeze({ operationTimeoutMs: timeout, allowedCapabilities: Object.freeze(allowedCapabilities) });
}

function parseCapability(value: unknown, index: number): CapabilityDescriptor {
  if (!isRecord(value)) throw new ExecutionEnvironmentConfigError(`allowedCapabilities[${index}] must be an object.`);
  rejectUnknownCapabilityKeys(value, index);
  const id = nonEmptyString(value.id, `allowedCapabilities[${index}].id`);
  const version = nonEmptyString(value.version, `allowedCapabilities[${index}].version`);
  const kind = nonEmptyString(value.kind, `allowedCapabilities[${index}].kind`);
  if (!Array.isArray(value.operations) || value.operations.length > 32) {
    throw new ExecutionEnvironmentConfigError(`allowedCapabilities[${index}].operations must be an array with at most 32 entries.`);
  }
  const operations = value.operations.map((item, operationIndex) => nonEmptyString(item, `allowedCapabilities[${index}].operations[${operationIndex}]`));
  if (new Set(operations).size !== operations.length) {
    throw new ExecutionEnvironmentConfigError(`allowedCapabilities[${index}].operations must not contain duplicates.`);
  }
  return Object.freeze({ id, version, kind, operations: Object.freeze(operations) });
}

function rejectUnknownCapabilityKeys(value: Record<string, unknown>, index: number): void {
  const unknown = Object.keys(value).find((key) => !["id", "version", "kind", "operations"].includes(key));
  if (unknown) throw new ExecutionEnvironmentConfigError(`Unknown allowedCapabilities[${index}] field: ${unknown}.`);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ExecutionEnvironmentConfigError(`Unknown execution environment config field: ${unknown}.`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new ExecutionEnvironmentConfigError(`${field} must be a non-empty string of at most 128 characters.`);
  }
  return value;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
