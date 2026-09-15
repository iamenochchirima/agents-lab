import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { InngestPlatformService } from "../../../src/platforms/inngest/service/platform-service.js";
import { InngestRunStore } from "../../../src/platforms/inngest/variants/baseline/store.js";
import { loadInngestConfig } from "../../../src/platforms/inngest/config.js";

function makeInput(runId: string) {
  return {
    runId,
    prompt: "Do one thing.",
    systemInstruction: "Be concise.",
    provider: "fake" as const,
    model: "fake-success",
  };
}

test("service reuses a stable event ID after a lost send acknowledgement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-service-"));
  try {
    const calls: Array<{ id: string; name: string }> = [];
    let sends = 0;
    const service = new InngestPlatformService({
      config: loadInngestConfig({ AGENTLAB_INNGEST_DATA_DIR: directory }),
      store: new InngestRunStore(directory),
      eventSender: async (payload) => {
        calls.push({ id: payload.id, name: payload.name });
        sends += 1;
        if (sends === 1) throw new Error("ack lost");
        return { ids: ["evt-reconciled"] };
      },
    });
    await service.initialize();
    const input = makeInput("run-lost-ack");
    const first = await service.dispatch(input);
    const second = await service.dispatch(input);

    assert.equal(first.submissionOutcome, "unknown");
    assert.equal(first.acknowledgement, "unknown");
    assert.equal(second.submissionOutcome, "already_accepted");
    assert.equal(second.eventId, "evt-reconciled");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].id, calls[1].id);
    assert.equal(calls[0].name, "agentlab/run.requested");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("service records cancellation even when cancellation acknowledgement is lost", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-cancel-service-"));
  try {
    const service = new InngestPlatformService({
      config: loadInngestConfig({ AGENTLAB_INNGEST_DATA_DIR: directory }),
      store: new InngestRunStore(directory),
      eventSender: async (payload) => {
        if (payload.name === "agentlab/run.cancelled") throw new Error("cancel ack lost");
        return { ids: ["evt-1"] };
      },
    });
    await service.initialize();
    const input = makeInput("run-cancel-ack");
    await service.admit(input);
    const result = await service.cancel(input.runId, "stop it");
    const record = await service.store.get(input.runId);
    assert.equal(result.accepted, true);
    assert.equal(result.acknowledgement, "unknown");
    assert.equal(record?.cancellationRequested, true);
    assert.equal(record?.result, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("service health reports a degraded Dev Server without claiming the service is down", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-health-"));
  try {
    const service = new InngestPlatformService({
      config: loadInngestConfig({ AGENTLAB_INNGEST_DATA_DIR: directory }),
      store: new InngestRunStore(directory),
      fetchImplementation: async () => new Response("down", { status: 503 }),
    });
    await service.initialize();
    const health = await service.health();
    assert.equal(health.status, "degraded");
    assert.equal(health.service.reachable, true);
    assert.equal(health.devServer.reachable, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
