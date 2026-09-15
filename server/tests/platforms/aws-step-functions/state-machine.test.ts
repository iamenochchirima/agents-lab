import assert from "node:assert/strict";
import test from "node:test";

import { executionArnForStateMachine, executionNameForRun, buildStateMachineDefinition } from "../../../src/platforms/aws-step-functions/variants/baseline/execution/state-machine.js";
import { testConfig, STATE_MACHINE_ARN, ACTIVITY_ARN } from "./helpers.js";

test("baseline state machine is Standard Activity execution with bounded retry", () => {
  const definition = buildStateMachineDefinition(ACTIVITY_ARN, testConfig({
    AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS: "10",
    AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS: "9000",
    AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_MAX_ATTEMPTS: "2",
  }));
  assert.equal(definition.StartAt, "RequestModel");
  assert.equal(definition.TimeoutSeconds, 300);
  assert.equal(definition.States.RequestModel.Resource, ACTIVITY_ARN);
  assert.equal(definition.States.RequestModel.Parameters["attempt.$"], "$$.State.RetryCount");
  assert.deepEqual(definition.States.RequestModel.Retry[0]?.ErrorEquals, ["RetryableModelError", "States.Timeout"]);
  assert.equal(definition.States.RequestModel.Retry[0]?.MaxAttempts, 2);
});

test("execution identity is deterministic, valid, and has a bounded name", () => {
  const runId = "run-identity-123";
  const name = executionNameForRun(runId);
  assert.equal(name, executionNameForRun(runId));
  assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
  assert.notEqual(name, `aws-step-functions:${runId}`);
  assert.equal(executionNameForRun("x".repeat(128)).length, 73);
});

test("native execution ARN is derived from the state-machine ARN", () => {
  assert.equal(
    executionArnForStateMachine(STATE_MACHINE_ARN, "agentlab-run-1"),
    "arn:aws:states:us-east-1:012345678901:execution:AgentLabAwsStepFunctionsBaseline:agentlab-run-1",
  );
});
