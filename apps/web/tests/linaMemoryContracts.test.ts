import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMORY_EDGES, MEMORY_STATE_ROUTES } from '../src/features/lina/memoryBlock';
import { memoryKnowledgeContracts, attachMemoryProducerHandoffs, memoryPhasePayload } from '../src/features/lina/contracts/memoryKnowledge';
import { memoryKnowledgeVariants, memoryForgetPlan } from '../src/features/lina/contracts/memoryRecords';
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
const producers: ContractDefinition[] = [...new Set(MEMORY_EDGES.map(edge => edge.source).filter(id => !id.startsWith('lina-memory-')))].map(nodeId => ({ nodeId, context: { schema: {}, example: {} }, contextSource: 'test fixture', reads: [], writes: [], rules: [], outputs: [] }));
attachMemoryProducerHandoffs(producers);
const definitions = [...memoryKnowledgeContracts, ...producers];

test('all twelve Memory boundaries and every handoff have valid typed examples', () => {
 assert.equal(memoryKnowledgeContracts.length, 12);
 for (const definition of definitions) {
  assert.ok(validate(definition.context.schema, definition.context.example), definition.nodeId);
  for (const item of definition.external ?? []) assert.ok(validate(item.value.schema, item.value.example), item.label);
  for (const output of definition.outputs) {
   assert.ok(validate(output.schema, output.example), output.id);
   assert.equal(validate(output.schema, { kind: 'invented', payload: {} }), false);
  }
 }
 for (const edge of MEMORY_EDGES) assert.ok(definitions.find(node => node.nodeId === edge.source)!.outputs.some(output => output.edgeIds.includes(edge.id)), edge.id);
});

test('facts, observed episodes and derived procedures preserve distinct meaning', () => {
 for (const record of memoryKnowledgeVariants) assert.ok(validate(record.schema, record.example));
 assert.deepEqual(memoryKnowledgeVariants.map(record => (record.example as any).content.kind), ['fact', 'episode', 'procedure']);
 const procedure = memoryKnowledgeVariants[2].example as any;
 assert.equal(procedure.authority, 'derived');
 assert.equal(procedure.content.executableSkill, false);
 assert.equal(procedure.content.independentlyVerified, false);
});

test('failed admission never forwards to extraction or commit', () => {
 const eligibleEdges = ['scope-capture', 'capture-extract', 'capture-validate', 'extract-validate', 'validate-resolve', 'resolve-commit', 'commit-index'];
 for (const short of eligibleEdges) {
  const edge = MEMORY_EDGES.find(edge => edge.id === `lina-memory-edge-${short}`)!;
  const outcomes = memoryKnowledgeContracts.find(node => node.nodeId === edge.source)!.outputs.filter(output => output.edgeIds.includes(edge.id));
  assert.ok(outcomes.length);
  for (const outcome of outcomes) assert.ok(!['denied', 'rejected', 'unknown', 'failed', 'needs-review', 'cancelled'].includes(payload(outcome.example).status), outcome.id);
 }
});

test('State requests and replies keep original phase identity; lost acknowledgments inspect original transaction', () => {
 for (const route of MEMORY_STATE_ROUTES) {
  const request = payload(memoryKnowledgeContracts.find(node => node.nodeId === route.source)!.outputs.find(output => output.edgeIds.includes(route.id))!.example);
  const responses = producers.find(node => node.nodeId === route.target)!.outputs.filter(output => output.edgeIds.includes(route.returnId));
  assert.ok(responses.length);
  if (route.kind === 'record') {
   assert.equal(request.transaction.transactionId, request.transactionId);
   assert.equal(request.transaction.requestFingerprint, request.requestFingerprint);
  } else assert.equal(request.transaction, null);
  for (const response of responses) {
   const value = payload(response.example);
   assert.equal(value.transactionId, request.transactionId);
   assert.equal(value.requestFingerprint, request.requestFingerprint);
   assert.equal(value.requestPhase, route.phase);
   assert.equal(value.returnToNodeId, route.source);
   assert.equal(value.recordsSearchable, false);
   if (['unknown', 'still-unknown'].includes(value.storageOutcome)) assert.equal(value.inspectBeforeRetry, true);
  }
 }
 for (const [commitPhase, inspectPhase] of [['commit-memory-mutation', 'inspect-memory-transaction'], ['revoke-memory-visibility', 'inspect-memory-revocation']]) {
  const get = (phase: string) => {
   const route = MEMORY_STATE_ROUTES.find(route => route.phase === phase)!;
   return payload(memoryKnowledgeContracts.find(node => node.nodeId === route.source)!.outputs.find(output => output.edgeIds.includes(route.id))!.example);
  };
  assert.equal(get(commitPhase).transactionId, get(inspectPhase).transactionId);
  assert.equal(get(commitPhase).requestFingerprint, get(inspectPhase).requestFingerprint);
 }
});

test('commit and index states distinguish authoritative storage from search visibility', () => {
 const applied = memoryPhasePayload('commit', 'applied').example as any;
 assert.equal(applied.recordCommitted, true);
 assert.equal(applied.searchable, false);
 const unknown = memoryPhasePayload('commit', 'unknown').example as any;
 assert.equal(unknown.recordCommitted, false);
 assert.equal(unknown.inspectBeforeRetry, true);
 assert.equal(unknown.permissionToRepeatUnknownMutation, false);
 const stale = memoryPhasePayload('retrieve', 'stale').example as any;
 assert.ok(stale.index.searchableWatermark < stale.index.authoritativeWatermark);
 assert.equal(stale.failedReadMayInitializeEmptyStore, false);
});

test('forget revokes recall and descendants before cleanup and reports limited coverage honestly', () => {
 const plan = memoryForgetPlan.example as any;
 assert.equal(plan.immediateRecallRevocation, true);
 assert.ok(plan.descendantRefs.length);
 assert.equal(plan.resurrectionForbidden, true);
 assert.equal(plan.tombstoneRetainsContent, false);
 assert.equal(plan.fullyErasedEverywhere, false);
 assert.ok(plan.excludedCopies.length);
 const pending = memoryPhasePayload('forget', 'purge-pending').example as any;
 assert.equal(pending.revocationAcknowledged, true);
 assert.equal(pending.cleanupCompleteWithinCoverage, false);
 const complete = memoryPhasePayload('forget', 'erased-within-coverage').example as any;
 assert.deepEqual(complete.plan.pendingCleanupRefs, []);
 assert.equal(complete.excludedCopiesStillReported, true);
});

test('Memory model work uses separate budgets and returns candidates without write authority', () => {
 for (const id of ['extract-model', 'consolidate-model', 'model-extract', 'model-consolidate']) {
  const edge = MEMORY_EDGES.find(edge => edge.id === `lina-memory-edge-${id}`)!;
  const value = payload(definitions.find(node => node.nodeId === edge.source)!.outputs.find(output => output.edgeIds.includes(edge.id))!.example);
  assert.equal(value.separateBudget.owner, 'Memory');
  assert.equal(value.consumesMainAgentRound, false);
  assert.equal(value.physicalAttemptAccountedSeparately, true);
  assert.equal(value.extractorAuthorizesPersistence, false);
  assert.equal(value.modelToolsAllowed, false);
  assert.ok(['memory-extraction', 'memory-consolidation'].includes(value.purpose));
 }
 const disabled = memoryPhasePayload('consolidate', 'disabled').example as any;
 assert.equal(disabled.maintenance.actualModelAttempts, 0);
 assert.equal(disabled.maintenance.directlyCommits, false);
});
