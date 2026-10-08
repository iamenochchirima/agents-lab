import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { ENVIRONMENT_CASES, type EnvironmentCase, type EnvironmentSettings } from '../src/features/lina/environmentFixtures';
import { startSimulation, advanceSimulation, answerSimulation, stopSimulation, resetSimulation, type SimulationState } from '../src/features/lina/inputSimulation';
const start=(scenario:EnvironmentCase,automatic=false,settings:Partial<EnvironmentSettings>={})=>startSimulation('cli',document,automatic,'tool-round',3,'fits','parallel','openai-chat','answer','policy-allow',[],'fresh','baseline','disabled',{},'disabled',{},scenario,settings);
function finish(initial:SimulationState){
 let state=initial;
 for(let n=0;n<6000&&!['completed','blocked'].includes(state.status);n++){
  if(state.status==='waiting')state=answerSimulation(state,document,['approval','memory-review','planning-review'].includes(state.wait?.kind??'')?'allow-once':['environment-reconciliation','planning-commit','subagent','reconciliation','delivery-reconciliation'].includes(state.wait?.kind??'')?'known-success':'ready');
  else state=advanceSimulation(state,document);
 }
 assert.equal(state.status,'completed',state.environmentCase+': '+(state.error??state.detail));return state;
}
for(const {value} of ENVIRONMENT_CASES)test(value+': valid graph with Auto/Next parity and reset',()=>{
 const manual=finish(start(value)),auto=finish(start(value,true));
 assert.deepEqual(manual.environmentSnapshot,auto.environmentSnapshot);
 assert.equal(new Set(manual.events.map(event=>event.id)).size,manual.events.length);
 const reset=resetSimulation(manual,document);assert.equal(reset.environmentCase,value);assert.equal(reset.step,0);
});
test('default preserves pure tool trace without environment acquisition',()=>{
 const state=finish(start('disabled'));assert.equal(state.environmentSnapshot,undefined);assert.equal(state.results[0]?.value,4);
});
test('unavailable backend cannot launch a model or fall back to local',()=>{
 const state=finish(start('unavailable'));assert.equal(state.outcome,'failed');assert.equal(state.events.some(event=>event.modelEvent?.type==='launch'),false);assert.equal(state.environmentSnapshot?.environment.status,'unavailable');
});
test('intent persists scoped ledger before running operation',()=>{
 const state=finish(start('local'));
 const receipt=state.events.find(event=>event.nodeId==='lina-state-record'&&event.environmentEvidence?.phase==='intent');
 assert.ok(receipt?.stateSnapshot?.records['environment-ledger:main']);
 assert.ok(state.results.every(result=>result.value===undefined));
});
test('uncertain launch refuses mismatched answer and reconciles original identity',()=>{
 let state=start('uncertain-launch');while(state.status!=='waiting'&&!['completed','blocked'].includes(state.status))state=advanceSimulation(state,document);
 assert.equal(state.wait?.owner,'environment');assert.equal(answerSimulation(state,document,'ready').wait?.id,state.wait?.id);
 const finished=finish(answerSimulation(state,document,'known-success'));assert.ok(finished.environmentSnapshot);
});
test('Stop joins owned workspace processes without fresh provider launch',()=>{
 let state=start('background');for(let i=0;i<1000&&!['completed','blocked'].includes(state.status)&&(!state.environmentSnapshot||!Object.values(state.environmentSnapshot.processes).some(process=>process.status==='running'));i++)state=advanceSimulation(state,document);
 assert.equal(state.status,'paused',state.error);
 const prefix=state.events.slice(0,state.step+1).filter(event=>event.modelEvent?.type==='launch').length;
 const stopped=finish(stopSimulation(state,document));assert.equal(stopped.outcome,'cancelled');assert.equal(stopped.events.filter(event=>event.modelEvent?.type==='launch').length,prefix);
 assert.ok(Object.values(stopped.environmentSnapshot!.processes).every(process=>process.status==='cancelled'||process.status==='exited'));
});
test('Planning assesses actual environment failures and plan-only grants no launches',()=>{
 for(const planningCase of ['sequential','plan-only'] as const){
 const state=finish(startSimulation('cli',document,false,'tool-round',3,'fits','parallel','openai-chat','answer','policy-allow',[],'fresh','baseline','disabled',{},planningCase,{},'read-only'));
 if(planningCase==='plan-only')assert.equal(state.events.some(event=>event.operations?.some(operation=>operation.status==='running')),false);
 else assert.notEqual(state.planningSnapshot?.goalStatus,'complete');
 }
});
test('Workspace commands enter actual model catalogs and are admitted as writes',()=>{
 const state=finish(start('local'));
 assert.ok(state.events.some(event=>JSON.stringify(event.modelRequest?.wireBody??{}).includes('workspace_fixture')));
 assert.equal(state.operations.find(operation=>operation.callId==='call-001')?.effectClass,'write');
});
test('Stop during uncertain launch retains observation owner and does not replay',()=>{
 let state=start('uncertain-launch');for(let i=0;i<1000&&state.status!=='waiting'&&!['completed','blocked'].includes(state.status);i++)state=advanceSimulation(state,document);
 const launched=state.events.slice(0,state.step+1).filter(event=>event.environmentEvidence?.phase==='launch').length;
 const stopped=finish(stopSimulation(state,document));assert.equal(stopped.outcome,'cancelled');assert.equal(stopped.events.filter(event=>event.environmentEvidence?.phase==='launch').length,launched);
 assert.ok(Object.values(stopped.environmentSnapshot!.processes).every(process=>process.status!=='running'&&process.status!=='unknown'));
});
test('Workspace fixtures normalize tool calls in all four provider protocols',()=>{
 for(const protocol of ['openai-chat','openai-responses','anthropic-messages','gemini-generate-content'] as const){
 const state=finish(startSimulation('telegram',document,false,'tool-round',3,'fits','parallel',protocol,'answer','policy-allow',[],'fresh','baseline','disabled',{},'disabled',{},'local'));
 const calls=state.modelHistory.flatMap(model=>model.outcome?.toolCalls??[]);
 assert.ok(calls.length);assert.ok(calls.every(call=>call.name==='workspace_fixture'&&call.catalogMapped));
 }
});
test('Children retain distinct lease ownership with shared or separate environment identities',()=>{
 for(const scenario of ['child-shared','child-separate'] as const){
 const state=finish(start(scenario)),children=Object.values(state.agents);
 assert.ok(children.length>=2);
 const identities=children.map(child=>child.environmentSnapshot!.environment.id);
 if(scenario==='child-shared')assert.equal(new Set(identities).size,1);else assert.equal(new Set(identities).size,children.length);
 assert.ok(children.every(child=>Object.values(child.environmentSnapshot!.leases).some(lease=>lease.agentId===child.activeAgentId)));
 }
});
test('Final State retains terminal environment ledger and checkpoint references',()=>{
 const state=finish(start('local'));
 const record=state.stateSnapshot!.records['environment-ledger:main'];assert.ok(record);
 assert.equal((record.payload as {cleanup:string}).cleanup,'retained');
 assert.ok(state.stateSnapshot!.checkpoints.some(checkpoint=>checkpoint.restore.environmentSnapshot?.environment.id===state.environmentSnapshot!.environment.id));
 const children=finish(start('child-shared'));assert.ok(Object.values(children.agents).every(child=>Object.values(child.environmentSnapshot!.leases).some(lease=>lease.agentId==='main')));
});
