import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_PROTOCOLS, MODEL_CASES, buildModelFixture, createModelFixtureState, applyModelFixtureEvent, cancelModelFixtureEvent,
  encodeModelFixture, normalizeModelUsage, type ModelFixtureEvent, type ModelProtocol, type ModelContinuation } from '../src/features/lina/modelFixtures';

const run = (protocol: ModelProtocol, modelCase: Parameters<typeof buildModelFixture>[0]['modelCase'] = 'answer') => {
  const fixture = buildModelFixture({ protocol, modelCase, attemptId: 'attempt-001' });
  const state = fixture.events.reduce(applyModelFixtureEvent, createModelFixtureState('attempt-001', protocol));
  return { fixture, state };
};
for (const { value: protocol } of MODEL_PROTOCOLS) {
  test(`${protocol}: terminal barrier preserves independent interleaved calculator calls`, () => {
    const fixture = buildModelFixture({ protocol, modelCase: 'interleaved-tools', attemptId: 'a1', callIds: ['call-A', 'call-B'] });
    let state = createModelFixtureState('a1', protocol);
    let closedPeerWhileFirstOpen = false;
    for (const event of fixture.events) {
      state = applyModelFixtureEvent(state, event);
      if (event.type !== 'terminal') assert.equal(state.outcome, undefined, 'completed draft calls still cannot dispatch');
      if (state.buffers.some(buffer => buffer.itemId === 'tool-1' && buffer.closed) && state.buffers.some(buffer => buffer.itemId === 'tool-0' && !buffer.closed)) closedPeerWhileFirstOpen = true;
    }
    assert.ok(closedPeerWhileFirstOpen);
    assert.equal(state.launchCount, 1);
    assert.equal(state.outcome?.status, 'complete');
    assert.deepEqual(state.outcome?.toolCalls.map(call => [call.callId, call.name, call.arguments]), [['call-A', 'calculator', { expression: '2+2' }], ['call-B', 'calculator', { expression: '3+3' }]]);
  });
  test(`${protocol}: truncated and malformed calls never promote even with a terminal marker`, () => {
    assert.equal(run(protocol, 'truncated').state.outcome?.status, 'incomplete');
    assert.equal(run(protocol, 'malformed').state.outcome?.status, 'malformed');
    for (const modelCase of ['truncated', 'malformed', 'duplicate-calls', 'missing-finish', 'unknown-finish'] as const) assert.deepEqual(run(protocol, modelCase).state.outcome?.toolCalls, []);
    assert.equal(run(protocol, 'duplicate-calls').state.outcome?.failure?.code, 'ambiguous_call_id');
    assert.equal(run(protocol, 'missing-finish').state.outcome?.status, 'unknown');
  });
  test(`${protocol}: prelaunch rejection and metadata waits consume no physical attempt`, () => {
    for (const modelCase of ['unsupported-media', 'unsupported-schema', 'unsupported-setting', 'binding-change', 'budget-change', 'opaque-mismatch', 'credential-wait', 'metadata-credential-wait'] as const) {
      const { fixture, state } = run(protocol, modelCase);
      assert.equal(state.launchCount, 0); assert.equal(fixture.events.length, 0); assert.equal(fixture.outcome.attemptId, null);
      assert.ok(fixture.prelaunchFailure); assert.equal(fixture.outcome.usage.availability, 'unavailable');
    }
    assert.equal(run(protocol, 'binding-change').fixture.reprepare, true);
    assert.equal(run(protocol, 'metadata-credential-wait').fixture.readinessWait, true);
  });
  test(`${protocol}: errors keep failed previews and usage distinct from accepted answers`, () => {
    const after = run(protocol, 'retry-after-output').state;
    assert.equal(after.outcome?.status, 'failed'); assert.match(after.outcome!.text, /Draft/);
    assert.equal(after.outcome?.failure?.retryable, true); assert.equal(after.outcome?.remoteStatus, 'unknown');
    const before = run(protocol, 'retry-before-output').state;
    assert.equal(before.outcome?.text, ''); assert.equal(before.launchCount, 1);
    assert.equal(run(protocol, 'http200-error').state.outcome?.status, 'failed');
    assert.equal(run(protocol, 'context-overflow').state.outcome?.failure?.contextRefresh, true);
  });
  test(`${protocol}: refusal, empty content and unknown names remain distinct`, () => {
    const refusal = run(protocol, 'refusal').state.outcome!;
    assert.equal(refusal.status, 'complete'); assert.ok(['refusal', 'blocked'].includes(refusal.kind)); assert.equal(refusal.toolCalls.length, 0);
    const empty = run(protocol, 'empty').state.outcome!;
    assert.equal(empty.status, 'malformed'); assert.equal(empty.failure?.code, 'empty_terminal_content'); assert.ok(empty.usage.outputTokens! > 0);
    const unknown = run(protocol, 'unknown-tool').state.outcome!;
    assert.equal(unknown.status, 'complete'); assert.equal(unknown.toolCalls[0].catalogMapped, false); assert.equal(unknown.toolCalls[0].name, 'not_registered');
  });
  test(`${protocol}: unavailable and partial usage never become zero`, () => {
    const unavailable = run(protocol, 'usage-unavailable').state.outcome!.usage;
    assert.equal(unavailable.availability, 'unavailable'); assert.equal(unavailable.inputTokens, null); assert.equal(unavailable.totalTokens, null);
    const partial = run(protocol, 'usage-partial').state.outcome!.usage;
    assert.equal(partial.availability, 'partial'); assert.equal(partial.inputTokens, 120);
    assert.equal(run(protocol, 'answer').state.outcome!.usage.availability, 'reported');
  });
  test(`${protocol}: first request has no fabricated tool history and later request retains both siblings`, () => {
    const first = encodeModelFixture({ protocol });
    const body = JSON.stringify(first.wireBody);
    assert.doesNotMatch(body, /tool_result|function_call_output|functionResponse|tool_call_id/);
    const history = [{ callId: 'call-A', name: 'calculator', arguments: { expression: '2+2' }, result: { value: 4 } }, { callId: 'call-B', name: 'calculator', arguments: { expression: '3+3' }, result: { value: 6 } }];
    const later = encodeModelFixture({ protocol, priorToolResults: history });
    assert.equal(later.failure, undefined);
    const laterBody = JSON.stringify(later.wireBody);
    assert.match(laterBody, /2\+2/); assert.match(laterBody, /3\+3/); assert.match(laterBody, /"value":4|\\"value\\":4/); assert.match(laterBody, /"value":6|\\"value\\":6/);
    if (protocol !== 'gemini-generate-content') { assert.match(laterBody, /call-A/); assert.match(laterBody, /call-B/); }
  });
  test(`${protocol}: catalog constraints and transmitted settings survive encoding`, () => {
    const encoded = encodeModelFixture({ protocol, settings: { temperature: 0.2, max_output_tokens: 640 }, requiredMedia: 'image' });
    assert.equal(encoded.failure, undefined);
    assert.deepEqual(encoded.manifest.originalSchema, encoded.manifest.projectedSchema);
    assert.equal(encoded.manifest.originalSchemaDigest, encoded.manifest.projectedSchemaDigest);
    assert.match(JSON.stringify(encoded.wireBody), /"minLength":1/);
    assert.match(JSON.stringify(encoded.wireBody), /"temperature":0.2/);
    assert.equal(encoded.manifest.outputReservation, 640);
    assert.match(JSON.stringify(encoded.wireBody), /fixture\.png/);
  });
}

test('every offered case has deterministic evidence or an explicit no-launch boundary', () => {
  for (const { value: modelCase } of MODEL_CASES) for (const { value: protocol } of MODEL_PROTOCOLS) {
    const a = buildModelFixture({ protocol, modelCase, attemptId: 'fixed' });
    const b = buildModelFixture({ protocol, modelCase, attemptId: 'fixed' });
    assert.deepEqual(a, b); assert.ok(a.outcome); assert.equal(a.binding.synthetic, true);
    assert.ok(a.events.length > 0 || a.prelaunchFailure);
  }
});
test('replayed sequence IDs and superseded attempts are idempotent without shared buffers', () => {
  const fixture = buildModelFixture({ protocol: 'openai-chat', modelCase: 'text-tools', attemptId: 'a1' });
  let state = createModelFixtureState('a1', 'openai-chat');
  for (const event of fixture.events.slice(0, -1)) {
    const prior = state; const priorJson = JSON.stringify(prior);
    state = applyModelFixtureEvent(state, event);
    assert.equal(JSON.stringify(prior), priorJson);
    assert.equal(applyModelFixtureEvent(state, event), state);
  }
  const foreign = { ...fixture.events.at(-1)!, attemptId: 'a2', sequence: 100 };
  assert.equal(applyModelFixtureEvent(state, foreign), state);
  const replacement = createModelFixtureState('a2', 'openai-chat');
  assert.deepEqual(replacement.buffers, []); assert.equal(replacement.usage.inputTokens, null);
});
test('Stop before dispatch and during stream never resurrect after late completion', () => {
  const planned = createModelFixtureState('a1', 'openai-chat');
  const stoppedPlanned = applyModelFixtureEvent(planned, cancelModelFixtureEvent(planned));
  assert.equal(stoppedPlanned.launchCount, 0); assert.equal(stoppedPlanned.outcome?.status, 'aborted');
  const fixture = buildModelFixture({ protocol: 'openai-chat', modelCase: 'text-tools', attemptId: 'a2' });
  let running = fixture.events.slice(0, -1).reduce(applyModelFixtureEvent, createModelFixtureState('a2', 'openai-chat'));
  running = applyModelFixtureEvent(running, cancelModelFixtureEvent(running));
  const late = { ...fixture.events.at(-1)!, sequence: running.lastSequence + 1 };
  const after = applyModelFixtureEvent(running, late);
  assert.equal(after.outcome?.status, 'aborted'); assert.deepEqual(after.outcome?.toolCalls, []); assert.equal(after.launchCount, 1);
  assert.equal(after.outcome?.localSettlement, 'settled'); assert.equal(after.outcome?.remoteStatus, 'unknown');
  assert.equal(after.outcome?.usage.availability, 'unavailable'); assert.match(after.diagnostics.at(-1)!, /Late/);
});
test('late second terminal and relaunch remain diagnostic instead of changing the accepted outcome', () => {
  let { state } = run('openai-responses');
  const outcome = state.outcome;
  const late: ModelFixtureEvent = { type: 'launch', attemptId: state.attemptId, sequence: state.lastSequence + 1, rawEvent: {} };
  state = applyModelFixtureEvent(state, late);
  assert.equal(state.outcome, outcome); assert.equal(state.launchCount, 1); assert.equal(state.lifecycle, 'settled');
});
test('duplicate content identity makes terminal promotion malformed', () => {
  const { fixture } = run('openai-chat', 'interleaved-tools');
  const first = fixture.events.find(event => event.type === 'item-start')!;
  const events = [fixture.events[0], first, { ...first, sequence: first.sequence + 1 }, { type: 'terminal', attemptId: first.attemptId, sequence: 100, status: 'complete', marker: true, finishReason: 'tool_calls', rawEvent: {} } as ModelFixtureEvent];
  const state = events.reduce(applyModelFixtureEvent, createModelFixtureState(first.attemptId, 'openai-chat'));
  assert.equal(state.outcome?.status, 'malformed'); assert.deepEqual(state.outcome?.toolCalls, []);
});
test('provider token counters retain differing cache and thought inclusion semantics', () => {
  const anthropic = normalizeModelUsage('anthropic-messages', { input_tokens: 80, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 20 });
  assert.equal(anthropic.inputTokens, 120); assert.equal(anthropic.totalTokens, 140); assert.equal(anthropic.reasoningTokens, null);
  const sparse = normalizeModelUsage('anthropic-messages', { input_tokens: 80, output_tokens: 20 });
  assert.equal(sparse.inputTokens, null); assert.equal(sparse.availability, 'partial');
  const google = normalizeModelUsage('gemini-generate-content', { promptTokenCount: 120, cachedContentTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 145 });
  assert.equal(google.inputTokens, 120); assert.equal(google.outputTokens, 20); assert.equal(google.reasoningTokens, 5); assert.equal(google.totalTokens, 145);
});
test('cumulative usage replaces prior observations rather than adding twice', () => {
  let state = applyModelFixtureEvent(createModelFixtureState('a1', 'openai-chat'), { type: 'launch', attemptId: 'a1', sequence: 0, rawEvent: {} });
  for (const sequence of [1, 2]) state = applyModelFixtureEvent(state, { type: 'usage', attemptId: 'a1', sequence, usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }, complete: false, rawEvent: {} });
  assert.equal(state.usage.inputTokens, 100); assert.equal(state.usage.totalTokens, 110);
});
test('opaque continuations reject account, agent, provider, binding and history mismatches', () => {
  const continuation: ModelContinuation = { artifactRef: 'opaque:fake', agentId: 'lina', accountId: 'account-demo', protocol: 'gemini-generate-content', bindingRevision: 1, historyRevision: 2, required: true, position: 0 };
  assert.equal(encodeModelFixture({ protocol: 'gemini-generate-content', continuation: [continuation], historyRevision: 2 }).failure, undefined);
  for (const change of [{ agentId: 'child' }, { accountId: 'other' }, { protocol: 'openai-chat' as const }, { bindingRevision: 2 }, { historyRevision: 3 }]) {
    const encoded = encodeModelFixture({ protocol: 'gemini-generate-content', continuation: [{ ...continuation, ...change }], historyRevision: 2 });
    assert.equal(encoded.failure?.code, 'incompatible_continuation');
  }
});
test('request sizing, settings and capability currentness are explicit prelaunch checks', () => {
  assert.equal(encodeModelFixture({ protocol: 'openai-chat', inputTokens: 4000, maxOutputTokens: 512 }).failure?.contextRefresh, true);
  assert.equal(encodeModelFixture({ protocol: 'openai-chat', capabilityRevision: 2, expectedCapabilityRevision: 1 }).failure?.reprepare, true);
  assert.equal(encodeModelFixture({ protocol: 'openai-chat', settings: { max_output_tokens: '512' } }).failure?.code, 'unsupported_fixture_setting');
  assert.equal(encodeModelFixture({ protocol: 'openai-chat', settings: { temperature: 3 } }).failure?.code, 'unsupported_fixture_setting');
});
test('explicit continuation is not lost through terminal normalization', () => {
  const fixture = buildModelFixture({ protocol: 'openai-chat', modelCase: 'answer', attemptId: 'a1', responseKind: 'continuation' });
  const state = fixture.events.reduce(applyModelFixtureEvent, createModelFixtureState('a1', 'openai-chat'));
  assert.equal(state.outcome?.kind, 'continuation'); assert.equal(state.outcome?.continuationHint, true);
});
test('optional foreign continuation is omitted explicitly and never appears in provider history', () => {
  const foreign: ModelContinuation = { artifactRef: 'opaque:foreign', agentId: 'other', accountId: 'account-demo', protocol: 'gemini-generate-content', bindingRevision: 1, historyRevision: 1, required: false, position: 0 };
  const encoded = encodeModelFixture({ protocol: 'gemini-generate-content', continuation: [foreign], includePriorToolResult: true });
  assert.equal(encoded.failure, undefined); assert.deepEqual(encoded.manifest.continuationRefs, []);
  assert.doesNotMatch(JSON.stringify(encoded.wireBody), /opaque:foreign/);
  assert.match(encoded.manifest.transformations.join(' '), /Optional incompatible continuation omitted/);
});
test('reprepared profile and exact snapshot revisions survive the next launch fixture', () => {
  const fixture = buildModelFixture({ protocol: 'openai-chat', modelCase: 'answer', attemptId: 'a1', encodeInput: { bindingRevision: 2, capabilityRevision: 3, snapshotRef: 'snapshot:new-generation', maxOutputTokens: 768 } });
  assert.equal(fixture.encodedRequest.binding.bindingRevision, 2); assert.equal(fixture.encodedRequest.binding.capabilityRevision, 3);
  assert.equal(fixture.encodedRequest.snapshotRef, 'snapshot:new-generation'); assert.equal(fixture.encodedRequest.manifest.outputReservation, 768);
});
test('unrecognized raw finish reason cannot be promoted by a nominal complete status', () => {
  const fixture = buildModelFixture({ protocol: 'openai-chat', modelCase: 'interleaved-tools', attemptId: 'a1' });
  const events = fixture.events.map(event => event.type === 'terminal' ? { ...event, finishReason: 'unknown-future-reason' } : event);
  const state = events.reduce(applyModelFixtureEvent, createModelFixtureState('a1', 'openai-chat'));
  assert.equal(state.outcome?.status, 'unknown'); assert.deepEqual(state.outcome?.toolCalls, []);
});
