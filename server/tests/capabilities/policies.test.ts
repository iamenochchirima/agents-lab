import assert from "node:assert/strict";
import test from "node:test";

import type {
  CapabilityApproval,
  CapabilityGrant,
  CapabilityManifest,
  CapabilityPolicy,
} from "../../src/capabilities/contracts.js";
import {
  CapabilityRegistry,
  CapabilityResolver,
  CapabilityValidationError,
  validateCapabilityGrant,
  validateCapabilityManifest,
  validateCapabilityPolicy,
} from "../../src/capabilities/index.js";

const now = "2026-09-20T12:00:00.000Z";

function manifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    schemaVersion: 1,
    id: "weather.read",
    version: "1.0.0",
    kind: "connection",
    displayName: "Weather read",
    description: "Read a bounded weather fixture.",
    risk: "read",
    operations: ["get_current"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { city: { type: "string" } },
      required: ["city"],
    },
    requiredScopes: ["weather.read"],
    source: { kind: "connection", ref: "local-weather" },
    ...overrides,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  const value: CapabilityGrant = {
    schemaVersion: 1,
    capabilityId: "weather.read",
    version: "1.0.0",
    enabled: true,
    connectionRef: "conn_weather_fixture",
    allowedOperations: ["get_current"],
    approvalMode: "none",
    timeoutMs: 1_000,
    maxInputBytes: 4_096,
    maxOutputBytes: 8_192,
    ...overrides,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "connectionRef") && overrides.connectionRef === undefined) {
    delete (value as { connectionRef?: string }).connectionRef;
  }
  return value;
}

function policy(overrides: Partial<CapabilityPolicy> = {}): CapabilityPolicy {
  return {
    schemaVersion: 1,
    policyId: "local-read",
    version: "1.0.0",
    allowedCapabilityIds: ["weather.read"],
    allowedRiskClasses: ["read"],
    requiredApprovalRiskClasses: [],
    allowedConnectionRefs: ["conn_weather_fixture"],
    maxTimeoutMs: 5_000,
    maxInputBytes: 16_384,
    maxOutputBytes: 16_384,
    ...overrides,
  };
}

function approval(overrides: Partial<CapabilityApproval> = {}): CapabilityApproval {
  const value: CapabilityApproval = {
    schemaVersion: 1,
    decisionId: "approval_weather_1",
    capabilityId: "weather.read",
    version: "1.0.0",
    allowedOperations: ["get_current"],
    connectionRef: "conn_weather_fixture",
    decision: "approved",
    decidedAt: "2026-09-20T11:59:00.000Z",
    expiresAt: "2026-09-20T12:30:00.000Z",
    ...overrides,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "connectionRef") && overrides.connectionRef === undefined) {
    delete (value as { connectionRef?: string }).connectionRef;
  }
  return value;
}

test("manifest, grant, and policy validation returns immutable bounded JSON-safe records", () => {
  const validatedManifest = validateCapabilityManifest(manifest());
  const validatedGrant = validateCapabilityGrant(grant());
  const validatedPolicy = validateCapabilityPolicy(policy());

  assert.equal(Object.isFrozen(validatedManifest), true);
  assert.equal(Object.isFrozen(validatedManifest.operations), true);
  assert.equal(Object.isFrozen(validatedGrant), true);
  assert.equal(Object.isFrozen(validatedPolicy), true);
  assert.deepEqual(validatedManifest, manifest());
  assert.deepEqual(validatedGrant, grant());
  assert.deepEqual(validatedPolicy, policy());
});

test("runtime validation rejects unsupported fields, unsafe values, and unbounded records", () => {
  assert.throws(() => validateCapabilityManifest({ ...manifest(), unexpected: true }), CapabilityValidationError);
  assert.throws(() => validateCapabilityManifest({ ...manifest(), description: "x".repeat(4_097) }), CapabilityValidationError);
  assert.throws(() => validateCapabilityManifest({ ...manifest(), inputSchema: { value: Number.NaN } }), CapabilityValidationError);
  assert.throws(() => validateCapabilityManifest({ ...manifest(), inputSchema: new Date() }), CapabilityValidationError);
  assert.throws(() => validateCapabilityGrant({ ...grant(), connectionRef: "Bearer-secret-value" }), CapabilityValidationError);
  assert.throws(() => validateCapabilityPolicy({ ...policy(), maxTimeoutMs: 0 }), CapabilityValidationError);

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => validateCapabilityManifest({ ...manifest(), inputSchema: cyclic }), CapabilityValidationError);
});

test("the resolver is deny-by-default and returns only explicit allowlisted grants", () => {
  const registry = new CapabilityRegistry([manifest()]);
  const resolver = new CapabilityResolver(registry, () => now);

  const denied = resolver.resolve({ policy: policy({ allowedCapabilityIds: [] }), grants: [grant()] });
  assert.deepEqual(denied.grants, []);
  assert.equal(denied.decisions[0]?.code, "CAPABILITY_NOT_ALLOWLISTED");

  const granted = resolver.resolve({ policy: policy(), grants: [grant()] });
  assert.equal(granted.grants.length, 1);
  assert.equal(granted.grants[0]?.manifest.id, "weather.read");
  assert.equal(granted.decisions[0]?.status, "granted");
  assert.equal(Object.isFrozen(granted), true);
  assert.equal(Object.isFrozen(granted.grants[0]), true);
});

test("the resolver enforces versions, declared operations, risks, connections, and limits", () => {
  const registry = new CapabilityRegistry([
    manifest(),
    manifest({ id: "publish.post", kind: "tool", risk: "write", operations: ["publish"], requiredScopes: [], source: { kind: "builtin", ref: "publisher" } }),
  ]);
  const resolver = new CapabilityResolver(registry, () => now);

  assert.equal(resolver.resolve({ policy: policy(), grants: [grant({ version: "2.0.0" })] }).decisions[0]?.code, "VERSION_MISMATCH");
  assert.equal(resolver.resolve({ policy: policy(), grants: [grant({ allowedOperations: ["delete"] })] }).decisions[0]?.code, "OPERATION_NOT_DECLARED");
  assert.equal(resolver.resolve({ policy: policy({ allowedRiskClasses: ["pure"] }), grants: [grant()] }).decisions[0]?.code, "RISK_NOT_ALLOWED");
  assert.equal(resolver.resolve({ policy: policy(), grants: [grant({ connectionRef: "conn_other" })] }).decisions[0]?.code, "CONNECTION_NOT_ALLOWED");
  assert.equal(resolver.resolve({ policy: policy({ maxTimeoutMs: 100 }), grants: [grant()] }).decisions[0]?.code, "LIMIT_EXCEEDED");
  assert.equal(resolver.resolve({ policy: policy(), grants: [grant({ connectionRef: undefined })] }).decisions[0]?.code, "CONNECTION_REQUIRED");

  const disabled = resolver.resolve({ policy: policy(), grants: [grant({ enabled: false })] });
  assert.equal(disabled.decisions[0]?.code, "CAPABILITY_DISABLED");
});

test("write risk requires grant approval mode and a matching unexpired decision", () => {
  const writeManifest = manifest({
    id: "publish.post",
    kind: "tool",
    risk: "write",
    operations: ["publish"],
    requiredScopes: [],
    source: { kind: "builtin", ref: "publisher" },
  });
  const registry = new CapabilityRegistry([writeManifest]);
  const resolver = new CapabilityResolver(registry, () => now);
  const writePolicy = policy({
    allowedCapabilityIds: ["publish.post"],
    allowedRiskClasses: ["write"],
    requiredApprovalRiskClasses: ["write"],
    allowedConnectionRefs: [],
  });
  const writeGrant = grant({
    capabilityId: "publish.post",
    connectionRef: undefined,
    allowedOperations: ["publish"],
    approvalMode: "required",
  });

  const pending = resolver.resolve({ policy: writePolicy, grants: [writeGrant] });
  assert.equal(pending.grants.length, 0);
  assert.equal(pending.decisions[0]?.status, "approval_required");

  const approved = resolver.resolve({ policy: writePolicy, grants: [writeGrant], approvals: [approval({ capabilityId: "publish.post", allowedOperations: ["publish"], connectionRef: undefined })] });
  assert.equal(approved.grants.length, 1);
  assert.equal(approved.grants[0]?.approval, "approved");

  const denied = resolver.resolve({ policy: writePolicy, grants: [writeGrant], approvals: [approval({ capabilityId: "publish.post", allowedOperations: ["publish"], connectionRef: undefined, decision: "denied" })] });
  assert.equal(denied.decisions[0]?.code, "APPROVAL_DENIED");

  const expired = resolver.resolve({ policy: writePolicy, grants: [writeGrant], approvals: [approval({ capabilityId: "publish.post", allowedOperations: ["publish"], connectionRef: undefined, expiresAt: "2026-09-20T11:59:59.000Z" })] });
  assert.equal(expired.decisions[0]?.code, "APPROVAL_EXPIRED");

  const stale = resolver.resolve({ policy: writePolicy, grants: [writeGrant], approvals: [approval({ capabilityId: "publish.post", allowedOperations: ["other"], connectionRef: undefined })] });
  assert.equal(stale.decisions[0]?.code, "APPROVAL_STALE");

  const misconfigured = resolver.resolve({ policy: writePolicy, grants: [{ ...writeGrant, approvalMode: "none" }], approvals: [approval({ capabilityId: "publish.post", allowedOperations: ["publish"], connectionRef: undefined })] });
  assert.equal(misconfigured.decisions[0]?.code, "APPROVAL_REQUIRED");
  assert.equal(misconfigured.decisions[0]?.status, "denied");
});

test("duplicate grants and approvals fail before resolution", () => {
  const registry = new CapabilityRegistry([manifest()]);
  const resolver = new CapabilityResolver(registry, () => now);

  assert.throws(() => resolver.resolve({ policy: policy(), grants: [grant(), grant()] }), /duplicate capability grants/);
  assert.throws(() => resolver.resolve({ policy: policy(), grants: [grant()], approvals: [approval(), approval()] }), /duplicate approval decisions/);
});
