import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OBSERVABILITY_CONFIG, ObservabilityConfigError, parseObservabilityConfig } from "../dist/index.js";

test("observability config supplies bounded buffer defaults", () => {
  assert.deepEqual(parseObservabilityConfig(), DEFAULT_OBSERVABILITY_CONFIG);
  assert.deepEqual(parseObservabilityConfig({ maxBufferedEvents: 5, flushEveryEvents: 5, maxModuleDetailBytes: 0 }), {
    maxBufferedEvents: 5,
    flushEveryEvents: 5,
    maxModuleDetailBytes: 0,
  });
});

test("observability config rejects invalid bounds, types, and relationships", () => {
  assert.throws(() => parseObservabilityConfig(null), ObservabilityConfigError);
  assert.throws(() => parseObservabilityConfig({ maxBufferedEvents: null }), /maxBufferedEvents/);
  assert.throws(() => parseObservabilityConfig({ flushEveryEvents: null }), /flushEveryEvents/);
  assert.throws(() => parseObservabilityConfig({ maxModuleDetailBytes: null }), /maxModuleDetailBytes/);
  assert.throws(() => parseObservabilityConfig({ maxBufferedEvents: 0 }), /maxBufferedEvents/);
  assert.throws(() => parseObservabilityConfig({ flushEveryEvents: 1001 }), /must not exceed/);
  assert.throws(() => parseObservabilityConfig({ maxModuleDetailBytes: "10" }), /maxModuleDetailBytes/);
  assert.throws(() => parseObservabilityConfig({ extra: 1 }), /Unknown/);
});
