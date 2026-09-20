import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ContextService } from "../../src/capabilities/context/context-service.js";
import { ContextCompactionError } from "../../src/capabilities/context/compaction.js";
import { ContextSessionStore } from "../../src/capabilities/context/session-store.js";

test("prepares a bounded request context before model execution and preserves canonical history", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-context-service-"));
  try {
    const store = new ContextSessionStore(root);
    const session = await store.create({
      sessionId: "session-service-1",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const first = await store.admitTurn(session.sessionId, "run-service-1", "A long earlier question");
    await store.settleTurn(session.sessionId, first.turn.turnId, { status: "completed", output: "An earlier answer." });
    const current = await store.admitTurn(session.sessionId, "run-service-2", "The current question");
    // The fixed counter keys below are replaced with the actual IDs after
    // admission; the map intentionally makes the canonical history exceed the
    // safe budget while leaving room for the generated summary.
    const service = new ContextService(
      store,
      {
        count(messages) {
          return {
            tokens: messages.reduce((total, message) => {
              if (message.role === "system") return total + 5;
              if (message.messageId === first.userMessage.messageId) return total + 45;
              if (message.role === "assistant") return total + 35;
              return total + 10;
            }, 0),
            quality: "exact",
            basis: "fixed-test-counter-v1",
          };
        },
      },
      () => "2026-09-15T20:00:00.000Z",
    );
    const prepared = await service.prepareTurn(current.session.sessionId, current.turn.turnId, {
      summarize: async ({ messages }) => `Summarized ${messages.length} earlier messages.`,
    });

    assert.equal(prepared.snapshot.compaction?.trigger, "preflight");
    assert.equal(prepared.snapshot.budget.pressure, "normal");
    assert.equal(prepared.snapshot.messages.some((message) => message.messageId === current.userMessage.messageId), true);
    assert.equal((await store.readTranscript(session.sessionId)).length, 3);
    assert.equal((await store.readTurn(session.sessionId, current.turn.turnId))?.status, "running");
    assert.equal((await service.projection(session.sessionId))?.budget.pressure, "normal");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when context safety cannot be measured", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-context-unknown-"));
  try {
    const store = new ContextSessionStore(root);
    const session = await store.create({
      sessionId: "session-service-unknown",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: null,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const turn = await store.admitTurn(session.sessionId, "run-service-unknown", "Do not send unsafely");
    const service = new ContextService(store, {
      count: () => ({ tokens: null, quality: "unknown", basis: "unavailable" }),
    });

    await assert.rejects(
      service.prepareTurn(turn.session.sessionId, turn.turn.turnId, { summarize: async () => "unused" }),
      ContextCompactionError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inserts selected skills as untrusted developer context and preserves them through compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-context-skills-"));
  try {
    const store = new ContextSessionStore(root);
    const session = await store.create({
      sessionId: "session-service-skills",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      skillContexts: [{
        kind: "skill-context",
        trust: "untrusted",
        authority: "none",
        skillId: "research-summary",
        skillVersion: "1.0.0",
        digest: "a".repeat(64),
        content: "Separate evidence from interpretation.",
        grants: [],
      }],
      contextWindowTokens: 10_000,
      reservedOutputTokens: 100,
      safetyMarginTokens: 50,
      compactionThresholdPercent: 20,
    });
    const seed = await store.admitTurn(session.sessionId, "run-service-skills-seed", "Earlier research.");
    await store.settleTurn(session.sessionId, seed.turn.turnId, { status: "completed", output: "Earlier evidence." });
    const turn = await store.admitTurn(session.sessionId, "run-service-skills", "Summarize research.");
    const service = new ContextService(store, {
      count: (messages) => ({ tokens: messages.reduce((sum, message) => sum + message.content.length, 0), quality: "estimated", basis: "test" }),
    });

    const prepared = await service.prepareTurn(
      turn.session.sessionId,
      turn.turn.turnId,
      { summarize: async () => "Earlier evidence summary." },
      { forceCompaction: true },
    );
    const skill = prepared.snapshot.messages.find((message) => message.source === "skills");
    assert.equal(skill?.role, "developer");
    assert.equal(skill?.content, "Separate evidence from interpretation.");
    assert.equal(skill?.metadata?.authority, "none");
    assert.deepEqual(prepared.snapshot.sources, ["system", "skills", "compaction-summary", "transcript"]);
    assert.equal(prepared.snapshot.compaction?.trigger, "preflight");
    assert.equal(prepared.snapshot.messages.some((message) => message.source === "compaction-summary"), true);
    assert.deepEqual((await store.readTranscript(session.sessionId)).map((message) => message.source), ["transcript", "transcript", "transcript"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
