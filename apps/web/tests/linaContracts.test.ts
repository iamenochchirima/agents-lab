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

const contextPayload = (node: string, outcome: string) => {
  const result = contractForNode(`lina-context-${node}`)!.outputs.find(item => item.id === outcome)!;
  assert.ok(result, outcome);
  return (result.example as Record<string, Json>).payload as Record<string, Json>;
};

test('Context delegation preserves execution identity and counters before model launch', () => {
  const prepare = contractForNode('lina-execution-prepare')!;
  const request = prepare.outputs.find(item => item.id === 'execution.context-requested-after-tool-success')!;
  const payload = (request.example as Record<string, Json>).payload as Record<string, Json>;
  const state = payload.state as Record<string, Json>;
  assert.deepEqual(state.limits, { roundsStarted: 1, maxRounds: 3, attempts: 1, retriesRemaining: 1 });
  assert.deepEqual(payload.toolResultRefs, ['call-001:result']);
  assert.equal((payload.round as Record<string, Json>).roundId, 'round-002');
  assert.equal((payload.identities as Record<string, Json>).roundId, 'round-002');
  assert.deepEqual(request.edgeIds, ['lina-context-edge-prepare-scope']);
});

test('Context reductions preserve canonical evidence and distinguish summary work from reasoning rounds', () => {
  const pruned = contextPayload('prune', 'context.pruned');
  assert.equal(pruned.canonicalRecordsPreserved, true);
  assert.equal(pruned.canonicalHistoryRef, 'history:conversation-001:r7');
  assert.equal(pruned.revision, 1);
  const messages = pruned.messages as Record<string, Json>[];
  const masked = messages.find(item => item.recordId === 'result-old-001')!;
  assert.equal(masked.artifactRef, 'artifact:old-observation:raw');
  assert.match((masked.result as Record<string, Json>).value as string, /masked/);
  assert.ok(messages.some(item => item.role === 'assistant' && (item.calls as Record<string, Json>[]).some(call => call.callId === masked.callId)));
  assert.ok(messages.some(item => item.callId === 'call-001' && item.protected === true));
  assert.ok((pruned.selectionManifest as Record<string, Json>[]).some(item => item.action === 'masked' && item.sourceRef === 'artifact:old-observation:raw'));
  const compacted = contextPayload('compact', 'context.compacted');
  const work = compacted.summaryWork as Record<string, Json>;
  assert.equal(work.kind, 'context-management');
  assert.equal(work.mainAgentRoundStarted, false);
  assert.equal(work.persistence, 'request-local');
  const candidate = compacted.candidate as Record<string, Json>;
  assert.ok((candidate.messages as Record<string, Json>[]).some(item => item.role === 'user' && item.protected === true));
  for (const outcome of ['context.summary-failed', 'context.summary-cancelled']) {
    const failure = contextPayload('compact', outcome);
    assert.equal((failure.contextFailure as Record<string, Json>).previousValidSnapshotPreserved, true);
    assert.equal((failure.contextFailure as Record<string, Json>).modelAttemptLaunched, false);
  }
});

test('Context snapshots expose estimated budgets and immutable revision identities without launch permission', () => {
  const first = contextPayload('publish', 'context.ready').contextSnapshot as Record<string, Json>;
  const revised = contextPayload('publish', 'context.ready-revised').contextSnapshot as Record<string, Json>;
  assert.equal(first.immutable, true);
  assert.equal(first.grantsLaunchPermission, false);
  assert.equal(first.storage, 'reference-fixture-not-persisted');
  assert.equal((first.budget as Record<string, Json>).accounting, 'synthetic-estimate');
  assert.equal((first.budget as Record<string, Json>).outputReservation, 200);
  assert.equal(revised.revision, 1);
  assert.ok(((revised.modelContext as Record<string, Json>).messages as Record<string, Json>[]).some(item => item.role === 'summary'));
  assert.ok((revised.selectionManifest as Record<string, Json>[]).some(item => item.action === 'summarized'));
  assert.notEqual(first.contextSnapshotRef, revised.contextSnapshotRef);
  assert.deepEqual(first.identities, revised.identities);
  assert.equal((revised.budget as Record<string, Json>).reductionAttempts, 1);
  for (const [node, outcome] of [['load', 'context.required-source-missing'], ['budget', 'context.protected-too-large'], ['validate', 'context.invalid']]) {
    const failure = contextPayload(node, outcome);
    assert.equal((failure.terminal as Record<string, Json>).outcome, 'failed');
    assert.equal((failure.contextFailure as Record<string, Json>).canonicalRecordsPreserved, true);
  }
});

test('continued provider requests pair each tool result with a prior assistant call and matching snapshot', () => {
  const prepare = contractForNode('lina-execution-prepare')!;
  for (const id of ['execution.model-request-after-tool-success', 'execution.model-request-after-tool-error', 'execution.model-request-after-replacement']) {
    const payload = (prepare.outputs.find(item => item.id === id)!.example as Record<string, Json>).payload as Record<string, Json>;
    const request = payload.modelRequest as Record<string, Json>;
    const messages = request.messages as Record<string, Json>[];
    const calls = new Set<string>();
    for (const message of messages) {
      if (message.role === 'assistant') for (const call of message.toolCalls as Record<string, Json>[]) calls.add(call.callId as string);
      if (message.role === 'tool') assert.ok(calls.has(message.callId as string), `${id}: orphan ${message.callId}`);
    }
    const snapshot = request.contextSnapshot as Record<string, Json>;
    assert.equal((snapshot.identities as Record<string, Json>).roundId, (payload.round as Record<string, Json>).roundId);
    assert.equal(((snapshot.modelContext as Record<string, Json>).messages as Json[]).length, messages.length);
  }
});

test('reduced and tool-feedback projections survive budget, validation and publication unchanged', () => {
  for (const [node, reducedId, budgetId, validatedId, readyId] of [
    ['prune', 'context.pruned', 'context.budget-fits-after-prune', 'context.validated-after-prune', 'context.ready-pruned'],
    ['compact', 'context.compacted', 'context.budget-fits-after-compact', 'context.validated-after-compact', 'context.ready-revised'],
  ]) {
    const reduced = contextPayload(node, reducedId);
    const projected = (reduced.candidate ?? reduced) as Record<string, Json>;
    for (const [stage, id] of [['budget', budgetId], ['validate', validatedId]]) {
      const payload = contextPayload(stage, id);
      assert.deepEqual(payload.candidate ?? payload, projected);
    }
    const snapshot = contextPayload('publish', readyId).contextSnapshot as Record<string, Json>;
    assert.deepEqual((snapshot.modelContext as Record<string, Json>).messages, projected.messages);
    assert.deepEqual(snapshot.selectionManifest, projected.selectionManifest);
    assert.deepEqual(snapshot.reductions, projected.reductions);
  }
  const task = contextPayload('task', 'context.task-tool-feedback');
  const tools = contextPayload('tools', 'context.tools-feedback');
  const fit = contextPayload('budget', 'context.budget-fits-feedback');
  const valid = contextPayload('validate', 'context.validated-feedback');
  const ready = contextPayload('publish', 'context.ready-feedback');
  for (const projection of [tools, fit, valid]) assert.deepEqual(projection.messages, task.messages);
  const snapshot = ready.contextSnapshot as Record<string, Json>;
  assert.deepEqual((snapshot.modelContext as Record<string, Json>).messages, task.messages);
  assert.equal((snapshot.identities as Record<string, Json>).roundId, 'round-002');
  assert.equal(((ready.state as Record<string, Json>).limits as Record<string, Json>).roundsStarted, 1);
  const media = contextPayload('task', 'context.task-media');
  const evidence = (media.taskEvidence as Record<string, Json>[])[0];
  assert.equal(evidence.text, null);
  assert.equal(evidence.artifactRef, 'artifact:input-001:image-001');
  const origins = new Set((media.sources as Record<string, Json>[]).map(item => item.sourceRef));
  assert.ok(origins.has(evidence.sourceRef));
  assert.ok((media.messages as Record<string, Json>[]).some(item => item.role === 'assistant' && typeof item.content === 'string'));
});

test('a fitting context can still carry an orphan result for explicit validation failure', () => {
  const malformed = contextPayload('budget', 'context.budget-fits-invalid');
  const messages = malformed.messages as Record<string, Json>[];
  assert.ok((malformed.budget as Record<string, Json>).fits);
  assert.ok(messages.some(message => message.role === 'tool' && message.callId === 'call-001'));
  assert.equal(messages.some(message => message.role === 'assistant'), false);
  const input = contractForNode('lina-context-validate')!.input.examples.find(example =>
    (example.value as Record<string, Json>).event && ((example.value as Record<string, Json>).event as Record<string, Json>).kind === 'context.budget-fits-invalid');
  assert.ok(input, 'the invalid relationship remains visible at its receiving node');
  assert.equal((contextPayload('validate', 'context.invalid').contextFailure as Record<string, Json>).modelAttemptLaunched, false);
});
