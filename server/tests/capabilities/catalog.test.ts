import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCapabilityCatalog } from "../../src/capabilities/catalog.js";

test("default capability profiles are server-owned and resolve read-only grants", () => {
  const catalog = createDefaultCapabilityCatalog(() => "2026-09-20T00:00:00.000Z");
  assert.deepEqual(catalog.list().map((profile) => profile.id), ["local-safe", "local-write-approved"]);
  const resolved = catalog.resolve("local-safe");
  assert.deepEqual(resolved.resolution.grants.map(({ manifest }) => manifest.id), ["calculator", "fixture_lookup"]);
  assert.deepEqual(resolved.skills.map((skill) => skill.manifest.id), ["research-summary"]);
  assert.deepEqual(catalog.list()[0]?.skills.map((skill) => skill.id), ["research-summary"]);
  assert.ok(resolved.resolution.grants.every(({ approval }) => approval === "not_required"));
  assert.equal(resolved.resolution.decisions.every((decision) => decision.status === "granted"), true);
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
