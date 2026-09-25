import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SAFETY_CONFIG, SafetyConfigError, parseSafetyConfig } from "../dist/index.js";

test("safety config defaults to deny and a bounded checkpoint", () => {
  assert.deepEqual(parseSafetyConfig(), DEFAULT_SAFETY_CONFIG);
  assert.deepEqual(parseSafetyConfig({ defaultDecision: "approval-required", maxCheckpointBytes: 1 }), {
    defaultDecision: "approval-required",
    maxCheckpointBytes: 1,
  });
});

test("safety config rejects invalid values and types", () => {
  assert.throws(() => parseSafetyConfig(null), SafetyConfigError);
  assert.throws(() => parseSafetyConfig({ defaultDecision: null }), /defaultDecision/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: null }), /maxCheckpointBytes/);
  assert.throws(() => parseSafetyConfig({ defaultDecision: "maybe" }), /defaultDecision/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: 0 }), /maxCheckpointBytes/);
  assert.throws(() => parseSafetyConfig({ maxCheckpointBytes: "512" }), /maxCheckpointBytes/);
  assert.throws(() => parseSafetyConfig({ other: false }), /Unknown/);
});
