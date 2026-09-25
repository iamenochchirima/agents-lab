import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COMPUTER_USE_CONFIG, ComputerUseConfigError, parseComputerUseConfig } from "../dist/index.js";

test("computer-use config supplies defaults and accepts bounded overrides", () => {
  assert.deepEqual(parseComputerUseConfig(), DEFAULT_COMPUTER_USE_CONFIG);
  assert.deepEqual(parseComputerUseConfig({ maxActionsPerTurn: 2 }), { ...DEFAULT_COMPUTER_USE_CONFIG, maxActionsPerTurn: 2 });
});

test("computer-use config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parseComputerUseConfig({ actionTimeoutMs: 0 }), ComputerUseConfigError);
  assert.throws(() => parseComputerUseConfig({ actionTimeoutMs: null }), ComputerUseConfigError);
  assert.throws(() => parseComputerUseConfig({ maxObservationBytes: "1000" }), ComputerUseConfigError);
  assert.throws(() => parseComputerUseConfig({ browserPath: "/usr/bin/chromium" }), ComputerUseConfigError);
});
