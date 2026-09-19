import assert from "node:assert/strict";
import test from "node:test";

import {
  EpisodicLexicalPolicy,
  InMemoryStudioMemoryRepository,
  NoMemoryPolicy,
  PolicyMemoryStore,
  ProceduralCachePolicy,
  SemanticFactPolicy,
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
