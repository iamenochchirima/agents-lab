import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { startSimulation, advanceSimulation, answerSimulation, stopSimulation, type SimulationState, type SimulationChannel } from '../src/features/lina/inputSimulation';
import type { OutputCase } from '../src/features/lina/outputFixtures';
import { attachOutputState } from '../src/features/lina/outputState';
const start = (scenario: OutputCase, channel: SimulationChannel = 'cli') => startSimulation(channel, document, false, 'direct-answer', 3, 'fits', 'parallel', 'openai-chat', 'answer', 'policy-allow', [], 'fresh', 'baseline', 'disabled', {}, 'disabled', {}, 'disabled', {}, scenario);
function walk(state: SimulationState, predicate: (state: SimulationState) => boolean = state => ['completed', 'waiting', 'blocked'].includes(state.status)) { for (let i = 0; i < 5000 && !predicate(state); i++)
    state = advanceSimulation(state, document); assert.ok(predicate(state), `Playback failed to reach requested boundary: ${state.detail}`); assert.notEqual(state.status, 'blocked', state.error); return state; }
function finish(state: SimulationState) { for (let i = 0; i < 5000 && state.status !== 'completed'; i++) {
    assert.notEqual(state.status, 'blocked', state.error);
    state = state.status === 'waiting' ? answerSimulation(state, document, state.wait?.kind === 'approval' ? 'allow-once' : state.wait?.kind === 'output-policy' ? 'allow-once' : state.wait?.kind === 'output-receipt' ? 'ready' : 'known-success') : advanceSimulation(state, document);
} assert.equal(state.status, 'completed'); return state; }
const obligations = (state: SimulationState) => Object.values(state.outputSnapshot?.obligations ?? {});
test('actual unknown delivery rejects stale identity then resolves original send without another model request', () => {
    const waiting = walk(start('unknown-send'));
    assert.equal(waiting.wait?.owner, 'output');
    assert.equal(waiting.wait?.kind, 'output-reconciliation');
    const outputId = obligations(waiting)[0].outputId, attempts = waiting.attempts;
    const stale = answerSimulation(waiting, document, 'known-success', 'unrelated-wait');
    assert.equal(stale.wait?.id, waiting.wait?.id);
    assert.equal(stale.step, waiting.step);
    const wrongAccount = answerSimulation(waiting, document, 'wrong-account');
    assert.equal(wrongAccount.wait?.id, waiting.wait?.id);
    const done = finish(answerSimulation(waiting, document, 'known-success'));
    assert.equal(done.attempts, attempts);
    assert.equal(obligations(done)[0].outputId, outputId);
    assert.equal(Object.keys(done.outputSnapshot!.attempts).length, 1);
    assert.equal(obligations(done)[0].status, 'accepted');
});
for (const scenario of ['delivery-threshold', 'read-threshold'] as const)
    test(`WhatsApp ${scenario} waits for native receipt while CLI reports unsupported`, () => {
        const waiting = walk(start(scenario, 'whatsapp'));
        assert.equal(waiting.wait?.kind, 'output-receipt');
        assert.equal(obligations(waiting)[0].status, 'pending');
        assert.ok(waiting.outputSnapshot?.observations.every(observation => observation.fact === 'accepted'));
        const done = finish(answerSimulation(waiting, document, 'ready'));
        assert.equal(obligations(done)[0].status, 'accepted');
        assert.ok(done.outputSnapshot?.observations.some(observation => observation.fact === (scenario === 'read-threshold' ? 'read' : 'delivered')));
        const cli = finish(start(scenario));
        assert.ok(!cli.events.some(event => event.wait?.kind === 'output-receipt'));
        assert.ok(cli.outputSnapshot?.observations.every(observation => !['delivered', 'read'].includes(observation.fact)));
    });
test('actual four-choice approval prompt cannot release reviewed turn before the user decides', () => {
    const waiting = walk(start('prompt-fallback', 'whatsapp'));
    assert.equal(waiting.wait?.kind, 'approval');
    assert.ok(obligations(waiting).some(obligation => obligation.status === 'accepted'));
    const delivered = waiting.events.slice(0, waiting.step + 1);
    assert.ok(!delivered.some(event => event.edgeId === 'lina-output-edge-register-release'), 'Prompt custody is not terminal answer custody');
    assert.ok(!delivered.some(event => event.nodeId === 'lina-execution-release'), 'Reviewed turn still owns its approval wait');
    const done = finish(answerSimulation(waiting, document, 'allow-once'));
    assert.ok(done.results.some(result => result.status === 'success'));
    assert.equal(done.wait, undefined);
});
test('unknown upload retains original upload identity and bytes through matched reconciliation', () => {
    const waiting = walk(start('upload-unknown'));
    assert.equal(waiting.wait?.owner, 'output');
    const artifact = Object.values(waiting.outputSnapshot!.artifacts)[0];
    assert.equal(artifact.upload, 'unknown');
    assert.equal(artifact.cleanup, 'retained');
    assert.ok(artifact.bytes.length);
    const originalAttempt = artifact.uploadAttempt!.id;
    const done = finish(answerSimulation(waiting, document, 'known-success'));
    assert.equal(Object.values(done.outputSnapshot!.artifacts)[0].uploadAttempt!.id, originalAttempt);
    assert.equal(obligations(done)[0].status, 'accepted');
});
test('actual fanout preserves successful recipient while another fails', () => {
    const done = finish(start('fanout-partial', 'telegram'));
    assert.equal(obligations(done).length, 2);
    assert.equal(obligations(done).find(obligation => obligation.recipient.target.endsWith(':recipient-1'))?.status, 'accepted');
    assert.equal(obligations(done).find(obligation => obligation.recipient.target.endsWith(':recipient-2'))?.status, 'failed');
});
test('Stop before native dispatch prevents new send; Stop after send-start retains its original effect', () => {
    const before = walk(start('final'), state => state.outputSnapshot !== undefined && obligations(state).length > 0 && Object.keys(state.outputSnapshot.attempts).length === 0);
    const cancelled = finish(stopSimulation(before, document));
    assert.equal(Object.keys(cancelled.outputSnapshot!.attempts).length, 0);
    const started = walk(start('unknown-send'), state => Object.values(state.outputSnapshot?.attempts ?? {}).some(attempt => attempt.sendStarted));
    const ids = Object.keys(started.outputSnapshot!.attempts), stopped = walk(stopSimulation(started, document));
    assert.deepEqual(Object.keys(stopped.outputSnapshot!.attempts), ids);
    assert.ok(obligations(stopped).some(obligation => obligation.status === 'unresolved'));
    const resolved = finish(answerSimulation(stopped, document, 'known-success'));
    assert.deepEqual(Object.keys(resolved.outputSnapshot!.attempts), ids);
    assert.ok(resolved.stopRequested);
});
test('fresh State recovery restores current Output ledger while prior execution checkpoint stays immutable', () => {
    const done = finish(start('final'));
    assert.ok(done.stateSnapshot?.records['output-ledger:cli']);
    const journal = JSON.parse(JSON.stringify(done.stateSnapshot)) as NonNullable<SimulationState['stateSnapshot']>, checkpoint = journal.checkpoints[0];
    assert.ok(checkpoint);
    const oldCheckpoint = structuredClone(checkpoint);
    const expected = journal.records['output-ledger:cli'].payload;
    assert.ok(Object.values((expected as NonNullable<SimulationState['outputSnapshot']>).obligations).every(obligation => obligation.status === 'accepted'));
    const recovered = attachOutputState([{ id: 'fresh-output-recovery', nodeId: 'lina-state-recover', update: { detail: 'Restore committed execution checkpoint plus independent current delivery ledger' }, stateSnapshot: journal, stateRestore: structuredClone(checkpoint.restore) }], 'cli');
    assert.deepEqual(recovered[0].stateRestore?.outputSnapshot, expected, 'Recovery must load supplied durable Output ledger, not an earlier process-memory cache');
    assert.deepEqual(journal.checkpoints[0], oldCheckpoint, 'Restoring independent delivery state must not rewrite historical execution checkpoints');
});
test('actual confirmed tool send suppresses only identical final for the same bound account and recipient', () => {
    const done = finish(start('tool-dedupe', 'telegram')), intents = Object.values(done.outputSnapshot!.intents), final = intents.find(intent => intent.finality === 'final')!;
    assert.equal(final.suppressed, 'confirmed-same-target-digest');
    assert.ok(!obligations(done).some(obligation => obligation.outputId === final.id));
    const confirmed = obligations(done).find(obligation => done.outputSnapshot!.intents[obligation.outputId].producer === 'lina-tools-dispatch')!;
    assert.equal(confirmed.status, 'accepted');
    assert.equal(confirmed.recipient.accountId, 'account-fixture:telegram');
    assert.equal(confirmed.recipient.target, 'telegram:recipient-1');
    const distinct = finish(start('distinct-tool-content', 'telegram'));
    assert.ok(obligations(distinct).some(obligation => distinct.outputSnapshot!.intents[obligation.outputId].finality === 'final' && obligation.status === 'accepted'));
});
