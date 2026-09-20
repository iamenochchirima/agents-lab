import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionWithRetry } from "../src/computer/decision-retry.js";
import { providerHttpError, providerErrorSummary, throwIfProviderErrorEnvelope } from "../src/computer/provider-response.js";

test("decision retry retries one transient provider failure before returning a decision", async () => {
  const attempts: number[] = [];
  const failures: Array<{ readonly attempt: number; readonly retrying: boolean }> = [];
  let calls = 0;

  const result = await runDecisionWithRetry(
    async (attempt) => {
      calls += 1;
      attempts.push(attempt);
      if (calls === 1) throw new Error("provider returned HTTP 429");
      return "selected-action";
    },
    {
      onFailure: (failure) => { failures.push({ attempt: failure.attempt, retrying: failure.retrying }); },
      retryDelayMs: 0,
    },
  );

  assert.equal(result, "selected-action");
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(failures, [{ attempt: 1, retrying: true }]);
});

test("decision retry does not repeat a non-transient malformed decision", async () => {
  let calls = 0;
  const error = new Error("Native computer decision returned malformed JSON.");

  await assert.rejects(
    runDecisionWithRetry(
      async () => {
        calls += 1;
        throw error;
      },
      { retryDelayMs: 0 },
    ),
    error,
  );

  assert.equal(calls, 1);
});

test("provider error envelopes retain bounded upstream status for retry classification", () => {
  assert.throws(
    () => throwIfProviderErrorEnvelope({ error: { code: 502, message: "ResourceExhausted: worker capacity reached" } }, "Native computer decision"),
    /Native computer decision provider returned an upstream error: HTTP 502: ResourceExhausted: worker capacity reached/u,
  );
  assert.equal(providerErrorSummary(JSON.stringify({ error: { code: "invalid_request", message: "tool_choice is unsupported" } })), "invalid_request: tool_choice is unsupported");
  assert.match(providerHttpError("Native computer decision", 400, JSON.stringify({ error: { code: "invalid_request", message: "tool_choice is unsupported" } })).message, /HTTP 400: invalid_request: tool_choice is unsupported/u);
  const nested = JSON.stringify({ error: { code: 400, message: "Provider returned error", metadata: { provider_name: "Nex AGI", raw: JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_request", message: "The request is invalid." } }) } } });
  assert.equal(providerErrorSummary(nested), "Nex AGI: invalid_request: The request is invalid.");
  assert.match(providerHttpError("Native computer decision", 400, nested).message, /HTTP 400: Nex AGI: invalid_request: The request is invalid\./u);
});
