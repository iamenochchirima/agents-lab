import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture } from '../src/features/lina/architectureDocument';
import { contractDefinitions, nodeContracts, contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import type { Json, Schema } from '../src/features/lina/contracts/schema';

// Test-only checker for the documented schema vocabulary. Fail on unsupported
// keywords so adding a schema feature cannot silently weaken example validation.
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

test('every maintained node has a versioned contract with input/output examples and state rules', () => {
  assert.equal(new Set(contractDefinitions.map(item => item.nodeId)).size, contractDefinitions.length);
  assert.deepEqual(nodeContracts.map(item => item.nodeId).sort(), linaArchitecture.nodes.map(item => item.id).sort());
  for (const contract of nodeContracts) {
    assert.equal(contract.version, 1);
    assert.equal(contract.status, 'provisional');
    assert.ok(contract.contextSource.length > 0, contract.nodeId);
    assert.ok(contract.reads.length > 0, contract.nodeId);
    assert.ok(contract.rules.length > 0, contract.nodeId);
    assert.ok(contract.input.examples.length > 0, contract.nodeId);
    assert.ok(contract.outputs.length > 0, contract.nodeId);
    for (const example of contract.input.examples) assert.ok(validate(contract.input.schema, example.value), `${contract.nodeId} input ${example.label}`);
    for (const snapshot of contract.contextExamples ?? []) assert.ok(validate(snapshot.value.schema, snapshot.value.example), `${contract.nodeId} context ${snapshot.label}`);
    for (const output of contract.outputs) {
      assert.ok(output.when.length > 0, output.id);
      assert.ok(validate(output.schema, output.example), `${contract.nodeId} output ${output.id}`);
    }
  }
});

test('every connection carries a declared producer output unchanged into the target event input', () => {
  const declaredEdges = new Set<string>();
  for (const source of nodeContracts) for (const output of source.outputs) for (const id of output.edgeIds) {
    declaredEdges.add(id);
    const edge = linaArchitecture.edges.find(edge => edge.id === id);
    assert.ok(edge, `Unknown declared edge ${id}`);
    assert.equal(edge.source, source.nodeId);
    const target = contractForNode(edge.target)!;
    const example = target.input.examples.find(item => item.edgeId === id && JSON.stringify((item.value as Record<string, Json>).event) === JSON.stringify(output.example));
    assert.ok(example, `${id} must preserve the output payload`);
    assert.ok(validate(target.input.schema, example.value), `${id} target input`);
  }
  assert.deepEqual([...declaredEdges].sort(), linaArchitecture.edges.map(edge => edge.id).sort());
  assert.equal(new Set(nodeContracts.flatMap(item => item.outputs.map(output => output.id))).size, nodeContracts.reduce((total, item) => total + item.outputs.length, 0));
});

test('contracts reject absent context, unknown event discriminators and malformed examples', () => {
  for (const contract of nodeContracts) {
    const example = structuredClone(contract.input.examples[0].value) as Record<string, Json>;
    delete example.context;
    assert.equal(validate(contract.input.schema, example), false, contract.nodeId);
    assert.equal(validate(contract.input.schema, { event: { kind: 'invented-event', payload: {} }, context: contract.context.example }), false, contract.nodeId);
    for (const output of contract.outputs) {
      const invalid = structuredClone(output.example) as Record<string, Json>;
      delete invalid.kind;
      assert.equal(validate(output.schema, invalid), false, output.id);
    }
  }
});

test('safe checkpoint handoffs bypass fresh turn initialization', () => {
  for (const step of ['prepare', 'controls', 'settle']) {
    const id = `lina-execution-edge-resume-${step}`;
    const edge = linaArchitecture.edges.find(edge => edge.id === id)!;
    assert.equal(edge.source, 'lina-input-runtime');
    assert.equal(edge.target, `lina-execution-${step}`);
    assert.ok(outputsForEdge(id).length > 0);
  }
});

function payload(outputId: string): Record<string, Json> {
  const output = nodeContracts.flatMap(contract => contract.outputs).find(output => output.id === outputId);
  assert.ok(output, outputId);
  return (output.example as Record<string, Json>).payload as Record<string, Json>;
}

test('Telegram channel, topic, media and callback projections preserve distinct provenance', () => {
  const channel = payload('input-telegram-raw-channel');
  const post = channel.channel_post as Record<string, Json>;
  assert.equal('from' in post, false, 'channel sender must not be fabricated as a person');
  assert.ok(post.sender_chat);
  const topic = payload('input-telegram-route-topic');
  assert.equal((topic.source as Record<string, Json>).topicId, '7');
  assert.equal((topic.destination as Record<string, Json>).topicId, '7');
  assert.equal((payload('input-telegram-route-supergroup').source as Record<string, Json>).topicId, null);
  const voice = payload('input-telegram-route-voice').content as Record<string, Json>;
  assert.equal(voice.text, null);
  assert.equal(((voice.attachments as Json[])[0] as Record<string, Json>).mediaType, 'audio');
  const callback = payload('input-telegram-route-callback');
  const operation = callback.requestedOperation as Record<string, Json>;
  assert.equal(operation.kind, 'prompt-answer');
  assert.equal(operation.promptId, 'prompt-001');
  assert.equal(operation.targetTurnId, 'turn-001');
  const withheld = payload('input-telegram-route-channel-deferred');
  assert.equal(withheld.destination, null);
});

test('attachment custody and acceptance retain origins and authorization evidence', () => {
  const attachment = payload('input-intent-custody');
  const record = attachment.record as Record<string, Json>;
  const content = (record.envelope as Record<string, Json>).content as Record<string, Json>;
  assert.ok((content.attachments as Json[]).length > 0);
  assert.ok(record.authorization);
  assert.ok(attachment.operationAuthorization);
  const custody = payload('input.custody.secured');
  assert.ok((custody.originals as Json[]).length > 0);
  assert.equal(((custody.originals as Json[])[0] as Record<string, Json>).attachmentId, ((content.attachments as Json[])[0] as Record<string, Json>).attachmentId);
});

test('unknown claims retain uncertainty and do not promise another accepted input', () => {
  assert.equal(payload('input-claim-uncertain').certainty, 'unknown');
  const response = payload('input.failure.unknown');
  assert.equal((response.failure as Record<string, Json>).certainty, 'unknown');
  assert.equal((response.output as Record<string, Json>).category, 'status');
});

test('the illustrative Input walkthroughs still follow real connections after channel routing changes', async () => {
  const { linaExecutionPaths } = await import('../src/features/lina/executionPaths');
  for (const path of linaExecutionPaths) for (let index = 1; index < path.steps.length; index++) {
    assert.ok(linaArchitecture.edges.some(edge => edge.source === path.steps[index - 1].nodeId && edge.target === path.steps[index].nodeId), `${path.id} step ${index}`);
  }
});

test('linked loop examples retain tool history until the next model round launches', () => {
  for (const suffix of ['tool-success', 'tool-error', 'replacement']) {
    const checkpoint = payload(`execution.controls-continue-after-${suffix}`);
    const gate = payload(`execution.round-permitted-after-${suffix}`);
    const prepared = payload(`execution.model-request-after-${suffix}`);
    assert.deepEqual(gate.state, checkpoint.state);
    assert.deepEqual(prepared.state, checkpoint.state);
    const state = checkpoint.state as Record<string, Json>;
    const limits = state.limits as Record<string, Json>;
    assert.ok((state.results as Json[]).length > 0);
    const observed = payload(`execution.model-${suffix === 'tool-error' ? 'correction' : 'answer'}-after-${suffix}`);
    const observedState = observed.state as Record<string, Json>;
    assert.deepEqual(observedState.results, state.results);
    assert.deepEqual(observedState.turn, state.turn);
    assert.equal((observedState.limits as Record<string, Json>).roundsStarted, Number(limits.roundsStarted) + 1);
    assert.equal((observedState.limits as Record<string, Json>).attempts, Number(limits.attempts) + 1);
  }
});

test('provider retry examples retain their round and tool results while consuming only another attempt', () => {
  const retry = payload('execution.provider-retry-permitted');
  const prepared = payload('execution.model-request-provider-retry');
  const observed = payload('execution.model-answer-after-provider-retry');
  assert.deepEqual(prepared.state, retry.state);
  assert.deepEqual(observed.round, prepared.round);
  const before = prepared.state as Record<string, Json>;
  const after = observed.state as Record<string, Json>;
  assert.deepEqual(after.turn, before.turn);
  assert.deepEqual(after.results, before.results);
  assert.equal((before.limits as Record<string, Json>).roundsStarted, 1);
  assert.equal((after.limits as Record<string, Json>).roundsStarted, 1);
  assert.equal((after.limits as Record<string, Json>).attempts, 2);
  assert.equal((after.limits as Record<string, Json>).retriesRemaining, 0);
});

test('delivery-status inputs bypass request admission and require outbound correlation', () => {
  const edge = linaArchitecture.edges.find(edge => edge.id === 'lina-input-edge-57')!;
  assert.equal(edge.source, 'lina-input-whatsapp');
  assert.equal(edge.target, 'lina-input-delivery');
  const observation = payload('input-whatsapp-delivery-observation');
  assert.equal(observation.form, 'verified-delivery-status');
  assert.equal('senderId' in observation, false);
  assert.ok(observation.outputId);
});

test('settlement and release preserve each terminal outcome and withhold unresolved work', () => {
  for (const outcome of ['completed', 'failed', 'cancelled', 'exhausted']) {
    const settled = payload(outcome === 'completed' ? 'execution.settled-release-ready' : `execution.settled-${outcome}-release-ready`);
    const released = payload(outcome === 'completed' ? 'execution.owner-released' : `execution.owner-released-${outcome}`);
    const terminal = settled.terminal as Record<string, Json>;
    const turn = terminal.turn as Record<string, Json>;
    const release = released.release as Record<string, Json>;
    assert.equal(terminal.outcome, outcome);
    assert.equal(release.outcome, outcome);
    assert.equal(release.turnId, turn.turnId);
    assert.equal(release.fence, (turn.authority as Record<string, Json>).fence);
    assert.equal(settled.releaseReady, true);
    if (outcome !== 'completed') assert.deepEqual(settled.savedOutputIds, []);
  }
  assert.equal(payload('execution.settlement-unresolved').releaseReady, false);
});

test('structured actions can omit content, while an empty ordinary envelope is invalid', async () => {
  const { envelope } = await import('../src/features/lina/contracts/shared');
  const blank = structuredClone(envelope.example) as Record<string, Json>;
  blank.content = { text: null, attachments: [] };
  blank.requestedOperation = null;
  assert.equal(validate(envelope.schema, blank), false);
  blank.requestedOperation = { kind: 'ordinary' };
  assert.equal(validate(envelope.schema, blank), false);
  blank.requestedOperation = { kind: 'stop', targetTurnId: 'turn-001', guidance: null };
  assert.equal(validate(envelope.schema, blank), true);
});
