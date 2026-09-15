import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import type { PlatformExecutionReference, RunManifest } from "../src/control-plane/domain/types.js";
import { loadAwsStepFunctionsConfig } from "../src/platforms/aws-step-functions/config.js";
import { AwsStepFunctionsBaselineRunner } from "../src/platforms/aws-step-functions/runner-adapter/aws-step-functions-runner.js";
import { AwsStepFunctionsPlatformService } from "../src/platforms/aws-step-functions/service/step-functions-service.js";

test(
  "Step Functions Local runs a prompt, retries a task, and survives service restart",
  {
    skip: process.env.AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION === "1"
      ? false
      : "Set AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION=1 with Step Functions Local running.",
  },
  async () => {
    const first = await startHarness();
    let reference: PlatformExecutionReference | null = null;
    try {
      const success = await run(first.runner, "run-aws-local-success", "fake-success");
      reference = success.reference;
      assert.equal(success.inspection.result?.status, "completed");
      assert.equal(success.inspection.result?.output, "Fake response: Produce one deterministic sentence.");
      assert.equal(success.inspection.reference.native.executionArn, reference.native.executionArn);
      assert.equal(success.inspection.reference.executionId, "aws-step-functions:run-aws-local-success");
      assert.notEqual(success.inspection.reference.executionId, success.inspection.reference.native.executionName);
      assert.ok(success.inspection.eventIntents.some((event) => event.kind === "RunCompleted"));

      const retried = await run(first.runner, "run-aws-local-retry", "fake-retry-once");
      assert.equal(retried.inspection.result?.status, "completed");
      assert.equal(retried.inspection.result?.attemptCount, 2);
      assert.equal(retried.inspection.eventIntents.filter((event) => event.kind === "ActivityStarted").length, 2);

      const failed = await run(first.runner, "run-aws-local-failure", "fake-failure");
      assert.equal(failed.inspection.result?.status, "failed");
      assert.equal(failed.inspection.result?.error?.code, "InjectedModelFailure");

      const cancellationReference = await start(first.runner, "run-aws-local-cancel", "fake-timeout");
      const cancellation = await first.runner.cancel(cancellationReference, "integration cancellation");
      assert.equal(cancellation.accepted, true);
      const cancelled = await inspectUntilResult(first.runner, cancellationReference);
      assert.equal(cancelled.result?.status, "cancelled");
    } finally {
      await first.close();
    }

    assert.ok(reference);
    const restarted = await startHarness();
    try {
      const inspection = await inspectUntilResult(restarted.runner, reference);
      assert.equal(inspection.result?.status, "completed");
      assert.equal(inspection.reference.native.executionArn, reference.native.executionArn);
    } finally {
      await restarted.close();
    }
  },
);

test(
  "Step Functions Local maps an Activity timeout to a timeout result",
  {
    skip: process.env.AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION === "1"
      ? false
      : "Set AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION=1 with Step Functions Local running.",
  },
  async () => {
    const harness = await startHarness({ activityTimeoutSeconds: 2, modelTimeoutMs: 1_900, retryMaxAttempts: 0 });
    try {
      const timedOut = await run(harness.runner, "run-aws-local-timeout", "fake-timeout");
      assert.equal(timedOut.inspection.result?.status, "failed");
      assert.equal(timedOut.inspection.result?.error?.failureKind, "timeout");
    } finally {
      await harness.close();
    }
  },
);

test(
  "Step Functions Local unavailable state is reported as unavailable, not completed",
  {
    skip: process.env.AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION === "1"
      ? false
      : "Set AGENTLAB_RUN_AWS_STEP_FUNCTIONS_INTEGRATION=1 to run the emulator availability check.",
  },
  async () => {
    const config = loadAwsStepFunctionsConfig({
      ...process.env,
      AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE: "local",
      AGENTLAB_AWS_STEP_FUNCTIONS_ENDPOINT_URL: "http://127.0.0.1:1",
      AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED: "false",
    });
    const service = new AwsStepFunctionsPlatformService({ config, startWorker: false });
    const health = await service.health();
    assert.equal(health.status, "degraded");
    assert.equal(health.stateMachine.reachable, false);
    await service.close();
  },
);

async function startHarness(options: {
  readonly activityTimeoutSeconds?: number;
  readonly modelTimeoutMs?: number;
  readonly retryMaxAttempts?: number;
} = {}): Promise<{
  readonly runner: AwsStepFunctionsBaselineRunner;
  readonly close: () => Promise<void>;
}> {
  const awsConfig = loadAwsStepFunctionsConfig({
    ...process.env,
    AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE: "local",
    AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED: "true",
    AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS: String(options.activityTimeoutSeconds ?? 10),
    AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS: String(options.modelTimeoutMs ?? 9000),
    AGENTLAB_AWS_STEP_FUNCTIONS_RETRY_MAX_ATTEMPTS: String(options.retryMaxAttempts ?? 2),
  });
  const service = new AwsStepFunctionsPlatformService({ config: awsConfig, startWorker: true });
  await service.initialize();
  const server = service.createHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const runner = new AwsStepFunctionsBaselineRunner({
    config: Object.freeze({ ...awsConfig, serviceUrl: `http://127.0.0.1:${address.port}` }),
    requestTimeoutMs: 10_000,
  });
  return {
    runner,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await service.close();
    },
  };
}

async function run(
  runner: AwsStepFunctionsBaselineRunner,
  runId: string,
  model: string,
): Promise<{ readonly reference: PlatformExecutionReference; readonly inspection: Awaited<ReturnType<typeof runner.inspect>> }> {
  const reference = await start(runner, runId, model);
  const inspection = await inspectUntilResult(runner, reference);
  return { reference, inspection };
}

async function start(
  runner: AwsStepFunctionsBaselineRunner,
  runId: string,
  model: string,
): Promise<PlatformExecutionReference> {
  const manifest = buildRunManifest({
    platform: "aws-step-functions",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Produce one deterministic sentence." },
    model: { provider: "fake", model },
  }, {
    runId,
    serverVersion: "integration-test",
    platformConfig: runner.manifestConfiguration(),
  }) as RunManifest;
  return runner.start(manifest);
}

async function inspectUntilResult(
  runner: AwsStepFunctionsBaselineRunner,
  reference: PlatformExecutionReference,
): Promise<Awaited<ReturnType<typeof runner.inspect>>> {
  let inspection = await runner.inspect(reference);
  const deadline = Date.now() + 20_000;
  while (!inspection.result && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    inspection = await runner.inspect(inspection.reference);
  }
  assert.ok(inspection.result, `Step Functions execution did not reach a terminal result: ${inspection.status}`);
  return inspection;
}
