import assert from "node:assert/strict";
import test from "node:test";
import { assertFreeModelCatalog, assertFreeModelRequest, DEFAULT_FREE_MODEL, COHERE_FREE_MODEL, SUSTAINED_FREE_MODEL, FREE_PROVIDER_ROUTING, LIVE_MAX_OUTPUT_TOKENS } from "../../../src/models/openrouter/free-model-policy.js";
const catalog = () => ({ data: [{ id: DEFAULT_FREE_MODEL, context_length: 32768, pricing: { prompt: "0", completion: "0", request: "0" }, supported_parameters: ["tools", "tool_choice", "max_tokens"] }] });
const request = () => ({ model: DEFAULT_FREE_MODEL, max_tokens: LIVE_MAX_OUTPUT_TOKENS, provider: structuredClone(FREE_PROVIDER_ROUTING) });
test("free policy validates current exact models and rejects paid, missing or unsupported catalog entries", () => {
  assert.equal(assertFreeModelCatalog(catalog(), DEFAULT_FREE_MODEL).id, DEFAULT_FREE_MODEL);
  for (const model of [COHERE_FREE_MODEL, SUSTAINED_FREE_MODEL]) {
    const alternate = catalog(); alternate.data[0].id = model;
    assert.equal(assertFreeModelCatalog(alternate, model).id, model);
    assert.doesNotThrow(() => assertFreeModelRequest({ ...request(), model }, model));
  }
  assert.throws(() => assertFreeModelCatalog(catalog(), "openrouter/auto"), /approved exact/);
  assert.throws(() => assertFreeModelCatalog({ data: [] }, DEFAULT_FREE_MODEL), /unavailable/);
  const paid = catalog(); paid.data[0].pricing.completion = "0.01";
  assert.throws(() => assertFreeModelCatalog(paid, DEFAULT_FREE_MODEL), /zero pricing/);
  const requestFee = catalog(); requestFee.data[0].pricing.request = "0.01";
  assert.throws(() => assertFreeModelCatalog(requestFee, DEFAULT_FREE_MODEL), /zero pricing/);
  const unsupported = catalog(); unsupported.data[0].supported_parameters = ["max_tokens"];
  assert.throws(() => assertFreeModelCatalog(unsupported, DEFAULT_FREE_MODEL), /support tools/);
});
test("request boundary rejects altered prices and model fallback before transport", () => {
  assert.doesNotThrow(() => assertFreeModelRequest(request(), DEFAULT_FREE_MODEL));
  for (const mutate of [
    (body: any) => { body.provider.max_price.prompt = 1; },
    (body: any) => { delete body.provider.max_price.request; },
    (body: any) => { body.provider.allow_fallbacks = true; },
    (body: any) => { body.models = [DEFAULT_FREE_MODEL, "paid/model"]; },
    (body: any) => { body.model = "paid/model"; },
    (body: any) => { body.plugins = [{ id: "web" }]; },
    (body: any) => { delete body.max_tokens; },
  ]) { const body = request(); mutate(body); assert.throws(() => assertFreeModelRequest(body, DEFAULT_FREE_MODEL)); }
});

test("output allowances are selected by experiment while zero-price routing remains mandatory", async () => {
  const { getFreeEvalSettings, isFreeEval } = await import("../../../src/models/openrouter/free-model-policy.js");
  assert.equal(getFreeEvalSettings("agent-harness-live")?.maxOutputTokens, 512);
  assert.equal(getFreeEvalSettings("agent-capabilities-live")?.maxOutputTokens, 2048);
  assert.equal(isFreeEval("ordinary-chat"), false);
  for (const experiment of ["agent-harness-live", "agent-capabilities-live"]) {
    const allowance = getFreeEvalSettings(experiment)!.maxOutputTokens;
    const body = { ...request(), max_tokens: allowance };
    assert.doesNotThrow(() => assertFreeModelRequest(body, DEFAULT_FREE_MODEL, experiment));
    assert.throws(() => assertFreeModelRequest({ ...body, max_tokens: allowance === 512 ? 2048 : 512 }, DEFAULT_FREE_MODEL, experiment), /output allowance/);
    assert.throws(() => assertFreeModelRequest({ ...body, provider: { ...body.provider, allow_fallbacks: true } }, DEFAULT_FREE_MODEL, experiment), /fallback disabled/);
  }
  assert.throws(() => assertFreeModelRequest({ ...request(), max_tokens: 2048 }, DEFAULT_FREE_MODEL, "client-custom-budget"), /Unknown/);
});
