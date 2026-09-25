import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONTROL_CONFIG, ControlConfigError, parseControlConfig } from "../dist/index.js";

test("control config supplies the serial baseline", () => {
  assert.deepEqual(parseControlConfig(), DEFAULT_CONTROL_CONFIG);
  assert.deepEqual(parseControlConfig({ toolCallOrder: "serial" }), DEFAULT_CONTROL_CONFIG);
});

test("control config rejects invalid values and misspelled fields", () => {
  assert.throws(() => parseControlConfig(null), ControlConfigError);
  assert.throws(() => parseControlConfig({ toolCallOrder: null }), /toolCallOrder/);
  assert.throws(() => parseControlConfig({ toolCallOrder: "parallel" }), /toolCallOrder/);
  assert.throws(() => parseControlConfig({ toolCallOrder: 1 }), /toolCallOrder/);
  assert.throws(() => parseControlConfig({ maxTurns: 3 }), /Unknown control config field/);
});
