import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { MastraBaselineRunner, waitForDurableSettlement } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createBaselineAgentRuntime } from "../../../src/platforms/mastra/variants/baseline/agent.js";
import test from "node:test";
import assert from "node:assert/strict";
import { liveOpenRouterModel } from "../../../src/platforms/mastra/variants/baseline/models/live-openrouter.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { DEFAULT_FREE_MODEL, COHERE_FREE_MODEL } from "../../../src/models/openrouter/free-model-policy.js";

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


test("native durable loop decodes controlled free transport tool chunks and correlated feedback", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-live-durable-"));
  const storage = new LibSQLStore({ id: "controlled-live", url: `file:${join(root, "snapshots.db")}` });
  const bodies: any[] = [], observations: any[] = [];
  let effects = 0;
  try {
    await storage.init();
    const runner = new MastraBaselineRunner({ environment: { OPENROUTER_API_KEY: "fake-secret" } });
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", model: { provider: "openrouter", model: COHERE_FREE_MODEL },
      selection: { experimentId: "agent-capabilities-live" }, task: { kind: "prompt", prompt: "Add 17 and 25 with calculator" } },
      { runId: "controlled-live-run", platformConfig: runner.manifestConfiguration() });
    const manifest = { ...base, execution: { schemaVersion: 1 as const, mode: "sustained" as const,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(), modelTimeoutMs: 10_000 } };
    const runtime = createBaselineAgentRuntime(manifest, admitted => liveOpenRouterModel(admitted, receipt => observations.push(receipt), {
      apiKey: "fake-secret", fetchImplementation: (async (_url, options) => {
        bodies.push(JSON.parse(String(options?.body)));
        return Response.json({ id: `response-${bodies.length}`, model: COHERE_FREE_MODEL, choices: [{ message: bodies.length === 1
          ? { tool_calls: [{ id: "native-free-call", type: "function", function: { name: "calculator", arguments: JSON.stringify({ operation: "add", left: 17, right: 25 }) } }] }
          : { content: "42" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
      }) as typeof fetch,
    }), { storage, sustained: true, runId: manifest.runId, turnId: "controlled-turn", signal: new AbortController().signal,
      maxToolCalls: 4, onToolObservation: () => { effects++; } });
    const output = await runtime.agent.generate(manifest.task.prompt, { runId: manifest.runId, maxSteps: 4 });
    await waitForDurableSettlement(runtime.agent, manifest.runId);
    assert.equal(output.text, "42"); assert.equal(effects, 1); assert.equal(bodies.length, 2);
    assert.ok(bodies[1].messages.some((message: any) => message.role === "tool" && message.tool_call_id === "native-free-call" && message.content.includes("42")));
    for (const body of bodies) {
      assert.equal(body.model, COHERE_FREE_MODEL); assert.equal(body.max_tokens, 2048);
      assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.require_parameters, true);
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
      assert.equal(body.stream, undefined);
    }
    assert.equal(output.totalUsage.totalTokens, 10);
    assert.equal(observations.filter(value => value.phase === "request").length, 2);
    assert.ok(!JSON.stringify(observations).includes("fake-secret"));
  } finally { await storage.close(); await rm(root, { recursive: true, force: true }); }
});
