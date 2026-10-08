import assert from 'node:assert/strict';
import test from 'node:test';
import { STATE_REQUEST_ROUTES } from '../src/features/lina/stateBlock';
import { statePersistenceContracts, attachStateProducerHandoffs, stateRequestForRoute } from '../src/features/lina/contracts/statePersistence';
import { stateCheckpointManifest, stateRecordsByKind } from '../src/features/lina/contracts/stateRecords';
import type { ContractDefinition, Json, Payload } from '../src/features/lina/contracts/schema';
const record = (value: Json) => value as Record<string, Json>;
const branch = (phase: string, result: string) => {
 const output = statePersistenceContracts.flatMap(node => node.outputs).find(item => item.id === `state.${phase}.${result}`);
 assert.ok(output, `${phase}.${result}`);
 return record(record(output.example).payload);
};
const request = (phase: string, command?: string): Payload => {
 const route = STATE_REQUEST_ROUTES.find(item => item.phase === phase);
 assert.ok(route, phase);
 return stateRequestForRoute(route, command);
};

test('every State request and return preserves the same requester phase and transaction identity', () => {
 const definitions: ContractDefinition[] = [...new Set(STATE_REQUEST_ROUTES.map(route => route.source))].map(nodeId => ({ nodeId, context: { schema: {}, example: {} }, contextSource: 'test', reads: [], writes: [], rules: [], outputs: [] }));
 attachStateProducerHandoffs(definitions);
 for (const route of STATE_REQUEST_ROUTES) {
  const requests = definitions.find(node => node.nodeId === route.source)!.outputs.filter(output => output.edgeIds.includes(route.id));
  assert.ok(requests.length, route.id);
  const replies = statePersistenceContracts.find(node => node.nodeId === route.target)!.outputs.filter(output => output.edgeIds.includes(route.returnId));
  assert.ok(replies.length, route.returnId);
  for (const reply of replies) {
   const payload = record(record(reply.example).payload);
   const original = record(payload.request);
   assert.equal(record(original.requester).nodeId, route.source);
   assert.equal(record(original.requester).phase, route.phase);
   assert.equal(payload.requestId, original.requestId);
   assert.equal(payload.transactionId, original.transactionId);
   assert.equal(record(payload.returnTo).nodeId, route.returnTarget);
   assert.equal(record(payload.returnTo).requesterPhase, route.phase);
  }
 }
});

test('acceptance requires one acknowledged record-set boundary; uncertain write inspection cannot prove effect absence', () => {
 const acceptance = record(request('commit-acceptance').example);
 assert.equal(acceptance.requiredCommitBoundary, 'all-listed-records');
 assert.deepEqual((acceptance.records as Json[]).map(value => record(value).kind), ['accepted-input', 'input-receipt']);
 for (const status of ['conflict', 'failed', 'unknown']) {
  const outcome = branch('commit-acceptance', `record-${status}`);
  assert.equal(outcome.acknowledgedRevision, null);
  assert.equal(outcome.acknowledged, false);
  assert.equal(outcome.mayAdvanceRequester, false);
  assert.equal(outcome.inspectBeforeRetry, status === 'unknown');
 }
 const duplicate = branch('commit-acceptance', 'record-already-applied');
 assert.equal(duplicate.acknowledged, true);
 assert.ok(duplicate.commitEvidenceRef);
 const absent = branch('inspect-acceptance', 'transaction-absent');
 const uncertain = branch('inspect-acceptance', 'transaction-still-unknown');
 assert.equal(record(absent.inspection).outcome, 'absent');
 assert.equal(record(uncertain.inspection).outcome, 'still-unknown');
 assert.equal(record(absent.inspection).effectAbsenceProven, false);
 assert.equal(absent.transactionId, branch('commit-acceptance', 'record-unknown').transactionId);
 assert.equal(record(absent.request).requestFingerprint, acceptance.requestFingerprint);
});

test('owner transitions are conditional and wait/Stop/grant commands retain their exact lifecycle facts', () => {
 const recovered = record(request('reacquire-owner').example);
 assert.equal(recovered.executionFence, 8);
 const newOwner = record(record((recovered.records as Json[])[0]).payload);
 assert.equal(newOwner.executionFence, 9);
 assert.equal(newOwner.ownerRevision, 5);
 const released = record(record((record(request('release-owner').example).records as Json[])[0]).payload);
 assert.equal(released.status, 'released');
 for (const [command, expected] of [['register-wait', 'registered'], ['consume-wait', 'consumed'], ['cancel-wait', 'cancelled']]) {
  const wait = record(record((record(request('persist-wait', command).example).records as Json[])[0]).payload);
  assert.equal(wait.status, expected);
  assert.equal(wait.operationId, 'call-002');
  assert.equal(wait.promptId, 'prompt:call-002:1');
  assert.ok(wait.continuationRef);
 }
 const stop = record(record(stateRecordsByKind['stop-intent'].example).payload);
 assert.equal(stop.pendingLaunchesInvalidated, true);
 assert.equal(stop.startedEffectsRolledBack, false);
 const grant = record(record(stateRecordsByKind['permission-grant'].example).payload);
 assert.equal(grant.lifetime, 'persistent');
 assert.equal(grant.permissionSessionId, null);
 assert.equal(grant.delegateToChildren, false);
});

test('intent and result receipts cannot authorize a physical launch or recursively dispatch completion', () => {
 const intent = record(record((record(request('record-tool-intent').example).records as Json[])[0]).payload);
 const outcome = record(record((record(request('record-tool-outcome').example).records as Json[])[0]).payload);
 assert.equal(intent.effectStatus, 'known-unstarted');
 assert.equal(intent.resultRef, null);
 assert.equal(outcome.effectStatus, 'complete');
 assert.equal(outcome.operationId, intent.operationId);
 assert.ok(outcome.resultRef);
 const receipt = branch('record-tool-outcome', 'record-applied');
 assert.equal(record(receipt.returnTo).nodeId, 'lina-tools-collect');
 assert.equal(receipt.grantsPermissionToLaunch, false);
 assert.equal(receipt.externalEffectOccurred, false, 'Storage acknowledgment does not infer external effects');
 const model = record(record((record(request('record-model-intent').example).records as Json[])[0]).payload);
 assert.equal(model.ownerNodeId, 'lina-model-invoke');
 assert.equal(model.operationId, record(request('record-model-intent').example).operationId);
 assert.equal(intent.operationId, record(request('record-tool-intent').example).operationId);
});

test('checkpoint fragments are unusable; committed manifests retain exact completed siblings and pending waits', () => {
 for (const status of ['incomplete', 'conflict', 'failed', 'unknown']) {
  const result = branch('tool-boundary', `checkpoint-${status}`);
  assert.equal(result.usableRecoveryCandidate, false);
  assert.equal(result.checkpointRevision, null);
  assert.equal(result.committedFragmentsAloneUsable, false);
 }
 assert.equal(branch('tool-boundary', 'checkpoint-committed').usableRecoveryCandidate, true);
 const manifest = record(stateCheckpointManifest.example);
 assert.equal(record((manifest.settledWork as Json[])[0]).operationId, 'call-001');
 assert.equal(record((manifest.pendingWork as Json[])[0]).operationId, 'call-002');
 assert.equal(record((manifest.pendingWork as Json[])[0]).launched, false);
 assert.equal(manifest.containsCredentials, false);
 assert.equal(manifest.stopIntentRef, null);
});

test('recovery proposals restore correlated waits and reconcile uncertain effects without dispatch authority', () => {
 for (const status of ['resume', 'restore-waits', 'reconcile', 'required-review', 'reject']) {
  const output = statePersistenceContracts.find(node => node.nodeId === 'lina-state-recover')!.outputs.find(item => item.id === `state.recovery-plan-${status}`)!;
  const result = record(record(output.example).payload);
  assert.deepEqual(output.edgeIds, ['lina-state-edge-recovery-plan']);
  assert.equal(result.relaunchAuthorized, false);
  assert.equal(result.dispatchesPhysicalEffects, false);
  assert.equal(result.sessionGrantsSurviveRestart, false);
  assert.equal(result.currentPolicyRecheckRequired, true);
  assert.equal(result.currentBindingRecheckRequired, true);
  if (status === 'restore-waits') assert.deepEqual(result.restoredWaitIds, ['wait:approval:call-002']);
  if (status === 'reconcile') {
   assert.equal(result.resumeNodeId, 'lina-input-reconcile');
   assert.deepEqual(result.unresolvedOperationIds, ['call-003']);
  }
  if (status === 'reject' || status === 'required-review') {
   assert.equal(result.ownerReacquired, false);
   assert.equal(result.resumeNodeId, null);
  }
 }
});

test('delivery obligations retain reply artifacts and never request an agent rerun to rebuild them', () => {
 const delivery = record(record(stateRecordsByKind['delivery-obligation'].example).payload);
 assert.equal(delivery.rerunAgentToRecreateReply, false);
 assert.ok(delivery.replyArtifactRef);
 assert.ok(delivery.deliveryId);
 const loaded = branch('read-history', 'load-unavailable');
 assert.equal(loaded.failedReadMayInitializeEmptyHistory, false);
 assert.deepEqual(loaded.records, []);
});
