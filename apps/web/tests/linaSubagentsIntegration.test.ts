import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { SUBAGENT_CASES, type SubagentCase, type SubagentSettings } from '../src/features/lina/subagentsFixtures';
import { advanceSimulation, answerSimulation, resetSimulation, selectSimulationAgent, simulationView, startSimulation, stopSimulation, type SimulationState } from '../src/features/lina/inputSimulation';
const start=(scenario:SubagentCase,automatic=false,settings:Partial<SubagentSettings>={})=>startSimulation('cli',document,automatic,'tool-round',3,'fits','parallel','openai-chat','answer','policy-allow',[],'fresh','baseline',scenario,settings);
function finish(initial:SimulationState){
 let state=initial;
 for(let n=0;n<4000&&!['completed','blocked'].includes(state.status);n++){
  if(state.status==='waiting'){
   const kind=state.wait?.kind;
   state=answerSimulation(state,document,kind==='approval'||kind==='memory-review'?'allow-once':['subagent','reconciliation','delivery-reconciliation'].includes(kind??'')?'known-success':'ready');
  }else state=advanceSimulation(state,document);
 }
 assert.equal(state.status,'completed',state.subagentCase+': '+(state.error??state.detail));
 return state;
}
for(const {value} of SUBAGENT_CASES.filter(item=>item.value!=='disabled'))test(value+': integrated child paths complete identically in Auto and Next',()=>{
 const manual=finish(start(value)),auto=finish(start(value,true));
 assert.deepEqual(manual.subagentSnapshot,auto.subagentSnapshot);
 const project=(state:SimulationState)=>Object.fromEntries(Object.entries(state.agents).map(([id,agent])=>[id,{attempts:agent.attempts,rounds:agent.rounds,results:agent.results,outcome:agent.outcome}]));
 assert.deepEqual(project(manual),project(auto));
 assert.equal(Object.values(manual.agents).some(agent=>agent.status==='waiting'),false,'Completed playback cannot abandon a child approval or publication wait');
 assert.equal(new Set(manual.events.map(event=>event.id)).size,manual.events.length,'Every instance and lifecycle event retains distinct identity');
 assert.equal(manual.events.some(event=>event.agentId&&event.agentId!=='main'&&['lina-input-delivery','lina-input-queue'].includes(event.nodeId)),false,'Child events cannot route to external delivery or parent queue');
 const reset=resetSimulation(manual,document);assert.equal(reset.subagentCase,value);assert.equal(reset.step,0);assert.deepEqual(reset.agents,{});
});
test('parallel children own actual model requests, counters and state',()=>{
 const state=finish(start('parallel'));
 const children=Object.values(state.agents);assert.ok(children.length>=2);
 for(const child of children){
  assert.ok(child.attempts>0);assert.ok(child.rounds>0);assert.ok(child.modelRequest);
  const request=JSON.stringify(child.modelRequest);
  assert.match(request,/worker:general/);assert.match(request,/taskId/);
  assert.equal(child.safetyGrants.length,0);assert.ok(child.stateSnapshot);
  const view=simulationView(selectSimulationAgent(state,child.activeAgentId));assert.equal(view.attempts,child.attempts);
 }
 const parentLaunches=state.events.filter(event=>(event.agentId??'main')==='main'&&event.modelEvent?.type==='launch').length;
 assert.equal(state.attempts,parentLaunches,'Child attempts cannot increment parent model accounting');
});
test('a nested child enters its own existing Model and Tools loop',()=>{
 const state=finish(start('nested'));
 const nested=Object.values(state.subagentSnapshot!.tasks).find(task=>task.depth===2)!;assert.ok(nested);assert.equal(nested.parentAgentId,'child-1');
 const parentChild=state.agents['child-1'];assert.ok(parentChild.attempts>0);assert.ok(parentChild.results.length>0);
 const grandchild=state.agents[nested.agentId];assert.ok(grandchild.attempts>0);assert.ok(grandchild.modelRequest);
 assert.notEqual(grandchild.model?.attemptId,parentChild.model?.attemptId);
});
test('background handle is returned before child terminal evidence',()=>{
 const state=finish(start('background'));
 const handle=state.events.findIndex(event=>event.subagentEvidence?.outcome==='handle');
 const result=state.events.findIndex(event=>event.subagentEvidence?.outcome==='success'&&event.subagentEvidence.phase==='return');
 assert.ok(handle>=0);assert.ok(result>handle);
 assert.ok(state.events.slice(handle+1,result).some(event=>(event.agentId??'main')==='main'&&event.modelEvent?.type==='launch'),'Parent performs actual model work while child runs');
});
test('persistent follow-up creates a fresh task and retains prior session result references',()=>{
 const state=finish(start('persistent-followup'));const tasks=Object.values(state.subagentSnapshot!.tasks);assert.ok(tasks.length>=2);
 const followup=tasks.find(task=>task.followup)!;assert.ok(followup);const prior=tasks.find(task=>!task.followup)!;
 assert.equal(followup.sessionId,prior.sessionId);assert.notEqual(followup.taskId,prior.taskId);assert.notEqual(followup.launchId,prior.launchId);
 assert.ok(followup.priorResultRefs.includes('result:'+prior.taskId));assert.ok(state.subagentSnapshot!.sessions[followup.sessionId].taskIds.includes(followup.taskId));
});
test('Stop of attached running child uses actual cancellation trace without relaunch',()=>{
 let state=start('one-child');
 for(let n=0;n<4000&&!state.events.slice(0,state.step+1).some(event=>event.agentId==='child-1'&&event.modelEvent?.type==='launch');n++)state=advanceSimulation(state,document);
 assert.ok(state.agents['child-1']?.attempts);const attempts=state.agents['child-1'].attempts;
 state=finish(stopSimulation(state,document));
 assert.equal(state.agents['child-1'].attempts,attempts);assert.equal(state.agents['child-1'].outcome,'cancelled');
 assert.ok(Object.values(state.subagentSnapshot!.tasks).every(task=>['cancelled','success','failed'].includes(task.status)));
});
test('detached ownership survives parent Stop and retains live child work',()=>{
 let state=start('detached');
 for(let n=0;n<4000&&!state.events.slice(0,state.step+1).some(event=>event.agentId==='child-1'&&event.modelEvent?.type==='launch');n++)state=advanceSimulation(state,document);
 assert.ok(state.agents['child-1']?.attempts);
 state=stopSimulation(state,document);
 assert.equal(state.subagentSnapshot!.parentStatus,'stopped');
 assert.ok(Object.values(state.subagentSnapshot!.tasks).some(task=>task.lifetime==='detached'&&task.status==='running'));
 assert.notEqual(state.agents['child-1'].outcome,'cancelled');
});
for(const scenario of ['child-approval','child-review'] as const)test(scenario+': stale response cannot resume a different child wait',()=>{
 let state=start(scenario);
 for(let n=0;n<2000&&state.status!=='waiting'&&!['completed','blocked'].includes(state.status);n++)state=advanceSimulation(state,document);
 assert.equal(state.status,'waiting');assert.ok(state.wait?.id.startsWith('task:child-1:'));
 const before=state.step;const stale=answerSimulation(state,document,'allow-once','task:other-child:unmatched');
 assert.equal(stale.step,before);assert.equal(stale.status,'waiting');
 const deniedCall=state.wait&&'callId'in state.wait?state.wait.callId:undefined;
 state=finish(answerSimulation(state,document,'deny'));
 assert.equal(state.safetyGrants.length,0,'Child decisions cannot grant parent permission');
 if(deniedCall){
  assert.equal(state.agents['child-1'].safetyGrants.some(grant=>grant.operationId===deniedCall),false,'Denied call has no permission grant');
  assert.equal(state.agents['child-1'].results.find(result=>result.callId===deniedCall)?.status,'denied');
 }else assert.equal(state.agents['child-1'].safetyGrants.length,0);
 if(scenario==='child-review')assert.equal(state.agents['child-1'].memorySnapshot!.records.remembered,undefined);
});
test('nested delegation settings enforce maximum depth without inventing a descendant loop',()=>{
 const state=finish(start('nested',false,{maxDepth:1}));
 assert.equal(Object.values(state.subagentSnapshot!.tasks).some(task=>task.depth>1),false);
 assert.equal(Object.keys(state.agents).length,1);
 assert.ok(state.events.some(event=>event.subagentEvidence?.outcome==='rejected'));
});

test('two child approvals retain separate waits and preserve the first denied operation',()=>{
 let state=start('child-approval');
 for(let n=0;n<2000&&state.status!=='waiting';n++)state=advanceSimulation(state,document);
 const first=state.wait!;assert.ok('callId'in first);const firstCall=first.callId;
 state=answerSimulation(state,document,'deny',first.id);
 for(let n=0;n<2000&&state.status!=='waiting'&&!['completed','blocked'].includes(state.status);n++)state=advanceSimulation(state,document);
 const second=state.wait!;assert.ok(second);assert.ok('callId'in second);assert.notEqual(second.callId,firstCall);assert.notEqual(second.id,first.id);
 const stale=answerSimulation(state,document,'allow-once',first.id);assert.equal(stale.wait?.id,second.id);
 state=finish(answerSimulation(state,document,'allow-once',second.id));
 const child=state.agents['child-1'];
 assert.equal(child.results.find(result=>result.callId===firstCall)?.status,'denied');
 assert.equal(child.results.find(result=>result.callId===second.callId)?.status,'success');
 assert.equal(child.safetyGrants.some(grant=>grant.operationId===firstCall),false);
 assert.ok(child.safetyGrants.some(grant=>grant.operationId===second.callId&&grant.lifetime==='once'&&grant.status==='consumed'));
 assert.equal(state.safetyGrants.length,0);
});
test('parent streamed delegation is paired with bounded child results in the next actual model request',()=>{
 const state=finish(start('one-child'));
 const task=Object.values(state.subagentSnapshot!.tasks)[0];
 assert.ok(state.events.some(event=>(event.agentId??'main')==='main'&&event.modelEvent?.type==='item-start'&&event.modelEvent.name==='spawn_subagent'&&event.modelEvent.callId===task.callId));
 const after=state.events.findIndex(event=>event.results?.some(result=>result.callId===task.callId&&result.status==='success'));
 assert.ok(after>=0);
 const request=state.events.slice(after+1).find(event=>(event.agentId??'main')==='main'&&event.modelRequest)?.modelRequest;
 assert.ok(request);
 const messages=request.wireBody.messages as {role:string;tool_call_id?:string;content?:string;tool_calls?:{id:string;function:{name:string}}[]}[];
 assert.ok(messages.some(message=>message.role==='assistant'&&message.tool_calls?.some(call=>call.id===task.callId&&call.function.name==='spawn_subagent')));
 const result=messages.find(message=>message.role==='tool'&&message.tool_call_id===task.callId)!;assert.ok(result);
 const bounded=JSON.parse(result.content!);assert.equal(bounded.taskId,task.taskId);assert.equal(bounded.agentId,task.agentId);assert.equal(bounded.status,'success');assert.ok(bounded.artifactRef);
 assert.equal(Object.keys(bounded).some(key=>['history','providerContinuation','credentials'].includes(key)),false);
});

test('private child Memory starts empty and automatic writes stay agent-private',()=>{
 const state=finish(start('nested'));
 for(const child of Object.values(state.agents)){
  const rows=Object.values(child.memorySnapshot?.records??{});
  assert.equal(rows.some(record=>record.text.includes('Parent private')||record.namespace==='user-private'),false);
  assert.equal(rows.some(record=>record.namespace==='workspace-shared'),false);
 }
 assert.ok(Object.values(state.agents['child-1'].memorySnapshot!.records).some(record=>record.namespace==='agent-private'));
});
test('shared-read children retain shared evidence without automatic shared publication',()=>{
 const state=finish(start('nested',false,{memoryAccess:'shared-read'}));
 for(const child of Object.values(state.agents)){
  assert.equal(Object.values(child.memorySnapshot?.records??{}).some(record=>record.namespace==='user-private'||record.text.includes('Parent private')),false);
  assert.deepEqual(child.memorySnapshot?.transactions,{});
 }
});
test('context handoff uses actual parent user evidence, without parent instructions or open calls',()=>{
 const taskOnly=finish(start('task-only')),selected=finish(start('selected-context')),fork=finish(start('fork-context'));
 const records=(state:SimulationState)=>state.subagentSnapshot!.tasks['task:child-1'].context.records.map(record=>JSON.parse(record));
 assert.equal(records(taskOnly).length,1);
 assert.ok(records(selected).some(record=>record.kind==='selected-evidence'&&record.content.includes('Calculate')));
 assert.ok(records(fork).some(record=>record.kind==='parent-user'&&record.content.includes('Calculate')));
 assert.equal(records(fork).some(record=>record.kind==='complete-tool-group'),false,'Pending parent batch is excluded from fork');
 assert.equal(JSON.stringify(records(fork)).includes('Fixture only: calculate'),false);
});
test('specialist profile activates a scoped skill and connector dependency in its own loop',()=>{
 const state=finish(start('specialist')),child=state.agents['child-1'];
 assert.ok(child.route.includes('lina-tools-skill-activate'));
 assert.ok(child.route.includes('lina-tools-resource-read'));
 assert.equal(child.modelRequest?.binding.model,'worker-specialist');
 assert.ok(JSON.stringify(child.modelRequest?.wireBody).includes('fixture-source-review'));
 assert.equal(child.safetyGrants.length,0);
});
test('fixture parent Stop cannot launch another model attempt while detached work finishes',()=>{
 const state=finish(start('detached'));
 const stop=state.events.findIndex(event=>event.stopRequested&&(!event.agentId||event.agentId==='main'));
 assert.ok(stop>=0);
 assert.equal(state.events.slice(stop+1).some(event=>!event.agentId&&event.modelEvent?.type==='launch'),false);
 assert.equal(state.outcome,'cancelled');
 assert.equal(state.agents['child-1'].outcome,'completed');
});
test('Stop during unknown child launch retains evidence until matched reconciliation',()=>{
 let state=start('unknown-launch');
 while(state.status!=='waiting')state=advanceSimulation(state,document);
 state=stopSimulation(state,document);
 while(state.status!=='waiting'&&!['completed','blocked'].includes(state.status))state=advanceSimulation(state,document);
 assert.equal(state.wait?.owner,'subagents');
 assert.equal(state.subagentSnapshot!.tasks['task:child-1'].status,'unknown');
 state=answerSimulation(state,document,'known-no-effect');
 state=finish(state);
 assert.equal(state.outcome,'cancelled');
 assert.equal(state.subagentSnapshot!.tasks['task:child-1'].launches,0);
 assert.equal(state.subagentSnapshot!.tasks['task:child-1'].status,'cancelled');
});
