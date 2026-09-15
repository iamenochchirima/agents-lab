import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "Hatchet embedded local engine completes a fake baseline task",
  { skip: !enabled },
  async () => {
    const testRuntime = await createTestRuntime();
    let host: Awaited<ReturnType<typeof createHatchetWorkerHost>> | null = null;
    try {
      host = await createHatchetWorkerHost(testRuntime.config);
      await host.start();
      const runner = HatchetBaselineRunner.fromClient({
        config: testRuntime.config,
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
      await host?.stop();
      await rm(testRuntime.dataDir, { recursive: true, force: true });
    }
  },
);

test(
  "Hatchet embedded local engine projects a provider failure without fabricating success",
  { skip: !enabled },
  async () => {
    const testRuntime = await createTestRuntime();
    let host: Awaited<ReturnType<typeof createHatchetWorkerHost>> | null = null;
    try {
      host = await createHatchetWorkerHost(testRuntime.config);
      await host.start();
      const runner = HatchetBaselineRunner.fromClient({
        config: testRuntime.config,
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
      await host?.stop();
      await rm(testRuntime.dataDir, { recursive: true, force: true });
    }
  },
);

test(
  "Hatchet embedded local engine owns retry, timeout, and cancellation lifecycle",
  { skip: !enabled },
  async () => {
    const testRuntime = await createTestRuntime({
      AGENTLAB_HATCHET_RUNTIME_MODE: "embedded",
      AGENTLAB_HATCHET_EXECUTION_TIMEOUT_MS: "2000",
      AGENTLAB_HATCHET_SCHEDULE_TIMEOUT_MS: "10000",
      AGENTLAB_HATCHET_RETRY_BACKOFF_FACTOR: "1",
      AGENTLAB_HATCHET_RETRY_BACKOFF_MAX_SECONDS: "1",
    });
    let host: Awaited<ReturnType<typeof createHatchetWorkerHost>> | null = null;
    try {
      host = await createHatchetWorkerHost(testRuntime.config);
      await host.start();
      const runner = HatchetBaselineRunner.fromClient({
        config: testRuntime.config,
        client: host.client as unknown as HatchetRunnerClientLike,
        task: host.task as unknown as HatchetTaskLike,
      });

      const retryRun = await runner.start(
        manifestFor(runner, `hatchet-retry-${Date.now()}`, "fake-pre-dispatch-retry"),
      );
      const retried = await waitForTerminal(runner, retryRun, 20_000);
      assert.equal(retried.status, "completed");
      assert.equal(retried.result?.attemptCount, 2);
      assert.equal(
        retried.result?.output,
        "Fake response after retry: Return one deterministic sentence.",
      );

      const timeoutRun = await runner.start(
        manifestFor(runner, `hatchet-timeout-${Date.now()}`, "fake-timeout"),
      );
      const timedOut = await waitForTerminal(runner, timeoutRun, 20_000);
      assert.equal(timedOut.status, "failed");
      assert.equal(timedOut.result?.error?.failureKind, "timeout");

      const cancelRun = await runner.start(
        manifestFor(runner, `hatchet-cancel-${Date.now()}`, "fake-cancel"),
      );
      await waitForNonTerminalInspection(runner, cancelRun, 5_000);
      const cancellation = await runner.cancel(cancelRun, "integration cancellation");
      assert.equal(cancellation.accepted, true);
      const cancelled = await waitForTerminal(runner, cancelRun, 10_000);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.result?.error?.failureKind, "cancelled");
    } finally {
      await host?.stop();
      await rm(testRuntime.dataDir, { recursive: true, force: true });
    }
  },
);

async function createTestRuntime(
  overrides: NodeJS.ProcessEnv = {},
): Promise<{
  readonly config: ReturnType<typeof loadHatchetConfig>;
  readonly dataDir: string;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agentlab-hatchet-integration-"));
  const apiPort = await freePort();
  const grpcPort = await freePort();
  return {
    config: loadHatchetConfig({
      ...process.env,
      ...overrides,
      AGENTLAB_HATCHET_RUNTIME_MODE: "embedded",
      AGENTLAB_HATCHET_API_URL: `http://127.0.0.1:${apiPort}`,
      AGENTLAB_HATCHET_HOST_PORT: `127.0.0.1:${grpcPort}`,
      AGENTLAB_HATCHET_EMBEDDED_POSTGRES_DATA_DIR: dataDir,
    }),
    dataDir,
  };
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The operating system did not return a test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForTerminal(
  runner: HatchetBaselineRunner,
  reference: Awaited<ReturnType<HatchetBaselineRunner["start"]>>,
  timeoutMs = 10_000,
) {
  const attempts = Math.ceil(timeoutMs / 250);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Hatchet integration run did not reach a terminal result within ${timeoutMs}ms.`,
  );
}

async function waitForNonTerminalInspection(
  runner: HatchetBaselineRunner,
  reference: Awaited<ReturnType<HatchetBaselineRunner["start"]>>,
  timeoutMs: number,
): Promise<void> {
  const attempts = Math.ceil(timeoutMs / 250);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.status === "queued" || inspection.status === "running") return;
    if (inspection.result) throw new Error("Hatchet cancellation fixture reached a terminal state before cancellation.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Hatchet cancellation fixture did not become cancellable within ${timeoutMs}ms.`);
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
