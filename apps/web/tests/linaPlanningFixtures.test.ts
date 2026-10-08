import assert from 'node:assert/strict';
import test from 'node:test';
import { linaPlanningBlock } from '../src/features/lina/planningBlock';
import { applyPlanningUpdate, assessPlanningCompletion, createPlanningFixtureState, DEFAULT_PLANNING_SETTINGS, PLANNING_CASES, planningModelRequest, reviewPlanningTask, selectPlanningReady, validatePlanningTasks, withPlanning, type PlanningTask } from '../src/features/lina/planningFixtures';
import { buildModelFixture } from '../src/features/lina/modelFixtures';
import type { SimulationEvent } from '../src/features/lina/inputSimulation';
const task=(id:string,deps:string[]=[]):PlanningTask=>({id,title:id,dependencies:deps,required:true,status:'pending',acceptance:[{criterionId:id,description:'Tool observation meets declared fixture criterion',method:'tool-result',requiredRefs:1}],evidence:[],bindings:[]});
const base:SimulationEvent[]=[{id:'start',nodeId:'lina-execution-start',update:{}},{id:'dispatch',nodeId:'lina-tools-dispatch',update:{},operations:[1,2].map(id=>({callId:`call:${id}`,batchId:'batch:1',attemptId:`attempt:${id}`,nodeId:'lina-tools-dispatch',status:'running' as const,effectClass:'read' as const,accountId:'fixture',catalogRevision:7}))},{id:'collect',nodeId:'lina-tools-collect',update:{},results:[1,2].map(id=>({callId:`call:${id}`,status:'success' as const,artifactRef:`artifact:${id}`}))},{id:'settle',nodeId:'lina-execution-settle',update:{outcome:'completed'}}];
const run=(scenario:Parameters<typeof withPlanning>[2],settings:Parameters<typeof withPlanning>[3]={},options:Parameters<typeof withPlanning>[4]={})=>withPlanning(base,linaPlanningBlock,scenario,settings,options);
const final=(events:SimulationEvent[])=>events.filter(event=>event.planningSnapshot).at(-1)!.planningSnapshot!;
for(const {value} of PLANNING_CASES)test(`${value}: reproducible planning trace uses graph routes`,()=>{
 const events=run(value);assert.deepEqual(events,run(value));assert.equal(new Set(events.map(event=>event.id)).size,events.length);
 for(const event of events.filter(event=>event.planningEvidence))assert.ok(linaPlanningBlock.edges.some(edge=>edge.id===event.edgeId&&edge.source===event.sourceNodeId&&edge.target===event.nodeId),`${event.sourceNodeId} -> ${event.nodeId}`);
});
test('bypass preserves exact base and defaults remain immutable',()=>{assert.equal(run('disabled'),base);run('parallel',{maxReady:1});assert.equal(DEFAULT_PLANNING_SETTINGS.maxReady,3);});
test('conditional update is atomic, fenced by scope/revision and idempotent',()=>{
 const store=createPlanningFixtureState(),command={operationId:'command:1',expectedRevision:0,scope:store.scope,tasks:[task('one')],reason:'initial'};
 assert.equal(applyPlanningUpdate(store,command),'applied');assert.equal(applyPlanningUpdate(store,command),'duplicate');assert.equal(store.revision,1);
 assert.equal(applyPlanningUpdate(store,{...command,reason:'different'}),'conflict');assert.equal(applyPlanningUpdate(store,{...command,operationId:'new'}),'conflict');
 assert.equal(applyPlanningUpdate(store,{...command,operationId:'foreign',scope:{...store.scope,agentId:'child'}}),'wrong-scope');assert.equal(store.tasks.one.title,'one');
});
test('dependency graph rejects missing/self/cyclic identities before mutation',()=>{
 assert.equal(validatePlanningTasks([task('one',['missing'])]),'missing-dependency');assert.equal(validatePlanningTasks([task('one',['one'])]),'self-dependency');assert.equal(validatePlanningTasks([task('one',['two']),task('two',['one'])]),'cycle');
 const store=createPlanningFixtureState();assert.equal(applyPlanningUpdate(store,{operationId:'bad',expectedRevision:0,scope:store.scope,tasks:[task('one',['missing'])],reason:'invalid'}),'invalid');assert.equal(store.revision,0);
});
test('independent readiness is bounded and successful prerequisites unlock dependents',()=>{
 const store=createPlanningFixtureState();store.tasks={one:task('one'),two:task('two'),three:task('three',['one'])};assert.deepEqual(selectPlanningReady(store,1),{ready:['one'],blocked:['three']});store.tasks.one.status='completed';store.tasks.one.evidence=[{criterionId:'one',sourceRef:'verified',method:'tool-result',verdict:'accepted'}];assert.deepEqual(selectPlanningReady(store).ready,['two','three']);store.tasks.one.status='failed';assert.deepEqual(selectPlanningReady(store).blocked,['three']);
});
test('only bound evidence meeting the declared evaluator counts as completion',()=>{
 const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.one.bindings=[{kind:'tool',operationId:'op:1',callId:'call:1',agentId:'main',status:'running'}];
 assert.equal(reviewPlanningTask(store,'one',{operationId:'foreign',sourceRef:'artifact',method:'tool-result',status:'success'}),'unmatched');
 assert.equal(reviewPlanningTask(store,'one',{operationId:'op:1',sourceRef:'assertion',method:'model-assertion',status:'success'}),'insufficient');assert.notEqual(assessPlanningCompletion(store),'complete');
 assert.equal(reviewPlanningTask(store,'one',{operationId:'op:1',sourceRef:'artifact',method:'tool-result',status:'success'}),'accepted');assert.equal(assessPlanningCompletion(store),'complete');
 reviewPlanningTask(store,'one',{operationId:'op:1',sourceRef:'artifact',method:'tool-result',status:'success'});assert.equal(store.tasks.one.evidence.length,1);
});
test('unknown running effects prevent whole-goal completion even when task status says completed',()=>{
 const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.one.status='completed';store.tasks.one.evidence=[{criterionId:'one',sourceRef:'artifact',method:'tool-result',verdict:'accepted'}];store.tasks.one.bindings=[{kind:'tool',operationId:'op',agentId:'main',status:'unknown'}];assert.equal(assessPlanningCompletion(store),'blocked');
});
test('revision cannot erase completed evidence or an unresolved execution binding',()=>{
 const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.one.bindings=[{kind:'tool',operationId:'op',agentId:'main',status:'unknown'}];assert.equal(applyPlanningUpdate(store,{operationId:'erase',expectedRevision:0,scope:store.scope,tasks:[task('replacement')],reason:'remove old task'}),'invalid');
 store.tasks.one.status='completed';store.tasks.one.bindings[0].status='completed';store.tasks.one.evidence=[{criterionId:'one',sourceRef:'artifact',method:'tool-result',verdict:'accepted'}];assert.equal(applyPlanningUpdate(store,{operationId:'erase-evidence',expectedRevision:0,scope:store.scope,tasks:[{...store.tasks.one,evidence:[]}],reason:'rewrite'}),'invalid');
});
test('sequential and parallel fixtures bind observed operations and preserve base event IDs',()=>{
 for(const scenario of ['sequential','parallel'] as const){const events=run(scenario);assert.equal(final(events).goalStatus,'complete');for(const original of base)assert.ok(events.some(event=>event.id===original.id));}
 assert.equal(final(run('parallel')).tasks.check.bindings[0].callId,'call:2');
});
test('plan-only launches no model, tool or child operation and means planned rather than complete',()=>{const events=run('plan-only');assert.equal(final(events).goalStatus,'planned');assert.ok(!events.some(event=>event.operations?.length||event.modelEvent||event.results?.length));});
test('review waits resume only accepted review, with normal action checks retained',()=>{
 const pending=run('review-before-execution');assert.equal(pending.at(-1)!.wait!.kind,'planning-review');assert.ok(!pending.some(event=>event.id==='dispatch'));
 assert.equal(final(run('review-before-execution',{}, {answers:{'planning:review:plan:main':'allow-once'}})).goalStatus,'complete');
 assert.ok(!run('review-before-execution',{}, {answers:{'planning:review:plan:main':'deny'}}).some(event=>event.id==='dispatch'));
});
test('unknown acknowledgement retains one committed original identity',()=>{
 const events=run('unknown-ack');assert.equal(events.at(-1)!.wait!.kind,'planning-commit');assert.equal(final(events).revision,0);
 const resumed=final(run('unknown-ack',{}, {answers:{'planning:ack:plan:main':'known-success'}}));assert.equal(resumed.revision,1);assert.equal(Object.keys(resumed.transactions).length,1);
});
test('partial/insufficient/invalid/budget branches never report successful whole goal',()=>{for(const scenario of ['partial','insufficient-evidence','invalid-reference','cycle','conflict','budget'] as const){const events=run(scenario);assert.notEqual(final(events).goalStatus,'complete');assert.notEqual(events.filter(event=>event.update.outcome).at(-1)!.update.outcome,'completed');}});
test('Stop preserves accepted evidence and unknown bindings; no post-Stop launch',()=>{
 const seed=final(run('sequential'));seed.tasks.check.status='running';seed.tasks.check.bindings[0].status='unknown';const events=run('stop-uncertain',{}, {seed,stopped:true});assert.equal(final(events).tasks.work.status,'completed');assert.equal(final(events).goalStatus,'blocked');assert.equal(final(events).tasks.check.bindings[0].status,'unknown');
});
test('bounded task projection reaches actual wire requests as agent-scoped data in all protocols',()=>{
 for(const protocol of ['openai-chat','openai-responses','anthropic-messages','gemini-generate-content'] as const){const fixture=buildModelFixture({protocol,modelCase:'answer',attemptId:'attempt:plan'});const event:SimulationEvent={id:'encode',nodeId:'lina-model-encode',update:{},modelRequest:fixture.encodedRequest};const store=createPlanningFixtureState('child-1');store.tasks.one=task('one');const enriched=planningModelRequest(event,store);assert.match(JSON.stringify(enriched.modelRequest!.wireBody),/scoped-task-plan/);assert.match(JSON.stringify(enriched.modelRequest!.wireBody),/child-1/);assert.ok(!JSON.stringify(event.modelRequest!.wireBody).includes('scoped-task-plan'));}
});
test('a same-ID replan cannot clear or settle the existing unknown binding',()=>{
 const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.one.bindings=[{kind:'tool',operationId:'original',agentId:'main',status:'unknown'}];
 for(const bindings of [[],[{...store.tasks.one.bindings[0],status:'completed' as const}]])assert.equal(applyPlanningUpdate(store,{operationId:`erase:${bindings.length}`,expectedRevision:0,scope:store.scope,tasks:[{...store.tasks.one,bindings}],reason:'change unresolved task'}),'invalid');
});
test('completed status without accepted evidence does not unlock dependent work',()=>{const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.two=task('two',['one']);store.tasks.one.status='completed';assert.deepEqual(selectPlanningReady(store),{ready:[],blocked:['two']});});
test('superseding required work does not satisfy goal completion',()=>{const store=createPlanningFixtureState();store.tasks.one=task('one');store.tasks.one.status='superseded';assert.equal(validatePlanningTasks([store.tasks.one]),'required-task-retired');assert.equal(assessPlanningCompletion(store),'blocked');});
test('task binding and owner receipt precede corresponding running event',()=>{const events=run('parallel'),running=events.findIndex(event=>event.id==='dispatch'),binding=events.findIndex(event=>event.planningEvidence?.outcome==='bound'),owner=events.findIndex(event=>event.planningEvidence?.outcome==='owner-resumed');assert.ok(binding>=0&&owner>binding&&running>owner);});
test('known non-commit inspection retries the same original command once',()=>{const state=final(run('unknown-ack',{}, {answers:{'planning:ack:plan:main':'known-no-effect'}}));assert.equal(state.revision,1);assert.deepEqual(Object.keys(state.transactions),['plan-update:plan:main:0']);});
test('child-local traces own their private plan and request scope',()=>{const events=run('child-local',{}, {childAgentId:'child-1'});assert.equal(final(events).scope.agentId,'child-1');assert.equal(final(events).planId,'plan:child-1');assert.ok(events.some(event=>event.planningEvidence));});
test('recovery keeps accepted prior evidence; user scope changes retain extra unfinished work',()=>{
 const state=final(run('recovery'));assert.ok(state.tasks.work.evidence.some(row=>row.sourceRef.startsWith('checkpoint:prior:')));assert.equal(state.tasks.work.bindings.length,1);assert.equal(state.tasks.work.bindings[0].status,'completed');
 const revised=final(run('user-change'));assert.equal(revised.tasks['scope-addition'].required,true);assert.equal(revised.tasks['scope-addition'].status,'pending');assert.equal(revised.goalStatus,'partial');
});
