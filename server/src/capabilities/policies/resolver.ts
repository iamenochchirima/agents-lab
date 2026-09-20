import type {
  CapabilityApproval,
  CapabilityGrant,
  CapabilityManifest,
  CapabilityPolicy,
  CapabilityResolution,
  CapabilityResolutionCode,
  CapabilityResolutionDecision,
  CapabilityResolutionRequest,
  ResolvedCapability,
} from "../contracts.js";
import {
  validateCapabilityApproval,
  validateCapabilityGrant,
  validateCapabilityManifest,
  validateCapabilityPolicy,
} from "../validation.js";

export class CapabilityRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRegistrationError";
  }
}

/**
 * The registered catalog is an allowlist, not an execution registry. The
 * resolver still requires an explicit grant and policy allowlist for every
 * capability in a run.
 */
export class CapabilityRegistry {
  private readonly manifests = new Map<string, CapabilityManifest>();

  constructor(manifests: readonly unknown[] = []) {
    for (const manifest of manifests) this.register(manifest);
  }

  register(value: unknown): void {
    const manifest = validateCapabilityManifest(value);
    const key = manifestKey(manifest.id, manifest.version);
    if (this.manifests.has(key)) throw new CapabilityRegistrationError(`Capability is already registered: ${key}`);
    this.manifests.set(key, manifest);
  }

  get(capabilityId: string, version: string): CapabilityManifest | undefined {
    return this.manifests.get(manifestKey(capabilityId, version));
  }

  hasId(capabilityId: string): boolean {
    for (const manifest of this.manifests.values()) {
      if (manifest.id === capabilityId) return true;
    }
    return false;
  }

  definitions(): readonly CapabilityManifest[] {
    return Object.freeze([...this.manifests.values()]);
  }
}

export class CapabilityResolver {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  resolve(value: CapabilityResolutionRequest): CapabilityResolution {
    const policy = validateCapabilityPolicy(value.policy);
    const grants = value.grants.map((grant) => validateCapabilityGrant(grant));
    const approvals = (value.approvals ?? []).map((approval) => validateCapabilityApproval(approval));
    assertNoDuplicateGrants(grants);
    assertNoDuplicateApprovals(approvals);
    const now = parseNow(this.now());
    const resolved: ResolvedCapability[] = [];
    const decisions: CapabilityResolutionDecision[] = [];

    for (const grant of grants) {
      const manifest = this.registry.get(grant.capabilityId, grant.version);
      if (!manifest) {
        decisions.push(denied(
          grant,
          this.registry.hasId(grant.capabilityId) ? "VERSION_MISMATCH" : "CAPABILITY_NOT_REGISTERED",
          this.registry.hasId(grant.capabilityId)
            ? "Capability is registered, but not at the requested version."
            : "Capability is not registered at the requested version.",
        ));
        continue;
      }
      if (!policy.allowedCapabilityIds.includes(manifest.id)) {
        decisions.push(denied(grant, "CAPABILITY_NOT_ALLOWLISTED", "Capability is not allowlisted by the run policy."));
        continue;
      }
      if (!grant.enabled) {
        decisions.push(denied(grant, "CAPABILITY_DISABLED", "Capability grant is disabled."));
        continue;
      }
      if (!policy.allowedRiskClasses.includes(manifest.risk)) {
        decisions.push(denied(grant, "RISK_NOT_ALLOWED", `Risk class is not allowed: ${manifest.risk}.`));
        continue;
      }
      if (grant.allowedOperations.some((operation) => !manifest.operations.includes(operation))) {
        decisions.push(denied(grant, "OPERATION_NOT_DECLARED", "Grant requests an operation the capability did not declare."));
        continue;
      }
      if (grant.timeoutMs > policy.maxTimeoutMs || grant.maxInputBytes > policy.maxInputBytes || grant.maxOutputBytes > policy.maxOutputBytes) {
        decisions.push(denied(grant, "LIMIT_EXCEEDED", "Grant limits exceed the run policy limits."));
        continue;
      }
      if (manifest.requiredScopes.length > 0 && grant.connectionRef === undefined) {
        decisions.push(denied(grant, "CONNECTION_REQUIRED", "This capability requires an explicit connection reference."));
        continue;
      }
      if (grant.connectionRef !== undefined && !policy.allowedConnectionRefs.includes(grant.connectionRef)) {
        decisions.push(denied(grant, "CONNECTION_NOT_ALLOWED", "Connection reference is not allowlisted by the run policy."));
        continue;
      }

      const policyRequiresApproval = policy.requiredApprovalRiskClasses.includes(manifest.risk);
      if (policyRequiresApproval && grant.approvalMode !== "required") {
        decisions.push(denied(grant, "APPROVAL_REQUIRED", "The policy requires explicit approval for this risk class."));
        continue;
      }

      const approvalRequired = policyRequiresApproval || grant.approvalMode === "required";
      if (approvalRequired) {
        const approval = matchingApproval(approvals, grant);
        if (!approval) {
          const stale = approvals.some((candidate) => candidate.capabilityId === grant.capabilityId && candidate.version === grant.version);
          decisions.push(stale
            ? decision(grant, "denied", "APPROVAL_STALE", "An approval exists, but it does not match this grant.")
            : decision(grant, "approval_required", "APPROVAL_REQUIRED", "Explicit approval is required before this capability can run."));
          continue;
        }
        if (approval.decision === "denied") {
          decisions.push(denied(grant, "APPROVAL_DENIED", "The capability approval was denied."));
          continue;
        }
        if (Date.parse(approval.expiresAt) <= now) {
          decisions.push(denied(grant, "APPROVAL_EXPIRED", "The capability approval has expired."));
          continue;
        }
        resolved.push({ manifest, grant, approval: "approved" });
        decisions.push({ ...decision(grant, "granted", "GRANTED", "Capability is enabled for this run.") });
        continue;
      }

      resolved.push({ manifest, grant, approval: "not_required" });
      decisions.push({ ...decision(grant, "granted", "GRANTED", "Capability is enabled for this run.") });
    }

    return freeze({ policy, grants: resolved, decisions });
  }
}

function matchingApproval(approvals: readonly CapabilityApproval[], grant: CapabilityGrant): CapabilityApproval | undefined {
  return approvals.find((approval) => (
    approval.capabilityId === grant.capabilityId
    && approval.version === grant.version
    && approval.decision !== "denied"
    && sameItems(approval.allowedOperations, grant.allowedOperations)
    && approval.connectionRef === grant.connectionRef
  )) ?? approvals.find((approval) => (
    approval.capabilityId === grant.capabilityId
    && approval.version === grant.version
    && approval.decision === "denied"
    && sameItems(approval.allowedOperations, grant.allowedOperations)
    && approval.connectionRef === grant.connectionRef
  ));
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertNoDuplicateGrants(grants: readonly CapabilityGrant[]): void {
  const seen = new Set<string>();
  for (const grant of grants) {
    const key = manifestKey(grant.capabilityId, grant.version);
    if (seen.has(key)) throw new CapabilityRegistrationError(`Run contains duplicate capability grants: ${key}`);
    seen.add(key);
  }
}

function assertNoDuplicateApprovals(approvals: readonly CapabilityApproval[]): void {
  const seen = new Set<string>();
  for (const approval of approvals) {
    if (seen.has(approval.decisionId)) throw new CapabilityRegistrationError(`Run contains duplicate approval decisions: ${approval.decisionId}`);
    seen.add(approval.decisionId);
  }
}

function denied(grant: CapabilityGrant, code: Exclude<CapabilityResolutionCode, "GRANTED" | "APPROVAL_STALE">, message: string): CapabilityResolutionDecision {
  return decision(grant, "denied", code, message);
}

function decision(
  grant: CapabilityGrant,
  status: CapabilityResolutionDecision["status"],
  code: CapabilityResolutionCode,
  message: string,
): CapabilityResolutionDecision {
  return {
    capabilityId: grant.capabilityId,
    version: grant.version,
    status,
    code,
    message,
  };
}

function manifestKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function parseNow(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Capability resolver clock must return an ISO timestamp.");
  return parsed;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}
