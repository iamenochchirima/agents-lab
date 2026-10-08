import test from 'node:test';
import assert from 'node:assert/strict';
import { contractForNode } from '../src/features/lina/contracts/nodeContracts';
import { linaArchitecture } from '../src/features/lina/architectureDocument';

function branch(node: string, output: string): Record<string, any> {
  const value = contractForNode(`lina-${node}`)?.outputs.find(value => value.id === output);
  assert.ok(value, `Missing ${node} / ${output}`);
  return (value.example as Record<string, any>).payload;
}
function edge(id: string) {
  const value = linaArchitecture.edges.find(value => value.id === id);
  assert.ok(value, `Missing ${id}`);
  return value;
}

// Audit cross-block fixture semantics: JSON Schema shape validation alone cannot
// establish identity, account scope, precedence or preservation through handoffs.
test('registered schemas and account bindings survive catalog exposure and Context selection', () => {
  const registry = branch('tools-catalog', 'tools.catalog-published');
  const projection = branch('tools-catalog', 'tools.catalog-model-projection');
  const candidate = branch('context-observations', 'context.observations-rich');
  const selected = candidate.catalogBinding.entries.find((entry: any) => entry.name === 'docs_search');
  const exposed = projection.entries.find((entry: any) => entry.toolId === selected.toolId);
  const registered = registry.entries.find((entry: any) => entry.toolId === selected.toolId);
  assert.ok(registered && exposed);
  assert.equal(registry.catalogRevision, projection.catalogRevision);
  assert.equal(candidate.catalogBinding.catalogRevision, registry.catalogRevision);
  for (const entry of [exposed, selected]) {
    assert.deepEqual(entry.inputSchema, registered.inputSchema);
    assert.equal(entry.inputSchema.properties.query.minLength, 1);
    assert.equal(entry.schemaDigest, registered.schemaDigest);
    assert.equal(entry.schemaRevision, registered.schemaRevision);
    assert.deepEqual(entry.binding, registered.binding);
  }
  assert.equal(projection.grantsExecutionPermission, false);
  assert.equal(candidate.catalogBinding.grantsExecutionPermission, false);
});

test('child preparation keeps its own history and selected namespaces under existing authority', () => {
  const parent = branch('context-scope', 'context.scope-bound');
  const child = branch('context-scope', 'context.scope-bound-child');
  const scope = child.scope;
  assert.equal(scope.agentId, child.request.identities.agentId);
  assert.equal(child.request.state.turn.turnId, child.request.identities.turnId);
  assert.equal(child.request.state.turn.conversationId, child.request.identities.conversationId);
  assert.notEqual(child.request.historyRef, parent.request.historyRef);
  assert.notEqual(scope.historyBranchRef, parent.scope.historyBranchRef);
  assert.equal(scope.inheritanceMode, 'selected-task-packet');
  assert.ok(scope.taskPacketRef);
  assert.ok(scope.excludedSourceRefs.includes('history:parent-private:r9'));
  assert.ok(scope.allowedMemoryNamespaces.every((namespace: string) => namespace.startsWith(`${scope.workspaceId}:`)));
  assert.equal(scope.permissionGeneration, parent.scope.permissionGeneration);
  assert.equal(scope.grantsAdditionalPermission, false);
  assert.equal(child.request.sourceGenerations.scope, scope.scopeRef);
  assert.equal(child.request.sourceGenerations.history, child.request.historyRef);
});

test('activated skill instructions preserve producer provenance and remain below harness precedence', () => {
  const activation = branch('tools-skill-activate', 'tools.skill-activated');
  const candidate = branch('context-instructions', 'context.instructions-skill');
  const selected = candidate.instructions.find((section: any) => section.activationId === activation.activationId);
  assert.ok(selected);
  for (const key of ['sourceRef', 'revision', 'originRef', 'text', 'precedence', 'precedencePolicyRef', 'hostTrustDecisionRef']) assert.equal(selected[key], activation.instruction[key], key);
  assert.equal(selected.contributionDigest, activation.instruction.digest);
  assert.equal(candidate.request.preparationId, activation.preparationId);
  assert.ok(selected.precedence > candidate.instructions.find((section: any) => section.kind === 'harness').precedence);
  assert.ok(candidate.skillInventory.every((skill: any) => skill.metadataOnly && !skill.instructionBodyIncluded));
  assert.equal(activation.grantsAdditionalPermission, false);
});

test('rich mixed results retain canonical identities and artifacts through budget, validation and publication', () => {
  const shaped = branch('context-observations', 'context.observations-rich');
  assert.deepEqual(shaped.canonicalResultCompletionOrder, ['call-002', 'call-001']);
  const calls = shaped.messages.filter((message: any) => message.role === 'assistant' && message.calls).flatMap((message: any) => message.calls);
  const results = shaped.messages.filter((message: any) => message.role === 'tool');
  assert.deepEqual(results.map((result: any) => result.callId), calls.map((call: any) => call.callId));
  assert.deepEqual(shaped.request.state.results, results.map((message: any) => message.result));
  for (const result of results) {
    const projection = shaped.observations.find((observation: any) => observation.callId === result.callId);
    assert.equal(projection.canonicalStatus, result.result.outcome);
    assert.equal(projection.originalResultRef, result.sourceRef);
    assert.ok(projection.rawArtifactRefs.includes(result.artifactRef));
  }
  assert.equal(shaped.observations[0].canonicalStatus, 'error');
  assert.ok(shaped.observations[1].structuredOutputRef);
  assert.ok(shaped.observations[1].content.some((block: any) => block.type === 'image' && block.mimeType === 'image/png'));
  for (const [node, output] of [['context-budget', 'context.budget-fits-rich'], ['context-validate', 'context.validated-rich']]) assert.deepEqual(branch(node, output), shaped);
  const ready = branch('context-publish', 'context.ready-rich');
  assert.deepEqual(ready.contextSnapshot.observations, shaped.observations);
  assert.deepEqual(ready.contextSnapshot.modelContext.messages, shaped.messages);
  assert.deepEqual(ready.state, shaped.request.state);
  assert.equal(ready.contextSnapshot.grantsLaunchPermission, false);
});

test('plugin loading stages every contribution before lifecycle activation and publication', () => {
  const loaded = branch('tools-plugin-load', 'tools.plugin-contributions-loaded');
  const activated = branch('tools-plugin-lifecycle', 'tools.plugin-active-tools');
  const failed = branch('tools-plugin-lifecycle', 'tools.plugin-activation-failed');
  assert.equal(loaded.active, false);
  assert.equal(activated.contributions.active, true);
  assert.deepEqual(activated.contributions.tools, loaded.tools);
  assert.deepEqual(activated.contributions.skills, loaded.skills);
  assert.deepEqual(activated.contributions.hookPoints, loaded.hookPoints);
  const loadEdges = linaArchitecture.edges.filter(value => value.source === 'lina-tools-plugin-load');
  assert.ok(loadEdges.length > 0);
  assert.ok(loadEdges.every(value => value.target === 'lina-tools-plugin-lifecycle'));
  assert.equal(failed.executablePublished, false);
  assert.deepEqual(failed.activeContributionRefs, []);
  assert.equal(branch('tools-plugin-lifecycle', 'tools.plugin-unloaded').freshResolutionAllowed, false);
});

test('Context hook changes are recorded once and must return through budget and validation', () => {
  const request = branch('context-observations', 'context.projection-hook-requested');
  const transformed = branch('tools-hooks', 'tools.context-projection-transformed');
  assert.equal(transformed.revision, request.candidate.revision + 1);
  assert.equal(transformed.hookInvocations.length, 1);
  const invocation = transformed.hookInvocations[0];
  assert.equal(invocation.invocationId, request.hook.invocationId);
  assert.equal(invocation.inputGeneration, request.candidate.revision);
  assert.equal(invocation.invocationCountForGeneration, 1);
  assert.ok(invocation.outputDigest && invocation.outputDigest !== invocation.inputDigest);
  assert.deepEqual(transformed.messages, request.candidate.messages);
  assert.deepEqual(transformed.catalogBinding, request.candidate.catalogBinding);
  assert.ok(transformed.taskEvidence.length > request.candidate.taskEvidence.length);
  assert.equal(invocation.grantsAdditionalPermission, false);
  assert.equal(invocation.mutatesCanonicalHistory, false);
  assert.equal(transformed.budgetRecheckRequired, true);
  assert.equal(transformed.estimatorSnapshotValid, false);
  assert.equal(edge('lina-tools-edge-hooks-context-budget').target, 'lina-context-budget');
  assert.equal(edge('lina-context-edge-budget-validate').target, 'lina-context-validate');
  for (const id of ['lina-context-edge-prune-budget', 'lina-context-edge-compact-budget']) assert.equal(edge(id).target, 'lina-context-budget');
});

test('answers and cancellation retain successful siblings without reusing another wait or launching a round', () => {
  const retained = branch('execution-wait', 'execution.wait-retained');
  const answered = branch('execution-wait', 'execution.wait-approval-answer');
  const rejected = branch('execution-wait', 'execution.wait-answer-rejected');
  assert.deepEqual(answered.wait, retained.wait);
  assert.deepEqual(answered.retainedWork, retained.retainedWork);
  assert.deepEqual(rejected.retainedWork, retained.retainedWork);
  assert.equal(rejected.continuationConsumed, false);
  assert.equal(answered.retainedWork.nextModelRoundAllowed, false);
  assert.deepEqual(answered.retainedWork.requestedCallIds, ['call-001', 'call-002']);
  assert.deepEqual(answered.retainedWork.pendingCallIds, ['call-001']);
  assert.deepEqual(answered.retainedWork.settledResults, [{ callId: 'call-002', outcome: 'success', value: 6 }]);
  assert.deepEqual(answered.retainedWork.state.results, answered.retainedWork.settledResults);
  assert.equal(answered.wait.callId, answered.retainedWork.pendingCallIds[0]);
  assert.equal(answered.wait.owningNodeId, edge('lina-execution-edge-wait-approval').target);
  const resolved = branch('execution-cancel', 'execution.cancellation-resolved');
  assert.deepEqual(resolved.state.results.find((result: any) => result.callId === 'call-002'), answered.retainedWork.settledResults[0]);
});


test('argument-changing hooks bind final validation and approval to the transformed operation', () => {
  const changed = branch('tools-hooks', 'tools.hook-arguments-mutated');
  const validated = branch('tools-validate', 'tools.arguments-valid-after-hook');
  const authorized = branch('tools-permissions', 'tools.calls-authorized-after-hook');
  const original = branch('tools-validate', 'tools.arguments-valid');
  assert.deepEqual(validated.batch.calls, changed.batch.calls);
  for (const call of changed.batch.calls) {
    const validation = validated.validations.find((value: any) => value.callId === call.callId);
    const grant = authorized.decisions.find((value: any) => value.callId === call.callId);
    assert.deepEqual(validation.normalizedArguments, call.arguments);
    assert.equal(grant.argumentDigest, validation.argumentDigest);
    assert.equal(grant.binding.schemaDigest, validation.schemaDigest);
    assert.equal(grant.binding.catalogRevision, authorized.catalogRevision);
  }
  assert.notEqual(validated.validations[0].argumentDigest, original.validations[0].argumentDigest);
  assert.notEqual(authorized.decisions[0].permissionDecisionRef, branch('tools-permissions', 'tools.calls-authorized').decisions[0].permissionDecisionRef);
  assert.deepEqual(validated.validations[1], original.validations[1]);
  assert.equal(edge('lina-tools-edge-hooks-validate').target, 'lina-tools-validate');
  assert.equal(edge('lina-tools-edge-validate-permissions').target, 'lina-tools-permissions');
});
