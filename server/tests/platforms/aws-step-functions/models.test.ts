import assert from "node:assert/strict";
import test from "node:test";

import { runFakeModel } from "../../../src/platforms/aws-step-functions/variants/baseline/models/fake.js";
import { createModelRunner } from "../../../src/platforms/aws-step-functions/variants/baseline/models/factory.js";
import { testConfig } from "./helpers.js";

const input = {
  runId: "run-model-test",
  prompt: "hello",
  systemInstruction: "be concise",
  provider: "fake" as const,
  model: "fake-retry-once",
  attempt: 0,
};

test("fake model retry fixture changes only after Step Functions increments attempt", async () => {
  const first = await runFakeModel(input, 10);
  const second = await runFakeModel({ ...input, attempt: 1 }, 10);
  assert.equal(first.kind, "failure");
  assert.equal(first.retryable, true);
  assert.equal(second.kind, "success");
  assert.equal(second.providerRequestId, "fake-run-model-test-1");
});

test("model factory keeps OpenRouter behind the platform-local model boundary", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const runner = createModelRunner(
    { modelTimeoutMs: 1000, openRouterApiKey: "sk-test", openRouterBaseUrl: "https://openrouter.ai/api/v1" },
    async (input, init) => {
      calls.push({ url: String(input), authorization: (init?.headers as Record<string, string>)?.authorization ?? null });
      return new Response(JSON.stringify({ id: "or-1", choices: [{ message: { content: "remote" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { status: 200 });
    },
  );
  const result = await runner.run({ ...input, provider: "openrouter", model: "openai/gpt-4o-mini" });
  assert.equal(result.kind, "success");
  assert.equal(result.output, "remote");
  assert.equal(result.providerRequestId, "or-1");
  assert.equal(result.usage.totalTokens, 5);
  assert.deepEqual(calls, [{ url: "https://openrouter.ai/api/v1/chat/completions", authorization: "Bearer sk-test" }]);
  assert.equal(JSON.stringify(testConfig()).includes("OPENROUTER_API_KEY"), false);
});
