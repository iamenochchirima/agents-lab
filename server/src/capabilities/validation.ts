import type {
  CapabilityApproval,
  CapabilityGrant,
  CapabilityManifest,
  CapabilityPolicy,
  CapabilityRisk,
  CapabilitySource,
  JsonObject,
  JsonValue,
} from "./contracts.js";
import { CAPABILITY_SCHEMA_VERSION } from "./contracts.js";

export const CAPABILITY_LIMITS = Object.freeze({
  maxRecordBytes: 64 * 1024,
  maxIdBytes: 128,
  maxVersionBytes: 64,
  maxDisplayNameBytes: 256,
  maxDescriptionBytes: 4 * 1024,
  maxSourceRefBytes: 256,
  maxDigestBytes: 128,
  maxOperationBytes: 128,
  maxOperations: 64,
  maxScopes: 64,
  maxScopeBytes: 256,
  maxSchemaBytes: 16 * 1024,
  maxSchemaDepth: 8,
  maxSchemaNodes: 256,
  maxAllowedCapabilities: 256,
  maxAllowedConnections: 256,
  maxApprovalBytes: 16 * 1024,
  maxTimeoutMs: 5 * 60 * 1000,
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
} as const);

const ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONNECTION_REF_PATTERN = /^conn_[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECISION_ID_PATTERN = /^approval_[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/;
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export class CapabilityValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "CapabilityValidationError";
    this.path = path;
  }
}

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  const input = validateRecord(value, "manifest", CAPABILITY_LIMITS.maxRecordBytes);
  assertKeys(input, [
    "schemaVersion",
    "id",
    "version",
    "kind",
    "displayName",
    "description",
    "risk",
    "operations",
    "inputSchema",
    "requiredScopes",
    "source",
    "mcp",
  ], "manifest");

  assertSchemaVersion(input.schemaVersion, "manifest.schemaVersion");
  const id = validateIdentifier(input.id, "manifest.id");
  const version = validateVersion(input.version, "manifest.version");
  const kind = validateEnum(input.kind, ["tool", "connection", "plugin"] as const, "manifest.kind");
  const displayName = validateText(input.displayName, "manifest.displayName", CAPABILITY_LIMITS.maxDisplayNameBytes);
  const description = validateText(input.description, "manifest.description", CAPABILITY_LIMITS.maxDescriptionBytes);
  const risk = validateEnum(input.risk, ["pure", "read", "write", "external"] as const, "manifest.risk");
  const operations = validateStringList(input.operations, "manifest.operations", CAPABILITY_LIMITS.maxOperations, CAPABILITY_LIMITS.maxOperationBytes, OPERATION_PATTERN, true);
  const inputSchema = input.inputSchema === undefined
    ? undefined
    : validateJsonObject(input.inputSchema, "manifest.inputSchema", CAPABILITY_LIMITS.maxSchemaBytes, CAPABILITY_LIMITS.maxSchemaDepth, CAPABILITY_LIMITS.maxSchemaNodes);
  const requiredScopes = validateStringList(input.requiredScopes, "manifest.requiredScopes", CAPABILITY_LIMITS.maxScopes, CAPABILITY_LIMITS.maxScopeBytes, SCOPE_PATTERN, false);
  const source = validateSource(input.source, "manifest.source");
  const mcp = input.mcp === undefined ? undefined : validateMcpBinding(input.mcp, "manifest.mcp");

  return freeze({
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    id,
    version,
    kind,
    displayName,
    description,
    risk,
    operations,
    ...(inputSchema === undefined ? {} : { inputSchema }),
    requiredScopes,
    source,
    ...(mcp === undefined ? {} : { mcp }),
  });
}

export function validateCapabilityGrant(value: unknown): CapabilityGrant {
  const input = validateRecord(value, "grant", CAPABILITY_LIMITS.maxRecordBytes);
  assertKeys(input, [
    "schemaVersion",
    "capabilityId",
    "version",
    "enabled",
    "connectionRef",
    "allowedOperations",
    "approvalMode",
    "timeoutMs",
    "maxInputBytes",
    "maxOutputBytes",
  ], "grant");

  assertSchemaVersion(input.schemaVersion, "grant.schemaVersion");
  const capabilityId = validateIdentifier(input.capabilityId, "grant.capabilityId");
  const version = validateVersion(input.version, "grant.version");
  const enabled = validateBoolean(input.enabled, "grant.enabled");
  const connectionRef = input.connectionRef === undefined
    ? undefined
    : validateConnectionRef(input.connectionRef, "grant.connectionRef");
  const allowedOperations = validateStringList(input.allowedOperations, "grant.allowedOperations", CAPABILITY_LIMITS.maxOperations, CAPABILITY_LIMITS.maxOperationBytes, OPERATION_PATTERN, true);
  const approvalMode = validateEnum(input.approvalMode, ["none", "required"] as const, "grant.approvalMode");
  const timeoutMs = validateBoundedInteger(input.timeoutMs, "grant.timeoutMs", 1, CAPABILITY_LIMITS.maxTimeoutMs);
  const maxInputBytes = validateBoundedInteger(input.maxInputBytes, "grant.maxInputBytes", 1, CAPABILITY_LIMITS.maxInputBytes);
  const maxOutputBytes = validateBoundedInteger(input.maxOutputBytes, "grant.maxOutputBytes", 1, CAPABILITY_LIMITS.maxOutputBytes);

  return freeze({
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    version,
    enabled,
    ...(connectionRef === undefined ? {} : { connectionRef }),
    allowedOperations,
    approvalMode,
    timeoutMs,
    maxInputBytes,
    maxOutputBytes,
  });
}

export function validateCapabilityPolicy(value: unknown): CapabilityPolicy {
  const input = validateRecord(value, "policy", CAPABILITY_LIMITS.maxRecordBytes);
  assertKeys(input, [
    "schemaVersion",
    "policyId",
    "version",
    "allowedCapabilityIds",
    "allowedRiskClasses",
    "requiredApprovalRiskClasses",
    "allowedConnectionRefs",
    "maxTimeoutMs",
    "maxInputBytes",
    "maxOutputBytes",
  ], "policy");

  assertSchemaVersion(input.schemaVersion, "policy.schemaVersion");
  const policyId = validateIdentifier(input.policyId, "policy.policyId");
  const version = validateVersion(input.version, "policy.version");
  const allowedCapabilityIds = validateStringList(input.allowedCapabilityIds, "policy.allowedCapabilityIds", CAPABILITY_LIMITS.maxAllowedCapabilities, CAPABILITY_LIMITS.maxIdBytes, ID_PATTERN, false);
  const allowedRiskClasses = validateEnumList(input.allowedRiskClasses, "policy.allowedRiskClasses", ["pure", "read", "write", "external"] as const);
  const requiredApprovalRiskClasses = validateEnumList(input.requiredApprovalRiskClasses, "policy.requiredApprovalRiskClasses", ["pure", "read", "write", "external"] as const);
  const allowedConnectionRefs = validateStringList(input.allowedConnectionRefs, "policy.allowedConnectionRefs", CAPABILITY_LIMITS.maxAllowedConnections, CAPABILITY_LIMITS.maxIdBytes, CONNECTION_REF_PATTERN, false);
  const maxTimeoutMs = validateBoundedInteger(input.maxTimeoutMs, "policy.maxTimeoutMs", 1, CAPABILITY_LIMITS.maxTimeoutMs);
  const maxInputBytes = validateBoundedInteger(input.maxInputBytes, "policy.maxInputBytes", 1, CAPABILITY_LIMITS.maxInputBytes);
  const maxOutputBytes = validateBoundedInteger(input.maxOutputBytes, "policy.maxOutputBytes", 1, CAPABILITY_LIMITS.maxOutputBytes);

  return freeze({
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    policyId,
    version,
    allowedCapabilityIds,
    allowedRiskClasses,
    requiredApprovalRiskClasses,
    allowedConnectionRefs,
    maxTimeoutMs,
    maxInputBytes,
    maxOutputBytes,
  });
}

export function validateCapabilityApproval(value: unknown): CapabilityApproval {
  const input = validateRecord(value, "approval", CAPABILITY_LIMITS.maxApprovalBytes);
  assertKeys(input, [
    "schemaVersion",
    "decisionId",
    "capabilityId",
    "version",
    "allowedOperations",
    "connectionRef",
    "decision",
    "decidedAt",
    "expiresAt",
  ], "approval");

  assertSchemaVersion(input.schemaVersion, "approval.schemaVersion");
  const decisionId = validateIdentifierWithPattern(input.decisionId, "approval.decisionId", DECISION_ID_PATTERN, CAPABILITY_LIMITS.maxIdBytes);
  const capabilityId = validateIdentifier(input.capabilityId, "approval.capabilityId");
  const version = validateVersion(input.version, "approval.version");
  const allowedOperations = validateStringList(input.allowedOperations, "approval.allowedOperations", CAPABILITY_LIMITS.maxOperations, CAPABILITY_LIMITS.maxOperationBytes, OPERATION_PATTERN, true);
  const connectionRef = input.connectionRef === undefined
    ? undefined
    : validateConnectionRef(input.connectionRef, "approval.connectionRef");
  const decision = validateEnum(input.decision, ["approved", "denied"] as const, "approval.decision");
  const decidedAt = validateTimestamp(input.decidedAt, "approval.decidedAt");
  const expiresAt = validateTimestamp(input.expiresAt, "approval.expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(decidedAt)) {
    throw new CapabilityValidationError("approval.expiresAt", "must be after decidedAt.");
  }

  return freeze({
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    decisionId,
    capabilityId,
    version,
    allowedOperations,
    ...(connectionRef === undefined ? {} : { connectionRef }),
    decision,
    decidedAt,
    expiresAt,
  });
}

export function validateJsonObject(
  value: unknown,
  path: string,
  maxBytes: number,
  maxDepth: number,
  maxNodes: number,
): JsonObject {
  assertJsonSafe(value, path, maxDepth, maxNodes);
  if (!isRecord(value)) throw new CapabilityValidationError(path, "must be a JSON object.");
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > maxBytes) {
    throw new CapabilityValidationError(path, `must be at most ${maxBytes} UTF-8 bytes.`);
  }
  return freeze(cloneJson(value as JsonObject) as JsonObject);
}

function validateSource(value: unknown, path: string): CapabilitySource {
  const input = validateRecord(value, path, CAPABILITY_LIMITS.maxRecordBytes);
  assertKeys(input, ["kind", "ref", "digest"], path);
  const kind = validateEnum(input.kind, ["builtin", "local", "plugin", "connection"] as const, `${path}.kind`);
  const ref = validateIdentifierWithPattern(input.ref, `${path}.ref`, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/, CAPABILITY_LIMITS.maxSourceRefBytes);
  const digest = input.digest === undefined ? undefined : validateIdentifierWithPattern(input.digest, `${path}.digest`, DIGEST_PATTERN, CAPABILITY_LIMITS.maxDigestBytes);
  return freeze({ kind, ref, ...(digest === undefined ? {} : { digest }) });
}

function validateMcpBinding(value: unknown, path: string): CapabilityManifest["mcp"] {
  const input = validateRecord(value, path, 4_096);
  assertKeys(input, ["endpointRef", "serverName", "protocolVersion", "toolName", "toolVersion"], path);
  const endpointRef = validateIdentifierWithPattern(input.endpointRef, `${path}.endpointRef`, /^[a-z][a-z0-9._-]{0,63}$/, 128);
  const serverName = validateIdentifierWithPattern(input.serverName, `${path}.serverName`, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 256);
  const protocolVersion = validateIdentifierWithPattern(input.protocolVersion, `${path}.protocolVersion`, /^\d{4}-\d{2}-\d{2}$/, 64);
  const toolName = validateIdentifierWithPattern(input.toolName, `${path}.toolName`, /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/, 256);
  const toolVersion = validateVersion(input.toolVersion, `${path}.toolVersion`);
  return Object.freeze({ endpointRef, serverName, protocolVersion, toolName, toolVersion });
}

function validateRecord(value: unknown, path: string, maxBytes: number): Record<string, unknown> {
  assertJsonSafe(value, path, CAPABILITY_LIMITS.maxSchemaDepth, CAPABILITY_LIMITS.maxSchemaNodes);
  if (!isRecord(value)) throw new CapabilityValidationError(path, "must be a JSON object.");
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > maxBytes) {
    throw new CapabilityValidationError(path, `must be at most ${maxBytes} UTF-8 bytes.`);
  }
  return value;
}

function validateIdentifier(value: unknown, path: string): string {
  return validateIdentifierWithPattern(value, path, ID_PATTERN, CAPABILITY_LIMITS.maxIdBytes);
}

function validateIdentifierWithPattern(value: unknown, path: string, pattern: RegExp, maxBytes: number): string {
  const result = validateText(value, path, maxBytes);
  if (!pattern.test(result)) throw new CapabilityValidationError(path, "contains unsupported characters.");
  return result;
}

function validateVersion(value: unknown, path: string): string {
  const result = validateText(value, path, CAPABILITY_LIMITS.maxVersionBytes);
  if (!VERSION_PATTERN.test(result)) throw new CapabilityValidationError(path, "must use a semantic version.");
  return result;
}

function validateConnectionRef(value: unknown, path: string): string {
  return validateIdentifierWithPattern(value, path, CONNECTION_REF_PATTERN, CAPABILITY_LIMITS.maxIdBytes);
}

function validateText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CapabilityValidationError(path, "must be a non-empty string.");
  }
  if (utf8ByteLength(value) > maxBytes) {
    throw new CapabilityValidationError(path, `must be at most ${maxBytes} UTF-8 bytes.`);
  }
  return value;
}

function validateStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxItemBytes: number,
  pattern: RegExp,
  requireItems: boolean,
): readonly string[] {
  if (!Array.isArray(value)) throw new CapabilityValidationError(path, "must be an array.");
  if (requireItems && value.length === 0) throw new CapabilityValidationError(path, "must not be empty.");
  if (value.length > maxItems) throw new CapabilityValidationError(path, `must contain at most ${maxItems} items.`);
  const result = value.map((item, index) => validateIdentifierWithPattern(item, `${path}[${index}]`, pattern, maxItemBytes));
  if (new Set(result).size !== result.length) throw new CapabilityValidationError(path, "must not contain duplicates.");
  return Object.freeze(result);
}

function validateEnumList<T extends string>(value: unknown, path: string, allowed: readonly T[]): readonly T[] {
  if (!Array.isArray(value)) throw new CapabilityValidationError(path, "must be an array.");
  if (value.length > allowed.length) throw new CapabilityValidationError(path, "contains too many values.");
  const result = value.map((item, index) => validateEnum(item, allowed, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new CapabilityValidationError(path, "must not contain duplicates.");
  return Object.freeze(result);
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CapabilityValidationError(path, `must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function validateBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new CapabilityValidationError(path, "must be a boolean.");
  return value;
}

function validateBoundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new CapabilityValidationError(path, `must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function validateTimestamp(value: unknown, path: string): string {
  const timestamp = validateText(value, path, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new CapabilityValidationError(path, "must be an ISO-8601 UTC timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function assertSchemaVersion(value: unknown, path: string): void {
  if (value !== CAPABILITY_SCHEMA_VERSION) throw new CapabilityValidationError(path, `must be ${CAPABILITY_SCHEMA_VERSION}.`);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new CapabilityValidationError(`${path}.${key}`, "is not a supported field.");
  }
}

function assertJsonSafe(value: unknown, path: string, maxDepth: number, maxNodes: number): void {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const visit = (candidate: unknown, candidatePath: string, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new CapabilityValidationError(candidatePath, `contains more than ${maxNodes} JSON values.`);
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new CapabilityValidationError(candidatePath, "must contain only finite numbers.");
      return;
    }
    if (typeof candidate !== "object") throw new CapabilityValidationError(candidatePath, "must contain JSON-safe values.");
    if (depth > maxDepth) throw new CapabilityValidationError(candidatePath, `exceeds the maximum JSON depth of ${maxDepth}.`);
    if (seen.has(candidate)) throw new CapabilityValidationError(candidatePath, "must not contain cycles or repeated object references.");
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(candidate, index)) {
          throw new CapabilityValidationError(`${candidatePath}[${index}]`, "must not contain sparse array entries.");
        }
        visit(candidate[index], `${candidatePath}[${index}]`, depth + 1);
      }
      for (const key of Object.keys(candidate)) {
        if (!/^\d+$/.test(key)) throw new CapabilityValidationError(`${candidatePath}.${key}`, "is not a JSON array index.");
      }
      return;
    }

    if (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null) {
      throw new CapabilityValidationError(candidatePath, "must contain only plain JSON objects.");
    }
    if (Object.getOwnPropertySymbols(candidate).length > 0) {
      throw new CapabilityValidationError(candidatePath, "must not contain symbol properties.");
    }
    for (const key of Object.keys(candidate)) visit((candidate as Record<string, unknown>)[key], `${candidatePath}.${key}`, depth + 1);
  };

  visit(value, path, 0);
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
