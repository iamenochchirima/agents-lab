import assert from "node:assert/strict";
import test from "node:test";
import { terminateObservation, describeExecutionBudgets } from "../../src/evals/observer-termination.js";
test("deadline retains its original running snapshot and observes later cancellation once", async () => {
  let clock = 0, cancellations = 0, inspections = 0;
  const result = await terminateObservation({ reason: "deadline", snapshot: { status: "running" }, now: () => clock, sleep: async ms => { clock += ms; },
    cancel: async () => { cancellations++; return { status: "running" }; }, inspect: async () => { inspections++; return { status: "cancelled" }; } });
  assert.equal(result.termination.statusAtDeadline, "running");
  assert.equal(result.termination.settledStatus, "cancelled");
  assert.equal(cancellations, 1); assert.equal(inspections, 1);
});
test("interruption and bounded nonsettlement cannot fabricate a cancelled native outcome", async () => {
  let clock = 0;
  const result = await terminateObservation({ reason: "user-interrupt", snapshot: { status: "suspended" }, now: () => clock, sleep: async ms => { clock += ms; }, settlementWindowMs: 500,
    cancel: async () => { throw new Error("Control endpoint unavailable"); }, inspect: async () => ({ status: "running" }) });
  assert.equal(result.termination.statusAtDeadline, null); assert.equal(result.termination.settledStatus, null);
  assert.equal(result.snapshot.status, "running"); assert.equal(result.termination.settlementWindowExhausted, true);
  assert.match(result.termination.cancellationError ?? "", /unavailable/);
});
test("racing native failure/uncertainty is retained and transport limits are not model budgets", async () => {
  const result = await terminateObservation({ reason: "deadline", snapshot: { status: "running" }, cancel: async () => ({ status: "reconciliation_required" }), inspect: async () => { throw new Error("Must not poll settled uncertainty"); } });
  assert.equal(result.termination.settledStatus, "reconciliation_required");
  const budgets = describeExecutionBudgets("langgraph", { timeoutMs: 10000 }, { maxRounds: 24 });
  assert.equal(budgets.nativeDeadline.milliseconds, null); assert.equal(budgets.runnerTransportDeadline?.milliseconds, 10000);
});
test("unresponsive control requests obey the bound even when a callback ignores abort", async () => {
  const result = await terminateObservation({ reason: "deadline", snapshot: { status: "running" }, cancellationDeadlineMs: 10, settlementWindowMs: 30, pollMs: 1,
    cancel: async () => new Promise<never>(() => {}), inspect: async () => ({ status: "failed" }) });
  assert.match(result.termination.cancellationError ?? "", /bounded window/);
  assert.equal(result.termination.settledStatus, "failed");
});
