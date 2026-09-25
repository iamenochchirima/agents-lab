import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OUTPUT_ACTIONS_CONFIG, OutputActionsConfigError, parseOutputActionsConfig } from "../dist/index.js";

test("output actions config supplies bounded, idempotent delivery defaults", () => {
  assert.deepEqual(parseOutputActionsConfig(), DEFAULT_OUTPUT_ACTIONS_CONFIG);
  assert.deepEqual(parseOutputActionsConfig({ maxPayloadBytes: 1, requireIdempotencyKey: false }), {
    maxPayloadBytes: 1,
    requireIdempotencyKey: false,
  });
});

test("output actions config rejects invalid bounds and types", () => {
  assert.throws(() => parseOutputActionsConfig(null), OutputActionsConfigError);
  assert.throws(() => parseOutputActionsConfig({ maxPayloadBytes: null }), /maxPayloadBytes/);
  assert.throws(() => parseOutputActionsConfig({ requireIdempotencyKey: null }), /requireIdempotencyKey/);
  assert.throws(() => parseOutputActionsConfig({ maxPayloadBytes: 0 }), /maxPayloadBytes/);
  assert.throws(() => parseOutputActionsConfig({ maxPayloadBytes: "256" }), /maxPayloadBytes/);
  assert.throws(() => parseOutputActionsConfig({ requireIdempotencyKey: "yes" }), /requireIdempotencyKey/);
  assert.throws(() => parseOutputActionsConfig({ unknown: true }), /Unknown/);
});
