import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { startSimulation, advanceSimulation, answerSimulation, stopSimulation, pauseSimulation, resetSimulation, type SimulationState, type SimulationAnswer, type ToolScenario, type ContextCase } from '../src/features/lina/inputSimulation';

const defaultAnswer = (state: SimulationState): SimulationAnswer => state.wait!.kind === 'approval' ? 'approve' : state.wait!.kind === 'reconciliation' ? 'known-success' : 'ready';
function until(state: SimulationState, predicate: (state: SimulationState) => boolean) {
  for (let i=0;i<400;i++) {
    if (predicate(state)) return state;
    assert.notEqual(state.status,'blocked',state.error);
    assert.notEqual(state.status,'completed','target must be visited before completion');
    assert.notEqual(state.status,'waiting','unexpected external wait');
    state=advanceSimulation(state,document);
  }
  assert.fail('fixture exceeded bounded event count');
}
function finish(state: SimulationState) {
  const seen=[state];
  for(let i=0;i<400 && state.status!=='completed';i++){
    assert.notEqual(state.status,'blocked',state.error);
    state=state.status==='waiting'?answerSimulation(state,document,defaultAnswer(state)):advanceSimulation(state,document);
    seen.push(state);
  }
  assert.equal(state.status,'completed');return {state,seen};
}
for(const scenario of ['parallel','conflict','mixed','approval','auth','input','uncertain','retry','hook'] as ToolScenario[]){
  test(`${scenario} detailed tool events have matching graph endpoints and equal Auto/Next state`,()=>{
    const auto=finish(startSimulation('telegram',document,true,'tool-round',3,'fits',scenario));
    const manual=finish(startSimulation('telegram',document,false,'tool-round',3,'fits',scenario));
    for(const event of auto.state.events){
      if(!event.edgeId)continue;
      const edge=document.edges.find(edge=>edge.id===event.edgeId)!;
      assert.equal(edge?.source,event.sourceNodeId,event.id);
      assert.equal(edge?.target,event.nodeId,event.id);
    }
    assert.deepEqual(auto.state.operations,manual.state.operations);
    assert.deepEqual(auto.state.results,manual.state.results);
    assert.equal(auto.state.rounds,2);assert.equal(auto.state.attempts,2);
    assert.deepEqual(auto.state.results.map(result=>result.callId),['call-001','call-002']);
    assert.ok(auto.state.events.some(event=>event.nodeId==='lina-tools-hooks'));
    assert.equal(auto.state.transitions.includes('lina-execution-edge-tools-outcomes'),false);
    assert.equal(resetSimulation(auto.state,document).toolScenario,scenario);
  });
}
test('independent operations overlap, complete in reverse order and preserve the peer while active',()=>{
  let state=startSimulation('cli',document,false,'tool-round');
  state=until(state,state=>state.operations.filter(op=>op.status==='running').length===2);
  assert.deepEqual(state.operations.map(op=>op.callId),['call-001','call-002']);
  state=until(state,state=>state.results.some(result=>result.callId==='call-002'));
  assert.equal(state.operations.find(op=>op.callId==='call-001')!.status,'running');
  assert.equal(state.results.length,1);
  assert.equal(state.rounds,1);
});
test('conflicting operations never overlap; the first result remains when the second starts',()=>{
  const run=finish(startSimulation('cli',document,false,'tool-round',3,'fits','conflict'));
  assert.ok(run.seen.every(state=>state.operations.filter(op=>op.status==='running').length<=1));
  const second=run.seen.find(state=>state.operations.find(op=>op.callId==='call-002')?.status==='running')!;
  assert.equal(second.results.find(result=>result.callId==='call-001')?.status,'success');
});
test('mixed known outcomes inform the next model round instead of erasing successful siblings',()=>{
  const {state}=finish(startSimulation('cli',document,false,'tool-round',3,'fits','mixed'));
  assert.equal(state.outcome,'completed');assert.equal(state.rounds,2);
  assert.deepEqual(state.results.map(result=>result.status),['error','success']);
});
for(const answer of ['approve','deny','expire'] as const){
  test(`approval ${answer} resumes only the owning call and keeps sibling result`,()=>{
    let state=until(startSimulation('cli',document,false,'tool-round',3,'fits','approval'),state=>state.status==='waiting');
    assert.equal(state.wait!.callId,'call-001');assert.equal(state.results[0].callId,'call-002');
    assert.strictEqual(advanceSimulation(state,document),state,'Next cannot bypass a wait');
    const mismatch=answerSimulation(state,document,'stale');assert.deepEqual(mismatch.operations,state.operations);assert.equal(mismatch.status,'waiting');
    state=answerSimulation(state,document,answer);const run=finish(state);
    assert.equal(run.state.results.find(result=>result.callId==='call-002')?.value,6);
    assert.equal(run.state.results.find(result=>result.callId==='call-001')?.status,answer==='approve'?'success':'denied');
    assert.equal(run.state.rounds,2);
    if(answer!=='approve')assert.ok(run.seen.every(state=>state.operations.find(op=>op.callId==='call-001')?.status!=='running'));
  });
}
test('authentication registers the wait before sign-in, rejects another account and rechecks the original call',()=>{
  let state=until(startSimulation('cli',document,false,'tool-round',3,'fits','auth'),state=>state.status==='waiting');
  assert.equal(state.route[state.step],'lina-tools-credential-authorize');
  assert.ok(state.route.indexOf('lina-execution-wait')<state.route.indexOf('lina-tools-auth'));
  assert.equal(state.operations.find(op=>op.callId==='call-001')!.status,'waiting');
  const rejected=answerSimulation(state,document,'wrong-account');assert.equal(rejected.status,'waiting');assert.deepEqual(rejected.results,state.results);
  state=answerSimulation(rejected,document,'ready');const {state:complete}=finish(state);
  assert.equal(complete.operations.find(op=>op.callId==='call-001')!.accountId,'account-demo');
  assert.equal(complete.events.filter(event=>event.edgeId==='lina-execution-edge-wait-auth').length,1);
});
test('protocol input continuation preserves call/attempt and does not repeat dispatch',()=>{
  const run=finish(startSimulation('cli',document,false,'tool-round',3,'fits','input'));
  assert.equal(run.state.events.filter(event=>event.edgeId==='lina-tools-edge-schedule-dispatch').length,1);
  assert.equal(run.state.operations[0].attemptId,'tool-attempt-1-1:1');
});
test('unknown write outcome withholds next model round and release until evidence arrives',()=>{
  const pending=until(startSimulation('cli',document,false,'tool-round',3,'fits','uncertain'),state=>state.status==='waiting');
  assert.equal(pending.wait!.kind,'reconciliation');assert.equal(pending.rounds,1);
  assert.equal(pending.operations.find(op=>op.callId==='call-001')!.status,'unknown');assert.equal(pending.results[0].value,6);
  assert.strictEqual(advanceSimulation(pending,document),pending);
  const {state}=finish(answerSimulation(pending,document,'known-no-effect'));
  assert.equal(state.results[0].status,'error');assert.equal(state.results[1].value,6);
  assert.equal(state.operations[0].attemptId,pending.operations[0].attemptId);
});
test('bounded tool retry changes its attempt, retains logical call and does not restart the model round',()=>{
  const run=finish(startSimulation('cli',document,false,'tool-round',3,'fits','retry'));
  const retried=run.seen.find(state=>state.operations.some(op=>op.attemptId==='tool-attempt-1-1:2'))!;
  assert.equal(retried.rounds,1);assert.equal(retried.attempts,1);
  assert.equal(retried.operations[0].callId,'call-001');assert.equal(retried.results[0].callId,'call-002');
});
for(const contextCase of ['catalog-change','hook','resource','prompt','foreign-scope'] as ContextCase[]){
  test(`Context ${contextCase} follows reviewed owners without extra provider work`,()=>{
    const {state}=finish(startSimulation('whatsapp',document,false,'direct-answer',3,contextCase));
    assert.equal(state.outcome,contextCase==='foreign-scope'?'failed':'completed');
    assert.equal(state.attempts,contextCase==='foreign-scope'?0:1);
    assert.equal(state.contextPreparations,contextCase==='catalog-change'?2:contextCase==='foreign-scope'?0:1);
    if(contextCase==='catalog-change')assert.equal(state.catalogRevision,8);
    if(contextCase==='hook')assert.ok(state.transitions.includes('lina-tools-edge-hooks-context-budget'));
  });
}
test('Pause preserves work and Stop prevents new launch, joins known work and releases a stopped turn',()=>{
  const active=until(startSimulation('cli',document,true,'tool-round'),state=>state.operations.filter(op=>op.status==='running').length===2);
  const paused=pauseSimulation(active);assert.deepEqual(paused.operations,active.operations);assert.equal(paused.stopRequested,false);
  const stopped=stopSimulation(paused,document);assert.equal(stopped.stopRequested,true);
  const {state}=finish(stopped);assert.equal(state.outcome,'cancelled');assert.equal(state.rounds,1);assert.equal(state.attempts,1);
  assert.ok(state.operations.every(op=>op.status==='cancelled'));assert.equal(state.route.at(-1),'lina-execution-release');
  assert.strictEqual(stopSimulation(stopped,document),stopped);
});
test('Stop while a write is active retains uncertainty and evidence cannot resume the ordinary loop',()=>{
  const active=until(startSimulation('cli',document,false,'tool-round',3,'fits','uncertain'),state=>state.operations.filter(op=>op.status==='running').length===2);
  const pending=until(stopSimulation(active,document),state=>state.status==='waiting');
  assert.equal(pending.outcome,'cancelled');assert.equal(pending.route.at(-1),'lina-input-reconcile');
  const {state}=finish(answerSimulation(pending,document,'known-success'));
  assert.equal(state.outcome,'cancelled');assert.equal(state.rounds,1);assert.equal(state.attempts,1);assert.equal(state.route.at(-1),'lina-execution-release');
  assert.equal(state.operations.find(op=>op.callId==='call-001')!.status,'success','late effect evidence is retained');
});
test('Stop before first provider launch and during provider work never creates another provider attempt',()=>{
  for(const target of ['lina-execution-limits','lina-execution-model','lina-model-invoke']){
    const active=until(startSimulation('cli',document,false),state=>state.route[state.step]===target && (target!=='lina-model-invoke'||state.events[state.step].modelEvent?.type==='launch'));
    const {state}=finish(stopSimulation(active,document));
    assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,target==='lina-model-invoke'?1:0);
  }
  const unadmitted=startSimulation('cli',document,false);assert.strictEqual(stopSimulation(unadmitted,document),unadmitted);
});
