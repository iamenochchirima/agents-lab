import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InngestPlatformService } from "../src/platforms/inngest/service/platform-service.js";
import { loadInngestConfig } from "../src/platforms/inngest/config.js";
import { InngestRunStore } from "../src/platforms/inngest/variants/baseline/store.js";

const enabled = process.env.AGENTLAB_RUN_INNGEST_INTEGRATION === "1";

test("real Inngest Dev Server runs the baseline function and projects native state", { skip: !enabled }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-integration-"));
  const servicePort = Number(process.env.AGENTLAB_INNGEST_TEST_SERVICE_PORT ?? "9191");
  const serviceUrl = process.env.AGENTLAB_INNGEST_SERVICE_URL ?? `http://127.0.0.1:${servicePort}`;
  const config = loadInngestConfig({
    ...process.env,
    AGENTLAB_INNGEST_DATA_DIR: directory,
    AGENTLAB_INNGEST_SERVICE_URL: serviceUrl,
    AGENTLAB_INNGEST_SERVICE_PORT: String(servicePort),
    AGENTLAB_INNGEST_DEV_SERVER_URL: process.env.AGENTLAB_INNGEST_DEV_SERVER_URL ?? "http://127.0.0.1:8288",
  });
  const service = new InngestPlatformService({ config, store: new InngestRunStore(directory) });
  await service.initialize();
  const server = service.createHttpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(servicePort, "127.0.0.1", () => resolve());
  });

  try {
    const health = await service.health();
    assert.equal(health.devServer.reachable, true, health.devServer.message);
    const runId = `integration-${Date.now()}`;
    const input = {
      runId,
      prompt: "Return one short durable sentence.",
      systemInstruction: "Be concise.",
      provider: "fake" as const,
      model: "fake-success",
    };
    const dispatch = await service.dispatch(input);
    assert.equal(dispatch.acknowledgement, "confirmed");
    const record = await waitForTerminal(service, runId);
    assert.equal(record.result?.status, "completed");
    assert.equal(record.result?.output, "Fake response: Return one short durable sentence.");
    assert.equal(record.eventId !== null, true);
    assert.equal(record.functionRunId !== null, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForTerminal(service: InngestPlatformService, runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const record = await service.store.get(runId);
    if (record?.result) return record;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Inngest run ${runId}.`);
}
