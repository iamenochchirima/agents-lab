import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ContextSessionBusyError,
  ContextSessionConflictError,
  ContextSessionLimitError,
  ContextSessionStore,
} from "../../src/capabilities/context/session-store.js";
import type { ContextSnapshot } from "../../src/capabilities/context/contracts.js";

async function withStore(run: (store: ContextSessionStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-context-session-"));
  try {
    await run(new ContextSessionStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("session store persists a transcript, active turn, and context snapshot", async () => {
  await withStore(async (store, root) => {
    const session = await store.create({
      sessionId: "session-1",
      platform: "temporal",
      variant: "baseline",
      model: "openrouter/test-model",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
      now: "2026-09-15T20:00:00.000Z",
    });
    const admitted = await store.admitTurn(session.sessionId, "run-1", "Hello", "2026-09-15T20:00:01.000Z");
    const snapshot: ContextSnapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-1",
      sessionId: session.sessionId,
      sessionRevision: admitted.session.revision,
      compactionRevision: 0,
      model: session.model,
      messages: admitted.transcript,
      sources: ["system", "transcript"],
      budget: {
        contextWindowTokens: 100,
        inputTokens: 10,
        reservedOutputTokens: 10,
        safetyMarginTokens: 5,
        remainingTokens: 75,
        remainingPercent: 75,
        quality: "estimated",
        tokenizerBasis: "test",
        pressure: "normal",
      },
      compaction: null,
      createdAt: "2026-09-15T20:00:02.000Z",
    };
    await store.writeSnapshot(snapshot);
    await store.markRunning(session.sessionId, admitted.turn.turnId, snapshot.snapshotId);
    await store.settleTurn(session.sessionId, admitted.turn.turnId, { status: "completed", output: "Hi back" });

    const reloaded = new ContextSessionStore(root);
    const finalSession = await reloaded.read(session.sessionId);
    const transcript = await reloaded.readTranscript(session.sessionId);
    assert.equal(finalSession.activeTurnId, null);
    assert.equal(finalSession.revision, 2);
    assert.deepEqual(transcript.map((message) => [message.role, message.content]), [["user", "Hello"], ["assistant", "Hi back"]]);
    assert.equal((await reloaded.latestSnapshot(session.sessionId))?.snapshotId, snapshot.snapshotId);
    assert.equal((await reloaded.projection(session.sessionId))?.budget.remainingPercent, 75);
  });
});

test("duplicate admission and settlement are idempotent, while concurrent turns are rejected", async () => {
  await withStore(async (store) => {
    const session = await store.create({
      sessionId: "session-2",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const first = await store.admitTurn(session.sessionId, "run-2", "First");
    const duplicate = await store.admitTurn(session.sessionId, "run-2", "First");
    assert.equal(duplicate.turn.turnId, first.turn.turnId);
    await assert.rejects(() => store.admitTurn(session.sessionId, "run-3", "Second"), ContextSessionBusyError);

    await store.settleTurn(session.sessionId, first.turn.turnId, { status: "completed", output: "Done" });
    await store.settleTurn(session.sessionId, first.turn.turnId, { status: "completed", output: "Done" });
    const transcript = await store.readTranscript(session.sessionId);
    assert.equal(transcript.filter((message) => message.role === "assistant").length, 1);
  });
});

test("a client turn key replays after store restart and rejects a changed prompt", async () => {
  await withStore(async (store, root) => {
    const session = await store.create({
      sessionId: "session-client-key",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const first = await store.admitTurn(session.sessionId, "run-client-key", "Same prompt", undefined, "client-key-1");

    const reloaded = new ContextSessionStore(root);
    const replay = await reloaded.admitTurn(session.sessionId, "new-run-id", "Same prompt", undefined, "client-key-1");
    assert.equal(replay.turn.turnId, first.turn.turnId);
    assert.equal(replay.turn.runId, "run-client-key");
    assert.equal(replay.turn.clientTurnId, "client-key-1");
    assert.equal((await reloaded.read(session.sessionId)).maxTranscriptBytes > 0, true);
    assert.equal((await reloaded.readTranscript(session.sessionId)).length, 1);

    await assert.rejects(
      () => reloaded.admitTurn(session.sessionId, "another-run", "Changed prompt", undefined, "client-key-1"),
      ContextSessionConflictError,
    );
  });
});

test("transcript and aggregate session limits reject writes before persistence", async () => {
  await withStore(async (_defaultStore, root) => {
    const transcriptLimited = new ContextSessionStore(root, { maxSessionBytes: 50_000, maxTranscriptBytes: 300 });
    const transcriptSession = await transcriptLimited.create({
      sessionId: "session-transcript-limit",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    await assert.rejects(
      () => transcriptLimited.admitTurn(transcriptSession.sessionId, "run-large-prompt", "x".repeat(500)),
      (error: unknown) => error instanceof ContextSessionLimitError
        && error.kind === "transcript"
        && error.attemptedBytes > error.limitBytes,
    );
    assert.equal((await transcriptLimited.readTranscript(transcriptSession.sessionId)).length, 0);

    const sessionLimited = new ContextSessionStore(root, { maxSessionBytes: 1_024, maxTranscriptBytes: 50_000 });
    const session = await sessionLimited.create({
      sessionId: "session-aggregate-limit",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    await assert.rejects(
      () => sessionLimited.admitTurn(session.sessionId, "run-aggregate-limit", "x".repeat(100)),
      (error: unknown) => error instanceof ContextSessionLimitError
        && error.kind === "session"
        && error.attemptedBytes > error.limitBytes,
    );
    assert.equal((await sessionLimited.readTranscript(session.sessionId)).length, 0);
  });
});

test("a crash between transcript and turn writes is repaired by a repeated run ID", async () => {
  await withStore(async (store, root) => {
    const session = await store.create({
      sessionId: "session-3",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const partialMessage = {
      schemaVersion: 1,
      messageId: "message-partial",
      sessionId: session.sessionId,
      sequence: 1,
      role: "user",
      content: "Recover me",
      source: "transcript",
      createdAt: "2026-09-15T20:00:00.000Z",
      metadata: { turnId: "turn-partial", runId: "run-partial" },
    };
    await writeFile(join(root, session.sessionId, "transcript.jsonl"), `${JSON.stringify(partialMessage)}\n`, "utf8");
    const repaired = await store.admitTurn(session.sessionId, "run-partial", "Recover me");
    assert.equal(repaired.turn.turnId, "turn-partial");
    assert.equal((await store.readTranscript(session.sessionId)).length, 1);
    assert.match(await readFile(join(root, session.sessionId, "turns.jsonl"), "utf8"), /turn-partial/);
  });
});

test("a durable terminal turn repairs the session index after an interrupted settlement", async () => {
  await withStore(async (store, root) => {
    const session = await store.create({
      sessionId: "session-settlement-repair",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const admitted = await store.admitTurn(session.sessionId, "run-settlement-repair", "Recover settlement");
    const assistant = {
      schemaVersion: 1,
      messageId: "message-repaired-assistant",
      sessionId: session.sessionId,
      sequence: 2,
      role: "assistant",
      content: "Recovered answer",
      source: "transcript",
      createdAt: "2026-09-15T20:00:01.000Z",
      metadata: { turnId: admitted.turn.turnId },
    };
    await writeFile(join(root, session.sessionId, "transcript.jsonl"), `${JSON.stringify(admitted.userMessage)}\n${JSON.stringify(assistant)}\n`, "utf8");
    await writeFile(join(root, session.sessionId, "turns.jsonl"), `${JSON.stringify({ ...admitted.turn, status: "completed", assistantMessageId: assistant.messageId, output: assistant.content })}\n`, "utf8");

    await store.settleTurn(session.sessionId, admitted.turn.turnId, { status: "completed", output: assistant.content });

    const repaired = await store.read(session.sessionId);
    assert.equal(repaired.activeTurnId, null);
    assert.equal(repaired.revision, 2);
  });
});

test("a snapshot repairs its revision ledger after an interrupted ledger append", async () => {
  await withStore(async (store, root) => {
    const session = await store.create({
      sessionId: "session-ledger-repair",
      platform: "temporal",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 100,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      compactionThresholdPercent: 20,
    });
    const admitted = await store.admitTurn(session.sessionId, "run-ledger-repair", "Persist this");
    const snapshot: ContextSnapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-ledger-repair",
      sessionId: session.sessionId,
      sessionRevision: admitted.session.revision,
      compactionRevision: 0,
      model: session.model,
      messages: admitted.transcript,
      sources: ["transcript"],
      budget: {
        contextWindowTokens: 100,
        inputTokens: 10,
        reservedOutputTokens: 10,
        safetyMarginTokens: 5,
        remainingTokens: 75,
        remainingPercent: 75,
        quality: "estimated",
        tokenizerBasis: "test",
        pressure: "normal",
      },
      compaction: null,
      createdAt: "2026-09-15T20:00:02.000Z",
    };
    await store.writeSnapshot(snapshot);
    await writeFile(join(root, session.sessionId, "context-revisions.jsonl"), "", "utf8");
    await store.writeSnapshot(snapshot);

    assert.match(await readFile(join(root, session.sessionId, "context-revisions.jsonl"), "utf8"), /snapshot-ledger-repair/);
  });
});
