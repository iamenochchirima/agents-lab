import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import {
  FileStudioMemoryRepository,
  InMemoryStudioMemoryRepository,
  StudioMemoryCorruptStateError,
  StudioMemoryConflictError,
  type StudioMemoryNamespace,
  type StudioMemoryMutation,
} from "../../../src/studio/memory/index.js";

const namespace: StudioMemoryNamespace = {
  comparisonId: "comparison-1",
  trialId: "trial-1",
  scenarioId: "memory-recall",
  sessionId: "session-1",
};

test("Memory repository applies seeded records and keeps operation IDs idempotent", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const seed = await repository.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English is the preferred support language.",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");

  assert.equal(seed.state.revision, 1);
  assert.equal(seed.state.records[0]?.recordId, "fact-language");
  const repeated = await repository.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English is the preferred support language.",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");
  assert.deepEqual(repeated.state, seed.state);
  assert.deepEqual(repeated.decisions, seed.decisions);
});

test("Memory repository updates a logical record by superseding its previous revision", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  await repository.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English is preferred.",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");

  const mutation: StudioMemoryMutation = {
    operationId: "turn-2-update-language",
    operation: "update",
    targetRecordId: "fact-language",
    candidate: {
      scope: "semantic",
      content: "Spanish is preferred.",
      logicalKey: "support-language",
      source: "studio-fact-extraction",
      sourceMessageIds: ["turn-2"],
      createdAt: "2026-09-20T00:01:00.000Z",
    },
    reason: "The preference changed.",
  };
  const result = await repository.apply([mutation]);
  const oldRecord = result.state.records.find((record) => record.recordId === "fact-language");
  const newRecord = result.state.records.find((record) => record.supersedesRecordId === "fact-language");
  assert.equal(oldRecord?.state, "superseded");
  assert.equal(newRecord?.state, "active");
  assert.equal(newRecord?.content, "Spanish is preferred.");
  assert.equal(result.decisions[0]?.operation, "update");
});

test("file Memory repository reconstructs state after a new repository instance", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-repository-"));
  try {
    const first = new FileStudioMemoryRepository(root, namespace);
    await first.seed([{
      recordId: "fact-language",
      scope: "semantic",
      content: "English is preferred.",
      logicalKey: "support-language",
      source: "fixture-memory",
      createdAt: "2026-09-20T00:00:00.000Z",
    }], "seed-fixture");
    await first.apply([{
      operationId: "turn-2-add-note",
      operation: "add",
      candidate: {
        scope: "episodic",
        content: "The user asked about an invoice.",
        source: "studio-turn-output",
        createdAt: "2026-09-20T00:01:00.000Z",
      },
      reason: "Persist the turn note.",
    }]);

    const second = new FileStudioMemoryRepository(root, namespace);
    const state = await second.load();
    assert.equal(state.revision, 2);
    assert.deepEqual(state.records.map((record) => record.recordId), ["fact-language", "turn-2-add-note-record"]);
    assert.match(await readFile(join(root, "events.jsonl"), "utf8"), /turn-2-add-note/);
    assert.match(await readFile(join(root, "records.json"), "utf8"), /fact-language/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Memory repository rejects a corrupt journal instead of treating it as empty", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-corrupt-"));
  try {
    await writeFile(join(root, "events.jsonl"), "{not-json}\n", "utf8");
    const repository = new FileStudioMemoryRepository(root, namespace);
    await assert.rejects(() => repository.load(), StudioMemoryCorruptStateError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory repository rejects a different operation that reuses a seeded record ID", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  await repository.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");

  await assert.rejects(
    () => repository.apply([{
      operationId: "different-seed",
      operation: "add",
      candidate: {
        recordId: "fact-language",
        scope: "semantic",
        content: "Spanish",
        logicalKey: "support-language",
        source: "fixture-memory",
        createdAt: "2026-09-20T00:01:00.000Z",
      },
      reason: "Conflicting fixture.",
    }]),
    StudioMemoryConflictError,
  );
});

test("Memory repository rejects an operation ID reused with different input", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const first = {
    operationId: "turn-1-add-language",
    operation: "add" as const,
    candidate: {
      scope: "semantic" as const,
      content: "English",
      logicalKey: "support-language",
      source: "studio-fact-extraction",
      createdAt: "2026-09-20T00:00:00.000Z",
    },
    reason: "Persist the preference.",
  };
  await repository.apply([first]);

  await assert.rejects(
    () => repository.apply([{ ...first, candidate: { ...first.candidate, content: "Spanish" } }]),
    StudioMemoryConflictError,
  );
});

test("file Memory repository recovers a journal append when snapshot publication is interrupted", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-journal-recovery-"));
  try {
    const first = new FileStudioMemoryRepository(root, namespace, undefined, undefined, {
      afterJournalAppend: () => {
        throw new Error("simulated interruption after journal append");
      },
    });
    await assert.rejects(
      () => first.seed([{
        recordId: "fact-language",
        scope: "semantic",
        content: "English is preferred.",
        logicalKey: "support-language",
        source: "fixture-memory",
        createdAt: "2026-09-20T00:00:00.000Z",
      }], "seed-fixture"),
      /simulated interruption/,
    );

    const recovered = new FileStudioMemoryRepository(root, namespace);
    const state = await recovered.load();
    assert.equal(recovered.lastLoadRecovered, true);
    assert.equal(state.revision, 1);
    assert.equal(state.records[0]?.recordId, "fact-language");
    const repeated = await recovered.seed([{
      recordId: "fact-language",
      scope: "semantic",
      content: "English is preferred.",
      logicalKey: "support-language",
      source: "fixture-memory",
      createdAt: "2026-09-20T00:00:00.000Z",
    }], "seed-fixture");
    assert.equal(repeated.state.revision, 1);
    assert.deepEqual(repeated.decisions, [{
      operationId: "seed-fixture:1",
      operation: "add",
      recordId: "fact-language",
      targetRecordId: null,
      logicalKey: "support-language",
      scope: "semantic",
      reason: "Seeded by the fixed Memory fixture.",
      stateRevision: 1,
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Memory repository treats a persisted write as applied after acknowledgement loss", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-ack-recovery-"));
  try {
    const first = new FileStudioMemoryRepository(root, namespace, undefined, undefined, {
      afterSnapshotWrite: () => {
        throw new Error("simulated acknowledgement loss");
      },
    });
    const mutation: StudioMemoryMutation = {
      operationId: "turn-1-add-note",
      operation: "add",
      candidate: {
        scope: "episodic",
        content: "The user asked about an invoice.",
        source: "studio-turn-output",
        createdAt: "2026-09-20T00:00:00.000Z",
      },
      reason: "Persist the turn note.",
    };
    await assert.rejects(() => first.apply([mutation]), /simulated acknowledgement loss/);

    const recovered = new FileStudioMemoryRepository(root, namespace);
    const repeated = await recovered.apply([mutation]);
    assert.equal(repeated.state.revision, 1);
    assert.deepEqual(repeated.state.records.map((record) => record.recordId), ["turn-1-add-note-record"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory repository rejects invalid timestamps and updates to retired records", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  await assert.rejects(
    () => repository.apply([{
      operationId: "invalid-timestamp",
      operation: "add",
      candidate: {
        scope: "semantic",
        content: "English",
        logicalKey: "support-language",
        source: "fixture-memory",
        createdAt: "not-a-timestamp",
      },
      reason: "Invalid fixture.",
    }]),
    /corrupt|timestamp/i,
  );
  await repository.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");
  await repository.apply([{
    operationId: "expire-language",
    operation: "expire",
    targetRecordId: "fact-language",
    reason: "Retention boundary reached.",
  }]);
  await assert.rejects(
    () => repository.apply([{
      operationId: "update-expired-language",
      operation: "update",
      targetRecordId: "fact-language",
      candidate: {
        scope: "semantic",
        content: "Spanish",
        logicalKey: "support-language",
        source: "studio-fact-extraction",
        createdAt: "2026-09-20T00:01:00.000Z",
      },
      reason: "Stale update.",
    }]),
    /active.*updated/i,
  );
});
