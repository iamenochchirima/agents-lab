import assert from "node:assert/strict";
import test from "node:test";
import { CuaEnvironmentError } from "../src/computer/cua-driver.js";
import { classifyComputerFailure, ComputerFailureError } from "../src/computer/failures.js";

test("computer failure classification keeps driver and display failures distinct", () => {
  assert.equal(classifyComputerFailure(new CuaEnvironmentError("unavailable", "X11 display is unavailable.")), "computer-display-unavailable");
  assert.equal(classifyComputerFailure(new CuaEnvironmentError("driver-failure", "CUA host driver crashed.")), "computer-driver-failure");
  assert.equal(classifyComputerFailure(new CuaEnvironmentError("stale-observation", "The observed window changed.")), "computer-stale-observation");
});

test("computer failure classification keeps provider timeout and malformed output distinct", () => {
  assert.equal(classifyComputerFailure(new Error("provider request timed out")), "computer-provider-timeout");
  assert.equal(classifyComputerFailure(new Error("Traditional computer decision returned malformed JSON.")), "computer-malformed-response");
  assert.equal(classifyComputerFailure(new ComputerFailureError("computer-confidence-abstention", "confidence below threshold")), "computer-confidence-abstention");
});
