import assert from "node:assert/strict";
import test from "node:test";

import { createInMemorySession, parseMemoryConfig } from "../dist/index.js";

const sessionId = "session-test";
const scope = { runId: "run-test", ownerId: "agent-test", sessionId };
const sessionScope = { ownerId: "agent-test", sessionId };

test("in-memory Memory recalls provenance-bearing records across turns in one session", async () => {
  const memory = createInMemorySession(sessionScope, parseMemoryConfig(), () => "2026-09-25T00:00:00.000Z");
  const write = await memory.observe({
    scope,
    observations: [{
      observationId: "preference-1",
      content: "The preferred support language is English.",
      kind: "fact",
      provenance: { sourceId: "turn-1", sourceKind: "user-message", trust: "untrusted", observedAt: "2026-09-25T00:00:00.000Z" },
    }],
  }, new AbortController().signal);
  assert.equal(write.outcome, "applied");

  const result = await memory.recall({ scope: { ...scope, runId: "run-next" }, query: "support language" }, new AbortController().signal);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].record.provenance.sourceId, "turn-1");
  assert.equal(result.candidates[0].record.provenance.trust, "untrusted");
  await memory.close();
});

test("in-memory Memory scopes, deduplicates, and cancels before writes", async () => {
  const memory = createInMemorySession(sessionScope, parseMemoryConfig());
  const observation = {
    observationId: "same-id",
    content: "A reusable process exists.",
    kind: "fact",
    provenance: { sourceId: "input-1", sourceKind: "user-message", trust: "untrusted", observedAt: "2026-09-25T00:00:00.000Z" },
  };
  const first = await memory.observe({ scope, observations: [observation] }, new AbortController().signal);
  const duplicate = await memory.observe({ scope, observations: [observation] }, new AbortController().signal);
  assert.equal(first.outcome, "applied");
  assert.equal(duplicate.outcome, "skipped");
  await assert.rejects(
    memory.recall({ scope: { runId: "other", sessionId: "other-session" }, query: "process" }, new AbortController().signal),
    { code: "MEMORY_SCOPE_MISMATCH" },
  );
  await assert.rejects(
    memory.recall({ scope: { runId: "other-owner", ownerId: "other-agent", sessionId }, query: "process" }, new AbortController().signal),
    { code: "MEMORY_SCOPE_MISMATCH" },
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(memory.observe({ scope, observations: [{ ...observation, observationId: "cancelled" }] }, cancelled.signal), { name: "AbortError" });
  const afterCancel = await memory.recall({ scope, query: "process" }, new AbortController().signal);
  assert.equal(afterCancel.candidates.length, 1);
  await memory.close();
  await assert.rejects(memory.recall({ scope, query: "process" }, new AbortController().signal), { code: "MEMORY_CLOSED" });
});
