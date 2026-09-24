import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import {
  FileStudioMemoryRepository,
  InMemoryStudioMemoryRepository,
  StudioMemoryCorruptStateError,
  StudioMemoryConflictError,
  StudioMemoryRepositoryError,
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

test("Memory journal records policy, namespace, revision, decision, reason, and timestamp", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-journal-metadata-"));
  try {
    const repository = new FileStudioMemoryRepository(root, namespace);
    await repository.apply([{
      operationId: "memory-operation-1",
      operation: "add",
      candidate: {
        recordId: "journal-record",
        scope: "semantic",
        content: "English",
        logicalKey: "support-language",
        source: "fixture-memory",
        createdAt: "2026-09-20T00:00:00.000Z",
      },
      reason: "Persist the fixed fixture fact.",
    }], {
      policyId: "semantic-keyed-facts",
      policyVersion: "1",
      timestamp: "2026-09-20T00:00:01.000Z",
    });

    const event = JSON.parse((await readFile(join(root, "events.jsonl"), "utf8")).trim()) as Record<string, unknown>;
    assert.equal(event.policyId, "semantic-keyed-facts");
    assert.equal(event.policyVersion, "1");
    assert.deepEqual(event.namespace, namespace);
    assert.equal(event.previousRevision, 0);
    assert.deepEqual(event.recordIds, ["journal-record"]);
    assert.equal(event.timestamp, "2026-09-20T00:00:01.000Z");
    assert.equal((event.decisions as Array<Record<string, unknown>>)[0]?.reason, "Persist the fixed fixture fact.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory repository rejects lexical traversal and symlinked state roots", async () => {
  const root = await mkdtemp(join(process.cwd(), "studio-memory-path-safety-"));
  const target = join(root, "target");
  const link = join(root, "link");
  try {
    await mkdtemp(target);
    await symlink(target, link, "dir");
    assert.throws(
      () => new FileStudioMemoryRepository(`${root}/../escaped`, namespace),
      StudioMemoryRepositoryError,
    );
    const linked = new FileStudioMemoryRepository(link, namespace);
    await assert.rejects(() => linked.load(), StudioMemoryRepositoryError);
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Memory validation errors do not include the rejected record content", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace, {
    maxRecords: 10,
    maxRecordBytes: 32_000,
    maxContentBytes: 4,
    maxRetrievedRecords: 5,
    maxJournalBytes: 100_000,
    maxConsolidationOperations: 10,
  });
  const secret = "do-not-leak-this-fixture";
  await assert.rejects(
    () => repository.apply([{
      operationId: "oversized-record",
      operation: "add",
      candidate: {
        scope: "semantic",
        content: secret,
        logicalKey: "safe-key",
        source: "fixture-memory",
        createdAt: "2026-09-20T00:00:00.000Z",
      },
      reason: "Oversized test record.",
    }]),
    (error: unknown) => error instanceof Error && !error.message.includes(secret),
  );
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

test("Memory records preserve all scopes, provenance, namespace, and revision links", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const result = await repository.seed([
    { recordId: "working-note", scope: "working", content: "Current turn note", source: "fixture-working", sourceMessageIds: ["turn-1"], createdAt: "2026-09-20T00:00:00.000Z" },
    { recordId: "episodic-note", scope: "episodic", content: "Past invoice note", source: "fixture-episodic", sourceMessageIds: ["turn-0"], createdAt: "2026-09-20T00:00:01.000Z" },
    { recordId: "semantic-fact", scope: "semantic", content: "English", logicalKey: "support-language", source: "fixture-semantic", sourceMessageIds: ["turn-0"], createdAt: "2026-09-20T00:00:02.000Z" },
    { recordId: "procedural-rule", scope: "procedural", content: "Verify invoice", logicalKey: "invoice-check", source: "fixture-procedural", sourceMessageIds: ["turn-0"], createdAt: "2026-09-20T00:00:03.000Z" },
  ], "seed-scopes");

  assert.deepEqual(result.state.records.map((record) => record.scope), ["episodic", "procedural", "semantic", "working"]);
  assert.equal(result.state.records.every((record) => JSON.stringify(record.namespace) === JSON.stringify(namespace)), true);
  assert.deepEqual(result.state.records.find((record) => record.recordId === "semantic-fact")?.sourceMessageIds, ["turn-0"]);
  const updated = await repository.apply([{
    operationId: "update-semantic-fact",
    operation: "update",
    targetRecordId: "semantic-fact",
    candidate: {
      scope: "semantic",
      content: "Spanish",
      logicalKey: "support-language",
      source: "fixture-semantic-update",
      sourceMessageIds: ["turn-2"],
      createdAt: "2026-09-20T00:01:00.000Z",
    },
    reason: "The preference changed.",
  }]);
  assert.equal(updated.state.records.find((record) => record.recordId === "semantic-fact")?.state, "superseded");
  assert.equal(updated.state.records.find((record) => record.supersedesRecordId === "semantic-fact")?.revision, 5);
});

test("Memory repository rejects invalid bounds before it can persist state", () => {
  assert.throws(
    () => new InMemoryStudioMemoryRepository(namespace, {
      maxRecords: 0,
      maxRecordBytes: 1024,
      maxContentBytes: 1024,
      maxRetrievedRecords: 1,
      maxJournalBytes: 4096,
      maxConsolidationOperations: 1,
    }),
    StudioMemoryRepositoryError,
  );
  assert.throws(
    () => new InMemoryStudioMemoryRepository(namespace, {
      maxRecords: 1,
      maxRecordBytes: 1024,
      maxContentBytes: 2048,
      maxRetrievedRecords: 1,
      maxJournalBytes: 4096,
      maxConsolidationOperations: 1,
    }),
    /record limit must cover/i,
  );
});
