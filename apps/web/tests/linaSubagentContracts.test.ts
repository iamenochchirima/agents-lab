import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBAGENTS_EDGES, SUBAGENT_STATE_ROUTES } from '../src/features/lina/subagentsBlock';
import { subagentOrchestrationContracts, attachSubagentProducerHandoffs, subagentPhasePayload } from '../src/features/lina/contracts/subagentOrchestration';
import { subagentOwner, subagentContextHandoff, subagentConfiguration } from '../src/features/lina/contracts/subagentRecords';
import type { ContractDefinition, Json, Schema } from '../src/features/lina/contracts/schema';
function validate(schema: Schema, value: Json): boolean {
  const supported = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'minLength', 'minimum', 'const', 'enum', 'anyOf', 'description']);
  for (const key of Object.keys(schema)) assert.ok(supported.has(key), `Unsupported schema keyword ${key}`);
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.anyOf && !schema.anyOf.some(variant => validate(variant, value))) return false;
  switch (schema.type) {
    case 'null': if (value !== null) return false; break;
    case 'boolean': if (typeof value !== 'boolean') return false; break;
    case 'string': if (typeof value !== 'string' || value.length < (schema.minLength ?? 0)) return false; break;
    case 'integer': if (typeof value !== 'number' || !Number.isInteger(value) || value < (schema.minimum ?? -Infinity)) return false; break;
    case 'number': if (typeof value !== 'number' || value < (schema.minimum ?? -Infinity)) return false; break;
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)) return false;
      if (schema.items && !value.every(item => validate(schema.items!, item))) return false;
      break;
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      if (schema.required?.some(key => !(key in value))) return false;
      for (const [key, item] of Object.entries(value)) {
        const property = schema.properties?.[key];
        if (property ? !validate(property, item) : schema.additionalProperties === false) return false;
      }
      break;
  }
  // Object constraints can also appear in a union branch without repeating type.
  if (!schema.type && schema.properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some(key => !(key in value))) return false;
    for (const [key, property] of Object.entries(schema.properties)) if (key in value && !validate(property, value[key])) return false;
  }
  return true;
}



const payload = (value: Json): any => (value as any).payload;
const producers: ContractDefinition[] = [...new Set(SUBAGENTS_EDGES.map(edge => edge.source).filter(id => !id.startsWith('lina-subagents-')))].map(nodeId => ({ nodeId, context: { schema: {}, example: {} }, contextSource: 'fixture', reads: [], writes: [], rules: [], outputs: [] }));
attachSubagentProducerHandoffs(producers);
const definitions = [...subagentOrchestrationContracts, ...producers];
const outputFor = (id: string) => { const edge = SUBAGENTS_EDGES.find(item => item.id === `lina-subagents-edge-${id}`)!; return definitions.find(item => item.nodeId === edge.source)!.outputs.find(item => item.edgeIds.includes(edge.id))!; };

test('eight Subagent contracts cover every edge with closed JSON examples', () => {
 assert.equal(subagentOrchestrationContracts.length, 8);
 for (const definition of definitions) {
  assert.ok(validate(definition.context.schema, definition.context.example));
  for (const example of definition.contextExamples ?? []) assert.ok(validate(example.value.schema, example.value.example), example.label);
  for (const external of definition.external ?? []) assert.ok(validate(external.value.schema, external.value.example), external.label);
  for (const output of definition.outputs) { assert.ok(validate(output.schema, output.example), output.id); assert.equal(validate(output.schema, {kind: 'invented', payload: {}}), false); }
 }
 for (const edge of SUBAGENTS_EDGES) assert.ok(definitions.find(item => item.nodeId === edge.source)!.outputs.some(item => item.edgeIds.includes(edge.id)), edge.id);
});
test('admitted paths cannot turn refusal or uncertainty into launch', () => {
 for (const short of ['validate-prepare','validate-coordinate','validate-join','validate-cancel','prepare-launch','launch-coordinate','reconcile-launch']) {
  const edge = SUBAGENTS_EDGES.find(item => item.id === `lina-subagents-edge-${short}`)!;
  for (const output of definitions.find(item => item.nodeId === edge.source)!.outputs.filter(item => item.edgeIds.includes(edge.id))) assert.ok(!['refused','unknown','still-unknown','failed','invalid','budget-exhausted','cancelled'].includes(payload(output.example).status), output.id);
 }
 const reconciled = payload(outputFor('reconcile-launch').example);
 assert.equal(reconciled.sameIdentityRetryAllowed, true);
 assert.equal(reconciled.childToolReplayAllowed, false);
});
test('task-tree limits account siblings and nested children without expanding authority', () => {
 const admitted = subagentPhasePayload('validate','admitted').example as any;
 assert.equal(admitted.budget.siblingReservationsCounted, true);
 assert.equal(admitted.budget.descendantsDebitSameTreeBudget, true);
 assert.ok(admitted.budget.maxDepth > 1);
 assert.equal(admitted.budget.childLimitsCannotExpandParentAuthority, true);
 assert.equal(admitted.configuration.automaticApprovalInheritance, false);
 assert.equal(admitted.configuration.credentialMaterialIncluded, false);
});
test('ownership separates waiting from detachment and preserves a supervisor', () => {
 const variants = subagentOwner.schema.anyOf!;
 const detached = variants.find(item => item.properties?.attachment.const === 'detached')!;
 assert.deepEqual(detached.properties?.parentWaiting.enum, ['wait','continue']);
 assert.equal(detached.properties?.parentStop.const, 'retain-explicit-detached-work');
 assert.ok(detached.required?.includes('lifecycleOwnerRef'));
 for (const variant of variants) assert.equal(variant.properties?.simulationReset.const, 'clear-fixture-only');
});
test('context handoff supports immutable forks and complete tool groups without credentials', () => {
 assert.deepEqual(subagentContextHandoff.schema.properties?.mode.enum, ['fresh-task','selected-parent-context','transcript-fork']);
 assert.equal((subagentContextHandoff.example as any).partialToolGroupsAllowed, false);
 assert.equal((subagentContextHandoff.example as any).forkMutatesParentBranch, false);
 assert.equal((subagentConfiguration.example as any).sharedPublicationRequiresParentReview, true);
 const child = payload(outputFor('launch-child-start').example);
 assert.equal(child.origin, 'internal-child-turn');
 assert.equal(child.userDeliveryAllowed, false);
 assert.equal(child.newUserIngressRequired, false);
});
test('all State replies preserve exact requester and original phase transaction', () => {
 for (const route of SUBAGENT_STATE_ROUTES) {
  const request = payload(definitions.find(item => item.nodeId === route.source)!.outputs.find(item => item.edgeIds.includes(route.id))!.example);
  assert.ok(request.record.kind);
  const responses = definitions.find(item => item.nodeId === route.target)!.outputs.filter(item => item.edgeIds.includes(route.returnId));
  for (const response of responses) {
   const body = payload(response.example);
   assert.equal(body.transactionId, request.transactionId);
   assert.equal(body.fingerprint, request.fingerprint);
   assert.equal(body.returnToNodeId, route.source);
   assert.equal(body.requestPhase, route.phase);
   assert.equal(body.childLaunchedByStorageAck, false);
   if (['unknown','still-unknown'].includes(body.storageOutcome)) assert.equal(body.inspectBeforeRetry, true);
  }
 }
 for (const [write,inspect] of [['launch','launch-inspect'],['return','return-inspect'],['cancel','cancel-inspect']]) assert.equal(payload(outputFor(`${write}-state-record`).example).transactionId, payload(outputFor(`${inspect}-state-load`).example).transactionId);
});
test('joins, cancellation, result validation and lost delivery retain honest outcomes', () => {
 const partial = subagentPhasePayload('join','partial-terminal').example as any;
 assert.equal(partial.successfulSiblingImpliesWholeJoinSuccess, false);
 assert.equal(partial.waitExpiredCancelsChildren, false);
 const cancel = subagentPhasePayload('cancel','unresolved').example as any;
 assert.equal(cancel.capacityReleased, false);
 assert.equal(cancel.acknowledgedEffectsReversed, false);
 assert.ok(cancel.unresolvedEffectRefs.length);
 const invalid = subagentPhasePayload('return','invalid-result').example as any;
 assert.equal(invalid.structuredResultAccepted, false);
 assert.equal(invalid.result.structuredResult.validation, 'invalid');
 const returned = subagentPhasePayload('return','success').example as any;
 assert.equal(returned.delivery.atLeastOnceDelivery, true);
 assert.equal(returned.delivery.childRerunOnLostDeliveryAck, false);
 assert.equal(returned.delivery.userOutputRoute, false);
 assert.equal(returned.reopensEndedParent, false);
});
