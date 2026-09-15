import assert from "node:assert/strict";
import test from "node:test";

import { deriveMetrics, deriveTrajectory, historyToEventIntents } from "../../../src/platforms/aws-step-functions/service/history.js";

const history = [
  { id: 1, type: "ExecutionStarted", timestamp: "2026-09-15T10:00:00.000Z" },
  { id: 2, type: "ActivityStarted", timestamp: "2026-09-15T10:00:00.100Z", activityStartedEventDetails: { name: "model" } },
  { id: 3, type: "ActivitySucceeded", timestamp: "2026-09-15T10:00:00.500Z", activitySucceededEventDetails: { name: "model" } },
  { id: 4, type: "ExecutionSucceeded", timestamp: "2026-09-15T10:00:00.600Z" },
];

test("native history becomes ordered normalized intents without discarding native identity", () => {
  const intents = historyToEventIntents("run-history", history);
  assert.deepEqual(intents.map((event) => [event.sourceSequence, event.kind]), [
    [1, "RunStarted"],
    [2, "ActivityStarted"],
    [3, "ActivitySucceeded"],
    [4, "RunCompleted"],
  ]);
  assert.equal(intents[1]?.payload.nativeEventId, 2);
  assert.equal(intents[1]?.payload.stateName, "model");
});

test("trajectory and metrics distinguish execution duration from model attempts", () => {
  const trajectory = deriveTrajectory("run-history", history);
  assert.deepEqual(trajectory.phases.map((phase) => phase.name), ["state-machine-execution", "model-attempt-1"]);
  assert.equal(trajectory.phases[1]?.finishedAt, "2026-09-15T10:00:00.500Z");
  const metrics = deriveMetrics(
    "run-history",
    "completed",
    history,
    "2026-09-15T10:00:00.000Z",
    "2026-09-15T10:00:00.600Z",
    {
      schemaVersion: 1,
      runId: "run-history",
      status: "completed",
      durationMs: 0,
      modelCallCount: 99,
      modelAttemptCount: 99,
      inputTokens: 4,
      outputTokens: 5,
      totalTokens: 9,
      costUsd: null,
    },
  );
  assert.equal(metrics.durationMs, 600);
  assert.equal(metrics.modelCallCount, 1);
  assert.equal(metrics.totalTokens, 9);
});
