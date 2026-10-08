import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { PLANNING_CASES, type PlanningCase, type PlanningSettings } from '../src/features/lina/planningFixtures';
import { advanceSimulation, answerSimulation, startSimulation, stopSimulation, resetSimulation, type SimulationState } from '../src/features/lina/inputSimulation';
const start=(scenario:PlanningCase,automatic=false,settings:Partial<PlanningSettings>={})=>startSimulation('cli',document,automatic,'tool-round',3,'fits','parallel','openai-chat','answer','policy-allow',[],'fresh','baseline','disabled',{},scenario,settings);
function finish(initial:SimulationState){
 let state=initial;
 for(let n=0;n<6000&&!['completed','blocked'].includes(state.status);n++){
  if(state.status==='waiting')state=answerSimulation(state,document,['planning-review','approval','memory-review'].includes(state.wait?.kind??'')?'allow-once':['planning-commit','subagent','reconciliation','delivery-reconciliation'].includes(state.wait?.kind??'')?'known-success':'ready');
  else state=advanceSimulation(state,document);
 }
 assert.equal(state.status,'completed',state.planningCase+': '+(state.error??state.detail));return state;
}
for(const {value} of PLANNING_CASES)test(value+': Auto/Next share planning state and graph-valid paths',()=>{
 const manual=finish(start(value)),auto=finish(start(value,true));
 assert.deepEqual(manual.planningSnapshot,auto.planningSnapshot);
 assert.equal(new Set(manual.events.map(event=>event.id)).size,manual.events.length);
 const reset=resetSimulation(manual,document);assert.equal(reset.planningCase,value);assert.equal(reset.step,0);
 if(value!=='disabled')assert.ok(manual.route.includes('lina-planning-policy'));
});
test('plan-only cannot launch a provider or operational tool and reports planned rather than goal complete',()=>{
 const state=finish(start('plan-only'));assert.equal(state.planningSnapshot?.goalStatus,'planned');
 assert.equal(state.events.some(event=>event.modelEvent?.type==='launch'||event.operations?.some(operation=>operation.status==='running')),false);
});
test('review waits before execution; decline cannot grant action access',()=>{
 let state=start('review-before-execution');for(let i=0;i<1000&&state.status!=='waiting'&&!['blocked','completed'].includes(state.status);i++)state=advanceSimulation(state,document);
 assert.equal(state.wait?.kind,'planning-review');assert.equal(state.operations.length,0);
 const denied=finish(answerSimulation(state,document,'deny'));assert.equal(denied.operations.length,0);assert.notEqual(denied.planningSnapshot?.goalStatus,'complete');
});
test('scoped plans enter actual encoded model requests for all protocol profiles',()=>{
 for(const protocol of ['openai-chat','openai-responses','anthropic-messages','gemini-generate-content'] as const){
 const state=finish(startSimulation('telegram',document,false,'tool-round',3,'fits','parallel',protocol,'answer','policy-allow',[],'fresh','baseline','disabled',{},'sequential'));
 assert.ok(state.events.some(event=>(JSON.stringify(event.modelRequest?.wireBody)??'').includes('scoped-task-plan')));
 }
});
test('delegated and child-local planning use actual child instances and scoped ledgers',()=>{
 const delegated=finish(start('delegation'));assert.ok(Object.keys(delegated.agents).length>=2);
 const local=finish(start('child-local'));assert.ok(Object.values(local.agents).every(child=>child.planningSnapshot?.scope.agentId===child.activeAgentId));
 assert.equal(local.planningSnapshot?.scope.agentId,'main');
});
test('Stop records cancellation without replaying completed work or launching another attempt',()=>{
 let state=start('sequential');for(let n=0;n<1000&&!state.model&&state.status!=='blocked';n++)state=advanceSimulation(state,document);
 const prefix=state.events.slice(0,state.step+1).filter(event=>event.modelEvent?.type==='launch').length;
 const stopped=finish(stopSimulation(state,document));assert.equal(stopped.outcome,'cancelled');
 assert.equal(stopped.events.filter(event=>event.modelEvent?.type==='launch').length,prefix);
 assert.notEqual(stopped.planningSnapshot?.goalStatus,'complete');
});
test('incomplete evidence, failure, scope change and exhausted replanning never report completed goal',()=>{
 for(const scenario of ['insufficient-evidence','failed-prerequisite','user-change','budget','partial'] as const){const state=finish(start(scenario));assert.notEqual(state.planningSnapshot?.goalStatus,'complete',scenario);assert.notEqual(state.outcome,'completed',scenario);}
});
test('replan traverses ordinary counted model preparation without resetting budgets',()=>{
 const state=finish(start('replan'));
 const trigger=state.events.findIndex(event=>event.nodeId==='lina-planning-replan');
 assert.ok(trigger>=0);assert.ok(state.events.slice(trigger+1).some(event=>event.modelEvent?.type==='launch'));
 assert.equal(state.attempts,state.events.filter(event=>!event.agentId&&event.modelEvent?.type==='launch').length);
 assert.ok(state.rounds<=state.maxRounds);
});
test('direct strategy bypasses goal ledger accounting even when a planning scenario is selected',()=>{
 const state=finish(start('sequential',false,{strategy:'direct'}));assert.equal(Object.keys(state.planningSnapshot?.tasks??{}).length,0);assert.equal(state.outcome,'completed');
});
test('known-no-effect mutation inspection reuses the original command identity',()=>{
 let state=start('unknown-ack');for(let n=0;n<1000&&state.status!=='waiting'&&!['blocked','completed'].includes(state.status);n++)state=advanceSimulation(state,document);
 assert.equal(state.wait?.kind,'planning-commit');const id=state.planningSnapshot?.pendingUpdate?.operationId;
 const final=finish(answerSimulation(state,document,'known-no-effect'));assert.ok(id);assert.equal(final.planningSnapshot?.revision,1);assert.ok(final.planningSnapshot?.transactions[id!]);
});
test('Planning State writes and checkpoints retain exact per-agent plan records',()=>{
 const state=finish(start('sequential'));
 const writes=state.events.filter(event=>event.nodeId==='lina-state-record'&&event.planningEvidence?.outcome==='committed');
 assert.ok(writes.length>0);assert.ok(writes.every(event=>event.stateSnapshot?.records['task-plan:plan:main']));
 assert.ok(state.stateSnapshot?.checkpoints.some(checkpoint=>checkpoint.restore.planningSnapshot?.planId==='plan:main'));
 const child=finish(start('child-local'));for(const [id,instance] of Object.entries(child.agents))assert.ok(instance.stateSnapshot?.records[`task-plan:plan:${id}`]);
});
