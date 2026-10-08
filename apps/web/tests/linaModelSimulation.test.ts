import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture } from '../src/features/lina/architectureDocument';
import { startSimulation, advanceSimulation, answerSimulation, stopSimulation, pauseSimulation, resumeSimulation, resetSimulation, type SimulationState, type SimulationAnswer, type SimulationCase, type ToolScenario } from '../src/features/lina/inputSimulation';
import { MODEL_CASES, MODEL_PROTOCOLS, applyModelFixtureEvent, type ModelCase, type ModelProtocol } from '../src/features/lina/modelFixtures';
const doc=linaArchitecture;
const initial=(modelCase:ModelCase='answer',protocol:ModelProtocol='openai-chat',automatic=false,executionCase:SimulationCase='direct-answer',toolScenario:ToolScenario='parallel')=>startSimulation('cli',doc,automatic,executionCase,3,'fits',toolScenario,protocol,modelCase);
function until(state:SimulationState,predicate:(state:SimulationState)=>boolean):SimulationState {
 for(let limit=0;limit<1500;limit++){
  assert.notEqual(state.status,'blocked',state.error);
  if(predicate(state))return state;
  assert.notEqual(state.status,'completed','Simulation completed before target state');
  assert.notEqual(state.status,'waiting','Unexpected wait before target state');
  const previous=state;state=advanceSimulation(state,doc);assert.notEqual(state.step,previous.step,'Reducer stalled before target');
 }
 throw new Error('Simulation failed to reach target within bounded events');
}
function complete(state:SimulationState, answer?:(state:SimulationState)=>SimulationAnswer):SimulationState {
 for(let limit=0;limit<1500;limit++){
  assert.notEqual(state.status,'blocked',state.error);
  if(state.status==='completed')return state;
  if(state.status==='waiting'){
   const selected=answer?.(state)??(state.wait?.kind==='approval'?'approve':state.wait?.kind==='reconciliation'?'known-success':'ready');
   state=answerSimulation(state,doc,selected);
  }else state=advanceSimulation(state,doc);
 }
 throw new Error('Simulation did not settle within bounded events');
}
const failed=new Set<ModelCase>(['truncated','malformed','duplicate-calls','missing-finish','unknown-finish','unsupported-media','unsupported-schema','unsupported-setting','opaque-mismatch','http200-error','empty','unknown-tool']);
const prelaunch=new Set<ModelCase>(['unsupported-media','unsupported-schema','unsupported-setting','opaque-mismatch']);
const recoveries=new Set<ModelCase>(['retry-before-output','retry-after-output','context-overflow']);
const parallelCases=new Set<ModelCase>(['interleaved-tools','text-tools']);
function comparable(state:SimulationState){return {route:state.route,step:state.step,rounds:state.rounds,attempts:state.attempts,contextPreparations:state.contextPreparations,outcome:state.outcome,operations:state.operations,results:state.results,model:state.model,modelHistory:state.modelHistory,modelOutcome:state.modelOutcome,modelRequest:state.modelRequest};}

for(const {value:protocol} of MODEL_PROTOCOLS)for(const {value:modelCase} of MODEL_CASES)test(`${protocol} / ${modelCase}: graph path, launch budgets and Auto/Next semantics`,()=>{
 const manual=complete(initial(modelCase,protocol));const automatic=complete(initial(modelCase,protocol,true));
 assert.deepEqual(comparable(automatic),comparable(manual));
 assert.equal(manual.outcome,failed.has(modelCase)?'failed':'completed');
 const launches=manual.events.filter(event=>event.modelEvent?.type==='launch');assert.equal(manual.attempts,launches.length);
 assert.equal(manual.attempts,prelaunch.has(modelCase)?0:recoveries.has(modelCase)||parallelCases.has(modelCase)?2:1);
 assert.equal(manual.rounds,prelaunch.has(modelCase)?0:parallelCases.has(modelCase)?2:1);
 if(failed.has(modelCase))assert.equal(manual.operations.length,0,'Unusable calls cannot dispatch');
 if(parallelCases.has(modelCase)){assert.equal(manual.results.length,2);assert.deepEqual(manual.results.map(result=>result.status),['success','success']);}
 for(const event of manual.events)if(event.edgeId)assert.ok(doc.edges.some(edge=>edge.id===event.edgeId&&edge.source===event.sourceNodeId&&edge.target===event.nodeId),event.edgeId);
});

test('metadata and encoding have zero launch accounting; first dispatch creates round and attempt once',()=>{
 let state=until(initial(),state=>state.modelWork?.purpose==='metadata'&&state.modelWork.phase==='resolving');
 assert.equal(state.attempts,0);assert.equal(state.rounds,0);assert.equal(state.model,undefined);
 state=until(state,state=>state.modelWork?.phase==='encoding');assert.equal(state.attempts,0);assert.equal(state.rounds,0);assert.ok(state.contextSnapshotRef);
 state=until(state,state=>state.model?.lifecycle==='running');assert.equal(state.attempts,1);assert.equal(state.rounds,1);assert.equal(state.model?.launchCount,1);
});

test('interleaved drafts and even closed items cannot launch Tools before provider terminal and Normalize',()=>{
 let state=initial('interleaved-tools');let witnessedTwoBuffers=false,witnessedClosedBeforeTerminal=false;
 while(state.status!=='completed'){
  state=advanceSimulation(state,doc);assert.notEqual(state.status,'blocked',state.error);
  if(state.model?.lifecycle==='running'){
   assert.equal(state.operations.filter(operation=>operation.status==='running').length,0);
   assert.equal(state.model.outcome,undefined);
   witnessedTwoBuffers ||= state.model.buffers.filter(buffer=>buffer.kind==='tool').length===2;
   witnessedClosedBeforeTerminal ||= state.model.buffers.some(buffer=>buffer.closed);
  }
  if(state.operations.some(operation=>operation.status==='running')){
   const visited=state.route.slice(0,state.step+1);assert.ok(visited.includes('lina-model-normalize'));assert.ok(visited.includes('lina-execution-decide'));assert.equal(state.model?.outcome?.toolCalls.length,2);
  }
 }
 assert.ok(witnessedTwoBuffers);assert.ok(witnessedClosedBeforeTerminal);
});

for(const modelCase of ['retry-before-output','retry-after-output','context-overflow'] as const)test(`${modelCase} retains failed attempt and retries original logical round`,()=>{
 const state=complete(initial(modelCase));assert.equal(state.rounds,1);assert.equal(state.attempts,2);assert.equal(state.modelHistory.length,1);
 assert.notEqual(state.modelHistory[0].attemptId,state.model?.attemptId);assert.equal(state.modelHistory[0].outcome?.status,'failed');assert.equal(state.model?.outcome?.status,'complete');
 if(modelCase==='retry-after-output'){assert.ok(state.modelHistory[0].buffers.some(buffer=>buffer.text.length>0));assert.equal(state.model?.outcome?.text,complete(initial('answer')).modelOutcome?.text,'Retried answer must not concatenate the previous failed preview');}
 if(modelCase==='context-overflow')assert.equal(state.contextPreparations,2);
 assert.equal(state.operations.length,0);
});
for(const modelCase of ['binding-change','budget-change'] as const)test(`${modelCase} reprepares without launching the stale projection`,()=>{
 const state=complete(initial(modelCase));assert.equal(state.contextPreparations,2);assert.equal(state.rounds,1);assert.equal(state.attempts,1);
 assert.equal(state.modelRequest?.binding.bindingRevision,modelCase==='binding-change'?2:1);
 assert.equal(state.modelRequest?.binding.capabilityRevision,modelCase==='budget-change'?2:1);
 assert.equal(state.modelRequest?.snapshotRef,state.contextSnapshotRef);
 const publications=state.events.filter(event=>event.edgeId==='lina-context-edge-validate-publish').map(event=>event.update.contextSnapshotRef);
 assert.equal(publications.length,2);assert.equal(new Set(publications).size,2,'Reprepared immutable snapshots need distinct identities');
 const reprepare=state.events.findIndex(event=>event.edgeId==='lina-model-edge-resolve-reprepare'||event.edgeId==='lina-model-edge-encode-reprepare');const launch=state.events.findIndex(event=>event.modelEvent?.type==='launch');assert.ok(reprepare>=0&&launch>reprepare);
});

for(const modelCase of ['credential-wait','metadata-credential-wait'] as const)for(const answer of ['ready','deny','expire'] as const)test(`${modelCase} / ${answer} resumes exact retained readiness purpose`,()=>{
 let state=until(initial(modelCase),state=>state.status==='waiting');const wait=state.wait!;assert.equal(wait.owner,'model');assert.equal(state.attempts,0);assert.equal(state.rounds,0);
 if(wait.owner==='model')assert.equal(wait.purpose,modelCase==='metadata-credential-wait'?'metadata':'invocation');
 for(const rejected of ['stale','wrong-account'] as const){const unchanged=answerSimulation(state,doc,rejected);assert.equal(unchanged.status,'waiting');assert.deepEqual(unchanged.wait,wait);assert.equal(unchanged.step,state.step);}
 const noProgress=advanceSimulation(state,doc);assert.equal(noProgress.step,state.step);
 state=answerSimulation(state,doc,answer);state=complete(state);assert.equal(state.outcome,answer==='ready'?'completed':'failed');assert.equal(state.attempts,answer==='ready'?1:0);assert.equal(state.rounds,answer==='ready'?1:0);
 assert.equal(state.events.filter(event=>event.modelEvent?.type==='launch').length,answer==='ready'?1:0);
});

for(const phase of ['resolving','encoding'] as const)test(`Stop while ${phase} cancels intent without an attempt`,()=>{
 const start=until(initial(),state=>state.modelWork?.purpose==='invocation'&&state.modelWork.phase===phase);
 const state=complete(stopSimulation(start,doc));assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,0);assert.equal(state.rounds,0);assert.equal(state.modelOutcome?.attemptId,null);assert.equal(state.modelOutcome?.usage.availability,'unavailable');
 assert.equal(state.events.slice(start.step+1).filter(event=>event.modelEvent?.type==='launch').length,0);
});

test('Stop while metadata readiness waits invalidates callback and settles the same preparation',()=>{
 const start=until(initial('metadata-credential-wait'),state=>state.status==='waiting');const stopped=stopSimulation(start,doc);const late=answerSimulation(stopped,doc,'ready');assert.equal(late.stopRequested,true);
 const state=complete(late);assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,0);assert.equal(state.rounds,0);assert.ok(state.events.some(event=>event.edgeId==='lina-model-edge-cancel-readiness'));
});

test('Stop during streaming accounts one attempt and rejects late provider fragments',()=>{
 const start=until(initial('interleaved-tools'),state=>state.model?.lifecycle==='running'&&state.model.buffers.length>0);
 const state=complete(stopSimulation(start,doc));assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,1);assert.equal(state.rounds,1);assert.equal(state.model?.outcome?.status,'aborted');assert.equal(state.model?.outcome?.remoteStatus,'unknown');assert.equal(state.operations.length,0);
 const previous=state.model!;const late=applyModelFixtureEvent(previous,{type:'text-delta',attemptId:previous.attemptId,sequence:previous.lastSequence+1,itemId:'late',text:'Never execute this',rawEvent:{fixture:'late'}});
 assert.deepEqual(late.buffers,previous.buffers);assert.deepEqual(late.outcome,previous.outcome);assert.ok(late.diagnostics.length>previous.diagnostics.length);
});

test('delayed local Stop settlement retains execution until exact attempt accounted',()=>{
 let state=until(initial('local-settlement-wait'),state=>state.model?.lifecycle==='running');const attemptId=state.model!.attemptId;
 state=stopSimulation(state,doc);state=until(state,state=>state.status==='waiting');assert.equal(state.wait?.kind,'model-settlement');assert.equal(state.wait?.owner,'model');assert.equal(state.model?.lifecycle,'running');assert.equal(state.attempts,1);
 const wait=state.wait!;assert.equal(advanceSimulation(state,doc).step,state.step);assert.deepEqual(answerSimulation(state,doc,'wrong-account').wait,wait);
 state=complete(answerSimulation(state,doc,'ready'));assert.equal(state.outcome,'cancelled');assert.equal(state.model?.attemptId,attemptId);assert.equal(state.attempts,1);assert.equal(state.modelOutcome?.remoteStatus,'unknown');assert.equal(state.modelOutcome?.usage.availability,'unavailable');
 assert.equal(state.events.filter(event=>event.modelEvent?.type==='launch').length,1);
});

test('Pause changes viewing pace, Resume uses same events, Reset retains Model settings',()=>{
 const state=until(initial('text-tools','gemini-generate-content',true),state=>state.model?.lifecycle==='running');const paused=pauseSimulation(state);assert.equal(paused.automatic,false);assert.equal(paused.stopRequested,false);assert.deepEqual(paused.model,state.model);
 const resumed=resumeSimulation(paused);assert.equal(resumed.automatic,true);assert.deepEqual(resumed.events,state.events);assert.equal(complete(resumed).outcome,'completed');
 const reset=resetSimulation(resumed,doc);assert.equal(reset.modelProtocol,'gemini-generate-content');assert.equal(reset.modelCase,'text-tools');assert.equal(reset.attempts,0);assert.equal(reset.rounds,0);assert.equal(reset.model,undefined);assert.equal(reset.status,'paused');
});

test('Model readiness then Tool approval denial remain separate waits without resetting earlier work',()=>{
 let state=until(initial('credential-wait','openai-chat',false,'tool-round','approval'),state=>state.status==='waiting');assert.equal(state.wait?.owner,'model');state=answerSimulation(state,doc,'ready');
 state=until(state,state=>state.status==='waiting');assert.equal(state.wait?.kind,'approval');assert.notEqual(state.wait?.owner,'model');assert.equal(state.attempts,1);const sibling=state.results.find(result=>result.callId==='call-002');assert.equal(sibling?.status,'success');
 state=complete(answerSimulation(state,doc,'deny'));assert.equal(state.outcome,'completed');assert.deepEqual(state.results.find(result=>result.callId==='call-002'),sibling);assert.equal(state.results.find(result=>result.callId==='call-001')?.status,'denied');assert.equal(state.rounds,2);assert.equal(state.attempts,2);
});

test('Stop after provider completion but before Normalize prevents complete calls from reaching Tools',()=>{
 const start=until(initial('interleaved-tools'),state=>state.model?.lifecycle==='settled'&&state.modelWork?.nodeId==='lina-model-invoke');
 assert.equal(start.model?.outcome?.toolCalls.length,2);assert.equal(start.operations.length,0);
 const state=complete(stopSimulation(start,doc));assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,1);assert.equal(state.rounds,1);assert.equal(state.operations.length,0);assert.equal(state.results.length,0);
 assert.equal(state.events.slice(start.step+1).some(event=>event.nodeId==='lina-tools-dispatch'),false);
});

test('Stop during metadata resolution cancels the required dependency before Context publication',()=>{
 const start=until(initial(),state=>state.modelWork?.purpose==='metadata'&&state.modelWork.phase==='resolving');
 const state=complete(stopSimulation(start,doc));assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,0);assert.equal(state.rounds,0);assert.equal(state.contextSnapshotRef,undefined);
 assert.ok(state.events.slice(start.step+1).some(event=>event.edgeId==='lina-model-edge-resolve-context'));
});

for(const {value:protocol} of MODEL_PROTOCOLS)test(`${protocol}: partial and unavailable usage survives full settlement`,()=>{
 const missing=complete(initial('usage-unavailable',protocol));const partial=complete(initial('usage-partial',protocol));
 assert.equal(missing.modelOutcome?.usage.availability,'unavailable');assert.equal(missing.modelOutcome?.usage.inputTokens,null);assert.equal(missing.modelOutcome?.usage.outputTokens,null);assert.equal(missing.modelOutcome?.usage.totalTokens,null);
 assert.equal(partial.modelOutcome?.usage.availability,'partial');assert.ok(partial.modelOutcome?.usage.rawUsage);assert.deepEqual(partial.modelOutcome?.usage,partial.model?.usage,'Partial counters remain the last observed provider snapshot without fabricated final usage');
 const finished=complete(initial('answer',protocol));assert.equal(finished.modelOutcome?.usage.availability,'reported');assert.equal(finished.modelOutcome?.usage.outputTokens,finished.model?.usage.outputTokens);
});

// Inspect the next native request, rather than only the UI's result list: a
// denial/error is still a correlated result and must not become synthetic success.
function nativeResults(state:SimulationState):{callId?:string;name?:string;result:unknown}[]{
 const body=state.modelRequest!.wireBody;
 if(state.modelProtocol==='openai-chat')return (body.messages as Record<string,unknown>[]).filter(message=>message.role==='tool').map(message=>({callId:message.tool_call_id as string,result:JSON.parse(message.content as string)}));
 if(state.modelProtocol==='openai-responses')return (body.input as Record<string,unknown>[]).filter(item=>item.type==='function_call_output').map(item=>({callId:item.call_id as string,result:JSON.parse(item.output as string)}));
 if(state.modelProtocol==='anthropic-messages')return (body.messages as {content:Record<string,unknown>[]}[]).flatMap(message=>message.content.filter(item=>item.type==='tool_result').map(item=>({callId:item.tool_use_id as string,result:JSON.parse(item.content as string)})));
 return (body.contents as {parts:{functionResponse?:{name:string;response:{result:unknown}}}[]}[]).flatMap(content=>content.parts.filter(part=>part.functionResponse).map(part=>({name:part.functionResponse!.name,result:part.functionResponse!.response.result})));
}
for(const {value:protocol} of MODEL_PROTOCOLS)for(const toolScenario of ['mixed','approval'] as const)test(`${protocol}: next encoded request retains ${toolScenario} results and successful sibling`,()=>{
 const state=complete(initial('answer',protocol,false,'tool-round',toolScenario),waiting=>waiting.wait?.kind==='approval'?'deny':'ready');
 assert.equal(state.rounds,2);assert.equal(state.attempts,2);assert.equal(state.outcome,'completed');
 assert.deepEqual(state.results.map(result=>result.status),[toolScenario==='mixed'?'error':'denied','success']);
 const projected=nativeResults(state);assert.equal(projected.length,2);
 assert.deepEqual(projected.map(item=>item.result),state.results);
 if(protocol!=='gemini-generate-content')assert.deepEqual(projected.map(item=>item.callId),state.results.map(result=>result.callId));
 else assert.deepEqual(projected.map(item=>item.name),['calculator','calculator']);
 assert.equal(state.modelHistory.length,1);assert.equal(state.modelHistory[0].outcome?.toolCalls.length,2);
 assert.equal(state.modelRequest?.snapshotRef,state.contextSnapshotRef);
});

test('metadata readiness resumes the same preparation without an extra invocation sign-in',()=>{
 const state=complete(initial('metadata-credential-wait'));
 const gates=state.events.flatMap(event=>event.wait?.owner==='model'?[event.wait]:[]);
 assert.equal(gates.length,1);assert.equal(gates[0].purpose,'metadata');
 assert.equal(state.attempts,1);assert.equal(state.contextPreparations,1);
});
