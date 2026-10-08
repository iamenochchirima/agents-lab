import assert from 'node:assert/strict';
import test from 'node:test';
import { linaSubagentsBlock } from '../src/features/lina/subagentsBlock';
import { createSubagentFixtureState, DEFAULT_SUBAGENT_SETTINGS, SUBAGENT_CASES, withSubagents } from '../src/features/lina/subagentsFixtures';
import type { SimulationEvent } from '../src/features/lina/inputSimulation';
const base:SimulationEvent[]=[{id:'parent:start',nodeId:'lina-execution-start',update:{}},{id:'parent:settle',nodeId:'lina-execution-settle',update:{outcome:'completed'}}];
const child=(spec:{taskId:string}):SimulationEvent[]=>[{id:`${spec.taskId}:start`,nodeId:'lina-execution-start',update:{}},{id:`${spec.taskId}:controls`,nodeId:'lina-execution-controls',update:{}},{id:`${spec.taskId}:model`,nodeId:'lina-model-invoke',update:{attempts:1}},{id:`${spec.taskId}:settle`,nodeId:'lina-execution-settle',update:{outcome:'completed'}}];
const run=(scenario:Parameters<typeof withSubagents>[2],settings:Parameters<typeof withSubagents>[3]={},options:Parameters<typeof withSubagents>[4]={})=>withSubagents(base,linaSubagentsBlock,scenario,settings,{buildChild:child,...options});
const final=(events:SimulationEvent[])=>events.filter(event=>event.subagentSnapshot).at(-1)!.subagentSnapshot!;
for(const {value} of SUBAGENT_CASES)test(`${value}: deterministic graph transitions and stable identities`,()=>{
 const events=run(value);assert.deepEqual(events,run(value));
 assert.equal(new Set(events.map(event=>event.id)).size,events.length);
 for(const event of events.filter(event=>event.subagentEvidence)){assert.ok(linaSubagentsBlock.edges.some(edge=>edge.id===event.edgeId&&edge.source===event.sourceNodeId&&edge.target===event.nodeId),`${event.sourceNodeId} -> ${event.nodeId}`);}
});
test('disabled preserves original events',()=>assert.equal(run('disabled'),base));
test('parallel children interleave actual compiler events with independent identities',()=>{
 const events=run('parallel'),owned=events.filter(event=>event.agentId);assert.deepEqual(owned.slice(0,4).map(event=>event.agentId),['child-1','child-2','child-1','child-2']);
 assert.equal(Object.keys(final(events).results).length,2);assert.equal(final(events).tasks['task:child-1'].launches,1);
});
test('capacity queues rather than allocating another active launch',()=>{
 const events=run('capacity-queued');assert.ok(events.some(event=>event.subagentEvidence?.outcome==='queued'&&event.subagentSnapshot?.tasks['task:child-2'].launches===0));
 const firstDone=events.findIndex(event=>event.agentId==='child-1'&&event.nodeId==='lina-execution-settle'),secondStart=events.findIndex(event=>event.agentId==='child-2'&&event.nodeId==='lina-execution-start');assert.ok(secondStart>firstDone);
});
test('nested depth and total tree budget are separately enforced',()=>{
 assert.equal(final(run('nested')).tasks['task:child-2'].parentAgentId,'child-1');
 for(const scenario of ['depth-rejected','tree-budget'] as const){const events=run(scenario);assert.equal(Object.keys(final(events).tasks).length,1);assert.ok(events.some(event=>event.subagentEvidence?.outcome==='rejected'));}
});
test('context packets are immutable copies with explicit authority and no parent private memory',()=>{
 const fresh=final(run('task-only')).tasks['task:child-1'],fork=final(run('fork-context')).tasks['task:child-1'];assert.equal(fresh.context.records.length,1);assert.ok(fork.context.records.includes('parent:tool-observation'));assert.equal(fork.context.parentPrivateMemoryIncluded,false);assert.equal(fork.context.instructionAuthority,'worker-profile');
});
test('persistent follow-up reuses session but has a new task and launch identity',()=>{
 const state=final(run('persistent-followup'));assert.equal(Object.keys(state.sessions).length,1);assert.equal(state.sessions['session:child-1'].taskIds.length,2);assert.equal(state.sessions['session:child-1'].status,'active');assert.notEqual(state.tasks['task:child-1'].launchId,state.tasks['task:child-1:followup'].launchId);
});
test('unknown launch never respawns without evidence',()=>{
 const events=run('unknown-launch'),state=final(events);assert.equal(state.tasks['task:child-1'].launches,0);assert.ok(events.some(event=>event.wait?.id==='subagents:launch:task:child-1'));
 const resumed=final(run('unknown-launch',{}, {answers:{'subagents:launch:task:child-1':'known-success'}}));assert.equal(resumed.tasks['task:child-1'].launches,1);
 const notStarted=final(run('unknown-launch',{}, {answers:{'subagents:launch:task:child-1':'known-no-effect'}}));assert.equal(notStarted.tasks['task:child-1'].launches,0);assert.equal(notStarted.tasks['task:child-1'].status,'failed');
});
test('partial failure preserves successful sibling and recovery does not replay it',()=>{
 const state=final(run('partial-failure'));assert.equal(state.results['result:task:child-1'].status,'success');assert.equal(state.results['result:task:child-2'].status,'failed');
 const recovery=run('recover-siblings');assert.ok(!recovery.some(event=>event.agentId==='child-1'));assert.equal(final(recovery).tasks['task:child-1'].launches,1);
});
test('result retries and invalid outputs do not create a new child',()=>{
 const state=final(run('delivery-retry'));assert.equal(state.results['result:task:child-1'].deliveries,2);assert.equal(state.tasks['task:child-1'].launches,1);
 assert.equal(final(run('invalid-result')).results['result:task:child-1'].status,'failed');
});
test('Stop cancels attached descendants but preserves detached owner work and successful results',()=>{
 const seed=createSubagentFixtureState();Object.assign(seed,final(run('parallel')));seed.tasks['task:child-2'].status='running';delete seed.tasks['task:child-2'].resultId;delete seed.results['result:task:child-2'];
 const stopped=final(run('parallel',{}, {seed,stopped:true}));assert.equal(stopped.tasks['task:child-1'].status,'success');assert.equal(stopped.tasks['task:child-2'].status,'cancelled');
 seed.tasks['task:child-2'].lifetime='detached';const detached=final(run('detached',{}, {seed,stopped:true}));assert.equal(detached.tasks['task:child-2'].status,'running');
});
test('child wait blocks that child while a sibling can complete',()=>{
 const events=run('parallel',{}, {buildChild:spec=>spec.agentId==='child-1'?[{id:'child-wait',nodeId:'lina-execution-wait',update:{},wait:{id:'child:approval',kind:'subagent',owner:'subagents',taskId:spec.taskId,ownerNodeId:'lina-subagents-coordinate'}}]:child(spec)});
 const state=final(events);assert.equal(state.tasks['task:child-1'].status,'waiting');assert.equal(state.tasks['task:child-2'].status,'success');assert.equal(state.joins['join:parent'].status,'waiting');
});
test('configuration edits do not mutate defaults',()=>{run('one-child',{tools:['custom'],maxDepth:7});assert.deepEqual(DEFAULT_SUBAGENT_SETTINGS.tools,['read','search']);});
test('background handles are accepted before parent continuation and explicit join',()=>{
 const events=run('background');const launch=events.findIndex(event=>event.subagentEvidence?.outcome==='running'),handle=events.findIndex(event=>event.subagentEvidence?.outcome==='handle'),join=events.findIndex(event=>event.subagentEvidence?.phase==='join'&&event.subagentEvidence.outcome==='settled');assert.ok(launch>=0&&handle>launch&&join>handle);
});
test('timeouts cancel before child terminal and use cancellation callback',()=>{
 const events=run('timeout',{}, {cancelChild:spec=>[{id:`${spec.taskId}:cancel`,nodeId:'lina-execution-cancel',update:{outcome:'cancelled'}}]});
 assert.ok(events.some(event=>event.agentId==='child-1'&&event.nodeId==='lina-execution-cancel'));assert.ok(!events.some(event=>event.agentId==='child-1'&&event.nodeId==='lina-execution-settle'));assert.equal(final(events).tasks['task:child-1'].status,'cancelled');
});
test('actual compiler failure is preserved regardless of scenario label',()=>{
 const state=final(run('one-child',{}, {buildChild:spec=>[{id:`${spec.taskId}:failed`,nodeId:'lina-execution-settle',update:{outcome:'failed'}}]}));assert.equal(state.tasks['task:child-1'].status,'failed');assert.equal(state.results['result:task:child-1'].status,'failed');
});
test('delegation observations return through exact parent tool call identity',()=>{
 const events=run('parallel');for(const task of Object.values(final(events).tasks)){const result=events.flatMap(event=>event.results??[]).find(result=>result.callId===task.callId);assert.ok(result);assert.equal(result.artifactRef,`artifact:${task.taskId}:output`);}
});
test('nested launch follows parent start and an actual parent checkpoint',()=>{
 const events=run('nested');const parentStart=events.findIndex(event=>event.agentId==='child-1'&&event.nodeId==='lina-execution-start'),checkpoint=events.findIndex(event=>event.agentId==='child-1'&&event.nodeId==='lina-execution-controls'),nestedStart=events.findIndex(event=>event.agentId==='child-2'&&event.nodeId==='lina-execution-start');assert.ok(parentStart<checkpoint&&checkpoint<nestedStart);
});
test('detached demonstration stops parent while durable child owner completes',()=>{const events=run('detached');assert.equal(final(events).parentStatus,'stopped');assert.equal(final(events).tasks['task:child-1'].status,'success');assert.ok(!events.some(event=>event.id==='parent:settle'));});
test('missing child terminal evidence remains unresolved',()=>{const state=final(run('one-child',{}, {buildChild:()=>[]}));assert.equal(state.tasks['task:child-1'].status,'unknown');assert.equal(Object.keys(state.results).length,0);});
test('Stop of unknown launch retains uncertainty rather than claiming cancellation settled',()=>{const seed=final(run('unknown-launch'));const state=final(run('unknown-launch',{}, {seed,stopped:true}));assert.equal(state.tasks['task:child-1'].status,'unknown');assert.equal(Object.keys(state.results).length,0);});
test('rejected admission returns exact call failure without allocating child or consuming tree budget',()=>{
 const events=run('one-child',{maxDepth:0});const state=final(events);assert.equal(Object.keys(state.tasks).length,0);assert.equal(state.requests['task:child-1'].admission,'rejected');assert.equal(events.flatMap(event=>event.results??[]).find(result=>result.callId==='call:delegation:task:child-1')!.status,'denied');assert.equal(Object.keys(state.launches).length,0);
});
test('context enrichment is frozen in admitted packet and passed to actual compiler',()=>{
 let seen:string[]=[];const events=run('fork-context',{}, {contextRecords:()=>['fixture:user:question','fixture:complete-tool-group:call1'],buildChild:spec=>{seen=spec.context.records;return child(spec);}});assert.deepEqual(seen,['fixture:user:question','fixture:complete-tool-group:call1']);assert.deepEqual(final(events).tasks['task:child-1'].context.records,seen);
});
test('cancellation waits retain child ownership and cannot fabricate terminal result',()=>{
 const events=run('timeout',{}, {cancelChild:spec=>[{id:'cancel-local-wait',nodeId:'lina-execution-wait',update:{},wait:{id:'local-settlement',kind:'subagent',owner:'subagents',taskId:spec.taskId,ownerNodeId:'lina-subagents-reconcile'}}]});
 const state=final(events);assert.equal(state.tasks['task:child-1'].status,'waiting');assert.equal(Object.keys(state.results).length,0);assert.equal(state.joins['join:parent'].status,'waiting');
});
