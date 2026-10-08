import test from 'node:test';
import assert from 'node:assert/strict';
import { contractForNode } from '../src/features/lina/contracts/nodeContracts';
import { linaArchitecture } from '../src/features/lina/architectureDocument';

function branch(node: string, id: string): Record<string, any> {
  const value = contractForNode(`lina-${node}`)?.outputs.find(value => value.id === id);
  assert.ok(value, `${node} / ${id}`);
  return (value.example as Record<string, any>).payload;
}
function received(node: string, edge: string, id: string): Record<string, any> {
  const example = contractForNode(`lina-${node}`)?.input.examples.find(value => value.edgeId === edge && (value.value as any).event.kind === id);
  assert.ok(example, `${node} receives ${id}`);
  return (example.value as any).event.payload;
}

test('capability resolution returns to the same preparation without an inference launch', () => {
  const request = branch('context-load', 'model.capabilities-requested');
  const resolved = branch('model-resolve', 'model.capabilities-ready');
  const ready = branch('context-publish', 'context.ready');
  assert.deepEqual(resolved.request, request);
  assert.equal(request.identity.preparationId, ready.sourceRequest.preparationId);
  assert.equal(request.identity.turnId, ready.state.turn.turnId);
  assert.equal(request.identity.conversationId, ready.state.turn.conversationId);
  assert.equal(request.identity.attemptId, null);
  assert.equal(resolved.modelAttemptLaunched, false);
  assert.equal(resolved.resumeSamePreparation, true);
  assert.deepEqual(ready.contextSnapshot.model.binding, resolved.binding);
  assert.deepEqual(ready.contextSnapshot.model.capabilities, resolved.capabilities);
  assert.deepEqual(ready.contextSnapshot.model.budgetProfile, resolved.binding.budgetProfile);
  assert.equal(ready.contextSnapshot.model.metadataSource, 'versioned-design-fixture');
  assert.equal(ready.contextSnapshot.model.providerInvokedDuringPreparation, false);
  assert.equal(resolved.capabilities.cache.state, 'unknown');
});

test('invocation retains accepted Context catalog and provider budget identities without launch authority from the snapshot', () => {
  const ready = branch('context-publish', 'context.ready');
  const intent = branch('execution-model', 'model.invocation-requested');
  const snapshot = ready.contextSnapshot;
  assert.equal(intent.contextSnapshotRef, snapshot.contextSnapshotRef);
  assert.equal(intent.identity.preparationId, ready.sourceRequest.preparationId);
  assert.equal(intent.catalogRevision, snapshot.catalogBinding.catalogRevision);
  assert.equal(intent.catalogBindingRef, snapshot.catalogBinding.catalogRef);
  assert.deepEqual(intent.requiredSchemaDigests, snapshot.catalogBinding.entries.map((entry: any) => entry.schemaDigest));
  assert.equal(intent.requestedBindingRef, snapshot.model.binding.bindingRef);
  assert.equal(intent.requiredCapabilitiesRef, snapshot.model.capabilities.capabilitiesRef);
  assert.equal(intent.requiredBudgetProfileRef, snapshot.model.budgetProfile.budgetProfileRef);
  assert.equal(intent.requiredCodecRevision, snapshot.model.binding.codecRevision);
  assert.equal(intent.snapshotGrantsLaunchPermission, false);
  assert.equal(intent.modelAttemptLaunched, false);
  assert.deepEqual(intent.executionState, ready.state);
  assert.equal(intent.executionState.limits.attempts, 0);
});

test('metadata and invocation credential completions retain purpose and private provider account scope', () => {
  for (const metadata of [false, true]) {
    const prefix = metadata ? 'model.metadata-' : 'model.';
    const request = branch('execution-wait', `${prefix}credential-readiness-requested`);
    const ready = branch('tools-auth', metadata ? 'tools.model-metadata-credential-ready' : 'tools.model-credential-ready');
    const resume = branch('execution-wait', `${prefix}readiness-resume`);
    assert.equal(request.owner, 'model');
    assert.equal(request.credentialProtocol, 'native-provider-auth');
    assert.equal(request.wait.purpose, metadata ? 'capabilities' : 'invocation');
    assert.deepEqual(ready.wait, request.wait);
    assert.deepEqual(resume.wait, ready.wait);
    assert.deepEqual(resume.completion, ready);
    assert.equal(ready.verifiedAccountId, request.accountId);
    assert.equal(request.providerAudienceRef, request.wait.providerAudienceRef);
    assert.equal(request.secretIncluded, false);
    assert.equal(ready.secretIncluded, false);
    assert.equal(request.wait.identity.attemptId, null);
    assert.equal(request.wait.modelAttemptLaunched, false);
    assert.equal(resume.modelAttemptLaunched, false);
    assert.equal(resume.continuationConsumedOnce, true);
    assert.equal('batchId' in request.wait, false);
    assert.equal('callId' in request.wait, false);
  }
});

test('cancellation invalidates pending readiness and signals the exact launched attempt without starting another', () => {
  const pending = branch('execution-cancel', 'model.intent-cancelled');
  assert.equal(pending.identity.attemptId, null);
  assert.equal(pending.invocationRequested, false);
  assert.equal(pending.pendingReadinessInvalidated, true);
  for (const id of ['model.readiness-cancelled', 'model.metadata-readiness-cancelled']) {
    const value = branch('execution-cancel', id);
    assert.equal(value.continuationInvalidated, true);
    assert.equal(value.modelAttemptLaunched, false);
  }
  const signal = branch('execution-cancel', 'execution.provider-cancellation-requested');
  const forwarded = branch('execution-model', 'model.abort-requested');
  assert.deepEqual(forwarded, signal);
  assert.deepEqual(received('model-invoke', 'lina-model-edge-cancel-invoke', 'model.abort-requested'), signal);
  assert.equal(signal.identity.attemptId, signal.attemptId);
  assert.equal(signal.invocationRequested, false);
  assert.equal(signal.remoteCancellationConfirmed, false);
  const resume = branch('execution-wait', 'model.settlement-resume');
  assert.equal(resume.wait.identity.attemptId, signal.attemptId);
  assert.equal(resume.resumeSameAttempt, true);
  assert.equal(resume.invocationRequested, false);
});

test('all normalized outcomes arrive at Execution intact and malformed output never becomes a complete call', () => {
  const normalize = contractForNode('lina-model-normalize')!;
  for (const value of normalize.outputs.filter(value => value.edgeIds.includes('lina-model-edge-normalize-decide'))) {
    assert.deepEqual(received('execution-decide', 'lina-model-edge-normalize-decide', value.id), (value.example as any).payload);
  }
  for (const id of ['model.outcome-truncated', 'model.outcome-malformed', 'model.outcome-duplicate-call-id', 'model.outcome-missing-terminal', 'model.outcome-failed-after-output']) {
    const value = branch('model-normalize', id);
    assert.deepEqual(value.toolCalls, []);
    assert.equal(value.textFinalCandidate, false);
    assert.ok(value.rawEvidenceRef);
    assert.equal(value.grantsToolPermission, false);
  }
  const calls = branch('model-normalize', 'model.outcome-calls');
  assert.equal(calls.toolCalls.length, 2);
  assert.equal(new Set(calls.toolCalls.map((call: any) => call.callId)).size, 2);
  assert.ok(calls.toolCalls.every((call: any) => call.providerConfirmedComplete && !call.schemaValidated && !call.executionAuthorized));
  const unavailable = branch('model-normalize', 'model.outcome-unavailable-usage');
  assert.equal(unavailable.usage.availability, 'unavailable');
  assert.equal(unavailable.usage.total, null);
  assert.equal(unavailable.usage.cost, null);
  const prelaunch = branch('model-normalize', 'model.outcome-prelaunch-failed');
  assert.equal(prelaunch.executionState.limits.attempts, 0);
  assert.equal(prelaunch.identity.attemptId, null);
  assert.equal(prelaunch.providerResponseId, null);
  const candidate = branch('execution-decide', 'execution.normalized-answer-candidate');
  assert.deepEqual(candidate.modelOutcome, branch('model-normalize', 'model.outcome-ready'));
  assert.deepEqual(candidate.state, candidate.modelOutcome.executionState);
  assert.deepEqual(candidate.round, candidate.modelOutcome.round);
  assert.equal(linaArchitecture.edges.some(edge => edge.source === 'lina-execution-model' && edge.target === 'lina-execution-decide'), false);
});


test('complete call batches and recovery retain exact Model evidence across coordinator handoffs', () => {
  for (const [source, decisionId, delegatedId] of [
    ['model.outcome-calls', 'execution.normalized-tool-batch', 'tools.normalized-tool-batch-delegated'],
    ['model.outcome-text-and-calls', 'execution.normalized-text-and-tool-batch', 'tools.normalized-text-and-tool-batch-delegated'],
  ]) {
    const outcome = branch('model-normalize', source);
    const decision = branch('execution-decide', decisionId);
    const delegated = branch('execution-tools', delegatedId);
    assert.deepEqual(decision.modelOutcome, outcome);
    assert.deepEqual(decision.state, outcome.executionState);
    assert.deepEqual(decision.round, outcome.round);
    assert.deepEqual(decision.batch.calls, outcome.toolCalls.map((call: any) => ({ callId: call.callId, name: call.name, arguments: call.arguments })));
    assert.deepEqual(delegated, decision);
    assert.deepEqual(received('tools-resolve', 'lina-tools-edge-execution-resolve', delegatedId), delegated);
    assert.equal(decision.accompanyingTextIsFinal, false);
  }
  const failed = branch('model-normalize', 'model.outcome-retryable-failure');
  const recovery = branch('execution-recover', 'execution.normalized-retry-preparation');
  assert.deepEqual(recovery.modelOutcome, failed);
  assert.deepEqual(recovery.round, failed.round);
  assert.equal(recovery.state.limits.roundsStarted, failed.executionState.limits.roundsStarted);
  assert.equal(recovery.state.limits.attempts, failed.executionState.limits.attempts);
  assert.equal(recovery.state.limits.retriesRemaining, failed.executionState.limits.retriesRemaining - 1);
  assert.equal(recovery.freshAttemptNotYetLaunched, true);
  const prelaunch = branch('execution-decide', 'execution.normalized-prelaunch-failure');
  assert.deepEqual(prelaunch.modelOutcome, branch('model-normalize', 'model.outcome-prelaunch-failed'));
});
