import assert from "node:assert/strict";
import test from "node:test";

import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { defaultMastraModelFactory } from "../../../src/platforms/mastra/variants/baseline/models/factory.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";

test("Mastra baseline validates fake and OpenRouter profiles without exposing secrets", async () => {
  const fakeRunner = new MastraBaselineRunner({ environment: {} });
  const fakeManifest = manifestFor(fakeRunner, "fake-success");

  assert.deepEqual(fakeRunner.validate(fakeManifest), { valid: true, reason: null });
  assert.deepEqual(await fakeRunner.checkConnection(), {
    reachable: true,
    message: "Mastra direct-agent runtime is ready for deterministic fake-model runs.",
  });

  const unavailableOpenRouter = new MastraBaselineRunner({ environment: {} });
  const openRouterManifest = manifestFor(unavailableOpenRouter, "aion-labs/aion-2.0", "openrouter");
  assert.deepEqual(unavailableOpenRouter.validate(openRouterManifest), {
    valid: false,
    reason: "OPENROUTER_API_KEY is required for the Mastra OpenRouter profile.",
  });
  assert.equal(defaultMastraModelFactory({ ...openRouterManifest, model: { provider: "openrouter", model: "aion-labs/aion-2.0" } }), "openrouter/aion-labs/aion-2.0");

  const availableOpenRouter = new MastraBaselineRunner({ environment: { OPENROUTER_API_KEY: "test-secret" } });
  assert.deepEqual(availableOpenRouter.validate(manifestFor(availableOpenRouter, "aion-labs/aion-2.0", "openrouter")), {
    valid: true,
    reason: null,
  });
  assert.equal(JSON.stringify(availableOpenRouter.manifestConfiguration()).includes("test-secret"), false);

  assert.equal(fakeRunner.validate(manifestFor(fakeRunner, "fake-not-supported")).valid, false);
});

test("Mastra runs a real Agent.generate call and duplicate start is idempotent", async () => {
  let modelFactoryCalls = 0;
  const runner = new MastraBaselineRunner({
    modelFactory: (manifest) => {
      modelFactoryCalls += 1;
      return createDeterministicFakeModel({ modelId: manifest.model.model, responseText: "Hello from Mastra." });
    },
  });
  const manifest = manifestFor(runner, "fake-success");

  const firstReference = await runner.start(manifest);
  const secondReference = await runner.start(manifest);
  assert.deepEqual(secondReference, firstReference);
  assert.equal(modelFactoryCalls, 1);

  const inspection = await waitForTerminal(runner, firstReference);
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.result?.output, "Hello from Mastra.");
  assert.equal(inspection.result?.attemptCount, 1);
  assert.equal(inspection.metrics?.modelCallCount, 1);
  assert.equal(inspection.eventIntents.filter((event) => event.kind === "ModelRequested").length, 1);
});

test("Mastra Agent.generate sends the selected OpenRouter model and preserves normalized evidence", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const selectedModel = "openai/gpt-4o-mini";

  process.env.OPENROUTER_API_KEY = "test-openrouter-secret";
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init);
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    requests.push({ url: request.url, headers: request.headers, body });
    return new Response(JSON.stringify({
      id: "chatcmpl-mastra-test",
      model: selectedModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OpenRouter response through Mastra." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const runner = new MastraBaselineRunner({
      environment: { OPENROUTER_API_KEY: "test-openrouter-secret" },
    });
    const manifest = manifestFor(runner, selectedModel, "openrouter", "mastra-openrouter-native");
    const reference = await runner.start(manifest);
    const inspection = await waitForTerminal(runner, reference);

    assert.equal(inspection.status, "completed");
    assert.equal(inspection.result?.output, "OpenRouter response through Mastra.");
    assert.deepEqual(inspection.result?.usage, { inputTokens: 7, outputTokens: 5, totalTokens: 12 });
    assert.equal(inspection.metrics?.modelCallCount, 1);
    assert.equal(reference.native.model, selectedModel);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.endsWith("/chat/completions"), true);
    assert.equal(requests[0]?.body.model, selectedModel);
    assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-openrouter-secret");
    assert.equal(JSON.stringify(inspection).includes("test-openrouter-secret"), false);
    assert.equal(JSON.stringify(reference).includes("test-openrouter-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("Mastra maps provider failure and ambiguous provider outcomes safely", async () => {
  const failedRunner = new MastraBaselineRunner();
  const failed = await waitForTerminal(failedRunner, await failedRunner.start(manifestFor(failedRunner, "fake-provider-failure")));
  assert.equal(failed.status, "failed");
  assert.equal(failed.result?.error?.failureKind, "provider");
  assert.equal(failed.result?.error?.message, "The Mastra model provider rejected the request.");

  const ambiguousRunner = new MastraBaselineRunner();
  const ambiguous = await waitForTerminal(
    ambiguousRunner,
    await ambiguousRunner.start(manifestFor(ambiguousRunner, "fake-ambiguous")),
  );
  assert.equal(ambiguous.status, "failed");
  assert.equal(ambiguous.result?.error?.failureKind, "outcome_unknown");
  assert.equal(ambiguous.result?.error?.code, "MASTRA_OUTCOME_UNKNOWN");
});

test("Mastra cancellation is cooperative and does not claim completion", async () => {
  const runner = new MastraBaselineRunner({ executionTimeoutMs: 1_000 });
  const reference = await runner.start(manifestFor(runner, "fake-slow"));
  const cancellation = await runner.cancel(reference, "stop for test");
  assert.equal(cancellation.accepted, true);

  const inspection = await waitForTerminal(runner, reference);
  assert.equal(inspection.status, "cancelled");
  assert.equal(inspection.result?.output, null);
  assert.equal(inspection.result?.error?.failureKind, "cancelled");
});

test("a replacement runner cannot recover an in-flight process-local call", async () => {
  const original = new MastraBaselineRunner({ executionTimeoutMs: 1_000 });
  const reference = await original.start(manifestFor(original, "fake-slow", "fake", "mastra-process-loss"));
  const replacement = new MastraBaselineRunner();

  await assert.rejects(
    replacement.inspect(reference),
    (error: unknown) => error instanceof Error && error.message.includes("Mastra execution was not found"),
  );
});

function manifestFor(
  runner: MastraBaselineRunner,
  model: string,
  provider: "fake" | "openrouter" = "fake",
  runId = `mastra-test-${model.replaceAll(/[^a-z0-9]+/gi, "-")}`,
): RunManifest {
  return buildRunManifest(
    {
      platform: "mastra",
      variant: "baseline",
      task: { kind: "prompt", prompt: "Say hello." },
      model: { provider, model },
    },
    {
      runId,
      platformConfig: runner.manifestConfiguration(),
    },
  );
}

async function waitForTerminal(
  runner: MastraBaselineRunner,
  reference: Awaited<ReturnType<MastraBaselineRunner["start"]>>,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) return inspection;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Mastra test execution did not reach a terminal state.");
}
