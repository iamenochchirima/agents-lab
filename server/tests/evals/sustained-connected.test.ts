import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConnectedFixture } from '../../src/evals/connected-fixture.js';
import { fixtureReviewDecision, matchesFixtureState, sustainedTaskCriteria, validateOwnedRestartEvidence, type Scenario } from '../../src/evals/connected.js';
import { argumentDigest } from '../../src/capabilities/reviews/store.js';
import type { RunView } from '../../src/control-plane/application/run-service.js';
import type { InvocationReviewView } from '../../src/capabilities/reviews/contracts.js';

const scenario: Scenario = JSON.parse(await readFile(new URL('../../../lab/scenarios/sustained-connected-review/scenario.json', import.meta.url), 'utf8').catch(() => readFile('../lab/scenarios/sustained-connected-review/scenario.json', 'utf8')));
const namespace = 'cap-sustained-test';
const action = (args: Record<string, unknown>) => ({ requestId: 'review-1', revision: 1, call: { name: 'record_correct', toolCallId: 'original-call', round: 2 }, displayArguments: args }) as InvocationReviewView;

test('sustained decisions authorize only exact declared namespace, owner, record and argument shape', () => {
  const args = { namespace, key: 'cedar', owner: 'Morgan', expectedRevision: 1 };
  assert.equal(fixtureReviewDecision(scenario, scenario.stages[0], action(args), namespace), 'approved');
  assert.equal(fixtureReviewDecision(scenario, scenario.stages[0], action({ ...args, key: 'pine', owner: 'Riley' }), namespace), 'denied');
  for (const invalid of [{ ...args, namespace: 'cap-other' }, { ...args, owner: 'Other' }, { ...args, approvedDate: 'changed' }, { ...args, expectedRevision: 0 }]) {
    assert.throws(() => fixtureReviewDecision(scenario, scenario.stages[0], action(invalid), namespace), /Unexpected action/);
  }
});

test('restart evidence requires an owned replacement with retained storage and original review identity', () => {
  const input = { platform: 'langgraph', runId: 'run-1', action: action({}), waitStartedAt: '2026-10-10T10:00:00Z' };
  const evidence = { platform: 'langgraph', runId: 'run-1', requestId: 'review-1', revision: 1, toolCallId: 'original-call', oldPid: 101, newPid: 102, storageRetained: true, owner: 'test-owned-service', storagePath: '/disposable/state', startedAt: input.waitStartedAt, completedAt: '2026-10-10T10:00:01Z' };
  validateOwnedRestartEvidence(evidence, input);
  for (const invalid of [{ ...evidence, newPid: 101 }, { ...evidence, storageRetained: false }, { ...evidence, toolCallId: 'new-call' }, { ...evidence, startedAt: '2026-10-10T09:00:00Z' }]) {
    assert.throws(() => validateOwnedRestartEvidence(invalid, input), /Restart hook/);
  }
});

test('six-record fixture preserves constraints, revisions and effects across concurrency and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentlab-collection-'));
  let fixture = await startConnectedFixture({ root, port: 0 });
  const state = async () => JSON.parse((await fixture.inject({ method: 'GET', url: `/collection-state/${namespace}` })).body);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await fixture.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).body).result;
  try {
    const before = await state();
    assert.equal(Object.keys(before.records).length, 6);
    const reference = JSON.parse((await fixture.inject({ method: 'GET', url: '/collection-reference' })).body);
    assert.deepEqual(reference, scenario.stages[0].collection!.reference);
    const approved = scenario.stages[0].reviewRules!.filter(rule => rule.decision === 'approved');
    await Promise.all(approved.map(rule => call('collection.correct', { namespace, ...rule.allowedArguments, expectedRevision: 1 })));
    const after = await state();
    assert.equal(after.effectCount, 3); assert.equal(after.effects.length, 3);
    assert.ok(matchesFixtureState(after, scenario.stages[0].expected));
    assert.deepEqual(after.records.pine, before.records.pine);
    for (const key of Object.keys(before.records)) for (const field of ['approvedDate', 'dependency', 'status']) assert.equal(after.records[key][field], before.records[key][field]);
    const stale = await call('collection.correct', { namespace, key: 'cedar', owner: 'Morgan', expectedRevision: 1 });
    assert.equal(stale.structuredContent.code, 'REVISION_CONFLICT');
    assert.equal((await state()).effectCount, 3);
    assert.equal(JSON.parse((await fixture.inject({ method: 'GET', url: `/state/${namespace}` })).body).effectCount, 0);
    await fixture.close(); fixture = await startConnectedFixture({ root, port: 0 });
    assert.deepEqual(await state(), after);
    const other = JSON.parse((await fixture.inject({ method: 'GET', url: '/collection-state/cap-other' })).body);
    assert.equal(other.effectCount, 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('sustained skill grading requires exact admitted receipt and delivery to a later model request', () => {
  const stage = scenario.stages[0]; const toolName = stage.collection!.skillTool;
  const content = JSON.stringify({ name: 'collection-review', packageId: 'record-review-skills', digest: 'digest', trust: 'untrusted', authority: 'none', instructions: 'Preserve dates; verify denied correction.' });
  const receipt = { status: 'complete', toolName, toolCallId: 'skill-call', catalogRevision: 'catalog', fingerprint: argumentDigest({ revision: 'catalog', turnId: 'turn', call: { toolCallId: 'skill-call', name: toolName, arguments: { name: 'collection-review' }, round: 1 } }), result: { status: 'completed', content } };
  const events = [{ kind: 'ToolExecutionCompleted', recordedSequence: 1, payload: { toolName, toolCallId: 'skill-call', round: 1 } }, { kind: 'EvalModelObserved', recordedSequence: 2, payload: { observation: { providerRequest: { messages: [{ role: 'tool', tool_call_id: 'skill-call', content }] } } } }];
  const record = { before: { records: stage.expected.records }, after: { records: stage.expected.records }, reviews: [], output: 'cedar birch maple oak pine willow' };
  const input = { stage, record, run: { events } as unknown as RunView, receipts: [receipt], manifest: { capabilities: { toolCatalog: { revision: 'catalog' } }, context: { turnId: 'turn' } }, namespace };
  assert.equal(sustainedTaskCriteria(input).skillLoaded, true);
  assert.equal(sustainedTaskCriteria({ ...input, receipts: [{ ...receipt, fingerprint: 'another-run' }] }).skillLoaded, false);
  assert.equal(sustainedTaskCriteria({ ...input, run: { events: events.slice(0, 1) } as unknown as RunView }).skillLoaded, false);
  assert.equal(sustainedTaskCriteria(input).originalWaitRetained, false);
  assert.equal(sustainedTaskCriteria(input).restartObserved, false);
});
