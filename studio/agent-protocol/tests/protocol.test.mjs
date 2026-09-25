import assert from "node:assert/strict";
import test from "node:test";

test("agent protocol creates validated IDs without changing their values", async () => {
  const protocol = await import("../dist/index.js");
  assert.equal(protocol.createRunId("run-1"), "run-1");
  assert.equal(protocol.createTurnId("turn-2"), "turn-2");
  assert.equal(protocol.createSessionId("session-3"), "session-3");
  assert.throws(() => protocol.createRunId(" run-1"), /runId must be a non-empty identifier/);
});
