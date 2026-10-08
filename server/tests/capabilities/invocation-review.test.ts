import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvocationReviewStore, argumentDigest } from '../../src/capabilities/reviews/store.js';

test('review binds exact action, deduplicates decisions, renews expiry and blocks cancelled dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentlab-review-'));
  let now = Date.now();
  const store = new InvocationReviewStore(root, () => now);
  const proposal = { runId: 'run-review', turnId: 'turn-review', call: { toolCallId: 'call-review', name: 'adjust', arguments: { amount: 500 }, round: 1 }, catalogRevision: 'catalog', sourceDigest: 'source', connectionIdentity: 'owner-resource', argumentDigest: argumentDigest({ amount: 500 }), displayArguments: { amount: 500 } };
  try {
    const initial = await store.propose(proposal);
    const decision = { requestId: initial.requestId, revision: 1, argumentDigest: initial.argumentDigest, decisionId: 'decision-1', decision: 'approved' as const };
    await assert.rejects(store.locked(proposal.runId, () => store.decide(proposal.runId, { ...decision, argumentDigest: argumentDigest({ amount: 900 }) })), /arguments changed/);
    const approved = await store.locked(proposal.runId, () => store.decide(proposal.runId, decision));
    assert.deepEqual(await store.locked(proposal.runId, () => store.decide(proposal.runId, decision)), approved);
    await assert.rejects(store.locked(proposal.runId, () => store.decide(proposal.runId, { ...decision, decision: 'denied' })), /conflicting/);
    now += 16 * 60 * 1000;
    await assert.rejects(store.locked(proposal.runId, () => store.decide(proposal.runId, decision)), /expired/);
    const renewed = await store.propose(proposal);
    assert.equal(renewed.requestId, initial.requestId);
    assert.equal(renewed.revision, 2);
    assert.ok(renewed.renewalId);
    assert.equal(renewed.status, 'pending');
    await assert.rejects(store.locked(proposal.runId, () => store.decide(proposal.runId, decision)), /revision/);
    await assert.rejects(store.propose({ ...proposal, call: { ...proposal.call, arguments: { amount: 900 } }, argumentDigest: argumentDigest({ amount: 900 }) }), /identity changed/);
    await store.cancel(proposal.runId);
    assert.equal((await store.get(proposal.runId, initial.requestId)).status, 'cancelled');
    await assert.rejects(store.locked(proposal.runId, () => store.decide(proposal.runId, { ...decision, revision: 2 })), /cancelled/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
