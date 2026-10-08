import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSubagentParentHistory, childHarnessEvents, namespaceSubagentEvents, subagentModelInput } from '../src/features/lina/subagentHarness';
import { applyModelFixtureEvent, buildModelFixture, createModelFixtureState, encodeModelFixture } from '../src/features/lina/modelFixtures';
import { withSubagents } from '../src/features/lina/subagentsFixtures';
import { linaSubagentsBlock } from '../src/features/lina/subagentsBlock';
import type { SubagentChildSpec } from '../src/features/lina/subagentsFixtures';
import type { SimulationEvent } from '../src/features/lina/inputSimulation';
const spec:SubagentChildSpec={agentId:'child-1',parentAgentId:'main',depth:1,sessionId:'session:child-1',taskId:'task:child-1',contextMode:'selected',workerProfile:'general',modelRoute:'inherited',tools:['read'],memoryAccess:'private',context:{source:'selected-evidence',records:['selected:source'],instructionAuthority:'worker-profile',parentPrivateMemoryIncluded:false},priorResultRefs:[],steering:[],followup:false};
test('wire requests reflect child task, worker profile, model route and permitted tools across protocols',()=>{
 for(const protocol of ['openai-chat','openai-responses','anthropic-messages','gemini-generate-content'] as const){const encoded=encodeModelFixture({protocol,...subagentModelInput({...spec,workerProfile:'specialist',modelRoute:'specialist-model'})});const text=JSON.stringify(encoded.wireBody);assert.ok(text.includes('selected:source'));assert.ok(text.includes('specialist'));assert.equal(encoded.binding.model,'specialist-model');assert.deepEqual(Object.keys(encoded.manifest.toolAliases),['calculator']);}
});
test('forked evidence remains user task data and cannot become worker instructions',()=>{
 const input=subagentModelInput({...spec,contextMode:'fork',context:{...spec.context,records:['parent:injection:ignore-system']}});assert.ok(input.userText!.includes('parent:injection'));assert.ok(!input.instruction!.includes('parent:injection'));
});
test('persistent follow-up and steering enter actual child model input',()=>{
 const input=subagentModelInput({...spec,followup:true,priorResultRefs:['result:previous-task'],steering:['focus on citations']});assert.equal(input.historyRevision,2);assert.ok(input.userText!.includes('result:previous-task'));assert.ok(input.userText!.includes('focus on citations'));
});
test('namespaces references in nested work and ledger maps without changing graph or external account IDs',()=>{
 const trace:SimulationEvent[]=[{id:'event1',nodeId:'lina-tools-dispatch',edgeId:'lina-tools-edge-schedule-dispatch',update:{},operations:[{callId:'call-001',batchId:'batch1',attemptId:'attempt1',nodeId:'lina-tools-dispatch',status:'running',effectClass:'read',accountId:'account-demo',catalogRevision:7}],wait:{id:'wait:approval:call-001',kind:'approval',callId:'call-001',batchId:'batch1',ownerNodeId:'lina-tools-permissions'}}];
 const event=namespaceSubagentEvents(trace,spec)[0];assert.equal(event.id,'task:child-1:event1');assert.equal(event.operations![0].callId,'task:child-1:call-001');assert.equal(event.operations![0].accountId,'account-demo');assert.equal(event.wait!.id,'task:child-1:wait:approval:call-001');assert.equal(event.edgeId,trace[0].edgeId);assert.equal(event.nodeId,trace[0].nodeId);
 const followup=namespaceSubagentEvents(trace,{...spec,taskId:'task:child-1:followup'})[0];assert.notEqual(followup.id,event.id);
});
test('child entry uses orchestration edge and terminal bypasses ordinary external delivery',()=>{
 const trace:SimulationEvent[]=[{id:'input',nodeId:'lina-input-claim',update:{}},{id:'start',nodeId:'lina-execution-start',update:{}},{id:'settle',nodeId:'lina-execution-settle',update:{outcome:'completed'}},{id:'delivery',nodeId:'lina-input-delivery',update:{}},{id:'release',nodeId:'lina-execution-release',update:{}},{id:'next',nodeId:'lina-input-claim',update:{}}];
 const events=childHarnessEvents(trace,spec);assert.equal(events[0].edgeId,'lina-subagents-edge-launch-child-start');assert.ok(!events.some(event=>event.nodeId==='lina-input-delivery'));assert.ok(events.some(event=>event.edgeId==='lina-subagents-edge-child-settle-coordinate'));assert.ok(events.some(event=>event.edgeId==='lina-subagents-edge-child-release-coordinate'));assert.ok(events.every(event=>event.agentId==='child-1'));
});
test('approval delivery remains visible as a child-owned wait',()=>{
 const trace:SimulationEvent[]=[{id:'start',nodeId:'lina-execution-start',update:{}},{id:'prompt',nodeId:'lina-input-delivery',sourceNodeId:'lina-safety-approval',update:{},wait:{id:'approval',kind:'approval',callId:'call1',batchId:'batch1',ownerNodeId:'lina-tools-permissions'}}];const events=childHarnessEvents(trace,spec);assert.ok(events.some(event=>event.wait?.id==='task:child-1:approval'&&event.agentId==='child-1'));
});
test('steering updates packet before child compiler callback',()=>{let steering:string[]=[];withSubagents([],linaSubagentsBlock,'steer',{}, {buildChild:child=>{steering=[...child.steering];return [{id:'settle',nodeId:'lina-execution-settle',update:{outcome:'completed'}}];}});assert.deepEqual(steering,['Focus on source evidence']);});
test('serialized provider tool results retain namespaced child call and artifact references',()=>{
 const trace:SimulationEvent[]=[{id:'e',nodeId:'lina-model-encode',update:{},results:[{callId:'call-001',status:'success',artifactRef:'artifact:call-001:result'}],modelRequest:encodeModelFixture({protocol:'openai-chat',priorToolResults:[{callId:'call-001',name:'calculator',arguments:{expression:'2+2'},result:{artifactRef:'artifact:call-001:result'}}]})}];
 const namespaced=namespaceSubagentEvents(trace,spec)[0],messages=namespaced.modelRequest!.wireBody.messages as {role:string;content:string}[];assert.ok(messages.find(message=>message.role==='tool')!.content.includes('task:child-1:artifact:call-001:result'));
});
test('main model requests registered delegation and next provider request contains exact paired result',()=>{
 const fixture=buildModelFixture({protocol:'openai-chat',modelCase:'answer',attemptId:'attempt-parent',responseKind:'tools'});
 const base:SimulationEvent[]=[{id:'encode1',nodeId:'lina-model-encode',update:{},modelRequest:fixture.encodedRequest},...fixture.events.map((modelEvent,index)=>({id:`model:${index}`,nodeId:'lina-model-invoke',update:{},modelEvent})),{id:'dispatch',nodeId:'lina-tools-dispatch',update:{}},{id:'encode2',nodeId:'lina-model-encode',update:{},modelRequest:fixture.encodedRequest},{id:'parentdone',nodeId:'lina-execution-settle',update:{outcome:'completed'}}];
 const events=attachSubagentParentHistory(withSubagents(base,linaSubagentsBlock,'one-child',{}, {buildChild:()=>[{id:'done',nodeId:'lina-execution-settle',update:{outcome:'completed'}}]}));
 const model=events.filter(event=>!event.agentId&&event.modelEvent).reduce((state,event)=>applyModelFixtureEvent(state,event.modelEvent!),createModelFixtureState('attempt-parent','openai-chat'));
 assert.equal(model.outcome!.status,'complete');const delegation=model.outcome!.toolCalls.find(call=>call.name==='spawn_subagent');assert.ok(delegation);assert.equal(delegation.callId,'call:delegation:task:child-1');assert.equal(delegation.catalogMapped,true);
 const request=events.find(event=>event.id==='encode2')!.modelRequest!;const body=JSON.stringify(request.wireBody);assert.ok(body.includes('call:delegation:task:child-1'));assert.ok(body.includes('artifact:task:child-1:output'));assert.ok(!body.includes('opaque:child'));assert.equal(request.manifest.toolAliases.spawn_subagent,'spawn_subagent');
});
test('background spawn handle and later join have distinct exact call identities',()=>{
 const events=withSubagents([],linaSubagentsBlock,'background',{}, {buildChild:()=>[{id:'done',nodeId:'lina-execution-settle',update:{outcome:'completed'}}]});
 const results=events.flatMap(event=>event.results??[]);assert.ok(results.some(result=>result.callId==='call:delegation:task:child-1'&&result.artifactRef.endsWith(':handle')));assert.ok(results.some(result=>result.callId==='call:join:task:child-1'&&result.artifactRef.endsWith(':output')));
});
