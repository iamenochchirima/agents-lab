import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PLANNING_CONFIG, PlanningConfigError, parsePlanningConfig } from "../dist/index.js";

test("planning config supplies defaults and accepts bounded overrides", () => {
  assert.deepEqual(parsePlanningConfig(), DEFAULT_PLANNING_CONFIG);
  assert.deepEqual(parsePlanningConfig({ maxSteps: 3 }), { ...DEFAULT_PLANNING_CONFIG, maxSteps: 3 });
});

test("planning config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parsePlanningConfig({ maxSteps: 0 }), PlanningConfigError);
  assert.throws(() => parsePlanningConfig({ maxSteps: null }), PlanningConfigError);
  assert.throws(() => parsePlanningConfig({ maxAssumptions: false }), PlanningConfigError);
  assert.throws(() => parsePlanningConfig({ executeTools: true }), PlanningConfigError);
});
