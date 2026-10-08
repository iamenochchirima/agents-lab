import assert from 'node:assert/strict';
import test from 'node:test';
import { contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import type { Json } from '../src/features/lina/contracts/schema';
const payload = (nodeId: string, outputId: string): Record<string, Json> => {
 const branch = contractForNode(nodeId)!.outputs.find(item => item.id === outputId);
 assert.ok(branch, outputId);
 return (branch.example as Record<string, Json>).payload as Record<string, Json>;
};
const record = (value: Json): Record<string, Json> => value as Record<string, Json>;

test('four approval choices have distinct grant lifetime and acknowledged storage semantics', () => {
 const choices = [ ['allow-once', 'logical-operation', 'operation-local', false], ['allow-session', 'permission-session', 'runtime-session-fixture', false], ['allow-always', 'persistent', 'durable-store-fixture', true] ] as const;
 for (const [choice, lifetime, storage, persisted] of choices) {
  const commit = payload('lina-safety-approval', `safety.approval-${choice}`);
  const resolution = record(commit.resolution);
  const candidate = record(commit.grant);
  const applied = payload('lina-safety-grants', `safety.grant-committed-${choice}`);
  const saved = record(applied.grant);
  assert.equal(resolution.selectedChoice, choice);
  assert.equal(resolution.grantLifetime, lifetime);
  assert.equal(candidate.persisted, false, 'Review selection is not durable acknowledgment');
  assert.equal(saved.lifetime, lifetime);
  assert.equal(saved.storage, storage);
  assert.equal(saved.persisted, persisted);
  assert.equal(saved.survivesRuntimeRestart, persisted);
  assert.equal(saved.delegateToChildren, false);
  if (choice === 'allow-session') assert.ok(saved.permissionSessionId);
  else assert.equal(saved.permissionSessionId, null);
 }
 const denial = payload('lina-safety-approval', 'safety.approval-denied');
 assert.equal(denial.status, 'denied');
 assert.equal(denial.permanentDenyCreated, false);
 assert.equal(denial.grantLifetime, 'none');
});

test('unknown grant commit holds dispatch and requests inspection without tool-effect uncertainty', () => {
 const unknown = payload('lina-safety-grants', 'safety.grant-commit-unknown');
 assert.equal(unknown.acknowledged, false);
 assert.equal(unknown.mayDispatch, false);
 assert.equal(unknown.inspectBeforeRetry, true);
 assert.equal(unknown.externalEffectUncertainty, false);
 const inspect = payload('lina-safety-grants', 'safety.grant-inspected');
 assert.equal(inspect.transactionId, unknown.transactionId);
 assert.equal(inspect.replayBeforeInspection, false);
});

test('scheduling evidence cannot replace fresh argument-bound launch authorization', () => {
 const request = payload('lina-tools-permissions', 'tools.safety-operation-requested');
 assert.equal(request.validatedAfterHooks, true);
 const admission = payload('lina-safety-authorize', 'safety.operation-decided');
 assert.equal(admission.permitsPhysicalLaunch, false);
 const permitted = payload('lina-safety-authorize', 'safety.launch-decided');
 const launch = record(permitted.launch);
 assert.equal(permitted.exactLaunchId, launch.launchId);
 assert.equal(permitted.singlePhysicalAttempt, true);
 assert.equal(permitted.dispatcherMustCompareFenceAtLaunch, true);
 assert.equal(permitted.atomicRuntimeEnforcementImplemented, false);
 for (const reason of ['grant-revoked', 'arguments-or-binding-changed', 'policy-generation-changed', 'stop-before-launch', 'grant-store-outcome-unknown']) {
  const denied = payload('lina-safety-authorize', `safety.launch-${reason}`);
  assert.notEqual(denied.status, 'allowed');
  assert.equal(denied.launchPermitRef, null);
  assert.equal(denied.effectOccurred, false);
 }
});

test('resource and prompt approvals retain exact dependency identity through registration and dispatch', () => {
 for (const kind of ['resource-read', 'prompt-get']) {
  const request = payload(`lina-tools-${kind}`, `tools.safety-${kind}-requested`);
  const identity = record(request.identity);
  const operation = record(request.operation);
  assert.equal(identity.operationId, operation.dependencyId);
  assert.equal(identity.ownerNodeId, `lina-tools-${kind}`);
  assert.equal(request.modelRoundStartedByPermission, false);
  const waiting = payload('lina-safety-approval', `safety.${kind === 'resource-read' ? 'resource' : 'prompt'}-approval-waiting`);
  assert.deepEqual(waiting.request, request);
  assert.equal(waiting.registered, false);
  const registered = payload('lina-execution-wait', `execution.safety-${kind}-wait-registered`);
  assert.deepEqual(registered.request, request);
  assert.equal(registered.registered, true);
  const answer = payload(`lina-tools-${kind}`, `tools.safety-${kind}-answer-forwarded`);
  assert.equal(answer.operationId, identity.operationId);
  assert.equal(answer.waitId, registered.waitId);
  assert.equal(answer.promptId, registered.promptId);
  const launch = payload(`lina-tools-${kind}`, `tools.safety-${kind}-launch-requested`);
  assert.deepEqual(launch.request, request);
  assert.deepEqual(launch.currentBinding, request.binding);
  assert.equal(launch.currentArgumentsDigest, operation.argumentDigest);
  const authorized = payload('lina-safety-authorize', `safety.${kind === 'resource-read' ? 'resource' : 'prompt'}-launch-decided`);
  assert.equal(authorized.exactLaunchId, record(authorized.launch).launchId);
 }
});

test('rejected review answers preserve the owning wait and Stop does not fabricate rollback or revoke unrelated grants', () => {
 for (const code of ['wrong-responder', 'wrong-prompt', 'duplicate-answer', 'changed-arguments', 'changed-binding', 'expired-answer']) {
  const rejected = payload('lina-safety-approval', `safety.approval-rejected-${code}`);
  assert.equal(rejected.authorizationGranted, false);
  assert.equal(rejected.owningWaitPreserved, true);
  assert.equal(rejected.siblingEvidencePreserved, true);
 }
 const stop = payload('lina-execution-cancel', 'execution.safety-authorization-cancelled');
 assert.equal(stop.persistentGrantsAutomaticallyRevoked, false);
 assert.equal(stop.alreadyStartedEffectsRolledBack, false);
 assert.equal(stop.siblingEvidencePreserved, true);
});

test('every Safety connection has exact producer event examples for the next inspector', () => {
 for (const suffix of ['tool-request', 'evaluate-policy', 'policy-evaluate', 'evaluate-grants', 'grants-evaluate', 'approval-wait-tools', 'wait-registered', 'approval-answer', 'approval-grants', 'grants-authorize', 'dispatch-authorize', 'authorize-dispatch', 'resource-read-request', 'prompt-get-request']) {
  assert.ok(outputsForEdge(`lina-safety-edge-${suffix}`).length > 0, suffix);
 }
});

test('typed operation choices survive Input and Execution while ordinary clarification remains separate', async () => {
 const { approvalOperation, promptOperation } = await import('../src/features/lina/contracts/shared');
 assert.equal(record(approvalOperation.example).answerKind, 'operation-approval');
 assert.deepEqual(approvalOperation.schema.properties!.answer.enum, ['allow-once', 'allow-session', 'allow-always', 'deny']);
 assert.equal('answerKind' in record(promptOperation.example), false);
 for (const selected of ['allow-once', 'allow-session', 'allow-always', 'deny']) {
  const input = payload('lina-input-prompt', `input.prompt.approval-${selected}`);
  const execution = payload('lina-execution-wait', `execution.wait.approval-${selected}`);
  assert.equal(input.answerKind, 'operation-approval');
  assert.equal(input.answer, selected);
  assert.equal(input.continuationGranted, false);
  assert.equal(execution.choice, selected);
  assert.equal(execution.operationId, input.operationId);
  assert.equal(execution.waitId, input.waitId);
  assert.equal(execution.waitRevision, input.waitRevision);
 }
});
