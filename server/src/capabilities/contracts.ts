/**
 * Provider-neutral capability contracts.
 *
 * These records are the seam between a selected run profile and a platform
 * adapter. They contain only bounded JSON-safe data. Platform SDK types,
 * credentials, and execution handles do not belong here.
 */

export const CAPABILITY_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type CapabilityKind = "tool" | "connection" | "plugin";
export type CapabilityRisk = "pure" | "read" | "write" | "external";
export type CapabilityApprovalMode = "none" | "required";
export type CapabilityApprovalDecision = "approved" | "denied";

export interface CapabilitySource {
  readonly kind: "builtin" | "local" | "plugin" | "connection";
  readonly ref: string;
  readonly digest?: string;
}

export interface CapabilityManifest {
  readonly schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly displayName: string;
  readonly description: string;
  readonly risk: CapabilityRisk;
  readonly operations: readonly string[];
  readonly inputSchema?: JsonObject;
  readonly requiredScopes: readonly string[];
  readonly source: CapabilitySource;
}

export interface CapabilityGrant {
  readonly schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  readonly capabilityId: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly connectionRef?: string;
  readonly allowedOperations: readonly string[];
  readonly approvalMode: CapabilityApprovalMode;
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface CapabilityPolicy {
  readonly schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  readonly policyId: string;
  readonly version: string;
  readonly allowedCapabilityIds: readonly string[];
  readonly allowedRiskClasses: readonly CapabilityRisk[];
  readonly requiredApprovalRiskClasses: readonly CapabilityRisk[];
  readonly allowedConnectionRefs: readonly string[];
  readonly maxTimeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface CapabilityApproval {
  readonly schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  readonly decisionId: string;
  readonly capabilityId: string;
  readonly version: string;
  readonly allowedOperations: readonly string[];
  readonly connectionRef?: string;
  readonly decision: CapabilityApprovalDecision;
  readonly decidedAt: string;
  readonly expiresAt: string;
}

export interface CapabilityResolutionRequest {
  readonly policy: CapabilityPolicy;
  readonly grants: readonly CapabilityGrant[];
  readonly approvals?: readonly CapabilityApproval[];
}

export type CapabilityResolutionStatus = "granted" | "denied" | "approval_required";

export type CapabilityResolutionCode =
  | "GRANTED"
  | "CAPABILITY_NOT_REGISTERED"
  | "CAPABILITY_NOT_ALLOWLISTED"
  | "CAPABILITY_DISABLED"
  | "VERSION_MISMATCH"
  | "RISK_NOT_ALLOWED"
  | "OPERATION_NOT_DECLARED"
  | "CONNECTION_REQUIRED"
  | "CONNECTION_NOT_ALLOWED"
  | "LIMIT_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DENIED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_STALE";

export interface CapabilityResolutionDecision {
  readonly capabilityId: string;
  readonly version: string;
  readonly status: CapabilityResolutionStatus;
  readonly code: CapabilityResolutionCode;
  readonly message: string;
}

export interface ResolvedCapability {
  readonly manifest: CapabilityManifest;
  readonly grant: CapabilityGrant;
  readonly approval: "not_required" | "approved";
}

export interface CapabilityResolution {
  readonly policy: CapabilityPolicy;
  readonly grants: readonly ResolvedCapability[];
  readonly decisions: readonly CapabilityResolutionDecision[];
}
