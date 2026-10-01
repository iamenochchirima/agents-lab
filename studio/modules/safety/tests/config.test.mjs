import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SAFETY_CONFIG, SafetyConfigError, parseSafetyConfig } from "../dist/index.js";

test("safety config defaults to deny and a bounded checkpoint", () => {
  assert.deepEqual(parseSafetyConfig(), DEFAULT_SAFETY_CONFIG);
  const calculator = { id: "calculator", version: "1.0.0", kind: "pure", operations: ["add"] };
  assert.deepEqual(parseSafetyConfig({ defaultDecision: "approval-required", maxCheckpointBytes: 1, allowedToolCapabilities: [calculator] }), {
    defaultDecision: "approval-required",
    maxCheckpointBytes: 1,
    allowedToolCapabilities: [calculator],
    allowedEnvironmentCapabilities: [],
    allowedOutputActionKinds: [],
    allowedMemoryWriteKinds: [],
    allowedEnvironmentCapabilities: [],
    allowedOutputActionKinds: [],
  });
});

test("safety config rejects invalid values and types", () => {
  assert.throws(() => parseSafetyConfig(null), SafetyConfigError);
  assert.throws(() => parseSafetyConfig({ defaultDecision: null }), /defaultDecision/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: null }), /maxCheckpointBytes/);
  assert.throws(() => parseSafetyConfig({ defaultDecision: "maybe" }), /defaultDecision/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: 0 }), /maxCheckpointBytes/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: "512" }), /maxCheckpointBytes/);
  const calculator = { id: "calculator", version: "1.0.0", kind: "pure", operations: ["add"] };
  assert.throws(() => parseSafetyConfig({ allowedToolCapabilities: calculator }), /allowedToolCapabilities/);
  assert.throws(() => parseSafetyConfig({ allowedToolCapabilities: [{ ...calculator, kind: "write" }] }), /must be "pure"/);
  assert.throws(() => parseSafetyConfig({ allowedToolCapabilities: [{ ...calculator, operations: ["add", "add"] }] }), /must not contain duplicates/);
  assert.throws(() => parseSafetyConfig({ allowedToolCapabilities: [calculator, calculator] }), /repeat a capability ID/);
  assert.throws(() => parseSafetyConfig({ allowedEnvironmentCapabilities: [calculator] }), /must be non-pure/);
  assert.throws(() => parseSafetyConfig({ allowedEnvironmentCapabilities: [{ id: "browser", version: "1.0.0", kind: "computer", operations: ["observe", "click"] }], allowedToolCapabilities: [{ ...calculator, id: "browser" }] }), /distinct IDs/);
  assert.throws(() => parseSafetyConfig({ allowedOutputActionKinds: ["text-response", "text-response"] }), /must not contain duplicates/);
  assert.throws(() => parseSafetyConfig({ allowedToolCapabilities: Array.from({ length: 33 }, (_, index) => ({
    id: `calculator-${index}`, version: "1.0.0", kind: "pure", operations: ["add"],
  })) }), /at most 32/);
  assert.throws(() => parseSafetyConfig({ other: false }), /Unknown/);
});
