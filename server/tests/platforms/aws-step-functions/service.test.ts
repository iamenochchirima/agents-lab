import assert from "node:assert/strict";
import test from "node:test";

import { AwsStepFunctionsExecutionConflictError, AwsStepFunctionsPlatformService } from "../../../src/platforms/aws-step-functions/service/step-functions-service.js";
import { executionNameForRun } from "../../../src/platforms/aws-step-functions/variants/baseline/execution/state-machine.js";
import { FakeStepFunctionsApi, STATE_MACHINE_ARN, successfulActivityOutput, testConfig } from "./helpers.js";

function input(runId: string, model = "fake-success") {
  return {
    runId,
    prompt: "hello",
    systemInstruction: "be concise",
    provider: "fake" as const,
    model,
  };
}

test("service keeps Lab executionId separate from stable native Step Functions identity", async () => {
  const api = new FakeStepFunctionsApi();
  const service = new AwsStepFunctionsPlatformService({ api, config: testConfig(), startWorker: false });
  const run = input("run-native-identity");
  const first = await service.dispatch(run);
  const second = await service.dispatch(run);
  assert.equal(first.submissionOutcome, "accepted");
  assert.equal(second.submissionOutcome, "already_accepted");
  assert.equal(first.executionArn, second.executionArn);
  assert.equal(first.executionName, executionNameForRun(run.runId));

  api.complete(first.executionArn!, successfulActivityOutput(run.runId));
  const inspection = await service.inspect(run.runId, first.executionArn);
  const native = inspection.reference.native;
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "done");
  assert.equal(inspection.reference.executionId, `aws-step-functions:${run.runId}`);
  assert.equal(native.executionName, first.executionName);
  assert.equal(native.executionArn, first.executionArn);
  assert.notEqual(native.executionName, inspection.reference.executionId);
  assert.notEqual(native.executionArn, inspection.reference.executionId);
  assert.equal(native.profile, "local");
  assert.equal(native.stateMachineArn, STATE_MACHINE_ARN);
  await service.close();
});

test("duplicate execution name with different input is a conflict", async () => {
  const api = new FakeStepFunctionsApi();
  const service = new AwsStepFunctionsPlatformService({ api, config: testConfig(), startWorker: false });
  await service.dispatch(input("run-conflict", "fake-success"));
  await assert.rejects(
    () => service.dispatch({ ...input("run-conflict", "fake-failure"), prompt: "different" }),
    (error: unknown) => error instanceof AwsStepFunctionsExecutionConflictError,
  );
  await service.close();
});

test("missing native execution produces reconciliation_required result, never fabricated terminal output", async () => {
  const api = new FakeStepFunctionsApi();
  const service = new AwsStepFunctionsPlatformService({ api, config: testConfig(), startWorker: false });
  const missing = await service.inspect("run-missing-execution");
  assert.equal(missing.status, "reconciliation_required");
  assert.equal(missing.result?.status, "reconciliation_required");
  assert.equal(missing.result?.output, null);
  assert.equal(missing.result?.error?.failureKind, "outcome_unknown");
  assert.equal(missing.reference.native.executionArn, null);

  const returnedButUninspectableArn = `${STATE_MACHINE_ARN.replace(":stateMachine:", ":execution:")}:agentlab-run-returned`;
  const unknown = await service.inspect("run-returned-but-uninspectable", returnedButUninspectableArn);
  assert.equal(unknown.status, "reconciliation_required");
  assert.equal(unknown.result?.status, "reconciliation_required");
  assert.equal(unknown.reference.native.executionArn, returnedButUninspectableArn);
  await service.close();
});

test("cancellation is an asynchronous native stop and projects ABORTED honestly", async () => {
  const api = new FakeStepFunctionsApi();
  const service = new AwsStepFunctionsPlatformService({ api, config: testConfig(), startWorker: false });
  const run = input("run-cancel");
  const dispatch = await service.dispatch(run);
  const cancellation = await service.cancel(run.runId, dispatch.executionArn, "stop it");
  assert.equal(cancellation.accepted, true);
  assert.equal(cancellation.alreadyTerminal, false);
  const inspection = await service.inspect(run.runId, dispatch.executionArn);
  assert.equal(inspection.status, "cancelled");
  assert.equal(inspection.result?.status, "cancelled");
  await service.close();
});
