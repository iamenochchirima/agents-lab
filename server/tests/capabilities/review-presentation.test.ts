import test from "node:test";
import assert from "node:assert/strict";
import type { RunManifest } from "../../src/control-plane/domain/types.js";
import type { InvocationReviewView } from "../../src/capabilities/reviews/contracts.js";
import { presentInvocationReview } from "../../src/capabilities/reviews/presentation.js";

const review: InvocationReviewView = {
  schemaVersion: 1, requestId: "request", revision: 2, runId: "run", turnId: "turn",
  call: { name: "unfamiliar_adjust", toolCallId: "call", round: 1 }, catalogRevision: "frozen-catalog",
  sourceDigest: "frozen-source", connectionIdentity: "protected-identity", argumentDigest: "arguments",
  displayArguments: { record_key: "safe-record", raw_field: "value" },
  createdAt: "2026-10-10T00:00:00Z", expiresAt: "2026-10-11T00:00:00Z", status: "pending", decision: null,
};
const manifest: Pick<RunManifest, "capabilities"> = { capabilities: {
  tools: { enabledNames: [review.call.name], maxRounds: 6, maxCalls: 8 },
  toolCatalog: { schemaVersion: 1, revision: "frozen-catalog", tools: [{
    source: { id: "fixture:unfamiliar", version: "3.1", digest: "frozen-source" },
    execution: { kind: "hosted", key: "private-routing-key" }, failurePolicy: "terminal",
    connection: { ref: "private-connection", authorityRevision: "private-revision", resource: "private-resource", scopes: ["private-scope"] },
    definition: { schemaVersion: 1, name: review.call.name, description: "Adjust the selected record.",
      inputSchema: { properties: { record_key: { title: "Record identifier", default: "private-default" }, raw_field: { description: "Do not derive a label from descriptions." } } },
      riskClass: "write", executionKind: "connection", limits: { maxArgumentBytes: 1000, maxResultBytes: 1000, timeoutMs: 1000 } },
  }] },
} };
test("safe generic presentation uses the frozen descriptor and explicit schema titles only", () => {
  const projected = presentInvocationReview(review, manifest);
  assert.deepEqual(projected.presentation, { displayName: "unfamiliar_adjust", description: "Adjust the selected record.", source: { id: "fixture:unfamiliar", version: "3.1" }, risk: "write", argumentLabels: { record_key: "Record identifier" } });
  assert.equal(projected.argumentDigest, review.argumentDigest);
  assert.equal(projected.revision, review.revision);
  assert.equal(projected.decision, review.decision);
  assert.doesNotMatch(JSON.stringify(projected.presentation), /private-/);
});
test("older snapshots and mismatched retained identities keep their original fallback", () => {
  assert.equal(presentInvocationReview(review, {}), review);
  assert.equal(presentInvocationReview({ ...review, sourceDigest: "different-source" }, manifest).presentation, undefined);
  assert.equal(presentInvocationReview({ ...review, catalogRevision: "different-catalog" }, manifest).presentation, undefined);
});
test("presentation descriptions and labels are bounded plain text", () => {
  const catalog = manifest.capabilities!.toolCatalog!;
  const descriptor = catalog.tools[0]!;
  const projected = presentInvocationReview(review, { capabilities: { ...manifest.capabilities!, toolCatalog: { ...catalog, tools: [{ ...descriptor, definition: { ...descriptor.definition, description: "x".repeat(1000), inputSchema: { properties: { record_key: { title: `Record\n${"x".repeat(200)}` } } } } }] } } });
  assert.equal(projected.presentation!.description.length, 600);
  assert.equal(projected.presentation!.argumentLabels.record_key!.length, 120);
  assert.doesNotMatch(projected.presentation!.argumentLabels.record_key!, /\n/);
});
test("admitted capability display name overrides the callable identifier", () => {
  const projected = presentInvocationReview(review, { capabilities: { ...manifest.capabilities!, resolution: {
    policy: { schemaVersion: 1, policyId: "policy", version: "1", allowedCapabilityIds: [review.call.name], allowedRiskClasses: ["write"], requiredApprovalRiskClasses: ["write"], allowedConnectionRefs: [], maxTimeoutMs: 1000, maxInputBytes: 1000, maxOutputBytes: 1000 },
    decisions: [], grants: [{
      approval: "invocation_required",
      manifest: { schemaVersion: 1, id: review.call.name, version: "1", kind: "connection", displayName: "Adjust a record", description: "Capability description", risk: "write", operations: ["adjust"], requiredScopes: [], source: { kind: "connection", ref: "private-reference" } },
      grant: { schemaVersion: 1, capabilityId: review.call.name, version: "1", enabled: true, allowedOperations: ["adjust"], approvalMode: "invocation", timeoutMs: 1000, maxInputBytes: 1000, maxOutputBytes: 1000 },
    }],
  } } });
  assert.equal(projected.presentation!.displayName, "Adjust a record");
  assert.equal(projected.call.name, "unfamiliar_adjust");
  assert.doesNotMatch(JSON.stringify(projected.presentation), /private-reference/);
});
