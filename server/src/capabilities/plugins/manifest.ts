export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/;
const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const SECRET_REFERENCE_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const PROCESS_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const MAX_CAPABILITIES = 32;
const MAX_OPERATIONS_PER_CAPABILITY = 32;
const MAX_PERMISSIONS = 64;
const MAX_PERMISSION_TARGETS = 16;
const MAX_DISPLAY_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2_048;
const MAX_SOURCE_NAME_BYTES = 64;
const MAX_TARGET_BYTES = 256;

const RESOURCE_LIMITS = {
  maxExecutionMs: { min: 1, max: 300_000 },
  maxInputBytes: { min: 1, max: 1_048_576 },
  maxOutputBytes: { min: 1, max: 4_194_304 },
  maxConcurrentCalls: { min: 1, max: 16 },
  maxNetworkRequests: { min: 0, max: 32 },
  maxFilesystemBytes: { min: 0, max: 16_777_216 },
  maxSubprocesses: { min: 0, max: 4 },
} as const;

const MANIFEST_KEYS = [
  "schemaVersion",
  "id",
  "version",
  "displayName",
  "description",
  "source",
  "capabilities",
  "permissions",
  "resourceLimits",
] as const;

const SOURCE_KEYS = ["kind", "name"] as const;
const CAPABILITY_KEYS = ["id", "version", "operations"] as const;
const PERMISSION_KEYS = ["capabilityId", "kind", "access", "targets"] as const;
const RESOURCE_LIMIT_KEYS = Object.keys(RESOURCE_LIMITS) as readonly (keyof typeof RESOURCE_LIMITS)[];

export type PluginPermissionKind = "network" | "filesystem" | "process" | "secret";
export type PluginPermissionAccess = "read" | "write" | "spawn";

export interface PluginCapabilityDeclaration {
  readonly id: string;
  readonly version: string;
  readonly operations: readonly string[];
}

export interface PluginPermission {
  readonly capabilityId: string;
  readonly kind: PluginPermissionKind;
  readonly access: PluginPermissionAccess;
  readonly targets: readonly string[];
}

export interface PluginResourceLimits {
  readonly maxExecutionMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxConcurrentCalls: number;
  readonly maxNetworkRequests: number;
  readonly maxFilesystemBytes: number;
  readonly maxSubprocesses: number;
}

export interface PluginManifest {
  readonly schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly source: {
    readonly kind: "local_builtin";
    readonly name: string;
  };
  readonly capabilities: readonly PluginCapabilityDeclaration[];
  readonly permissions: readonly PluginPermission[];
  readonly resourceLimits: PluginResourceLimits;
}

export interface PluginCapabilityUse {
  readonly capabilityId: string;
  readonly version: string;
  readonly operation: string;
}

export interface PluginManifestValidatorOptions {
  /** Plugin IDs are trusted configuration, not a value supplied by a manifest. */
  readonly trustedPluginIds: readonly string[];
  /** Capability IDs are the only capability names this validator will admit. */
  readonly allowedCapabilityIds: readonly string[];
  /** Process access is disabled unless each executable is separately allowlisted. */
  readonly allowedProcessNames?: readonly string[];
  /** Secret references are opaque names, never secret values. */
  readonly allowedSecretReferences?: readonly string[];
}

export type PluginManifestValidationErrorCode =
  | "INVALID_MANIFEST"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNTRUSTED_PLUGIN"
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_SOURCE"
  | "CAPABILITY_NOT_ALLOWED"
  | "DUPLICATE_CAPABILITY"
  | "INVALID_CAPABILITY"
  | "UNDECLARED_CAPABILITY"
  | "UNDECLARED_OPERATION"
  | "DUPLICATE_PERMISSION"
  | "INVALID_PERMISSION"
  | "UNSAFE_PERMISSION"
  | "UNBOUNDED_PERMISSION"
  | "INVALID_RESOURCE_LIMIT"
  | "UNBOUNDED_RESOURCE_LIMIT"
  | "RESOURCE_LIMIT_CONFLICT";

export class PluginManifestValidationError extends Error {
  readonly code: PluginManifestValidationErrorCode;
  readonly path: string;

  constructor(code: PluginManifestValidationErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PluginManifestValidationError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Validates metadata only. This class intentionally has no module loading,
 * dynamic import, subprocess, or plugin execution method.
 */
export class PluginManifestValidator {
  private readonly trustedPluginIds: ReadonlySet<string>;
  private readonly allowedCapabilityIds: ReadonlySet<string>;
  private readonly allowedProcessNames: ReadonlySet<string>;
  private readonly allowedSecretReferences: ReadonlySet<string>;

  constructor(options: PluginManifestValidatorOptions) {
    this.trustedPluginIds = validatedAllowlist(options.trustedPluginIds, "trustedPluginIds", PLUGIN_ID_PATTERN);
    this.allowedCapabilityIds = validatedAllowlist(options.allowedCapabilityIds, "allowedCapabilityIds", CAPABILITY_ID_PATTERN);
    this.allowedProcessNames = validatedAllowlist(options.allowedProcessNames ?? [], "allowedProcessNames", PROCESS_NAME_PATTERN);
    this.allowedSecretReferences = validatedAllowlist(options.allowedSecretReferences ?? [], "allowedSecretReferences", SECRET_REFERENCE_PATTERN);
  }

  validate(input: unknown): Readonly<PluginManifest> {
    const manifest = record(input, "manifest");
    exactKeys(manifest, MANIFEST_KEYS, "manifest");

    if (manifest.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) {
      throw new PluginManifestValidationError(
        manifest.schemaVersion === undefined ? "INVALID_MANIFEST" : "UNSUPPORTED_SCHEMA_VERSION",
        "manifest.schemaVersion",
        `expected schema version ${PLUGIN_MANIFEST_SCHEMA_VERSION}`,
      );
    }

    const id = safeString(manifest.id, "manifest.id", PLUGIN_ID_PATTERN, "INVALID_ID");
    if (!this.trustedPluginIds.has(id)) {
      throw new PluginManifestValidationError("UNTRUSTED_PLUGIN", "manifest.id", `plugin is not trusted: ${id}`);
    }
    const version = semver(manifest.version, "manifest.version");
    const displayName = boundedText(manifest.displayName, "manifest.displayName", MAX_DISPLAY_NAME_BYTES);
    const description = boundedText(manifest.description, "manifest.description", MAX_DESCRIPTION_BYTES);
    const source = this.validateSource(manifest.source);
    if (source.name !== id) {
      throw new PluginManifestValidationError("INVALID_SOURCE", "manifest.source.name", "local built-in name must match the trusted plugin ID");
    }
    const capabilities = this.validateCapabilities(manifest.capabilities);
    const permissions = this.validatePermissions(manifest.permissions, capabilities);
    const resourceLimits = this.validateResourceLimits(manifest.resourceLimits);
    validateResourceConflicts(permissions, resourceLimits);

    return deepFreeze({
      schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
      id,
      version,
      displayName,
      description,
      source,
      capabilities,
      permissions,
      resourceLimits,
    });
  }

  validateCapabilityUse(manifest: PluginManifest, use: unknown): PluginCapabilityDeclaration {
    const request = record(use, "capabilityUse");
    exactKeys(request, ["capabilityId", "version", "operation"], "capabilityUse");
    const capabilityId = safeString(request.capabilityId, "capabilityUse.capabilityId", CAPABILITY_ID_PATTERN, "UNDECLARED_CAPABILITY");
    const version = semver(request.version, "capabilityUse.version");
    const operation = safeString(request.operation, "capabilityUse.operation", OPERATION_PATTERN, "UNDECLARED_OPERATION");
    const declaration = manifest.capabilities.find((capability) => capability.id === capabilityId);
    if (!declaration) {
      throw new PluginManifestValidationError("UNDECLARED_CAPABILITY", "capabilityUse.capabilityId", `capability is not declared: ${capabilityId}`);
    }
    if (declaration.version !== version) {
      throw new PluginManifestValidationError(
        "UNDECLARED_CAPABILITY",
        "capabilityUse.version",
        `capability version does not match the declared version for ${capabilityId}`,
      );
    }
    if (!declaration.operations.includes(operation)) {
      throw new PluginManifestValidationError("UNDECLARED_OPERATION", "capabilityUse.operation", `operation is not declared: ${operation}`);
    }
    return declaration;
  }

  private validateSource(input: unknown): PluginManifest["source"] {
    const source = record(input, "manifest.source");
    exactKeys(source, SOURCE_KEYS, "manifest.source");
    if (source.kind !== "local_builtin") {
      throw new PluginManifestValidationError("INVALID_SOURCE", "manifest.source.kind", "only local_builtin sources are accepted");
    }
    const name = safeString(source.name, "manifest.source.name", SOURCE_NAME_PATTERN, "INVALID_SOURCE");
    if (byteLength(name) > MAX_SOURCE_NAME_BYTES) {
      throw new PluginManifestValidationError("INVALID_SOURCE", "manifest.source.name", "source name is too large");
    }
    return { kind: "local_builtin", name };
  }

  private validateCapabilities(input: unknown): readonly PluginCapabilityDeclaration[] {
    const values = boundedArray(input, "manifest.capabilities", MAX_CAPABILITIES, true);
    const seen = new Set<string>();
    const capabilities: PluginCapabilityDeclaration[] = [];
    for (const [index, value] of values.entries()) {
      const path = `manifest.capabilities[${index}]`;
      const capability = record(value, path);
      exactKeys(capability, CAPABILITY_KEYS, path);
      const id = safeString(capability.id, `${path}.id`, CAPABILITY_ID_PATTERN, "INVALID_CAPABILITY");
      if (!this.allowedCapabilityIds.has(id)) {
        throw new PluginManifestValidationError("CAPABILITY_NOT_ALLOWED", `${path}.id`, `capability is not allowlisted: ${id}`);
      }
      if (seen.has(id)) {
        throw new PluginManifestValidationError("DUPLICATE_CAPABILITY", `${path}.id`, `capability is declared more than once: ${id}`);
      }
      seen.add(id);
      const version = semver(capability.version, `${path}.version`);
      const operations = boundedArray(capability.operations, `${path}.operations`, MAX_OPERATIONS_PER_CAPABILITY, true)
        .map((operation, operationIndex) => safeString(operation, `${path}.operations[${operationIndex}]`, OPERATION_PATTERN, "INVALID_CAPABILITY"));
      if (new Set(operations).size !== operations.length) {
        throw new PluginManifestValidationError("INVALID_CAPABILITY", `${path}.operations`, "operations must be unique");
      }
      capabilities.push({ id, version, operations });
    }
    return capabilities;
  }

  private validatePermissions(input: unknown, capabilities: readonly PluginCapabilityDeclaration[]): readonly PluginPermission[] {
    const values = boundedArray(input, "manifest.permissions", MAX_PERMISSIONS, false);
    const declaredCapabilities = new Set(capabilities.map((capability) => capability.id));
    const seen = new Set<string>();
    const permissions: PluginPermission[] = [];
    for (const [index, value] of values.entries()) {
      const path = `manifest.permissions[${index}]`;
      const permission = record(value, path);
      exactKeys(permission, PERMISSION_KEYS, path);
      const capabilityId = safeString(permission.capabilityId, `${path}.capabilityId`, CAPABILITY_ID_PATTERN, "UNDECLARED_CAPABILITY");
      if (!declaredCapabilities.has(capabilityId)) {
        throw new PluginManifestValidationError("UNDECLARED_CAPABILITY", `${path}.capabilityId`, `permission is for an undeclared capability: ${capabilityId}`);
      }
      const kind = enumValue(permission.kind, `${path}.kind`, ["network", "filesystem", "process", "secret"] as const, "INVALID_PERMISSION");
      const access = enumValue(permission.access, `${path}.access`, ["read", "write", "spawn"] as const, "INVALID_PERMISSION");
      const targets = boundedArray(permission.targets, `${path}.targets`, MAX_PERMISSION_TARGETS, true)
        .map((target, targetIndex) => boundedText(target, `${path}.targets[${targetIndex}]`, MAX_TARGET_BYTES));
      if (new Set(targets).size !== targets.length) {
        throw new PluginManifestValidationError("DUPLICATE_PERMISSION", `${path}.targets`, "permission targets must be unique");
      }
      const key = `${capabilityId}\u0000${kind}\u0000${access}\u0000${targets.join("\u0001")}`;
      if (seen.has(key)) {
        throw new PluginManifestValidationError("DUPLICATE_PERMISSION", path, "permission is declared more than once");
      }
      seen.add(key);
      validatePermission(kind, access, targets, path, this.allowedProcessNames, this.allowedSecretReferences);
      permissions.push({ capabilityId, kind, access, targets });
    }
    return permissions;
  }

  private validateResourceLimits(input: unknown): PluginResourceLimits {
    const limits = record(input, "manifest.resourceLimits");
    exactKeys(limits, RESOURCE_LIMIT_KEYS, "manifest.resourceLimits");
    const result = {} as { -readonly [K in keyof PluginResourceLimits]: number };
    for (const key of RESOURCE_LIMIT_KEYS) {
      const value = limits[key];
      const bounds = RESOURCE_LIMITS[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new PluginManifestValidationError("INVALID_RESOURCE_LIMIT", `manifest.resourceLimits.${key}`, "limit must be a safe integer");
      }
      if (value < bounds.min || value > bounds.max) {
        throw new PluginManifestValidationError(
          "UNBOUNDED_RESOURCE_LIMIT",
          `manifest.resourceLimits.${key}`,
          `limit must be between ${bounds.min} and ${bounds.max}`,
        );
      }
      result[key] = value;
    }
    return result;
  }
}

function validatePermission(
  kind: PluginPermissionKind,
  access: PluginPermissionAccess,
  targets: readonly string[],
  path: string,
  allowedProcessNames: ReadonlySet<string>,
  allowedSecretReferences: ReadonlySet<string>,
): void {
  if (kind === "network") {
    if (access === "spawn") throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.access`, "network permissions cannot spawn processes");
    for (const [index, target] of targets.entries()) validateNetworkTarget(target, `${path}.targets[${index}]`);
    return;
  }
  if (kind === "filesystem") {
    if (access === "spawn") throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.access`, "filesystem permissions cannot spawn processes");
    for (const [index, target] of targets.entries()) validateFilesystemTarget(target, `${path}.targets[${index}]`);
    return;
  }
  if (kind === "process") {
    if (access !== "spawn") throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.access`, "process permissions must use spawn access");
    for (const [index, target] of targets.entries()) {
      if (!PROCESS_NAME_PATTERN.test(target) || !allowedProcessNames.has(target)) {
        throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.targets[${index}]`, "process is not explicitly allowlisted");
      }
    }
    return;
  }
  if (access !== "read") {
    throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.access`, "secret permissions are read-only");
  }
  for (const [index, target] of targets.entries()) {
    if (!SECRET_REFERENCE_PATTERN.test(target) || !allowedSecretReferences.has(target)) {
      throw new PluginManifestValidationError("UNSAFE_PERMISSION", `${path}.targets[${index}]`, "secret reference is not explicitly allowlisted");
    }
  }
}

function validateNetworkTarget(target: string, path: string): void {
  if (target.includes("*") || target.includes("?")) {
    throw new PluginManifestValidationError("UNBOUNDED_PERMISSION", path, "network targets cannot use wildcards");
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new PluginManifestValidationError("UNSAFE_PERMISSION", path, "network target must be an absolute URL");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new PluginManifestValidationError("UNSAFE_PERMISSION", path, "network targets must use HTTPS, except local HTTP fixtures");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== target.replace(/\/$/, "")) {
    throw new PluginManifestValidationError("UNSAFE_PERMISSION", path, "network target must be an origin without credentials or path access");
  }
}

function validateFilesystemTarget(target: string, path: string): void {
  if (
    target.startsWith("/") ||
    target.includes("\\") ||
    target.includes("*") ||
    target.includes("?") ||
    target.split("/").some((part) => part === ".." || part.length === 0)
  ) {
    throw new PluginManifestValidationError("UNBOUNDED_PERMISSION", path, "filesystem targets must be non-empty relative paths without traversal or globs");
  }
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(target)) {
    throw new PluginManifestValidationError("UNSAFE_PERMISSION", path, "filesystem target contains an unsafe path segment");
  }
}

function validateResourceConflicts(permissions: readonly PluginPermission[], limits: PluginResourceLimits): void {
  if (permissions.some((permission) => permission.kind === "network") && limits.maxNetworkRequests === 0) {
    throw new PluginManifestValidationError("RESOURCE_LIMIT_CONFLICT", "manifest.resourceLimits.maxNetworkRequests", "network permission requires a positive request limit");
  }
  if (permissions.some((permission) => permission.kind === "filesystem" && permission.access === "write") && limits.maxFilesystemBytes === 0) {
    throw new PluginManifestValidationError("RESOURCE_LIMIT_CONFLICT", "manifest.resourceLimits.maxFilesystemBytes", "filesystem write permission requires a positive byte limit");
  }
  if (permissions.some((permission) => permission.kind === "process") && limits.maxSubprocesses === 0) {
    throw new PluginManifestValidationError("RESOURCE_LIMIT_CONFLICT", "manifest.resourceLimits.maxSubprocesses", "process permission requires a positive subprocess limit");
  }
}

function validatedAllowlist(values: readonly string[], path: string, pattern: RegExp): ReadonlySet<string> {
  const result = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string" || !pattern.test(value) || result.has(value)) {
      throw new PluginManifestValidationError("INVALID_MANIFEST", `${path}[${index}]`, "allowlist entries must be unique safe identifiers");
    }
    result.add(value);
  }
  return result;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginManifestValidationError("INVALID_MANIFEST", path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new PluginManifestValidationError("INVALID_MANIFEST", `${path}.${unknown}`, "unknown field is not permitted");
  }
  const missing = allowed.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) {
    throw new PluginManifestValidationError("INVALID_MANIFEST", `${path}.${missing}`, "required field is missing");
  }
}

function boundedArray(value: unknown, path: string, max: number, requireAtLeastOne: boolean): unknown[] {
  if (!Array.isArray(value)) throw new PluginManifestValidationError("INVALID_MANIFEST", path, "expected an array");
  if (requireAtLeastOne && value.length === 0) throw new PluginManifestValidationError("INVALID_MANIFEST", path, "must contain at least one entry");
  if (value.length > max) throw new PluginManifestValidationError("UNBOUNDED_PERMISSION", path, `must contain at most ${max} entries`);
  return value;
}

function safeString(value: unknown, path: string, pattern: RegExp, code: PluginManifestValidationErrorCode): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PluginManifestValidationError(code, path, "must be a non-empty safe identifier");
  }
  return value;
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PluginManifestValidationError("INVALID_MANIFEST", path, "must be non-empty text");
  }
  if (byteLength(value) > maxBytes) {
    throw new PluginManifestValidationError("UNBOUNDED_PERMISSION", path, `must be at most ${maxBytes} bytes`);
  }
  return value;
}

function semver(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new PluginManifestValidationError("INVALID_VERSION", path, "must be an exact semantic version");
  }
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, path: string, allowed: T, code: PluginManifestValidationErrorCode): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new PluginManifestValidationError(code, path, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
