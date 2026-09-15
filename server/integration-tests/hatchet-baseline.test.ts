import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { createHatchetWorkerHost } from "../src/platforms/hatchet/service/worker-host.js";
import { loadHatchetConfig } from "../src/platforms/hatchet/config.js";
import {
  HatchetBaselineRunner,
  type HatchetRunnerClientLike,
  type HatchetTaskLike,
} from "../src/platforms/hatchet/runner-adapter/hatchet-runner.js";

const enabled = process.env.AGENTLAB_RUN_HATCHET_INTEGRATION === "1";

test(
  "Hatchet full local stack completes a fake baseline task",
  { skip: !enabled },
  async () => {
    const config = loadHatchetConfig();
    const host = await createHatchetWorkerHost(config);
    try {
      await host.start();
      const runner = HatchetBaselineRunner.fromClient({
        config,
        client: host.client as unknown as HatchetRunnerClientLike,
        task: host.task as unknown as HatchetTaskLike,
      });
      const runId = `hatchet-integration-${Date.now()}`;
      const inspection = await waitForTerminal(
        runner,
        await runner.start(manifestFor(runner, runId)),
      );

      assert.equal(inspection.status, "completed");
      assert.equal(inspection.result?.status, "completed");
      assert.equal(
        inspection.result?.output,
        `Fake response: Return one deterministic sentence.`,
      );
      assert.equal(typeof inspection.reference.native.workflowRunId, "string");
      assert.equal(typeof inspection.reference.native.taskExternalId, "string");
    } finally {
      await host.stop();
    }
  },
);

test(
  "Hatchet full local stack projects a provider failure without fabricating success",
  { skip: !enabled },
  async () => {
    const config = loadHatchetConfig();
    const host = await createHatchetWorkerHost(config);
    try {
      await host.start();
      const runner = HatchetBaselineRunner.fromClient({
        config,
        client: host.client as unknown as HatchetRunnerClientLike,
        task: host.task as unknown as HatchetTaskLike,
      });
      const inspection = await waitForTerminal(
        runner,
        await runner.start(
          manifestFor(
            runner,
            `hatchet-failure-${Date.now()}`,
            "fake-provider-failure",
          ),
        ),
      );

      assert.equal(inspection.result?.status, "failed");
      assert.equal(inspection.result?.error?.code, "FAKE_PROVIDER_FAILURE");
    } finally {
      await host.stop();
    }
  },
);

async function waitForTerminal(
  runner: HatchetBaselineRunner,
  reference: Awaited<ReturnType<HatchetBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "Hatchet integration run did not reach a terminal result within 10 seconds.",
  );
}

function manifestFor(
  runner: HatchetBaselineRunner,
  runId: string,
  model = "fake-success",
) {
  return buildRunManifest(
    {
      platform: "hatchet",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Return one deterministic sentence." },
      model: { provider: "fake", model },
    },
    {
      runId,
      platformConfig: runner.manifestConfiguration(),
      serverVersion: "integration-test",
    },
  );
}
