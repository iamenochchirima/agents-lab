import { createHash } from "node:crypto";
import type { ToolCatalogSnapshot, ResolvedToolDescriptor } from "./extensions/contracts.js";
import { legacyToolImplementations } from "./extensions/projection.js";
import { compileToolSchema } from "./extensions/schema.js";
import type { UntrustedSkillContextText } from "./skills/contracts.js";
import type {
  CapabilityApproval,
  CapabilityGrant,
  CapabilityManifest,
  CapabilityPolicy,
  CapabilityResolution,
} from "./contracts.js";
import { CapabilityRegistry, CapabilityResolver } from "./policies/index.js";
import { createDefaultSkillCatalog, type LoadedSkill, type SkillCatalog, type SkillSummary } from "./skills/index.js";

export interface CapabilityProfile {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly policy: CapabilityPolicy;
  readonly grants: readonly CapabilityGrant[];
  readonly skillIds?: readonly string[];
  /** Available on-demand through skill tools, not preloaded into the session. */
  readonly availableSkills?: readonly SkillSummary[];
  /** Native adapter targets verified for this profile. */
  readonly supportedVariants?: readonly string[];
}

export interface CapabilityProfileView extends Omit<CapabilityProfile, "policy" | "grants" | "skillIds"> {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly capabilities: readonly Pick<CapabilityManifest, "id" | "version" | "kind" | "displayName" | "description" | "risk" | "operations">[];
  readonly skills: readonly SkillSummary[];
  readonly availableSkills?: readonly SkillSummary[];
}

export interface CapabilityCatalogOptions {
  /** Rollback switch for connected and side-effecting capability profiles. */
  readonly connectedEnabled?: boolean;
  readonly toolDescriptors?: readonly ResolvedToolDescriptor[];
  readonly skillResolver?: (ids: readonly string[]) => Promise<readonly UntrustedSkillContextText[]>;
}

export interface CapabilityProfileResolution {
  readonly profile: CapabilityProfile;
  readonly resolution: CapabilityResolution;
  readonly skills: readonly LoadedSkill[];
}

/**
 * Server-owned capability profiles. The browser may select a profile, but it
 * cannot add a grant or widen its policy.
 */
export class CapabilityCatalog {
  private readonly profiles: ReadonlyMap<string, CapabilityProfile>;
  private readonly registry: CapabilityRegistry;
  private readonly resolver: CapabilityResolver;
  private readonly connectedEnabled: boolean;
  private readonly toolDescriptors: ReadonlyMap<string, ResolvedToolDescriptor>;
  private readonly skillResolver: CapabilityCatalogOptions["skillResolver"];

  constructor(
    manifests: readonly CapabilityManifest[],
    profiles: readonly CapabilityProfile[],
    now?: () => string,
    private readonly skills: SkillCatalog = createDefaultSkillCatalog(),
    options: CapabilityCatalogOptions = {},
  ) {
    this.registry = new CapabilityRegistry(manifests);
    this.resolver = new CapabilityResolver(this.registry, now);
    this.connectedEnabled = options.connectedEnabled ?? true;
    this.skillResolver = options.skillResolver;
    const descriptors = options.toolDescriptors ?? builtinToolDescriptors();
    const tools = new Map<string, ResolvedToolDescriptor>();
    for (const descriptor of descriptors) {
      if (tools.has(descriptor.definition.name)) throw new Error(`Duplicate catalog tool: ${descriptor.definition.name}`);
      compileToolSchema(descriptor.definition.inputSchema);
      tools.set(descriptor.definition.name, deepFreeze(descriptor));
    }
    this.toolDescriptors = tools;
    const values = new Map<string, CapabilityProfile>();
    for (const profile of profiles) {
      if (values.has(profile.id)) throw new Error(`Capability profile is duplicated: ${profile.id}`);
      values.set(profile.id, deepFreeze(profile));
    }
    this.profiles = values;
  }

  list(): readonly CapabilityProfileView[] {
    return [...this.profiles.values()].map((profile) => this.profileView(profile));
  }

  get(profileId: string): CapabilityProfile | undefined {
    return this.profiles.get(profileId);
  }

  resolve(profileId: string, approvals: readonly CapabilityApproval[] = []): CapabilityProfileResolution {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Capability profile is not available: ${profileId}`);
    const availability = this.profileAvailability(profile);
    if (!availability.available) throw new Error(availability.reason);
    const resolution = this.resolver.resolve({ policy: profile.policy, grants: profile.grants, approvals });
    const skills = this.skills.resolve(profile.skillIds ?? []);
    return { profile, resolution, skills };
  }

  /** Resolve full declarations once; grant limits override broader source defaults. */
  toolSnapshot(names: readonly string[], resolution?: CapabilityResolution): ToolCatalogSnapshot {
    const tools = names.map(name => {
      const descriptor = this.toolDescriptors.get(name);
      if (!descriptor) throw new Error(`Tool is absent from the configured catalog: ${name}`);
      const grant = resolution?.grants.find(item => item.manifest.id === name)?.grant;
      const limits = descriptor.definition.limits;
      return { ...descriptor, definition: { ...descriptor.definition, limits: grant ? {
        timeoutMs: Math.min(limits.timeoutMs, grant.timeoutMs),
        maxArgumentBytes: Math.min(limits.maxArgumentBytes, grant.maxInputBytes),
        maxResultBytes: Math.min(limits.maxResultBytes, grant.maxOutputBytes),
      } : limits } };
    });
    return deepFreeze({ schemaVersion: 1 as const, revision: createHash("sha256").update(JSON.stringify(tools)).digest("hex"), tools });
  }

  definitions(): readonly CapabilityManifest[] {
    return this.registry.definitions();
  }

  /** Explicit selection remains bounded by the selected profile's skill inventory. */
  async resolveRequestedSkills(profileId: string, ids: readonly string[]): Promise<readonly UntrustedSkillContextText[]> {
    const profile = this.get(profileId);
    if (!profile || ids.some(id => !profile.availableSkills?.some(skill => skill.id === id))) {
      throw new Error("Requested skill is not available in the selected capability profile.");
    }
    if (!ids.length) return [];
    if (!this.skillResolver) throw new Error("Package skill activation is not configured.");
    return this.skillResolver(ids);
  }

  private profileView(profile: CapabilityProfile): CapabilityProfileView {
    const availability = this.profileAvailability(profile);
    return {
      id: profile.id,
      version: profile.version,
      displayName: profile.displayName,
      description: profile.description,
      available: availability.available,
      unavailableReason: availability.available ? null : availability.reason,
      skills: this.skills.resolve(profile.skillIds ?? []).map((skill) => ({
        id: skill.manifest.id,
        version: skill.manifest.version,
        name: skill.manifest.name,
        description: skill.manifest.description,
        digest: skill.manifest.provenance.digest,
      })),
      ...(profile.availableSkills ? {availableSkills:profile.availableSkills} : {}),
      ...(profile.supportedVariants ? { supportedVariants: profile.supportedVariants } : {}),
      capabilities: profile.grants.flatMap((grant) => {
        const manifest = this.registry.get(grant.capabilityId, grant.version);
        return manifest ? [{
          id: manifest.id,
          version: manifest.version,
          kind: manifest.kind,
          displayName: manifest.displayName,
          description: manifest.description,
          risk: manifest.risk,
          operations: manifest.operations,
        }] : [];
      }),
    };
  }

  private profileAvailability(profile: CapabilityProfile): { readonly available: boolean; readonly reason: string } {
    if (this.connectedEnabled) return { available: true, reason: "" };
    const connected = profile.grants.some((grant) => {
      const manifest = this.registry.get(grant.capabilityId, grant.version);
      return this.toolDescriptors.get(grant.capabilityId)?.execution.kind === "hosted" || manifest?.kind === "connection" || manifest?.risk === "write" || manifest?.risk === "external";
    });
    return connected
      ? { available: false, reason: "Connected and side-effecting capabilities are disabled by the server rollback switch." }
      : { available: true, reason: "" };
  }
}

export const DEFAULT_CAPABILITY_MANIFESTS: readonly CapabilityManifest[] = Object.freeze([
  {
    schemaVersion: 1,
    id: "calculator",
    version: "1.0.0",
    kind: "tool",
    displayName: "Calculator",
    description: "Bounded deterministic arithmetic.",
    risk: "pure",
    operations: ["calculate"],
    inputSchema: { type: "object" },
    requiredScopes: [],
    source: { kind: "builtin", ref: "server/src/capabilities/tools/calculator.ts" },
  },
  {
    schemaVersion: 1,
    id: "fixture_lookup",
    version: "1.0.0",
    kind: "connection",
    displayName: "Local read fixture",
    description: "Read-only provider-shaped local data.",
    risk: "read",
    operations: ["lookup"],
    inputSchema: { type: "object" },
    requiredScopes: [],
    source: { kind: "connection", ref: "local-fixture" },
  },
  {
    schemaVersion: 1,
    id: "fixture_write",
    version: "1.0.0",
    kind: "connection",
    displayName: "Approval write fixture",
    description: "A deterministic write used to verify approval and unknown-outcome handling.",
    risk: "write",
    operations: ["write"],
    inputSchema: { type: "object" },
    requiredScopes: [],
    source: { kind: "connection", ref: "local-fixture" },
  },
  {
    schemaVersion: 1,
    id: "mcp_fixture_lookup",
    version: "1.0.0",
    kind: "connection",
    displayName: "Local MCP read fixture",
    description: "Read one value through the local Streamable HTTP MCP server.",
    risk: "read",
    operations: ["lookup"],
    inputSchema: { type: "object" },
    requiredScopes: [],
    source: { kind: "connection", ref: "local-fixture-mcp" },
    mcp: {
      endpointRef: "local-fixture-mcp",
      serverName: "agentlab-local-mcp",
      protocolVersion: "2025-06-18",
      toolName: "fixture.lookup",
      toolVersion: "1.0.0",
    },
  },
]);

export const DEFAULT_CAPABILITY_PROFILES: readonly CapabilityProfile[] = Object.freeze([
  {
    id: "local-safe",
    version: "1.0.0",
    displayName: "Local safe",
    description: "Pure tools and read-only local fixture access.",
    policy: defaultPolicy("local-safe", ["calculator", "fixture_lookup"], ["pure", "read"], [], ["conn_local_fixture"]),
    grants: [
      grant("calculator", "calculate", "none"),
      grant("fixture_lookup", "lookup", "none", "conn_local_fixture"),
    ],
    skillIds: ["research-summary"],
  },
  {
    id: "local-write-approved",
    version: "1.0.0",
    displayName: "Local write test",
    description: "Local write fixture; requires an explicit approval decision.",
    policy: defaultPolicy("local-write-approved", ["calculator", "fixture_lookup", "fixture_write"], ["pure", "read", "write"], ["write"], ["conn_local_fixture"]),
    grants: [
      grant("calculator", "calculate", "none"),
      grant("fixture_lookup", "lookup", "none", "conn_local_fixture"),
      grant("fixture_write", "write", "required", "conn_local_fixture"),
    ],
  },
  {
    id: "local-mcp-safe",
    version: "1.0.0",
    displayName: "Local MCP safe",
    description: "Pure tools and a read-only local MCP fixture.",
    policy: defaultPolicy("local-mcp-safe", ["calculator", "mcp_fixture_lookup"], ["pure", "read"], [], ["conn_local_mcp_fixture"]),
    grants: [
      grant("calculator", "calculate", "none"),
      grant("mcp_fixture_lookup", "lookup", "none", "conn_local_mcp_fixture"),
    ],
  },
]);

export function createDefaultCapabilityCatalog(now?: () => string, options?: CapabilityCatalogOptions): CapabilityCatalog {
  return new CapabilityCatalog(DEFAULT_CAPABILITY_MANIFESTS, DEFAULT_CAPABILITY_PROFILES, now, undefined, options);
}

function grant(capabilityId: string, operation: string, approvalMode: CapabilityGrant["approvalMode"], connectionRef?: string): CapabilityGrant {
  return {
    schemaVersion: 1,
    capabilityId,
    version: "1.0.0",
    enabled: true,
    allowedOperations: [operation],
    approvalMode,
    ...(connectionRef ? { connectionRef } : {}),
    timeoutMs: 10_000,
    maxInputBytes: 8_192,
    maxOutputBytes: 32_768,
  };
}

function defaultPolicy(
  policyId: string,
  allowedCapabilityIds: readonly string[],
  allowedRiskClasses: CapabilityPolicy["allowedRiskClasses"],
  requiredApprovalRiskClasses: CapabilityPolicy["requiredApprovalRiskClasses"] = [],
  allowedConnectionRefs: readonly string[] = [],
): CapabilityPolicy {
  return {
    schemaVersion: 1,
    policyId,
    version: "1.0.0",
    allowedCapabilityIds,
    allowedRiskClasses,
    requiredApprovalRiskClasses,
    allowedConnectionRefs,
    maxTimeoutMs: 30_000,
    maxInputBytes: 64 * 1024,
    maxOutputBytes: 256 * 1024,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** One registration location for existing inline tools. New connected tools are data. */
export function builtinToolDescriptors(): readonly ResolvedToolDescriptor[] {
  return legacyToolImplementations().map(tool => ({ definition: tool.definition,
    source: { id: `builtin:${tool.definition.name}`, version: "1.0.0", digest: createHash("sha256").update(JSON.stringify(tool.definition)).digest("hex") },
    execution: { kind: "builtin" as const, id: tool.definition.name }, failurePolicy: tool.definition.failurePolicy ?? "terminal",
  }));
}
