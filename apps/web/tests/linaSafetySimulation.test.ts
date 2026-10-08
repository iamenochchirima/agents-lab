import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { advanceSimulation, answerSimulation, selectSimulationWait, startSimulation, stopSimulation, type SimulationState, type SimulationAnswer } from '../src/features/lina/inputSimulation';
import { safetyCases, safetyMatcher, type SafetyCase, type SafetyGrant } from '../src/features/lina/safetyFixtures';
const initial=(scenario:SafetyCase,automatic=false,grants:SafetyGrant[]=[],context:'fits'|'resource'|'prompt'='fits')=>startSimulation('cli',document,automatic,'tool-round',3,context,'parallel','openai-chat','answer',scenario,grants);
function until(state:SimulationState,predicate:(state:SimulationState)=>boolean){for(let n=0;n<700;n++){if(predicate(state))return state;assert.notEqual(state.status,'blocked',state.error);assert.notEqual(state.status,'completed','target not visited');assert.notEqual(state.status,'waiting','unexpected wait');state=advanceSimulation(state,document);}assert.fail('bounded fixture exceeded');}
function finish(state:SimulationState,choice:SimulationAnswer='allow-once'){for(let n=0;n<900&&state.status!=='completed';n++){assert.notEqual(state.status,'blocked',state.error);state=state.status==='waiting'?answerSimulation(state,document,state.wait?.kind==='approval'?choice:state.wait?.kind==='reconciliation'?'known-success':'ready'):advanceSimulation(state,document);}assert.equal(state.status,'completed');return state;}
for(const {value:scenario} of safetyCases)test(`${scenario}: matching graph endpoints and identical manual/Auto reducers`,()=>{
 const manual=finish(initial(scenario),scenario.startsWith('persistence-')?'allow-always':'allow-once');
 const auto=finish(initial(scenario,true),scenario.startsWith('persistence-')?'allow-always':'allow-once');
 assert.deepEqual(manual.operations,auto.operations);assert.deepEqual(manual.safetyGrants,auto.safetyGrants);
 for(const event of manual.events)if(event.edgeId){const edge=document.edges.find(edge=>edge.id===event.edgeId);assert.equal(edge?.source,event.sourceNodeId,event.id);assert.equal(edge?.target,event.nodeId,event.id);}
});
for(const choice of ['allow-once','allow-session','allow-always','deny'] as const)test(`${choice}: correct lifetime and denial`,()=>{
 const state=finish(initial('review'),choice);
 if(choice==='deny'){assert.equal(state.results[0].status,'denied');assert.equal(state.safetyGrants.length,0);}
 else {assert.equal(state.results[0].status,'success');assert.equal(state.safetyGrants[0].lifetime,choice==='allow-once'?'once':choice==='allow-session'?'session':'persistent');assert.equal(state.safetyGrants[0].status,choice==='allow-once'?'consumed':'active');}
});
test('matching session/persistent grant reused, mandatory review and scope mismatch still pause',()=>{
 for(const choice of ['allow-session','allow-always'] as const){const saved=finish(initial('review'),choice).safetyGrants;const reused=finish(initial('grant-reuse',false,saved));assert.equal(reused.events.some(event=>event.wait?.kind==='approval'),false);assert.equal(until(initial('mandatory-review',false,saved),state=>state.status==='waiting').wait?.kind,'approval');const wrong=saved.map(grant=>({...grant,matcher:{...grant.matcher,accountId:'different-account'}}));assert.equal(until(initial('grant-reuse',false,wrong),state=>state.status==='waiting').wait?.kind,'approval');}
});
test('two waits resolve independently: second call progresses while first is retained',()=>{
 let state=until(initial('parallel-review'),state=>state.status==='waiting');assert.equal(state.waits.length,2);
 const first=state.waits[0].id,second=state.waits[1].id;
 state=answerSimulation(selectSimulationWait(state,second),document,'allow-once',second);
 state=until(state,state=>state.status==='waiting');assert.equal(state.waits.length,1);assert.equal(state.wait?.id,first);assert.equal(state.results.find(result=>result.callId==='call-002')?.status,'success');assert.equal(state.operations.find(op=>op.callId==='call-001')?.status,'waiting');
 state=answerSimulation(state,document,'deny',first);state=finish(state);assert.deepEqual(state.results.map(result=>result.status),['denied','success']);
});
test('stale/wrong account and duplicate answer do not consume or clear pending approvals',()=>{
 const state=until(initial('parallel-review'),state=>state.status==='waiting');for(const answer of ['stale','wrong-account'] as const){const rejected=answerSimulation(state,document,answer);assert.deepEqual(rejected.waits,state.waits);assert.deepEqual(rejected.safetyGrants,state.safetyGrants);}
 let answered=answerSimulation(state,document,'allow-once',state.waits[0].id);answered=until(answered,state=>state.status==='waiting');const rejected=answerSimulation(answered,document,'allow-always',state.waits[0].id);assert.deepEqual(rejected.waits,answered.waits);
});
test('hard deny and queued binding/policy change never start refused operations',()=>{
 for(const scenario of ['hard-deny','binding-change','policy-change'] as const){const state=finish(initial(scenario));assert.ok(state.results.every(result=>result.status==='denied'));assert.ok(state.events.every(event=>!(event.operations??[]).some(op=>op.status==='running')));}
});
test('failed and unknown persistence never claim saved grant; unknown inspects stable transaction',()=>{
 for(const scenario of ['persistence-failed','persistence-unknown'] as const){const state=finish(initial(scenario),'allow-always');assert.equal(state.safetyGrants.length,0);assert.equal(state.results[0].status,'denied');if(scenario==='persistence-unknown'){const commit=state.events.find(event=>event.safetyEvidence?.phase==='commit')!.safetyEvidence!;const inspect=state.events.find(event=>event.safetyEvidence?.phase==='inspect')!.safetyEvidence!;assert.equal(commit.transactionId,inspect.transactionId);}}
});
for(const context of ['resource','prompt'] as const)test(`${context} approval occurs before model launch and denial withholds inference`,()=>{let state=until(initial('review',false,[],context),state=>state.status==='waiting');assert.equal(state.attempts,0);assert.match(state.wait!.ownerNodeId,/resource-read|prompt-get/);state=finish(answerSimulation(state,document,'deny'));assert.equal(state.attempts,0);assert.equal(state.outcome,'failed');});
test('Stop invalidates all approval waits and cannot revoke unrelated persistent grants',()=>{
 const saved=finish(initial('review'),'allow-always').safetyGrants;let state=until(initial('mandatory-review',false,saved),state=>state.status==='waiting');state=stopSimulation(state,document);assert.equal(state.waits.length,0);state=finish(state);assert.equal(state.outcome,'cancelled');assert.ok(state.safetyGrants.some(grant=>grant.lifetime==='persistent'&&grant.status==='active'));assert.equal(answerSimulation(state,document,'allow-always'),state);
});
test('session end expires seeded session grants, preserves persistent grants; revocation invalidates seeded scope',()=>{
 const session=finish(initial('review'),'allow-session').safetyGrants;
 const persistent=finish(initial('review'),'allow-always').safetyGrants;
 const ended=until(initial('session-end',false,session),state=>state.status==='waiting');assert.equal(ended.safetyGrants[0].status,'expired');assert.ok(ended.safetyGrants[0].generation>session[0].generation);
 const durable=finish(initial('session-end',false,persistent));assert.equal(durable.events.some(event=>event.wait?.kind==='approval'),false);assert.equal(durable.safetyGrants[0].status,'active');
 const revoked=until(initial('revoked',false,persistent),state=>state.status==='waiting');assert.equal(revoked.safetyGrants[0].status,'revoked');assert.ok(revoked.safetyGrants[0].generation>persistent[0].generation);
});
test('expired grant cannot match; Stop preserves already completed sibling and no later launch',()=>{
 const saved=finish(initial('review'),'allow-always').safetyGrants.map(grant=>({...grant,status:'expired' as const}));assert.equal(until(initial('grant-reuse',false,saved),state=>state.status==='waiting').wait?.kind,'approval');
 let state=until(initial('review'),state=>state.status==='waiting');assert.equal(state.results.find(result=>result.callId==='call-002')?.status,'success');const result=state.results[0];state=finish(stopSimulation(state,document));assert.deepEqual(state.results.find(item=>item.callId===result.callId),result);const cancel=state.events.findIndex(event=>event.nodeId==='lina-execution-cancel');assert.ok(state.events.slice(cancel+1).every(event=>!(event.operations??[]).some(op=>op.status==='running')));
});
test('every physical fixture launch has fresh Safety authorization and attempt is never launched twice',()=>{
 const state=finish(initial('parallel-review'));const launches=new Set<string>();
 for(const event of state.events){const running=event.operations?.filter(op=>op.status==='running')??[];if(!running.length)continue;assert.equal(event.nodeId,'lina-tools-dispatch');assert.equal(event.edgeId,'lina-safety-edge-authorize-dispatch');for(const op of running){assert.ok(!launches.has(op.attemptId),'duplicate physical launch');launches.add(op.attemptId);}}
 assert.equal(launches.size,2);
});
