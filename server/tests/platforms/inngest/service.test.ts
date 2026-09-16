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

test("the Inngest function executes the selected OpenRouter model and records normalized evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-inngest-openrouter-"));
  try {
    let requestBody: Record<string, unknown> | null = null;
    const service = new InngestPlatformService({
      config: loadInngestConfig({
        AGENTLAB_INNGEST_DATA_DIR: directory,
        OPENROUTER_API_KEY: "test-secret",
        AGENTLAB_OPENROUTER_BASE_URL: "https://openrouter.example/v1",
      }),
      store: new InngestRunStore(directory),
      fetchImplementation: async (url, init) => {
        assert.equal(String(url), "https://openrouter.example/v1/chat/completions");
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
        return new Response(JSON.stringify({
          id: "inngest-openrouter-provider-id",
          choices: [{ message: { content: "hello from Inngest OpenRouter" } }],
          usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
        }), { status: 200 });
      },
    });
    await service.initialize();
    const input = {
      runId: "run-inngest-openrouter",
      prompt: "Say hello.",
      systemInstruction: "Be concise.",
      provider: "openrouter" as const,
      model: "cohere/north-mini-code:free",
    };
    await service.admit(input);

    const runFunction = service.functions[0] as {
      readonly fn: (input: {
        readonly event: { readonly data: unknown };
        readonly step: {
          readonly run: (name: string, action: () => Promise<unknown> | unknown) => Promise<unknown>;
          readonly sleep: (name: string, duration: string) => Promise<void>;
        };
        readonly runId: string;
        readonly attempt: number;
      }) => Promise<unknown>;
    };
    const step = {
      run: async (_name: string, action: () => Promise<unknown> | unknown) => action(),
      sleep: async (_name: string, _duration: string) => undefined,
    };

    const functionResult = await runFunction.fn({
      event: { data: input },
      step,
      runId: "inngest-function-run",
      attempt: 0,
    });

    const record = await service.store.get(input.runId);
    assert.equal((requestBody as Record<string, unknown> | null)?.model, "cohere/north-mini-code:free");
    assert.deepEqual(functionResult, { status: "completed", output: "hello from Inngest OpenRouter" });
    assert.equal(record?.result?.status, "completed");
    assert.equal(record?.result?.output, "hello from Inngest OpenRouter");
    assert.deepEqual(record?.result?.usage, { inputTokens: 6, outputTokens: 7, totalTokens: 13 });
    assert.equal(record?.modelProvider, "openrouter");
    assert.equal(record?.model, "cohere/north-mini-code:free");
    const requested = record?.events.find((event) => event.kind === "ModelRequested");
    assert.deepEqual(requested?.payload, {
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
      attempt: 0,
    });
    assert.equal(JSON.stringify(record).includes("test-secret"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
