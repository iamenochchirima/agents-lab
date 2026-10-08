import assert from 'node:assert/strict';
import test from 'node:test';
import { ENVIRONMENT_EDGES, ENVIRONMENT_STATE_ROUTES } from '../src/features/lina/environmentBlock';
import { environmentExecutionContracts, environmentStatuses, environmentPhasePayload } from '../src/features/lina/contracts/environmentExecution';
import { contractDefinitions, contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import { environmentProfile, environmentTarget, environmentFileRequest, environmentProcessControl, environmentChildBinding, environmentPlacement, environmentWorkspace } from '../src/features/lina/contracts/environmentRecords';
import { safetyBinding, safetyScope } from '../src/features/lina/contracts/safetyRecords';
import { stateRecordKinds, stateRecordsByKind, stateCheckpointManifest } from '../src/features/lina/contracts/stateRecords';
import { contextCandidate, contextSnapshot } from '../src/features/lina/contracts/contextAssembly';
import type { Json } from '../src/features/lina/contracts/schema';
const record = (value: Json) => value as Record<string, Json>;
const payload = (value: Json) => record(record(value).payload);
test('twelve contracts preserve every Environment producer handoff into consumer example', () => {
 assert.equal(environmentExecutionContracts.length,12);
 for (const edge of ENVIRONMENT_EDGES) {
  const outputs=outputsForEdge(edge.id); assert.ok(outputs.length,edge.id);
  for (const out of outputs) {
   assert.equal(contractDefinitions.find(def=>def.outputs.includes(out))?.nodeId,edge.source);
   assert.ok(contractForNode(edge.target)?.input.examples.some(input=>input.edgeId===edge.id&&JSON.stringify(record(input.value).event)===JSON.stringify(out.example)),edge.id);
  }
 }
});
test('State replies retain exact request/transaction identity and never imply physical launch', () => {
 for (const route of ENVIRONMENT_STATE_ROUTES) {
  const request=payload(outputsForEdge(route.id)[0].example);
  for (const out of outputsForEdge(route.returnId)) {
   const result=payload(out.example);
   for (const field of ['identity','target','transactionId','fingerprint','expectedRevision','expectedOwnerGeneration','requestPhase','requesterNodeId','returnToNodeId']) assert.deepEqual(result[field],request[field],`${route.phase}: ${field}`);
   assert.equal(result.storageReceiptGrantsLaunch,false); assert.equal(result.recordAbsenceProvesEffectAbsent,false);
  }
 }
 const launch=payload(outputsForEdge('lina-environment-edge-acquire-state-record')[0].example);
 const inspect=payload(outputsForEdge('lina-environment-edge-acquire-inspect-state-load')[0].example);
 assert.equal(inspect.transactionId,launch.transactionId); assert.equal(inspect.fingerprint,launch.fingerprint);
});
test('local defaults disclose advisory restrictions and explicit host account access', () => {
 const profile=record(environmentProfile.example);
 assert.equal(profile.backend,'local'); assert.equal(profile.isolationMechanism,'none'); assert.equal(profile.hostFallbackAllowed,false);
 assert.equal(record(record(profile.limits).memoryMiB).enforcement,'advisory');
 assert.equal(record(environmentWorkspace.example).shellCwdIsFilesystemConfinement,false);
 assert.equal(record(environmentWorkspace.example).localShellRunsWithHostAccountAccess,true);
 for (const statuses of Object.entries(environmentStatuses)) for (const status of statuses[1]) {
  const result=record(environmentPhasePayload(statuses[0],status).example);
  assert.equal(result.grantsActionPermission,false); assert.equal(result.hostFallback,false);
 }
});
test('file and process commands are discriminated including stdin/PTY and mutation options', () => {
 assert.deepEqual(environmentFileRequest.schema.anyOf!.map(s=>s.properties?.action.const),['read','list','search','stat','write','edit','delete']);
 assert.deepEqual(environmentProcessControl.schema.anyOf!.map(s=>s.properties?.action.const),['poll','logs','stdin','signal','terminate','resize']);
 const control=environmentProcessControl.schema.anyOf!.find(s=>s.properties?.action.const==='stdin')!;
 assert.equal(control.properties?.inputRef.type,'string');
 assert.equal(environmentProcessControl.schema.anyOf!.find(s=>s.properties?.action.const==='poll')!.properties?.inputRef.const,null);
});
test('exact target generations and mount revision participate in Safety reviewed binding', () => {
 for(const field of ['environmentId','environmentGeneration','workspaceId','workspaceGeneration','mountRevision','bindingDigest']) assert.ok(environmentTarget.schema.required?.includes(field));
 for(const safety of [safetyBinding,safetyScope]) {
  const shape=safety.schema.properties!.environmentTarget.anyOf![0];
  assert.deepEqual(shape,environmentTarget.schema);
 }
 const permit=payload(outputsForEdge('lina-environment-edge-authorize-start')[0].example);
 assert.deepEqual(permit.reviewedEnvironmentTarget,permit.currentEnvironmentTarget); assert.equal(permit.mountRevisionMustMatch,true);
});
test('terminal process state is separate from no-effect proof and unknown work cannot be replaced', () => {
 const unknown=record(environmentPhasePayload('start','unknown').example);
 assert.equal(unknown.physicalLaunchProven,false); assert.equal(record(unknown.intent).unknownCanBeReplaced,false);
 const exited=record(environmentPhasePayload('process','exited').example);
 assert.equal(exited.exitObserved,true); assert.equal(record(exited.process).exitCode,0);
 const inspection=record(environmentPhasePayload('reconcile','terminal').example);
 assert.equal(inspection.noEffectProven,false); assert.equal(inspection.processTerminalIsNoEffectProof,false);
 const unstarted=record(environmentPhasePayload('reconcile','proven-unstarted').example);
 assert.equal(unstarted.noEffectProven,true); assert.equal(record(unstarted.receipt).newLaunchAuthorized,false);
});
test('progress cannot settle tool batch or accept Planning goal', () => {
 const progress=record(environmentPhasePayload('collect','progress').example);
 assert.equal(record(progress.observation).terminal,false); assert.equal(progress.nextModelRoundAllowedByThisReceipt,false); assert.equal(progress.taskAcceptedByThisReceipt,false);
 const outgoing=outputsForEdge('lina-environment-edge-collect-tools').find(out=>out.id.endsWith('.progress'))!;
 assert.equal(record(record(payload(outgoing.example).handoff).observation).terminal,false);
});
test('unknown input transfer preserves original custody and refuses verified staging claims', () => {
 const result=record(environmentPhasePayload('stage','unknown').example);
 assert.equal(result.copyVerified,false); assert.equal(result.originalCustodyPreserved,true);
 const entry=record((record(result.manifest).entries as Json[])[0]);
 assert.equal(entry.status,'unknown'); assert.equal(entry.originalCustodyReplaced,false);
});
test('artifact publication requires custody, managed cleanup respects borrowed ownership', () => {
 for(const status of environmentStatuses.artifacts) {
  const result=record(environmentPhasePayload('artifacts',status).example), artifact=record(result.artifact);
  assert.equal(result.cleanupEligibleFromExport,status==='retained');
  if(status!=='retained') {assert.equal(artifact.storageRef,null); assert.equal(artifact.transferReceiptRef,null);}
 }
 for(const status of environmentStatuses.release) {
  const result=record(environmentPhasePayload('release',status).example), receipt=record(result.receipt);
  assert.equal(receipt.userWorkspaceDeleted,false); assert.equal(receipt.unrelatedProcessesTerminated,false);
  assert.equal(receipt.stopImpliesDestroy,false);
  if(status==='removed') assert.equal(record(receipt.lease).resourceOwnership,'managed');
 }
});
test('inherited child keeps shared environment identity and distinct lease without broader authority', () => {
 const child=record(environmentChildBinding.example);
 assert.equal(child.parentEnvironmentId,child.childEnvironmentId); assert.notEqual(child.parentLeaseId,child.childLeaseId);
 assert.equal(child.expandsAuthority,false); assert.equal(child.processControlRightsAutomaticallyShared,false); assert.equal(child.childLeaseCannotDestroyParentResources,true);
 assert.deepEqual(environmentPlacement.schema.anyOf!.map(s=>s.properties?.kind.const??s.properties?.kind.enum),['pure','external-service','configured-host-service',['workspace-local','workspace-sandbox']]);
});
test('State and Context records preserve environment references without live handle portability claims', () => {
 for(const kind of ['environment-binding','environment-lease','environment-intent','environment-process','environment-observation','environment-staging','environment-artifact','environment-release']) {assert.ok((stateRecordKinds as readonly string[]).includes(kind)); assert.ok(stateRecordsByKind[kind]);}
 const refs=stateCheckpointManifest.schema.properties!.environmentReferences.items!;
 assert.equal(refs.properties!.inspectionRequiredBeforeReuse.const,true); assert.equal(refs.properties!.checkpointProvesProcessAlive.const,false); assert.equal(refs.properties!.liveHandlesSerialized.const,false);
 for(const context of [contextCandidate,contextSnapshot]) {
  assert.equal(record(context.example).environmentProjection,null);
  const projection=context.schema.properties!.environmentProjection.anyOf![0];
  assert.equal(projection.properties!.credentialMaterialIncluded.const,false); assert.equal(projection.properties!.filesystemInventoryIncluded.const,false);
 }
});

test('Context source reads retain their requester without fabricated model tool calls', () => {
 for (const edge of ['lina-environment-edge-context-files', 'lina-environment-edge-collect-context']) {
  for (const out of outputsForEdge(edge)) {
   const body=payload(out.example);
   const scoped='handoff' in body ? record(body.handoff) : body;
   const identity=record(scoped.identity);
   assert.equal(identity.origin,'context-source'); assert.equal(identity.callId,null); assert.equal(identity.batchId,null); assert.equal(identity.requesterNodeId,'lina-context-load');
   if ('phaseOutcome' in body) assert.deepEqual(record(body.phaseOutcome).identity,identity);
  }
 }
 const pending=outputsForEdge('lina-environment-edge-acquire-reconcile').find(out=>out.id.endsWith('.provisioning'))!;
 const result=record(payload(pending.example).handoff);
 assert.equal(record(result.receipt).status,'pending-provision'); assert.equal(result.resourceExistenceCertainty,'known'); assert.equal(result.replacementLaunchAllowed,false);
});
