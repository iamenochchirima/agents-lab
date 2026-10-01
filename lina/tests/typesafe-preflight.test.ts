import assert from "node:assert/strict";
import { test } from "node:test";
import { createTypeSafeModelPreflight } from "../src/computer/typesafe-preflight.js";

function response(model: unknown): Response {
  return new Response(JSON.stringify({
    model,
    answers: {
      ready: {
        type: "choice",
        choice: "ready",
        confidence: 1,
        probabilities: { ready: 1, unavailable: 0 },
      },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("TypeSafe readiness proves and memoizes the returned model identity without task data", async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  const preflight = createTypeSafeModelPreflight({
    apiKey: "typesafe-test-secret",
    model: "jev-latest",
    fetchImpl: async (_input, init) => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response("jev-2026-09-01");
    },
  });

  const first = await preflight();
  const second = await preflight();

  assert.deepEqual(first, { requestedModel: "jev-latest", resolvedModel: "jev-2026-09-01" });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.deepEqual(requestBody?.state, { purpose: "Lina Jev readiness check" });
  assert.equal(JSON.stringify(requestBody).includes("typesafe-test-secret"), false);
  assert.equal(JSON.stringify(requestBody).includes("user goal"), false);
});

test("TypeSafe readiness fails closed without an API key", async () => {
  const preflight = createTypeSafeModelPreflight({ model: "jev-latest" });
  await assert.rejects(preflight(), /TYPESAFE_API_KEY before task approval/u);
});

test("TypeSafe readiness rejects an unidentifiable or oversized returned model", async () => {
  const missingModel = createTypeSafeModelPreflight({
    apiKey: "typesafe-test-secret",
    fetchImpl: async () => response(undefined),
  });
  await assert.rejects(missingModel(), /did not identify a bounded model/u);

  const oversizedModel = createTypeSafeModelPreflight({
    apiKey: "typesafe-test-secret",
    fetchImpl: async () => response("x".repeat(129)),
  });
  await assert.rejects(oversizedModel(), /did not identify a bounded model/u);
});
