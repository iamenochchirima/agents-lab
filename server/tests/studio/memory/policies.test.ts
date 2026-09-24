import assert from "node:assert/strict";
import test from "node:test";

import {
  EpisodicLexicalPolicy,
  InMemoryStudioMemoryRepository,
  NoMemoryPolicy,
  PolicyMemoryStore,
  ProceduralCachePolicy,
  SemanticFactPolicy,
  StudioMemoryCancellationError,
  WorkingMemoryPolicy,
  type StudioMemoryNamespace,
} from "../../../src/studio/memory/index.js";

const namespace: StudioMemoryNamespace = {
  comparisonId: "comparison-1",
  trialId: "trial-1",
  scenarioId: "memory-scenario",
  sessionId: "session-1",
};
const limits = {
  maxRecords: 20,
  maxRecordBytes: 32_000,
  maxContentBytes: 16_000,
  maxRetrievedRecords: 5,
  maxJournalBytes: 100_000,
  maxConsolidationOperations: 10,
};

test("no-memory is a real control and never proposes persistence", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const state = await repository.load();
  const policy = new NoMemoryPolicy();
  assert.deepEqual(policy.retrieve({ state, task: "support language", now: "2026-09-20T00:00:00.000Z", limits }).records, []);
  assert.deepEqual(policy.proposeWrite({ state, task: "support language", turnId: "turn-1", output: "English", now: "2026-09-20T00:00:00.000Z" }), []);
});

test("no-memory ignores fixture seeding at the store boundary", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const store = new PolicyMemoryStore(new NoMemoryPolicy(), repository, limits);
  await store.seed([{
    recordId: "fact-language",
    scope: "semantic",
    content: "English is preferred.",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");

  const result = await store.read({
    task: "support language",
    now: "2026-09-20T00:01:00.000Z",
    signal: new AbortController().signal,
  });
  assert.deepEqual(result.retrievedRecordIds, []);
  assert.deepEqual((await repository.load()).records, []);
});

test("episodic lexical policy ranks matching active records and omits unrelated records", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const seeded = await repository.seed([
    {
      recordId: "language",
      scope: "episodic",
      content: "The preferred support language is English.",
      source: "fixture-memory",
      createdAt: "2026-09-20T00:00:00.000Z",
    },
    {
      recordId: "invoice",
      scope: "episodic",
      content: "The user asked about an invoice.",
      source: "fixture-memory",
      createdAt: "2026-09-20T00:00:01.000Z",
    },
  ], "seed-fixture");
  const result = new EpisodicLexicalPolicy().retrieve({
    state: seeded.state,
    task: "Which support language is preferred?",
    now: "2026-09-20T00:01:00.000Z",
    limits,
  });
  assert.deepEqual(result.retrievedRecordIds, ["language"]);
  assert.deepEqual(result.omittedRecordIds, ["invoice"]);
  assert.equal(result.candidates.find((candidate) => candidate.record.recordId === "language")?.selected, true);
});

test("semantic fact policy proposes update, no-op, and expiry decisions", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const seeded = await repository.seed([{
    recordId: "language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    expiresAt: "2026-09-20T00:30:00.000Z",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-fixture");
  const policy = new SemanticFactPolicy();
  const update = policy.proposeWrite({
    state: seeded.state,
    task: "support language",
    turnId: "turn-2",
    output: "Preference: support-language = Spanish",
    now: "2026-09-20T00:01:00.000Z",
  });
  assert.equal(update[0]?.operation, "update");
  const noop = policy.proposeWrite({
    state: seeded.state,
    task: "support language",
    turnId: "turn-3",
    output: "Fact: support-language = English",
    now: "2026-09-20T00:02:00.000Z",
  });
  assert.equal(noop[0]?.operation, "noop");
  const expiry = policy.proposeConsolidation({ state: seeded.state, now: "2026-09-20T01:00:00.000Z" });
  assert.equal(expiry[0]?.operation, "expire");
});

test("procedural cache policy only accepts keyed procedure output", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const state = await repository.load();
  const policy = new ProceduralCachePolicy();
  const accepted = policy.proposeWrite({
    state,
    task: "resolve an invoice dispute",
    turnId: "turn-procedure",
    output: "Procedure: invoice-dispute => verify the invoice and request approval",
    now: "2026-09-20T00:00:00.000Z",
  });
  assert.equal(accepted[0]?.operation, "add");
  assert.equal(accepted[0]?.candidate?.logicalKey, "invoice-dispute");
  assert.deepEqual(policy.proposeWrite({
    state,
    task: "resolve an invoice dispute",
    turnId: "turn-freeform",
    output: "I would verify the invoice first.",
    now: "2026-09-20T00:00:01.000Z",
  }), []);
});

test("working memory is bounded to its repository instance", async () => {
  const firstRepository = new InMemoryStudioMemoryRepository(namespace);
  const policy = new WorkingMemoryPolicy();
  const state = await firstRepository.load();
  const mutations = policy.proposeWrite({
    state,
    task: "remember this turn",
    turnId: "turn-1",
    output: "A bounded working note.",
    now: "2026-09-20T00:00:00.000Z",
  });
  await firstRepository.apply(mutations);
  assert.equal((await firstRepository.load()).records.length, 1);
  assert.equal((await new InMemoryStudioMemoryRepository(namespace).load()).records.length, 0);
});

test("Memory store expires stale facts and records an inspectable decision", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const store = new PolicyMemoryStore(new SemanticFactPolicy(), repository, limits);
  await store.seed([{
    recordId: "expiring-language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    expiresAt: "2026-09-20T00:30:00.000Z",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-expiring");
  const read = await store.read({
    task: "support language",
    now: "2026-09-20T01:00:00.000Z",
    signal: new AbortController().signal,
  });
  assert.deepEqual(read.retrievedRecordIds, []);
  const consolidated = await store.consolidate({
    now: "2026-09-20T01:00:00.000Z",
    signal: new AbortController().signal,
  });
  assert.deepEqual(consolidated.expiredRecordIds, ["expiring-language"]);
  assert.equal(consolidated.decisions[0]?.operation, "expire");
});

test("Memory store turns an unchanged keyed fact into a NOOP", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const store = new PolicyMemoryStore(new SemanticFactPolicy(), repository, limits);
  await store.seed([{
    recordId: "language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-language");
  const result = await store.write({
    task: "support language",
    turnId: "turn-unchanged",
    output: "Preference: support-language = English",
    now: "2026-09-20T00:01:00.000Z",
    signal: new AbortController().signal,
  });
  assert.equal(result.decisions[0]?.operation, "noop");
  assert.deepEqual(result.writtenRecordIds, []);
  assert.equal((await repository.load()).records.length, 1);
});

test("Memory store rejects cancelled reads and writes before mutating state", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const store = new PolicyMemoryStore(new EpisodicLexicalPolicy(), repository, limits);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => store.read({ task: "support language", signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  await assert.rejects(
    () => store.write({ task: "support language", turnId: "cancelled-turn", output: "A note", signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.deepEqual((await repository.load()).records, []);
});

test("Memory operation IDs include the trial, policy, turn, and candidate identity", async () => {
  const firstRepository = new InMemoryStudioMemoryRepository(namespace);
  const firstStore = new PolicyMemoryStore(new SemanticFactPolicy(), firstRepository, limits);
  await firstStore.seed([{
    recordId: "language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-language");
  const first = await firstStore.write({
    trialId: namespace.trialId,
    task: "support language",
    turnId: "turn-1",
    output: "Preference: support-language = Spanish",
    now: "2026-09-20T00:01:00.000Z",
    signal: new AbortController().signal,
  });

  const secondRepository = new InMemoryStudioMemoryRepository(namespace);
  const secondStore = new PolicyMemoryStore(new SemanticFactPolicy(), secondRepository, limits);
  await secondStore.seed([{
    recordId: "language",
    scope: "semantic",
    content: "English",
    logicalKey: "support-language",
    source: "fixture-memory",
    createdAt: "2026-09-20T00:00:00.000Z",
  }], "seed-language");
  const second = await secondStore.write({
    trialId: namespace.trialId,
    task: "support language",
    turnId: "turn-1",
    output: "Preference: support-language = Spanish",
    now: "2026-09-20T00:01:00.000Z",
    signal: new AbortController().signal,
  });

  assert.equal(first.decisions[0]?.operationId, second.decisions[0]?.operationId);
  assert.match(first.decisions[0]?.operationId ?? "", /^memory-[a-f0-9]{32}$/);
});

test("Memory consolidation is bounded and deterministic", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const store = new PolicyMemoryStore(new SemanticFactPolicy(), repository, { ...limits, maxConsolidationOperations: 1 });
  await store.seed([
    { recordId: "expired-a", scope: "semantic", content: "English", logicalKey: "language-a", source: "fixture-memory", expiresAt: "2026-09-19T00:00:00.000Z", createdAt: "2026-09-18T00:00:00.000Z" },
    { recordId: "expired-b", scope: "semantic", content: "Spanish", logicalKey: "language-b", source: "fixture-memory", expiresAt: "2026-09-19T00:00:00.000Z", createdAt: "2026-09-18T00:00:00.000Z" },
  ], "seed-expired");

  await assert.rejects(
    () => store.consolidate({ now: "2026-09-20T00:00:00.000Z", signal: new AbortController().signal }),
    /consolidation limit/,
  );
});

test("Memory reports a persisted cancellation without describing the write as rolled back", async () => {
  const repository = new InMemoryStudioMemoryRepository(namespace);
  const controller = new AbortController();
  const store = new PolicyMemoryStore(new SemanticFactPolicy(), repository, limits, undefined, () => {
    controller.abort();
  });

  await assert.rejects(
    () => store.write({
      trialId: namespace.trialId,
      task: "support language",
      turnId: "turn-cancelled-after-write",
      output: "Preference: support-language = Spanish",
      now: "2026-09-20T00:01:00.000Z",
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof StudioMemoryCancellationError
      && error.phase === "after-persistence"
      && error.persisted,
  );
  assert.equal((await repository.load()).records.length, 1);
});

test("Memory reports an acknowledgement-unknown cancellation during persistence", async () => {
  const controller = new AbortController();
  const repository = {
    namespace,
    lastLoadRecovered: false,
    async load() { return { schemaVersion: 1 as const, namespace, revision: 0, records: [] }; },
    async seed() { return { state: await this.load(), decisions: [], appliedOperationIds: [] }; },
    async apply() {
      controller.abort();
      throw new Error("simulated persistence interruption");
    },
  };
  const store = new PolicyMemoryStore(new SemanticFactPolicy(), repository, limits);

  await assert.rejects(
    () => store.write({
      trialId: namespace.trialId,
      task: "support language",
      turnId: "turn-cancelled-during-write",
      output: "Preference: support-language = Spanish",
      now: "2026-09-20T00:01:00.000Z",
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof StudioMemoryCancellationError
      && error.phase === "during-persistence"
      && error.persistenceOutcome === "unknown"
      && !error.persisted,
  );
});
