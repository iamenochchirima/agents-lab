import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OBSERVABILITY_CONFIG, ObservabilityConfigError, parseObservabilityConfig } from "../dist/index.js";

test("observability config supplies bounded buffer defaults", () => {
  assert.deepEqual(parseObservabilityConfig(), DEFAULT_OBSERVABILITY_CONFIG);
  assert.deepEqual(parseObservabilityConfig({ maxBufferedEvents: 5, flushEveryEvents: 5, maxModuleDetailBytes: 0 }), {
    maxBufferedEvents: 5,
    maxBufferedBytes: DEFAULT_OBSERVABILITY_CONFIG.maxBufferedBytes,
    flushEveryEvents: 5,
    maxEventBytes: DEFAULT_OBSERVABILITY_CONFIG.maxEventBytes,
    maxModuleDetailBytes: 0,
    maxTrackedEvents: DEFAULT_OBSERVABILITY_CONFIG.maxTrackedEvents,
    maxStoredBytes: DEFAULT_OBSERVABILITY_CONFIG.maxStoredBytes,
  });
});

test("observability config rejects invalid bounds, types, and relationships", () => {
  assert.throws(() => parseObservabilityConfig(null), ObservabilityConfigError);
  assert.throws(() => parseObservabilityConfig({ maxBufferedEvents: null }), /maxBufferedEvents/);
  assert.throws(() => parseObservabilityConfig({ maxBufferedBytes: null }), /maxBufferedBytes/);
  assert.throws(() => parseObservabilityConfig({ flushEveryEvents: null }), /flushEveryEvents/);
  assert.throws(() => parseObservabilityConfig({ maxEventBytes: null }), /maxEventBytes/);
  assert.throws(() => parseObservabilityConfig({ maxModuleDetailBytes: null }), /maxModuleDetailBytes/);
  assert.throws(() => parseObservabilityConfig({ maxTrackedEvents: null }), /maxTrackedEvents/);
  assert.throws(() => parseObservabilityConfig({ maxStoredBytes: null }), /maxStoredBytes/);
  assert.throws(() => parseObservabilityConfig({ maxBufferedEvents: 0 }), /maxBufferedEvents/);
  assert.throws(() => parseObservabilityConfig({ flushEveryEvents: 1001 }), /must not exceed/);
  assert.throws(() => parseObservabilityConfig({ maxEventBytes: 9000, maxBufferedBytes: 8000 }), /maxEventBytes/);
  assert.throws(() => parseObservabilityConfig({ maxTrackedEvents: 1, maxBufferedEvents: 2, flushEveryEvents: 2 }), /at least/);
  assert.throws(() => parseObservabilityConfig({ maxStoredBytes: 1 }), /fit at least/);
  assert.throws(() => parseObservabilityConfig({ maxModuleDetailBytes: "10" }), /maxModuleDetailBytes/);
  assert.throws(() => parseObservabilityConfig({ extra: 1 }), /Unknown/);
});
