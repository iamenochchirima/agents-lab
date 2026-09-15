import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { InngestBaselineRunner } from "../src/platforms/inngest/runner-adapter/inngest-runner.js";
import { loadInngestConfig } from "../src/platforms/inngest/config.js";

const enabled = process.env.AGENTLAB_RUN_INNGEST_INTEGRATION === "1";

test(
  "real Inngest Dev Server runs baseline success, failure, retry, and cancellation paths",
  {
    skip: enabled
      ? false
      : "Set AGENTLAB_RUN_INNGEST_INTEGRATION=1 with the Inngest service and Dev Server running.",
  },
  async () => {
    const runner = new InngestBaselineRunner({ config: loadInngestConfig() });
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);

    const suffix = Date.now();
    const success = await runAndWait(runner, {
      runId: `integration-success-${suffix}`,
      prompt: "Return one short durable sentence.",
      model: "fake-success",
    });
    assert.equal(success.result?.status, "completed");
    assert.equal(success.result?.output, "Fake response: Return one short durable sentence.");
    assert.notEqual(success.reference.native.eventId, null);
    assert.notEqual(success.reference.native.functionRunId, null);

    await assert.rejects(
      runner.start(buildRunManifest(
        {
          platform: "inngest",
          variant: "baseline",
          task: { kind: "prompt", prompt: "A different request." },
          model: { provider: "fake", model: "fake-success" },
        },
        { runId: `integration-success-${suffix}`, platformConfig: runner.manifestConfiguration() },
      )),
      /different request input/,
    );

    const failure = await runAndWait(runner, {
      runId: `integration-failure-${suffix}`,
      prompt: "Fail deterministically.",
      model: "fake-failure",
    });
    assert.equal(failure.result?.status, "failed");
    assert.equal(failure.result?.error?.code, "FAKE_MODEL_FAILURE");

    const retry = await runAndWait(runner, {
      runId: `integration-retry-${suffix}`,
      prompt: "Retry once before completing.",
      model: "fake-retry",
    });
    assert.equal(retry.result?.status, "completed");
    assert.equal(retry.result?.output, "Fake response: Retry once before completing.");
    assert.ok((retry.result?.attemptCount ?? 0) >= 2);
    assert.equal(retry.eventIntents.filter((event) => event.kind === "ModelRequested").length, 2);

    const cancellation = await startRun(runner, {
      runId: `integration-cancel-${suffix}`,
      prompt: "Wait until cancellation.",
      model: "fake-wait",
    });
    const cancellationRequest = await runner.cancel(cancellation.reference, "integration cancellation");
    assert.equal(cancellationRequest.accepted, true);
    const cancelled = await waitForTerminal(runner, cancellation.reference);
    assert.equal(cancelled.result?.status, "cancelled");
    assert.equal(cancelled.reference.native.cancellationRequested, true);
  },
);

async function runAndWait(
  runner: InngestBaselineRunner,
  input: { readonly runId: string; readonly prompt: string; readonly model: string },
) {
  const started = await startRun(runner, input);
  return waitForTerminal(runner, started.reference);
}

async function startRun(
  runner: InngestBaselineRunner,
  input: { readonly runId: string; readonly prompt: string; readonly model: string },
) {
  const manifest = buildRunManifest(
    {
      platform: "inngest",
      variant: "baseline",
      task: { kind: "prompt", prompt: input.prompt },
      model: { provider: "fake", model: input.model },
    },
    {
      runId: input.runId,
      platformConfig: runner.manifestConfiguration(),
    },
  );
  const reference = await runner.start(manifest);
  return runner.inspect(reference);
}

async function waitForTerminal(
  runner: InngestBaselineRunner,
  initialReference: Awaited<ReturnType<InngestBaselineRunner["inspect"]>>["reference"],
) {
  let inspection = await runner.inspect(initialReference);
  for (let attempt = 0; attempt < 80 && !inspection.result; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    inspection = await runner.inspect(inspection.reference);
  }
  if (!inspection.result) throw new Error(`Timed out waiting for Inngest execution ${inspection.reference.executionId}.`);
  return inspection;
}
