import assert from "node:assert/strict";
import test from "node:test";
import { ActivityFailure, TimeoutFailure } from "@temporalio/workflow";
import { classifyActivityFailure } from "../../../src/platforms/temporal/variants/baseline/workflow.js";

test("model heartbeat loss retains dispatch uncertainty while active deadline stays a timeout", () => {
  const heartbeat = new ActivityFailure("worker lost", "requestModel", "model-2", "NON_RETRYABLE_FAILURE", "synthetic-worker", new TimeoutFailure("heartbeat", { attemptId: "model-2" }, "HEARTBEAT"));
  assert.equal(classifyActivityFailure(heartbeat).failureKind, "outcome_unknown");
  assert.equal(classifyActivityFailure(heartbeat).retryable, false);
  const deadline = new ActivityFailure("deadline", "requestModel", "model-2", "NON_RETRYABLE_FAILURE", "synthetic-worker", new TimeoutFailure("deadline", null, "START_TO_CLOSE"));
  assert.equal(classifyActivityFailure(deadline).failureKind, "timeout");
});
