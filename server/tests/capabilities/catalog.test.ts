import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityCatalog, builtinToolDescriptors, createDefaultCapabilityCatalog } from "../../src/capabilities/catalog.js";
import { createProjectedToolRegistry } from "../../src/capabilities/extensions/projection.js";

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
