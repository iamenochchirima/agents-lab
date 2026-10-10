import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityCatalog, DEFAULT_CAPABILITY_MANIFESTS, DEFAULT_CAPABILITY_PROFILES, builtinToolDescriptors, createDefaultCapabilityCatalog } from "../../src/capabilities/catalog.js";
import { capabilityInventoryContext } from "../../src/capabilities/inventory.js";
import { createProjectedToolRegistry } from "../../src/capabilities/extensions/projection.js";
import { createRuntimeToolRegistry } from "../../src/capabilities/extensions/runtime.js";
import { projectToolResult, toolResultEvidence } from "../../src/capabilities/tools/result-projection.js";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";

test("retained schema-v1 built-in manifests execute without new catalog or effect fields", async () => {
  const retained = JSON.parse(JSON.stringify(buildRunManifest({
    platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Add two numbers." },
    model: { provider: "fake", model: "fake-tool-call" },
    capabilities: { tools: { enabledNames: ["calculator"], maxCalls: 1, maxRounds: 2 } },
  }, { runId: "legacy-schema-one" })));
  assert.equal(retained.schemaVersion, 1);
  assert.equal(retained.capabilities.toolCatalog, undefined);
  assert.equal(retained.capabilities.approvals, undefined);
  const registry = createRuntimeToolRegistry(retained.capabilities.tools, retained.capabilities.toolCatalog);
  const call = registry.validateCall({ toolCallId: "legacy-calculator", name: "calculator", round: 1,
    arguments: { operation: "add", left: 17, right: 25 } });
  assert.equal(call.accepted, true);
  if (!call.accepted) return;
  assert.equal(call.definition.approvalMode, undefined);
  const result = await registry.execute(call, { runId: retained.runId, turnId: "legacy-turn", signal: new AbortController().signal });
  assert.equal(result.status, "completed");
  assert.deepEqual(JSON.parse(projectToolResult(result).content), { value: 42 });
  assert.equal(result.effect, undefined, "Legacy completion must not invent confirmed business effects");
  assert.equal(toolResultEvidence(result).effect, undefined);
});

test("default capability profiles are server-owned and resolve read-only grants", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z");
  assert.deepEqual(catalog.list().map((profile) => profile.id), ["local-safe", "local-write-approved", "local-mcp-safe"]);
  const resolved = catalog.resolve("local-safe");
  assert.deepEqual(resolved.resolution.grants.map(({ manifest }) => manifest.id), ["calculator", "fixture_lookup"]);
  assert.deepEqual(resolved.skills.map((skill) => skill.manifest.id), ["research-summary"]);
  assert.deepEqual(catalog.list()[0]?.skills.map((skill) => skill.id), ["research-summary"]);
  assert.ok(resolved.resolution.grants.every(({ approval }) => approval === "not_required"));
  assert.equal(resolved.resolution.decisions.every((decision) => decision.status === "granted"), true);
});

test("capability inventory contains only the selected profile tools and scoped skill metadata", () => {
  const skill = { id: "notes:review", version: "2.0.0", name: "review-notes", description: "Check existing notes before editing.", digest: "a".repeat(64) };
  const profiles = DEFAULT_CAPABILITY_PROFILES.map(profile => profile.id === "local-safe"
    ? { ...profile, availableSkills: [skill] }
    : profile);
  const catalog = new CapabilityCatalog(DEFAULT_CAPABILITY_MANIFESTS, profiles, undefined, undefined, { toolDescriptors: builtinToolDescriptors() });
  const resolved = catalog.resolve("local-safe");
  const toolCatalog = catalog.toolSnapshot(["calculator", "fixture_lookup"], resolved.resolution);
  const preloadedSkills = resolved.skills.map(value => ({
    id: value.manifest.id,
    version: value.manifest.version,
    name: value.manifest.name,
    description: value.manifest.description,
    digest: value.manifest.provenance.digest,
  }));
  const inventory = catalog.inventory(resolved.profile, toolCatalog, preloadedSkills);
  const context = capabilityInventoryContext(inventory);

  assert.deepEqual(inventory.sources.flatMap(source => source.tools.map(tool => tool.name)).sort(), ["calculator", "fixture_lookup"]);
  assert.equal(inventory.toolCatalogRevision, toolCatalog.revision);
  assert.deepEqual(inventory.skills.map(value => [value.id, value.activation]), [["research-summary", "preloaded"], ["notes:review", "available"]]);
  assert.match(context, /review-notes/);
  assert.match(context, /Check existing notes before editing/);
  assert.match(context, /metadata only/);
  assert.match(context, new RegExp(toolCatalog.revision));
  assert.doesNotMatch(JSON.stringify(inventory), /https?:\/\//);
  assert.doesNotMatch(context, /fixture_write/);
  assert.equal(catalog.inventory(resolved.profile, toolCatalog, preloadedSkills).revision, inventory.revision);
  assert.notEqual(catalog.inventory(resolved.profile, { ...toolCatalog, revision: `${toolCatalog.revision}-changed` }, preloadedSkills).revision, inventory.revision);
});

test("the MCP profile keeps server-owned tool selection separate from the direct fixture", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z");
  const resolved = catalog.resolve("local-mcp-safe");
  const grant = resolved.resolution.grants.find(({ manifest }) => manifest.id === "mcp_fixture_lookup");
  assert.ok(grant);
  assert.deepEqual(grant.manifest.mcp, {
    endpointRef: "local-fixture-mcp",
    serverName: "agentlab-local-mcp",
    protocolVersion: "2025-06-18",
    toolName: "fixture.lookup",
    toolVersion: "1.0.0",
  });
  assert.equal(grant.grant.connectionRef, "conn_local_mcp_fixture");
});

test("write profile fails closed until a matching unexpired approval is supplied", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z");
  const pending = catalog.resolve("local-write-approved");
  assert.equal(pending.resolution.grants.some(({ manifest }) => manifest.id === "fixture_write"), false);
  assert.equal(pending.resolution.decisions.find(({ capabilityId }) => capabilityId === "fixture_write")?.code, "APPROVAL_REQUIRED");

  const approved = catalog.resolve("local-write-approved", [{
    schemaVersion: 1,
    decisionId: "approval_fixture_write_1",
    capabilityId: "fixture_write",
    version: "1.0.0",
    connectionRef: "conn_local_fixture",
    allowedOperations: ["write"],
    decision: "approved",
    decidedAt: "2026-09-19T23:59:00.000Z",
    expiresAt: "2026-09-20T00:05:00.000Z",
  }]);
  assert.equal(approved.resolution.grants.some(({ manifest }) => manifest.id === "fixture_write"), true);
});

test("rollback mode exposes connected profiles as unavailable and fails closed on resolution", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z", { connectedEnabled: false });
  const localSafe = catalog.list().find((profile) => profile.id === "local-safe");
  assert.equal(localSafe?.available, false);
  assert.match(localSafe?.unavailableReason ?? "", /rollback switch/);
  assert.throws(() => catalog.resolve("local-safe"), /rollback switch/);
});

test("catalog snapshots freeze effective limits and validate native arguments without coercion", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z");
  const resolution = catalog.resolve("local-safe").resolution;
  const snapshot = catalog.toolSnapshot(["calculator"], resolution);
  assert.ok(Object.isFrozen(snapshot.tools[0]?.definition.limits));
  assert.equal(snapshot.revision, catalog.toolSnapshot(["calculator"], resolution).revision);
  const registry = createProjectedToolRegistry({ enabledNames: ["calculator"] }, snapshot);
  assert.equal(registry.validateCall({ toolCallId: "bad", name: "calculator", round: 1, arguments: {operation: "add", left: "2", right: 3} }).accepted, false);
  assert.equal(registry.validateCall({ toolCallId: "good", name: "calculator", round: 1, arguments: {operation: "add", left: 2, right: 3} }).accepted, true);
  assert.throws(() => catalog.toolSnapshot(["unregistered"]), /absent/);
});

test("catalog rejects colliding declarations and unresolved remote schemas at registration", () => {
  const descriptor = builtinToolDescriptors()[0]!;
  assert.throws(() => new CapabilityCatalog([], [], undefined, undefined, { toolDescriptors: [descriptor, descriptor] }), /Duplicate catalog tool/);
  assert.throws(() => new CapabilityCatalog([], [], undefined, undefined, { toolDescriptors: [{...descriptor, definition: {...descriptor.definition, inputSchema: { $ref: "https://invalid.example/schema" }}}] }), /resolve reference/);
});
