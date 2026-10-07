import test from "node:test";
import assert from "node:assert/strict";
import { liveOpenRouterModel } from "../../../src/platforms/mastra/variants/baseline/models/live-openrouter.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { DEFAULT_FREE_MODEL } from "../../../src/models/openrouter/free-model-policy.js";

test("live Mastra transport retains actual tools, correlated feedback and free routing without headers", async () => {
  const observations: any[] = [], bodies: any[] = [];
  const model: any = liveOpenRouterModel({ model: { model: DEFAULT_FREE_MODEL } } as RunManifest, receipt => observations.push(receipt), {
    apiKey: "fake-secret", fetchImplementation: (async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({ id: "response-1", model: DEFAULT_FREE_MODEL, provider: "fixture", choices: [{ message: bodies.length === 1 ? { tool_calls: [{ id: "call-1", function: { name: "calculator", arguments: '{"operation":"add","left":17,"right":25}' } }] } : { content: "42" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    }) as typeof fetch,
  });
  const prompt = [{ role: "system", content: "Instructions" }, { role: "user", content: [{ type: "text", text: "Use calculator" }] }];
  const first = await model.doGenerate({ prompt, tools: [{ type: "function", name: "calculator", inputSchema: { type: "object" } }] });
  assert.equal(first.finishReason, "tool-calls");
  const final = await model.doGenerate({ prompt: [...prompt, { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "calculator", input: { operation: "add", left: 17, right: 25 } }] }, { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", output: { type: "json", value: { value: 42 } } }] }] });
  assert.equal(final.content[0].text, "42");
  assert.deepEqual(bodies[1].messages.at(-1), { role: "tool", tool_call_id: "call-1", content: '{"value":42}' });
  assert.equal(bodies[0].provider.max_price.prompt, 0);
  assert.equal(bodies[0].provider.allow_fallbacks, false);
  assert.equal(bodies[0].tools[0].function.name, "calculator");
  assert.equal(observations[1].providerModel, DEFAULT_FREE_MODEL);
  assert.ok(!JSON.stringify(observations).includes("fake-secret"));
});
test("live transport records one provider rejection and makes no automatic retry", async () => {
  let calls = 0; const observations: any[] = [];
  const model: any = liveOpenRouterModel({ model: { model: DEFAULT_FREE_MODEL } } as RunManifest, value => observations.push(value), {
    apiKey: "fake-secret", fetchImplementation: (async () => { calls++; return new Response("rate limited", { status: 429 }); }) as typeof fetch,
  });
  await assert.rejects(model.doGenerate({ prompt: [{ role: "user", content: "test" }] }), /HTTP 429/);
  assert.equal(calls, 1); assert.equal(observations.at(-1).providerStatus, 429);
});
