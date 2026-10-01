import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TOOL_USE_CONFIG, ToolUseConfigError, parseToolUseConfig } from "../dist/index.js";

test("tool-use config supplies defaults and accepts bounded overrides", () => {
  assert.deepEqual(parseToolUseConfig(), DEFAULT_TOOL_USE_CONFIG);
  assert.deepEqual(parseToolUseConfig({ timeoutMs: 5000 }), { ...DEFAULT_TOOL_USE_CONFIG, timeoutMs: 5000 });
});

test("tool-use config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parseToolUseConfig({ timeoutMs: 0 }), ToolUseConfigError);
  assert.throws(() => parseToolUseConfig({ timeoutMs: null }), ToolUseConfigError);
  assert.throws(() => parseToolUseConfig({ maxCallsPerTurn: 3 }), /not a supported setting/);
  assert.throws(() => parseToolUseConfig({ allowedRisk: ["write"] }), ToolUseConfigError);
});
