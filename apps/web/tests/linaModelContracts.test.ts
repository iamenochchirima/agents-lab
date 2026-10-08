import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { linaModelBlock } from '../src/features/lina/modelBlock';
import { modelInterfaceContracts } from '../src/features/lina/contracts/modelInterface';
import { modelMetadataCredentialReady, modelMetadataReadinessResume, modelMetadataReadinessWait, modelPrelaunchCancellation, modelSettlementResume, modelUnavailableUsage, modelToolMapping, modelInvocationIntent, modelCapabilities } from '../src/features/lina/contracts/modelRecords';
import { catalogEntry } from '../src/features/lina/contracts/contextRecords';
import type { Payload } from '../src/features/lina/contracts/schema';
const require = createRequire(new URL('../../../server/package.json', import.meta.url));
const Ajv2020 = require('ajv/dist/2020.js').default;
const ajv = new Ajv2020({strict:true,allErrors:true});
const branch = (id:string):any => {
 const value = modelInterfaceContracts.flatMap(node=>node.outputs).find(output=>output.id===id);
 assert.ok(value,`Missing ${id}`);
 return (value.example as any).payload;
};
const valid = (record:Payload, value:unknown = record.example) => { const check=ajv.compile(record.schema);assert.equal(check(value),true,JSON.stringify(check.errors)); };

test('four Model nodes have standard-valid rich branch examples and declared outgoing connections',()=>{
 assert.equal(linaModelBlock.nodes.length,4);
 assert.equal(linaModelBlock.edges.length,21);
 assert.deepEqual(modelInterfaceContracts.map(node=>node.nodeId).sort(),linaModelBlock.nodes.map(node=>node.id).sort());
 for(const contract of modelInterfaceContracts){valid(contract.context);for(const external of contract.external??[])valid(external.value);for(const result of contract.outputs){valid(result);for(const id of result.edgeIds){const edge=linaModelBlock.edges.find(edge=>edge.id===id);assert.ok(edge,id);assert.equal(edge.source,contract.nodeId);}}}
 const internal=linaModelBlock.edges.filter(edge=>edge.source.startsWith('lina-model-'));
 for(const edge of internal)assert.ok(modelInterfaceContracts.flatMap(node=>node.outputs).some(output=>output.edgeIds.includes(edge.id)),edge.id);
});

test('capabilities, readiness, encoding and prelaunch cancellation do not count physical attempts',()=>{
 for(const id of ['model.capabilities-ready','model.capabilities-unavailable','model.capabilities-cancelled','model.binding-ready','model.request-ready','model.resolve-cancelled','model.encode-cancelled','model.invoke-prelaunch-stopped']){
  const value=branch(id);assert.equal(value.modelAttemptLaunched,false,id);assert.equal(value.identity.attemptId,null,id);
 }
 for(const id of ['model.outcome-prelaunch-failed','model.outcome-prelaunch-aborted']){const value=branch(id);assert.equal(value.identity.attemptId,null);assert.equal(value.executionState.limits.attempts,0);assert.equal(value.executionState.limits.roundsStarted,0);assert.equal(value.providerResponseId,null);}
});

test('metadata readiness preserves purpose, dependency, scope and original preparation in every handoff',()=>{
 const wait=modelMetadataReadinessWait.example as any;
 const ready=modelMetadataCredentialReady.example as any;
 const resume=modelMetadataReadinessResume.example as any;
 assert.equal(wait.purpose,'capabilities');assert.equal(wait.request.purpose,'capabilities');assert.equal(wait.request.identity.preparationId,wait.identity.preparationId);
 assert.deepEqual(ready.wait,wait);assert.deepEqual(resume.wait,wait);assert.deepEqual(resume.completion,ready);
 assert.equal(wait.request.modelAttemptLaunched,false);assert.equal(ready.invocationRequested,false);assert.equal(resume.modelAttemptLaunched,false);
 assert.equal(ready.verifiedAccountId,wait.expectedAccountId);
 for(const value of [modelMetadataReadinessWait,modelMetadataCredentialReady,modelMetadataReadinessResume])valid(value);
});

test('encoded registered schema, digest and account binding equal Context original metadata',()=>{
 const registered=catalogEntry.example as any;const mapping=modelToolMapping.example as any;const encoded=branch('model.request-ready');
 assert.equal(mapping.toolId,registered.toolId);assert.equal(mapping.canonicalName,registered.name);assert.equal(mapping.schemaRevision,registered.schemaRevision);
 assert.equal(mapping.originalSchemaDigest,registered.schemaDigest);assert.equal(mapping.projectedSchemaDigest,registered.schemaDigest);assert.deepEqual(mapping.inputSchema,registered.inputSchema);assert.deepEqual(mapping.binding,registered.binding);
 assert.deepEqual(encoded.safeFixtureBody.tools[0].function.parameters,registered.inputSchema);
 assert.equal(encoded.manifest.toolMappings[0].grantsExecutionPermission,false);assert.equal(encoded.physicalRequestId,null);
 assert.equal(encoded.manifest.contextSnapshotRef,encoded.intent.contextSnapshotRef);assert.equal(encoded.manifest.preparationId,encoded.intent.identity.preparationId);
});

test('effective budget profile accompanies capabilities, intent, binding and encoder manifest',()=>{
 const encoded=branch('model.request-ready');const caps=modelCapabilities.example as any;
 assert.equal(encoded.intent.requiredBudgetProfileRef,caps.budgetProfile.budgetProfileRef);
 assert.equal(encoded.binding.budgetProfile.budgetProfileRef,encoded.manifest.budgetProfileRef);
 assert.equal(encoded.manifest.outputReservation,caps.budgetProfile.outputReservation);
 const refresh=branch('model.encode-budget-changed');assert.equal(refresh.reason,'budget-profile-changed');assert.notEqual(refresh.currentBudgetProfileRef,encoded.manifest.budgetProfileRef);assert.equal(refresh.countersPreserved,true);
});

test('interleaved call previews retain independent indices and cannot authorize Tools',()=>{
 const first=branch('model.progress');const second=branch('model.progress-second-call');
 assert.equal(first.executable,false);assert.equal(second.executable,false);assert.equal(first.callDraft.complete,false);assert.equal(second.callDraft.complete,false);
 assert.notEqual(first.itemId,second.itemId);assert.notEqual(first.callDraft.wireIndex,second.callDraft.wireIndex);assert.notEqual(first.callDraft.wireCallId,second.callDraft.wireCallId);
 assert.equal(first.attempt.attemptId,second.attempt.attemptId);
 const calls=branch('model.outcome-calls').toolCalls;assert.equal(calls.length,2);assert.equal(new Set(calls.map((call:any)=>call.callId)).size,2);assert.equal(new Set(calls.map((call:any)=>call.wireCallId)).size,2);
 for(const call of calls){assert.equal(call.providerConfirmedComplete,true);assert.equal(call.syntax,'complete-json-object');assert.equal(call.schemaValidated,false);assert.equal(call.executionAuthorized,false);}
});

test('incomplete, malformed, refused and unknown outcomes contain no runnable calls',()=>{
 for(const id of ['model.outcome-truncated','model.outcome-malformed','model.outcome-duplicate-call-id','model.outcome-refused','model.outcome-unknown-finish','model.outcome-missing-terminal']){const value=branch(id);assert.deepEqual(value.toolCalls,[]);assert.equal(value.textFinalCandidate,false);assert.equal(value.acceptedAssistantRecordRef,null);assert.ok(value.rawEvidenceRef);}
 assert.equal(branch('model.outcome-unknown-finish').rawFinishReason,'future_reason');
 assert.equal(branch('model.outcome-refused').failure.retryHint,false);
});

test('local abort settles cancelled evidence with unknown remote work and usage',()=>{
 const value=branch('model.outcome-aborted');assert.equal(value.status,'aborted');assert.equal(value.localSettlement,'settled');assert.equal(value.remoteStatus,'unknown');assert.deepEqual(value.usage,modelUnavailableUsage.example);
 const pending=branch('model.local-settlement-pending');assert.equal(pending.cleanReleaseAllowed,false);assert.equal(pending.newAttemptAllowed,false);
 const resume=modelSettlementResume.example as any;assert.equal(resume.resumeSameAttempt,true);assert.equal(resume.invocationRequested,false);
 const cancel=modelPrelaunchCancellation.example as any;assert.equal(cancel.attemptId,null);assert.equal(cancel.pendingReadinessInvalidated,true);assert.equal(cancel.remoteCancellationConfirmed,false);
});

test('failed preview remains nonfinal and provider HTTP status cannot imply completion',()=>{
 const preview=branch('model.outcome-failed-after-output');assert.equal(preview.text,'Partial answer');assert.equal(preview.textFinalCandidate,false);assert.equal(preview.acceptedAssistantRecordRef,null);assert.ok(preview.failure.partialOutputRef);
 const observed=branch('model.attempt-http200-error');assert.equal(observed.transportStatus,200);assert.equal(observed.protocolTerminalObserved,false);assert.ok(observed.rawErrorRef);
 const late=branch('model.progress-late');assert.equal(late.late,true);assert.equal(late.stateMutationAllowed,false);assert.equal(late.executable,false);
});

test('opaque continuation preserves agent, account and conversation rather than pretending portability',()=>{
 const value=branch('model.outcome-scoped-replay');const replay=value.continuation;
 assert.equal(replay.agentId,value.identity.agentId);assert.equal(replay.accountId,branch('model.binding-ready').binding.accountId);assert.equal(replay.conversationId,value.identity.conversationId);assert.equal(replay.portable,false);assert.equal(replay.rawSecretsIncluded,false);assert.ok(replay.replayOrderRef);
 const unsupported=branch('model.outcome-hosted-continuation-unsupported');assert.equal(unsupported.continuationHint,'unsupported-provider-continuation');assert.deepEqual(unsupported.toolCalls,[]);assert.equal(unsupported.rawFinishReason,'pause_turn');
});

test('reported and unavailable usage preserve different accounting semantics',()=>{
 const reported=branch('model.outcome-ready').usage;assert.equal(reported.availability,'reported');assert.equal(reported.total,reported.input+reported.output);assert.equal(reported.streamSemantics,'cumulative-final');assert.equal(reported.cacheRead,null);assert.equal(reported.cost,null);
 const missing=branch('model.outcome-unavailable-usage').usage;for(const key of ['input','output','cacheRead','cacheWrite','reasoning','total','cost'])assert.equal(missing[key],null,key);assert.equal(missing.availability,'unavailable');assert.equal(missing.synthetic,true);
});

test('recovery hints select existing owners without resetting round or pretending permission',()=>{
 const timeout=branch('model.outcome-retryable-failure');const overflow=branch('model.outcome-context-overflow');const auth=branch('model.outcome-auth-failure');
 assert.equal(timeout.failure.retryHint,true);assert.equal(timeout.failure.retryAfterMs,1000);assert.equal(overflow.failure.requestsContextRefresh,true);assert.equal(overflow.failure.retryHint,false);assert.equal(auth.failure.requestsCredentialReadiness,true);
 for(const value of [timeout,overflow,auth]){assert.equal(value.identity.roundId,(modelInvocationIntent.example as any).identity.roundId);assert.equal(value.grantsToolPermission,false);}
});
