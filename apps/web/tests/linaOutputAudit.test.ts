import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture } from '../src/features/lina/architectureDocument';
import { withOutput, createOutputFixtureState, renderOutputFixture, DEFAULT_OUTPUT_SETTINGS, OUTPUT_CASES, registerOutputFixture, type OutputFixtureState, type OutputCase } from '../src/features/lina/outputFixtures';
import { startSimulation, type SimulationEvent } from '../src/features/lina/inputSimulation';
const base: SimulationEvent[] = [{ id: 'saved-final', nodeId: 'lina-input-delivery', update: { detail: 'Saved authoritative fixture answer' } }];
const run = (scenario: OutputCase) => withOutput(base, linaArchitecture, scenario);
const snapshot = (events: SimulationEvent[]): OutputFixtureState => events.filter(e => e.outputSnapshot).at(-1)!.outputSnapshot!;
test('every Output case traverses declared graph edges and retains fixture-only evidence', () => {
    for (const item of OUTPUT_CASES) {
        const events = run(item.value);
        for (const event of events.filter(e => e.outputEvidence)) {
            const edge = linaArchitecture.edges.find(edge => edge.id === event.edgeId);
            assert.ok(edge, `${item.value}: ${event.sourceNodeId} -> ${event.nodeId}`);
            assert.equal(edge.source, event.sourceNodeId);
            assert.equal(edge.target, event.nodeId);
            assert.equal(event.outputSnapshot?.storage, 'fixture-only');
        }
    }
});
test('partial multipart failure retries only unsent part and retains ordered canonical text', () => {
    const state = snapshot(run('partial-success')), obligation = Object.values(state.obligations)[0];
    assert.ok(obligation.parts.length > 2);
    assert.equal(obligation.status, 'accepted');
    assert.equal(obligation.parts[0].attemptIds.length, 1);
    assert.equal(obligation.parts[1].attemptIds.length, 2);
    const started = Object.values(state.attempts);
    assert.deepEqual(started.map(a => a.partId), obligation.parts.flatMap(p => p.attemptIds.map(() => p.id)));
    assert.ok(obligation.parts.every(p => p.payload.codeFenceBalanced));
    const original = state.intents[obligation.outputId].content.text;
    assert.equal(obligation.parts.map(p => p.payload.sourceText).join(''), original);
});
test('fanout partial failure preserves recipient-specific acceptance and failed outcome', () => {
    const state = snapshot(run('fanout-partial')), obligations = Object.values(state.obligations);
    assert.equal(obligations.length, 2);
    assert.equal(obligations.find(o => o.recipient.target.endsWith(':recipient-1'))?.status, 'accepted');
    assert.equal(obligations.find(o => o.recipient.target.endsWith(':recipient-2'))?.status, 'failed');
    assert.notEqual(obligations[0].lane, obligations[1].lane);
});
test('unknown send holds original output and Stop cannot turn it into unsent success', () => {
    const events = run('unknown-send'), state = snapshot(events), obligation = Object.values(state.obligations)[0];
    assert.equal(obligation.status, 'unresolved');
    assert.equal(Object.keys(state.attempts).length, 1);
    assert.equal(obligation.custody, 'retained');
    const stopped = snapshot(withOutput([], linaArchitecture, 'unknown-send', {}, { seed: state, stopped: true }));
    assert.equal(Object.keys(stopped.attempts).length, 1);
    assert.equal(stopped.obligations[obligation.id].status, 'unresolved');
    assert.ok(stopped.stopped);
});
test('required artifact stays retained after transport instead of depending on workspace path', () => {
    const state = snapshot(run('media-only')), artifact = Object.values(state.artifacts)[0];
    assert.equal(artifact.access, 'allowed');
    assert.ok(artifact.bytes.length);
    assert.equal(artifact.cleanup, 'retained');
    assert.ok(['output', 'retained'].includes(artifact.custody));
    assert.ok(artifact.handle?.id);
    assert.equal(Object.values(state.obligations)[0].status, 'accepted');
});
test('WhatsApp prompt rendering keeps fourth choice in typed fallback', () => {
    const choices = ['allow-once', 'allow-session', 'allow-always', 'deny'];
    const parts = renderOutputFixture({ kind: 'prompt', text: 'Review?', choices, canonicalDigest: 'fixture:digest' }, 'whatsapp', DEFAULT_OUTPUT_SETTINGS);
    assert.equal((parts[0].controls as unknown[]).length, 3);
    assert.deepEqual(parts[0].typedAnswers, choices);
});
test('required custody precedes send and release path does not depend on read evidence', () => {
    const events = run('final'), registration = events.findIndex(e => e.sourceNodeId === 'lina-state-record' && e.nodeId === 'lina-output-register');
    const launch = events.findIndex(e => e.nodeId === 'lina-output-send');
    assert.ok(registration >= 0 && launch > registration);
    const receipt = events.find(e => e.edgeId === 'lina-output-edge-register-release');
    assert.ok(receipt, 'Output custody must transfer to its owner before releasing the original turn');
    assert.ok(snapshot(events).observations.every(o => o.fact !== 'read'));
});
test('preview acceptance cannot fulfill required final when final send fails', () => {
    const events = withOutput([{ id: 'visible-delta', nodeId: 'lina-model-invoke', modelEvent: { type: 'text-delta', attemptId: 'attempt:preview:001', text: 'Working' }, update: { detail: 'Visible admitted draft' } }, ...base], linaArchitecture, 'preview-failure');
    const state = snapshot(events), obligations = Object.values(state.obligations);
    assert.ok(obligations.some(o => !o.required && o.status === 'accepted'));
    assert.ok(obligations.some(o => o.required && o.status === 'failed'));
});
test('quiet and unavailable routes never acquire a transport attempt', () => {
    for (const scenario of ['quiet', 'route-missing', 'route-stale', 'policy-denied', 'storage-failure', 'lost-claim'] as const) {
        const state = snapshot(run(scenario));
        assert.equal(Object.keys(state.attempts).length, 0, scenario);
    }
});
test('same delivery identity cannot change recipient or prepared payload across restart', () => {
    const state = snapshot(run('final')), original = Object.values(state.obligations)[0], destinationChanged = structuredClone(original);
    destinationChanged.recipient.target = 'different-recipient';
    assert.equal(registerOutputFixture(state, destinationChanged), 'conflict', 'Target authority is part of immutable obligation identity');
    const bytesChanged = structuredClone(original);
    bytesChanged.parts[0].payload.text = 'Changed';
    assert.equal(registerOutputFixture(state, bytesChanged), 'conflict');
});
test('renderer cannot split code-fence tokens at a native chunk boundary', () => {
    const text = 'x'.repeat(23) + '```json\n' + JSON.stringify({ answer: 4 }) + '\n```';
    const parts = renderOutputFixture({ kind: 'text', text, canonicalDigest: 'fixture:fence' }, 'telegram', { ...DEFAULT_OUTPUT_SETTINGS, partLimit: 24 });
    assert.equal(parts.map(p => p.sourceText).join(''), text);
    assert.ok(parts.every(p => p.codeFenceBalanced));
    assert.ok(parts.every(p => !String(p.sourceText).endsWith('`') || String(p.sourceText).endsWith('```')), 'Chunker must preserve complete delimiter tokens');
});
test('internal child output bypasses transport while main final remains externally addressed', () => {
    const playback = startSimulation('cli', linaArchitecture, false, 'direct-answer', 3, 'fits', 'parallel', 'openai-chat', 'answer', 'policy-allow', [], 'fresh', 'baseline', 'disabled', {}, 'disabled', {}, 'disabled', {}, 'internal').events;
    const state = snapshot(playback), internal = Object.values(state.intents).filter(intent => intent.audience === 'internal');
    assert.ok(internal.length > 0, 'Scenario requires an actual completed child producer');
    for (const intent of internal) {
        assert.equal(intent.producer, 'lina-subagents-return');
        assert.ok(!Object.values(state.obligations).some(obligation => obligation.outputId === intent.id));
    }
    assert.ok(Object.values(state.intents).some(intent => intent.audience === 'external' && intent.finality === 'final'));
});
