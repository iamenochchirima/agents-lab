import assert from 'node:assert/strict';
import test from 'node:test';
import { PLANNING_EDGES, PLANNING_STATE_ROUTES } from '../src/features/lina/planningBlock';
import { planningTaskContracts, planningPhasePayload, planningStatuses } from '../src/features/lina/contracts/planningTasks';
import { contractDefinitions, contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import { planningCommand, planningDependency, planningPlan, planningPolicy, planningProjection } from '../src/features/lina/contracts/planningRecords';
import { stateCheckpointManifest, stateRecordsByKind } from '../src/features/lina/contracts/stateRecords';
import { contextCandidate, contextSnapshot } from '../src/features/lina/contracts/contextAssembly';
import type { Json } from '../src/features/lina/contracts/schema';
const record = (value: Json) => value as Record<string, Json>;
const payload = (value: Json) => record(record(value).payload);

test('eight phase contracts cover every Planning route with exact inherited event examples', () => {
 assert.equal(planningTaskContracts.length, 8);
 for (const edge of PLANNING_EDGES) {
  const outputs = outputsForEdge(edge.id);
  assert.ok(outputs.length, edge.id);
  for (const output of outputs) {
   assert.equal(contractDefinitions.find(node => node.outputs.includes(output))?.nodeId, edge.source);
   assert.ok(contractForNode(edge.target)?.input.examples.some(example => example.edgeId === edge.id && JSON.stringify(record(example.value).event) === JSON.stringify(output.example)), edge.id);
  }
 }
});
test('State phase replies preserve original mutation identity through lost acknowledgement inspection', () => {
 for (const route of PLANNING_STATE_ROUTES) {
  const request = payload(outputsForEdge(route.id)[0].example);
  for (const reply of outputsForEdge(route.returnId)) {
   const body = payload(reply.example);
   for (const key of ['transactionId', 'commandId', 'callId', 'fingerprint', 'expectedRevision', 'expectedOwnerGeneration', 'requestPhase', 'requesterNodeId', 'returnToNodeId']) assert.deepEqual(body[key], request[key], `${route.phase}: ${key}`);
   assert.equal(body.launchedWork, false);
   assert.equal(body.absenceProvesEffectAbsent, false);
  }
 }
 const ordinary = payload(outputsForEdge('lina-planning-edge-update-state-record')[0].example);
 const inspection = payload(outputsForEdge('lina-planning-edge-update-inspect-state-load')[0].example);
 assert.equal(inspection.transactionId, ordinary.transactionId);
 assert.equal(inspection.fingerprint, ordinary.fingerprint);
 assert.equal(inspection.newMutationWhileUnknown, false);
});
test('unknown and conflicting mutations cannot claim a committed revision or launch', () => {
 for (const status of planningStatuses.update) {
  const receipt = record(record(planningPhasePayload('update', status).example).receipt);
  assert.equal(receipt.status, status);
  assert.equal(receipt.launchedWork, false);
  assert.equal(receipt.inspectOriginalTransaction, status === 'unknown');
  if (!['applied', 'duplicate'].includes(status)) { assert.equal(receipt.revision, null); assert.equal(receipt.receiptRef, null); }
 }
});
test('plan command alternatives retain structured creation, revision and assessment boundaries', () => {
 const commands = planningCommand.schema.anyOf!;
 assert.deepEqual(commands.map(item => item.properties?.operation.const), ['create_plan', 'update_task', 'revise_plan', 'record_assessment', 'set_plan_status']);
 const created = record(planningCommand.example);
 assert.equal(created.expectedRevision, 0);
 assert.equal(record(record(created.proposedPlan).identity).revision, 1);
 assert.equal(record(created.proposedPlan).status, 'draft');
 const revision = commands.find(item => item.properties?.operation.const === 'revise_plan')!;
 assert.equal(revision.properties?.planEditImplicitlyCancelsWork.const, false);
 assert.ok(revision.required?.includes('acceptedGoalRevisionRef'));
 assert.ok(revision.required?.includes('preserveCompletedAttemptIds'));
});
test('ready dependencies distinguish accepted success from terminal cleanup without granting authority', () => {
 assert.deepEqual(planningDependency.schema.properties?.condition.enum, ['accepted-success', 'terminal-outcome']);
 for (const status of planningStatuses.ready) {
  const result = record(record(planningPhasePayload('ready', status).example).readiness);
  assert.equal(result.launchesExecution, false);
  assert.equal(result.permissionGranted, false);
  assert.equal(result.completionCandidate, status === 'completion-candidate');
  if (status !== 'ready') assert.deepEqual(result.readyTaskIds, []);
 }
 assert.equal(record(planningPlan.example).authorityFromPlan, false);
});
test('bindings and late observations preserve original attempt identity and unresolved effects', () => {
 const unknown = record(planningPhasePayload('bind', 'unresolved').example);
 assert.equal(unknown.replacementLaunchAllowed, false);
 assert.equal(record(unknown.attempt).outcomeCertainty, 'unknown');
 assert.ok((record(unknown.attempt).unresolvedEffectRefs as Json[]).length);
 const late = record(planningPhasePayload('review', 'late-result').example);
 assert.equal(late.lateResultRetainedAtOriginalAttempt, true);
 assert.equal(late.completesReplacement, false);
 const uncertain = record(planningPhasePayload('review', 'uncertain').example);
 assert.equal(record(uncertain.attempt).outcomeCertainty, 'unknown');
});
test('goal completion keeps task truth distinct from model assertion and publication', () => {
 for (const status of planningStatuses.complete) {
  const outcome = record(planningPhasePayload('complete', status).example);
  assert.equal(outcome.goalCompleted, status === 'complete');
  assert.equal(outcome.publicationPerformed, false);
  const assessment = record(outcome.goalAssessment);
  assert.equal(assessment.independentlyVerified, false);
  assert.deepEqual(assessment.criterionIds, ['criterion:goal:001']);
  if (status === 'complete') { assert.deepEqual(outcome.remainingRequiredTaskIds, []); assert.deepEqual(outcome.unresolvedEffectRefs, []); }
  else assert.ok((outcome.remainingRequiredTaskIds as Json[]).length);
 }
});
test('canonical planning is State-owned and Context receives bounded provenance without mutation', () => {
 for (const kind of ['task-plan', 'task-attempt', 'task-assessment', 'plan-mutation']) assert.ok(stateRecordsByKind[kind], kind);
 assert.ok(stateCheckpointManifest.schema.properties?.taskPlanReferences);
 assert.equal(record(planningProjection.example).canonicalPlanMutatedByCompaction, false);
 assert.equal(record(planningProjection.example).instructionAuthority, false);
 assert.ok(contextCandidate.schema.properties?.taskPlanProjection);
 assert.ok(contextSnapshot.schema.properties?.taskPlanProjection);
 assert.equal(record(contextCandidate.example).taskPlanProjection, null);
 assert.equal(record(contextSnapshot.example).taskPlanProjection, null);
});
test('plan-only/review policy and revision limits never replace actual Tools/Safety admission', () => {
 assert.deepEqual(planningPolicy.schema.properties?.executionMode.enum, ['execute', 'plan-only', 'review-before-execution']);
 assert.equal(record(planningPolicy.example).planAcceptanceGrantsActionPermission, false);
 assert.equal(record(planningPolicy.example).planningConsumesMainBudget, true);
 const exhausted = record(planningPhasePayload('replan', 'exhausted').example);
 assert.equal(exhausted.resetsMainLoopBudget, false);
 assert.equal(exhausted.implicitCancellation, false);
 const child = planningTaskContracts[0].contextExamples!.find(item => item.label.startsWith('Fresh child'))!;
 assert.equal(record(child.value.example).currentPlan, null);
 assert.equal(record(child.value.example).projection, null);
 assert.equal(record(record(child.value.example).scope).agentId, 'lina-child:001');
});
