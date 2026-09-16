import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputerNativeError } from "../src/runtime/errors.js";
import { assertLifecycleTransition } from "../src/runtime/lifecycle.js";

type Status = "prepared" | "approved" | "completed";

const transitions: Readonly<Record<Status, readonly Status[]>> = {
  prepared: ["approved"],
  approved: ["completed"],
  completed: [],
};

test("shared lifecycle transition checking accepts legal and repeated states", () => {
  const message = (from: Status, to: Status) => `Test action cannot transition from ${from} to ${to}.`;
  assert.doesNotThrow(() => assertLifecycleTransition(transitions, "prepared", "approved", message));
  assert.doesNotThrow(() => assertLifecycleTransition(transitions, "approved", "approved", message));
});

test("shared lifecycle transition checking fails closed with a persistence error", () => {
  assert.throws(
    () => assertLifecycleTransition(transitions, "completed", "prepared", (from, to) => `Test action cannot transition from ${from} to ${to}.`),
    (error: unknown) => error instanceof ComputerNativeError
      && error.code === "persistence"
      && /Test action cannot transition from completed to prepared/u.test(error.message),
  );
});
