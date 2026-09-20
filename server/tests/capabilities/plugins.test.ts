import assert from "node:assert/strict";
import test from "node:test";

import {
  PluginManifestValidationError,
  PluginManifestValidator,
  type PluginManifest,
} from "../../src/capabilities/plugins/index.js";

function validator(): PluginManifestValidator {
  return new PluginManifestValidator({
    trustedPluginIds: ["content-reader"],
    allowedCapabilityIds: ["content.read", "content.publish"],
    allowedProcessNames: ["git"],
    allowedSecretReferences: ["social.readonly"],
  });
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id: "content-reader",
    version: "1.2.0",
    displayName: "Content reader",
    description: "Reads content from an explicitly configured source.",
    source: { kind: "local_builtin", name: "content-reader" },
    capabilities: [{ id: "content.read", version: "1.0.0", operations: ["read"] }],
    permissions: [],
    resourceLimits: {
      maxExecutionMs: 30_000,
      maxInputBytes: 4_096,
      maxOutputBytes: 64_000,
      maxConcurrentCalls: 2,
      maxNetworkRequests: 0,
      maxFilesystemBytes: 0,
      maxSubprocesses: 0,
    },
    ...overrides,
  };
}

function errorOf(action: () => unknown): PluginManifestValidationError {
  assert.throws(action, (error: unknown) => error instanceof PluginManifestValidationError);
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof PluginManifestValidationError);
    return error;
  }
  throw new Error("Expected validation to throw.");
}

test("accepts a trusted local manifest and deeply freezes the normalized result", () => {
  const result = validator().validate(manifest({
    permissions: [{
      capabilityId: "content.read",
      kind: "network",
      access: "read",
      targets: ["https://content.example"],
    }],
    resourceLimits: {
      ...manifest().resourceLimits,
      maxNetworkRequests: 4,
    },
  }));

  assert.equal(result.source.kind, "local_builtin");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.capabilities), true);
  assert.equal(Object.isFrozen(result.capabilities[0]), true);
  assert.equal(Object.isFrozen(result.permissions), true);
  assert.equal(Object.isFrozen(result.resourceLimits), true);
  assert.deepEqual(validator().validateCapabilityUse(result, {
    capabilityId: "content.read",
    version: "1.0.0",
    operation: "read",
  }), result.capabilities[0]);
});

test("trust is external configuration and executable or unknown manifest fields are rejected", () => {
  const untrusted = new PluginManifestValidator({ trustedPluginIds: [], allowedCapabilityIds: ["content.read"] });
  assert.equal(errorOf(() => untrusted.validate(manifest())).code, "UNTRUSTED_PLUGIN");

  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    entrypoint: "./plugin.js",
  })).code, "INVALID_MANIFEST");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    source: { kind: "module", name: "./plugin.js" },
  })).code, "INVALID_SOURCE");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    source: { kind: "local_builtin", name: "different-builtin" },
  })).code, "INVALID_SOURCE");
});

test("requires supported versions, allowlisted capabilities, and unique declarations", () => {
  assert.equal(errorOf(() => validator().validate({ ...manifest(), schemaVersion: 2 })).code, "UNSUPPORTED_SCHEMA_VERSION");
  assert.equal(errorOf(() => validator().validate({ ...manifest(), version: "latest" })).code, "INVALID_VERSION");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    capabilities: [{ id: "unknown.capability", version: "1.0.0", operations: ["read"] }],
  })).code, "CAPABILITY_NOT_ALLOWED");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    capabilities: [
      { id: "content.read", version: "1.0.0", operations: ["read"] },
      { id: "content.read", version: "1.0.0", operations: ["read"] },
    ],
  })).code, "DUPLICATE_CAPABILITY");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    capabilities: [{ id: "content.read", version: "1.0.0", operations: ["*"] }],
  })).code, "INVALID_CAPABILITY");
});

test("permissions must reference declared capabilities and use bounded explicit targets", () => {
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    permissions: [{ capabilityId: "content.publish", kind: "network", access: "read", targets: ["https://content.example"] }],
    resourceLimits: { ...manifest().resourceLimits, maxNetworkRequests: 1 },
  })).code, "UNDECLARED_CAPABILITY");

  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    permissions: [{ capabilityId: "content.read", kind: "network", access: "read", targets: ["https://*.example"] }],
    resourceLimits: { ...manifest().resourceLimits, maxNetworkRequests: 1 },
  })).code, "UNBOUNDED_PERMISSION");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    permissions: [{ capabilityId: "content.read", kind: "filesystem", access: "read", targets: ["../secrets"] }],
  })).code, "UNBOUNDED_PERMISSION");
  assert.equal(errorOf(() => validator().validate({
    ...manifest(),
    permissions: [{ capabilityId: "content.read", kind: "filesystem", access: "read", targets: ["/etc/passwd"] }],
  })).code, "UNBOUNDED_PERMISSION");
});

test("process and secret access remain separately allowlisted and cannot widen themselves", () => {
  const processManifest = manifest({
    permissions: [{ capabilityId: "content.read", kind: "process", access: "spawn", targets: ["git"] }],
    resourceLimits: { ...manifest().resourceLimits, maxSubprocesses: 1 },
  });
  assert.equal(validator().validate(processManifest).permissions[0]?.targets[0], "git");
  assert.equal(errorOf(() => validator().validate({
    ...processManifest,
    permissions: [{ capabilityId: "content.read", kind: "process", access: "spawn", targets: ["sh"] }],
  })).code, "UNSAFE_PERMISSION");

  const secretManifest = manifest({
    permissions: [{ capabilityId: "content.read", kind: "secret", access: "read", targets: ["social.readonly"] }],
  });
  assert.equal(validator().validate(secretManifest).permissions[0]?.targets[0], "social.readonly");
  assert.equal(errorOf(() => validator().validate({
    ...secretManifest,
    permissions: [{ capabilityId: "content.read", kind: "secret", access: "write", targets: ["social.readonly"] }],
  })).code, "UNSAFE_PERMISSION");
  assert.equal(errorOf(() => validator().validate({
    ...secretManifest,
    permissions: [{ capabilityId: "content.read", kind: "secret", access: "read", targets: ["*"] }],
  })).code, "UNSAFE_PERMISSION");
});

test("every resource limit is required, finite, bounded, and consistent with permissions", () => {
  const base = manifest();
  const missing = { ...base.resourceLimits } as Record<string, unknown>;
  delete missing.maxOutputBytes;
  assert.equal(errorOf(() => validator().validate({ ...base, resourceLimits: missing as unknown as PluginManifest["resourceLimits"] })).code, "INVALID_MANIFEST");
  assert.equal(errorOf(() => validator().validate({
    ...base,
    resourceLimits: { ...base.resourceLimits, maxExecutionMs: Number.POSITIVE_INFINITY },
  })).code, "INVALID_RESOURCE_LIMIT");
  assert.equal(errorOf(() => validator().validate({
    ...base,
    resourceLimits: { ...base.resourceLimits, maxInputBytes: 1_048_577 },
  })).code, "UNBOUNDED_RESOURCE_LIMIT");
  assert.equal(errorOf(() => validator().validate({
    ...base,
    permissions: [{ capabilityId: "content.read", kind: "network", access: "read", targets: ["https://content.example"] }],
    resourceLimits: { ...base.resourceLimits, maxNetworkRequests: 0 },
  })).code, "RESOURCE_LIMIT_CONFLICT");
});

test("capability use rejects undeclared capabilities, versions, and operations", () => {
  const value = validator().validate(manifest());
  assert.equal(errorOf(() => validator().validateCapabilityUse(value, {
    capabilityId: "content.publish",
    version: "1.0.0",
    operation: "publish",
  })).code, "UNDECLARED_CAPABILITY");
  assert.equal(errorOf(() => validator().validateCapabilityUse(value, {
    capabilityId: "content.read",
    version: "2.0.0",
    operation: "read",
  })).code, "UNDECLARED_CAPABILITY");
  assert.equal(errorOf(() => validator().validateCapabilityUse(value, {
    capabilityId: "content.read",
    version: "1.0.0",
    operation: "write",
  })).code, "UNDECLARED_OPERATION");
});
