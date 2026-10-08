import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CapabilityProfile } from "../catalog.js";
import type { HostedToolContribution } from "./contracts.js";
import { digest, type PackageIdentity } from "./package-utils.js";
import { skillContributions } from "./skills.js";
import { loadMcpSource, loadHttpSource } from "./connected-sources.js";
import type { UntrustedSkillContextText } from "../skills/contracts.js";

export interface CapabilityPackageSummary extends PackageIdentity { readonly source: "skills" | "mcp" | "http"; readonly digest: string; readonly connectionRef?: string; readonly unavailableReason?: string; readonly tools: readonly string[]; readonly skills: readonly { name: string; description: string; digest: string }[] }
export interface LoadedCapabilityPackages { readonly tools: HostedToolContribution[]; readonly profiles: CapabilityProfile[]; readonly packages: CapabilityPackageSummary[]; readonly resolveSkillContexts: (ids: readonly string[]) => Promise<UntrustedSkillContextText[]> }
export interface PackageConnectionResolver {
  binding(ref: string): Promise<{ connection: NonNullable<HostedToolContribution["descriptor"]["connection"]>; resolveHeaders(signal: AbortSignal): Promise<Readonly<Record<string, string>>> }>;
  summary(ref: string): Promise<{ status: string }>;
}

/** Loads trusted server configuration. Model/browser input must never be passed here. */
export async function loadCapabilityPackages(configPath: string, options: { connections?: PackageConnectionResolver; allowUnavailable?: boolean } = {}): Promise<LoadedCapabilityPackages> {
  const bytes = await readFile(configPath); if (bytes.length > 256 * 1024) throw new Error("Capability package configuration exceeds 262144 bytes.");
  const config: unknown = JSON.parse(bytes.toString("utf8"));
  if (!record(config) || config.schemaVersion !== 1 || !Array.isArray(config.packages) || config.packages.length < 1 || config.packages.length > 32) throw new Error("Capability package configuration requires schemaVersion 1 and 1 to 32 packages.");
  exactKeys(config, ["schemaVersion", "packages", "profiles", "connections"]);
  const tools: HostedToolContribution[] = []; const profiles: CapabilityProfile[] = []; const packages: CapabilityPackageSummary[] = []; const ids = new Set<string>();
  const skillResolvers = new Map<string, (names: readonly string[]) => Promise<UntrustedSkillContextText[]>>();
  // Until admission succeeds, the loader owns every discovered connection. A
  // later invalid package/profile must not leak earlier MCP sessions.
  const cleanups = new Set<() => Promise<void>>();
  try {
  for (const value of config.packages) {
    if (!record(value) || typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(value.id) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error("Every package requires a safe id and exact semantic version.");
    if (ids.has(value.id)) throw new Error(`Package id is duplicated: ${value.id}.`); ids.add(value.id);
    const fields: Record<string, string[]> = { skills: ["root"], mcp: ["endpoint", "tools", "protocolVersion", "headersEnv", "trustedContext", "connectionRef"], http: ["baseUrl", "operations", "headersEnv", "connectionRef"] };
    if (value.source === "workspace") throw new Error("Native workspace packages are no longer supported. Start the optional document provider and migrate this package to source mcp; the provider owns filesystem storage.");
    if (typeof value.source !== "string" || !fields[value.source]) throw new Error("Package source must be skills, mcp or http.");
    exactKeys(value, ["id", "version", "source", ...fields[value.source]]);
    const identity = { id: value.id, version: value.version }; let contributions: HostedToolContribution[]; let skills: CapabilityPackageSummary["skills"] = []; let unavailableReason: string | undefined;
    try {
    const connected = value.connectionRef === undefined ? {} : await packageConnection(value.connectionRef, options.connections);
    if (value.source === "skills") {
      const result = await skillContributions(identity, root(value.root, configPath)); contributions = result.tools; skills = result.skills;
      skillResolvers.set(identity.id, result.resolveSkillContexts);
    } else if (value.source === "mcp") {
      if (typeof value.endpoint !== "string") throw new Error("MCP package requires a configured endpoint.");
      contributions = await loadMcpSource({ ...identity, ...connected, endpoint: value.endpoint, ...(typeof value.protocolVersion === "string" ? { protocolVersion: value.protocolVersion } : {}), ...(value.tools !== undefined ? { tools: value.tools as Parameters<typeof loadMcpSource>[0]["tools"] } : {}), headers: headers(value.headersEnv), ...(value.trustedContext !== undefined ? { trustedContext: value.trustedContext as "session" } : {}) });
    } else if (value.source === "http") {
      if (typeof value.baseUrl !== "string" || !Array.isArray(value.operations)) throw new Error("HTTP package requires baseUrl and explicit operations.");
      contributions = loadHttpSource({ ...identity, ...connected, baseUrl: value.baseUrl, operations: value.operations as Parameters<typeof loadHttpSource>[0]["operations"], headers: headers(value.headersEnv) });
    } else throw new Error("Package source must be skills, mcp or http.");
    } catch (error) {
      if (!options.allowUnavailable || value.source === "skills") throw error;
      // Optional remote availability never prevents local startup. Do not expose
      // transport error strings, which may contain source credential material.
      unavailableReason = `Source ${identity.id} is unavailable. Check its connection and refresh the catalog.`;
      contributions = [];
    }
    for (const contribution of contributions) if (contribution.close) cleanups.add(contribution.close);
    for (const tool of contributions) if (tools.some((existing) => existing.descriptor.definition.name === tool.descriptor.definition.name)) throw new Error(`Tool name collision: ${tool.descriptor.definition.name}.`);
    tools.push(...contributions); profiles.push({ ...profile(identity, contributions), ...(unavailableReason ? { unavailableReason } : {}) });
    packages.push({ ...identity, ...(typeof value.connectionRef === "string" ? { connectionRef: value.connectionRef } : {}), ...(unavailableReason ? { unavailableReason } : {}), source: value.source as CapabilityPackageSummary["source"], digest: digest(JSON.stringify(contributions.map((tool) => tool.descriptor))), tools: contributions.map((tool) => tool.descriptor.definition.name), skills });
  }
  if (config.profiles !== undefined) {
    if (!Array.isArray(config.profiles) || config.profiles.length > 32) throw new Error("Composed profiles must be an array of at most 32 entries.");
    for (const value of config.profiles) {
      if (!record(value) || typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(value.id) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error("Composed profiles require a safe id and exact semantic version.");
      exactKeys(value, ["id", "version", "packages"]);
      const selections = stringArray(value.packages, "profile packages");
      if (!selections.length || new Set(selections).size !== selections.length || selections.some((id) => !ids.has(id))) throw new Error("Composed profiles require distinct known package ids.");
      if (profiles.some((profile) => profile.id === value.id)) throw new Error(`Profile id is duplicated: ${value.id}.`);
      const unavailableReason = profiles.find(profile => selections.includes(profile.id) && profile.unavailableReason)?.unavailableReason;
      profiles.push({ ...profile({ id: value.id, version: value.version }, tools.filter((tool) => selections.includes(tool.descriptor.source.id))), ...(unavailableReason ? { unavailableReason } : {}) });
    }
  }
  const resolveSkillContexts = async (requestedIds: readonly string[]): Promise<UntrustedSkillContextText[]> => {
    if (!Array.isArray(requestedIds) || requestedIds.length > 64 || new Set(requestedIds).size !== requestedIds.length) throw new Error("Explicit skill selection requires at most 64 distinct catalog IDs.");
    return Promise.all(requestedIds.map(async (id) => {
      const index = id.indexOf(":"); const packageId = id.slice(0, index); const name = id.slice(index + 1); const resolver = skillResolvers.get(packageId);
      if (index < 1 || !resolver || !packages.some(value => value.id === packageId && value.skills.some(skill => skill.name === name))) throw new Error("Selected skill is not in the configured package catalog.");
      return (await resolver([name]))[0];
    }));
  };
  return { tools, profiles, packages, resolveSkillContexts };
  } catch (error) {
    await Promise.allSettled([...cleanups].map(close => close()));
    throw error;
  }
}
async function packageConnection(ref: unknown, connections?: PackageConnectionResolver) {
  if (typeof ref !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(ref) || !connections) throw new Error("Package connection is not configured.");
  if ((await connections.summary(ref)).status !== "available") throw new Error("Package connection requires authorization or refresh.");
  return connections.binding(ref);
}
function root(value: unknown, configPath: string): string { if (typeof value !== "string" || !value) throw new Error("Package root must be a configured path."); return resolve(dirname(configPath), value); }
function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("headersEnv must map header names to environment references.");
  const result: Record<string, string> = {};
  for (const [name, reference] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || typeof reference !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(reference)) throw new Error("Invalid credential header environment reference.");
    const secret = process.env[reference]; if (!secret || secret.includes("\r") || secret.includes("\n")) throw new Error(`Required credential environment reference is unavailable: ${reference}.`);
    result[name] = secret;
  }
  return result;
}
function stringArray(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.length > 32 || !value.every((item) => typeof item === "string")) throw new Error(`${label} must be a bounded array of strings.`); return value; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void { const unknown = Object.keys(value).find((key) => !allowed.includes(key)); if (unknown) throw new Error(`Unsupported capability package configuration field: ${unknown}.`); }
function profile(identity: PackageIdentity, tools: readonly HostedToolContribution[]): CapabilityProfile {
  const definitions = tools.map((tool) => tool.descriptor.definition);
  return { id: identity.id, version: identity.version, displayName: identity.id, description: `Tools selected by ${identity.id}.`, policy: { schemaVersion: 1, policyId: identity.id, version: identity.version, allowedCapabilityIds: definitions.map((definition) => definition.name), allowedRiskClasses: ["pure", "read", "write", "external"], requiredApprovalRiskClasses: [], allowedConnectionRefs: [...new Set(tools.flatMap(tool => tool.descriptor.connection ? [tool.descriptor.connection.ref] : []))], maxTimeoutMs: 120_000, maxInputBytes: 1_048_576, maxOutputBytes: 1_048_576 }, grants: tools.map(({ descriptor: { definition, source, connection } }) => ({ schemaVersion: 1, capabilityId: definition.name, version: source.version, enabled: true, allowedOperations: ["execute"], ...(connection ? { connectionRef: connection.ref } : {}), approvalMode: definition.approvalMode === "invocation" ? "invocation" : definition.approvalMode === "automatic" ? "none" : definition.riskClass === "write" || definition.riskClass === "external" ? "required" : "none", timeoutMs: definition.limits.timeoutMs, maxInputBytes: definition.limits.maxArgumentBytes, maxOutputBytes: definition.limits.maxResultBytes })) };
}
