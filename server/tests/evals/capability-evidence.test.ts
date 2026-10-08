import assert from "node:assert/strict";
import test from "node:test";
import { validateCapabilityRouting } from "../../src/evals/capability-evidence.js";
import { COMPARISON_FREE_MODEL, FREE_PROVIDER_ROUTING } from "../../src/models/openrouter/free-model-policy.js";

test("routing evidence accepts phased and combined native observations but never missing or paid dispatches", () => {
  const request = { model: COMPARISON_FREE_MODEL, max_tokens: 2048, provider: FREE_PROVIDER_ROUTING };
  const run = (observation: unknown) => ({ events: [{kind: "EvalModelObserved", payload: {observation}}] });
  const check = (runs: Parameters<typeof validateCapabilityRouting>[0]) => validateCapabilityRouting(runs, COMPARISON_FREE_MODEL, "agent-capabilities-live");
  assert.equal(check([run({phase: "request", providerRequest: request}), run({providerRequest: request, output: "actual Python response"})]), true);
  assert.equal(check([run({phase: "response", output: "no request evidence"})]), false);
  assert.equal(check([]), false);
  assert.equal(check([run({providerRequest: {...request, provider: {...FREE_PROVIDER_ROUTING, allow_fallbacks: true}}})]), false);
});
