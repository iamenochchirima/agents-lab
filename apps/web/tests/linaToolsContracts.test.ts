import test from 'node:test';
import assert from 'node:assert/strict';
import { contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import type { Json } from '../src/features/lina/contracts/schema';

function payload(id: string, outputId: string): Record<string, any> {
  const output = contractForNode(`lina-tools-${id}`)?.outputs.find(value => value.id === outputId);
  assert.ok(output, `${id}: missing ${outputId}`);
  return (output.example as Record<string, Json>).payload as Record<string, any>;
}

// These checks audit reference handoffs and example semantics, not an executable
// Tools runtime. The ordinary contract suite separately validates schema shapes.
test('parallel examples retain requested identities, grants, intents and joined results', () => {
  const request = outputsForEdge('lina-tools-edge-execution-resolve').find(value => value.id === 'tools.batch-delegated-parallel')!;
  const requested = (request.example as Record<string, any>).payload;
  const resolved = payload('resolve', 'tools.calls-resolved');
  const allowed = payload('permissions', 'tools.calls-authorized');
  const scheduled = payload('schedule', 'tools.parallel-wave');
  const launched = payload('dispatch', 'tools.calls-dispatched');
  const joined = payload('collect', 'tools.calls-joined');
  const published = payload('publish', 'tools.results-published');
  const ids = requested.batch.calls.map((call: any) => call.callId);
  for (const stage of [resolved, allowed, scheduled, launched, joined]) {
    assert.deepEqual(stage.batch, requested.batch);
    assert.deepEqual(stage.round, requested.round);
    assert.deepEqual(stage.state.limits, requested.state.limits);
  }
  assert.deepEqual(allowed.decisions.map((grant: any) => grant.callId), ids);
  for (const grant of allowed.decisions) {
    const validation = allowed.validations.find((value: any) => value.callId === grant.callId);
    assert.equal(grant.argumentDigest, validation.argumentDigest);
    assert.equal(grant.binding.schemaDigest, validation.schemaDigest);
    assert.equal(grant.binding.catalogRevision, allowed.catalogRevision);
  }
  assert.deepEqual(scheduled.scheduling.waves[0].callIds, ids);
  assert.equal(scheduled.scheduling.waves[0].mode, 'parallel');
  assert.ok(ids.length <= scheduled.scheduling.maxConcurrent);
  assert.deepEqual(launched.intents.map((intent: any) => intent.callId), ids);
  assert.deepEqual(joined.join.settledCallIds, ids);
  assert.deepEqual(joined.join.activeCallIds, []);
  assert.deepEqual(joined.join.unresolvedEffectCallIds, []);
  assert.deepEqual(published.results.map((result: any) => result.callId), ids);
  assert.deepEqual(published.results.map((result: any) => result.value), [4, 6]);
  assert.deepEqual(published.state.results, published.results);
  assert.deepEqual(published.state.limits, requested.state.limits);
});

test('conflicting write examples declare the same resource and ordered single-call waves', () => {
  const scheduled = payload('schedule', 'tools.ordered-waves');
  assert.deepEqual(scheduled.batch.calls.map((call: any) => call.name), ['docs_update', 'docs_update']);
  assert.equal(scheduled.batch.calls[0].arguments.documentId, scheduled.batch.calls[1].arguments.documentId);
  for (const entry of scheduled.resolvedCalls) {
    assert.equal(entry.definition.localExecutionPolicy.effectClass, 'write');
    assert.equal(entry.definition.localExecutionPolicy.parallelEligible, false);
    assert.equal(entry.definition.localExecutionPolicy.conflictScope, 'document:document-demo');
  }
  assert.deepEqual(scheduled.scheduling.waves.map((wave: any) => wave.callIds), [['call-001'], ['call-002']]);
  assert.ok(scheduled.scheduling.waves.every((wave: any) => wave.mode === 'serial' && wave.connectionCapacity === 1));
});

test('uncertain write examples preserve successful siblings and withhold model continuation', () => {
  const unknown = payload('collect', 'tools.effects-unresolved');
  const request = unknown.batch.calls.find((call: any) => call.callId === 'call-001');
  assert.equal(request.name, 'docs_update');
  const intent = unknown.intents.find((value: any) => value.callId === request.callId);
  assert.equal(intent.effectClass, 'write');
  assert.equal(intent.binding.accountId, 'account-demo');
  assert.equal(unknown.readyForModel, false);
  assert.deepEqual(unknown.unresolvedEffectCallIds, ['call-001']);
  assert.deepEqual(unknown.results.map((result: any) => result.callId), ['call-002']);
  assert.equal(unknown.results[0].value, 6);
  const evidence = unknown.outcomes.find((value: any) => value.callId === request.callId);
  assert.equal(evidence.effectCertainty, 'unknown');
  assert.equal(evidence.retry.eligible, false);
  const reconcile = payload('publish', 'tools.reconciliation-required');
  assert.deepEqual(reconcile.pendingCallIds, ['call-001']);
  assert.deepEqual(reconcile.settledResults, unknown.results);
  assert.deepEqual(reconcile.state.results, unknown.results);
});

test('credential and connection examples expose references without raw secrets', () => {
  const forbidden = new Set(['accessToken', 'refreshToken', 'clientSecret', 'codeVerifier', 'pkceVerifier', 'authorizationCode', 'password']);
  const inspect = (value: Json, where: string) => {
    if (Array.isArray(value)) value.forEach(item => inspect(item, where));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `${where} exposes ${key}`);
      inspect(item, `${where}.${key}`);
    }
  };
  for (const suffix of ['config', 'auth', 'connect', 'protocol', 'discover', 'monitor', 'credential-reference', 'credential-retrieve', 'credential-validity', 'credential-authorize', 'credential-store', 'credential-refresh', 'credential-remove']) {
    const contract = contractForNode(`lina-tools-${suffix}`)!;
    for (const input of contract.input.examples) inspect(input.value, `${suffix} input`);
    for (const output of contract.outputs) inspect(output.example, output.id);
  }
  const resumed = payload('auth', 'tools.auth-parallel-batch-resumed');
  assert.equal(resumed.launchPermissionRecheckRequired, true);
  assert.equal(resumed.bindingRecheckRequired, true);
  assert.equal(resumed.round.roundId, 'round-001');
  assert.equal(resumed.state.limits.roundsStarted, 1);
  assert.deepEqual(resumed.batch.calls.map((call: any) => call.callId), ['call-001', 'call-002']);
});
