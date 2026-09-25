import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONTEXT_CONFIG, ContextConfigError, parseContextConfig } from "../dist/index.js";

test("context config supplies defaults and accepts bounded overrides", () => {
  assert.deepEqual(parseContextConfig(), DEFAULT_CONTEXT_CONFIG);
  assert.deepEqual(parseContextConfig({ maxMessages: 50 }), { ...DEFAULT_CONTEXT_CONFIG, maxMessages: 50 });
});

test("context config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parseContextConfig({ maxMessages: 0 }), ContextConfigError);
  assert.throws(() => parseContextConfig({ maxMessages: null }), ContextConfigError);
  assert.throws(() => parseContextConfig({ maxSourceBytes: "1024" }), ContextConfigError);
  assert.throws(() => parseContextConfig({ memoryPolicy: "own-memory" }), ContextConfigError);
});
