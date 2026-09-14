import assert from "node:assert/strict";
import test from "node:test";

import { InvalidRunTransitionError, transitionRun } from "../../src/control-plane/domain/run-state.js";

test("run state follows the accepted lifecycle", () => {
  let status = transitionRun("created", "queued");
  status = transitionRun(status, "running");
  status = transitionRun(status, "completed");

  assert.equal(status, "completed");
});

test("a terminal run cannot be completed twice", () => {
  assert.throws(
    () => transitionRun("completed", "completed"),
    (error: unknown) => error instanceof InvalidRunTransitionError,
  );
});

test("a queued run can be cancelled before execution starts", () => {
  assert.equal(transitionRun("queued", "cancelled"), "cancelled");
});

test("a completed run cannot be changed to reconciliation required", () => {
  assert.throws(
    () => transitionRun("completed", "reconciliation_required"),
    (error: unknown) => error instanceof InvalidRunTransitionError,
  );
});
