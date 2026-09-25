import assert from "node:assert/strict";
import test from "node:test";

import { createInMemorySession, DEFAULT_MEMORY_CONFIG, MemoryConfigError, parseMemoryConfig } from "../dist/index.js";

test("memory config supplies defaults and accepts bounded overrides", () => {
  assert.deepEqual(parseMemoryConfig(), DEFAULT_MEMORY_CONFIG);
  assert.deepEqual(parseMemoryConfig({ maxRecallResults: 5 }), { ...DEFAULT_MEMORY_CONFIG, maxRecallResults: 5 });
});

test("memory config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parseMemoryConfig({ maxRecords: 0 }), MemoryConfigError);
  assert.throws(() => parseMemoryConfig({ maxRecords: null }), MemoryConfigError);
  assert.throws(() => parseMemoryConfig({ maxContentBytes: "100" }), MemoryConfigError);
  assert.throws(() => parseMemoryConfig({ databaseUrl: "file.db" }), MemoryConfigError);
});

test("the Memory implementation validates config and session identity at construction", () => {
  assert.throws(() => createInMemorySession({ ownerId: "agent", sessionId: "session" }, { ...DEFAULT_MEMORY_CONFIG, maxRecords: 0 }), MemoryConfigError);
  assert.throws(() => createInMemorySession({ ownerId: "", sessionId: "session" }, DEFAULT_MEMORY_CONFIG), /ownerId and sessionId/);
});
