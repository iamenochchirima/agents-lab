import {
  CapabilityCatalog, DEFAULT_CAPABILITY_MANIFESTS, DEFAULT_CAPABILITY_PROFILES,
  builtinToolDescriptors,
} from "../catalog.js";
import type { JsonObject } from "../contracts.js";
import type { LoadedCapabilityPackages } from "./packages.js";

/** Compose source contributions with existing policy profiles, never executable plugins. */
export function createPackageCapabilityCatalog(packages: LoadedCapabilityPackages, connectedEnabled = true): CapabilityCatalog {
  const manifests = packages.tools.map(({ descriptor }) => ({
    schemaVersion: 1 as const,
    id: descriptor.definition.name,
    version: descriptor.source.version,
    kind: "tool" as const,
    displayName: descriptor.definition.name,
    description: descriptor.definition.description,
    risk: descriptor.definition.riskClass,
    operations: ["execute"],
    inputSchema: descriptor.definition.inputSchema as JsonObject,
    requiredScopes: descriptor.connection?.scopes ?? [],
    source: { kind: "package" as const, ref: descriptor.source.id, digest: descriptor.source.digest },
  }));
  const profiles = packages.profiles.map(profile => ({
    ...profile,
    supportedVariants: ["mastra/baseline", "langgraph/baseline", "temporal/baseline", "restate/baseline"],
    availableSkills: packages.packages
      .filter(pkg => pkg.tools.some(name => profile.grants.some(grant => grant.capabilityId === name)))
      .flatMap(pkg => pkg.skills.map(skill => ({ id: `${pkg.id}:${skill.name}`, version: pkg.version, ...skill }))),
  }));
  return new CapabilityCatalog(
    [...DEFAULT_CAPABILITY_MANIFESTS, ...manifests],
    [...DEFAULT_CAPABILITY_PROFILES, ...profiles],
    undefined, undefined,
    { connectedEnabled, toolDescriptors: [...builtinToolDescriptors(), ...packages.tools.map(tool => tool.descriptor)], skillResolver: packages.resolveSkillContexts },
  );
}
