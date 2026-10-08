import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { advanceSimulation, answerSimulation, selectSimulationWait, startSimulation, stopSimulation, type SimulationState } from '../src/features/lina/inputSimulation';
import { STATE_CASES, commitStateFixture, type StateCase, type StateFixtureState } from '../src/features/lina/stateFixtures';
const initial=(scenario:StateCase,automatic=false)=>startSimulation('cli',document,automatic,'direct-answer',3,'fits','parallel','openai-chat','answer','policy-allow',[],scenario);
function finish(state:SimulationState){for(let n=0;n<1800&&!['completed','blocked'].includes(state.status);n++)state=state.status==='waiting'?answerSimulation(state,document,state.wait?.kind==='approval'?'allow-once':['reconciliation','delivery-reconciliation'].includes(state.wait?.kind??'')?'known-success':'ready'):advanceSimulation(state,document);assert.ok(['completed','blocked'].includes(state.status),'fixture terminates');return state;}
for(const {value:scenario} of STATE_CASES)test(`${scenario}: Auto and Next share recovery evidence and valid graph edges`,()=>{
 const manual=finish(initial(scenario)),auto=finish(initial(scenario,true));
 assert.equal(manual.status,auto.status);assert.deepEqual(manual.stateSnapshot,auto.stateSnapshot);assert.deepEqual(manual.results,auto.results);assert.equal(manual.attempts,auto.attempts);
 for(const event of manual.events)if(event.edgeId){const edge=document.edges.find(edge=>edge.id===event.edgeId);assert.equal(edge?.source,event.sourceNodeId,event.id);assert.equal(edge?.target,event.nodeId,event.id);}
});
test('missing State connection blocks rather than bypasses storage',()=>{const missing={...document,edges:document.edges.filter(edge=>edge.id!=='lina-state-edge-claim-record')};const state=startSimulation('cli',missing,false);assert.equal(state.status,'blocked');assert.match(state.error??'',/missing connection/i);});
test('lost acknowledgment inspects the exact committed transaction and does not write twice',()=>{const state=finish(initial('lost-ack'));const unknown=state.events.find(event=>event.stateEvidence?.outcome==='unknown')!.stateEvidence!;const inspect=state.events.find(event=>event.stateEvidence?.phase==='inspect')!.stateEvidence!;assert.equal(inspect.transactionId,unknown.transactionId);assert.equal(state.stateSnapshot!.records['input-receipt'].revision,1);});
test('duplicate input returns original receipt without model launch',()=>{const state=finish(initial('duplicate-input'));assert.equal(state.attempts,0);assert.equal(state.events.some(event=>event.modelEvent?.type==='launch'),false);assert.ok(state.events.some(event=>event.nodeId==='lina-input-duplicate'));});
test('parallel recovery restores settled sibling and does not launch it again',()=>{const state=finish(initial('parallel-recovery'));assert.equal(state.status,'completed');assert.equal(state.results.find(result=>result.callId==='call-002')?.status,'success');const launches=state.events.flatMap(event=>event.operations?.filter(op=>op.status==='running')??[]);assert.equal(launches.filter(op=>op.callId==='call-002').length,1);const restored=state.events.find(event=>event.stateRestore);assert.ok(restored?.stateRestore?.results.some(result=>result.callId==='call-002'));assert.equal(state.attempts,2);});
for(const scenario of ['incompatible','missing-artifact','stale-owner','storage-unavailable'] as const)test(`${scenario} withholds physical launch`,()=>{const state=finish(initial(scenario));assert.equal(state.status,'blocked');assert.equal(state.events.some(event=>event.modelEvent?.type==='launch'),false);assert.equal(state.stateSnapshot?.recovery,'reject');});
test('uncertain effect resumes through original reconciliation without second launch',()=>{const state=finish(initial('unknown-effect'));assert.ok(state.events.some(event=>event.nodeId==='lina-input-reconcile'));assert.equal(state.events.flatMap(event=>event.operations??[]).filter(op=>op.callId==='call-001'&&op.status==='running').length,1);assert.equal(state.results.find(result=>result.callId==='call-001')?.status,'success');});
test('checkpoint fragments never replace committed recovery manifest',()=>{const state=finish(initial('partial-checkpoint'));const partial=state.stateSnapshot!.checkpoints.find(cp=>!cp.committed)!;assert.ok(partial);assert.notEqual(state.stateSnapshot!.checkpointRef,partial.id);assert.ok(state.events.some(event=>event.stateEvidence?.phase==='inspect'));});
test('persisted Stop prevents fresh launch after recovery',()=>{const state=finish(initial('stop-recovery'));assert.equal(state.outcome,'cancelled');assert.equal(state.events.some(event=>event.modelEvent?.type==='launch'),false);assert.ok(state.stateSnapshot!.records.stop);});
test('transaction identity mismatch and stale owner cannot mutate committed records',()=>{const store:StateFixtureState={storage:'fixture-only',ownerRevision:2,records:{},transactions:{},checkpoints:[]};assert.equal(commitStateFixture(store,'tx','result',{value:4},2),'applied');assert.equal(commitStateFixture(store,'tx','result',{value:4},2),'already-applied');assert.equal(commitStateFixture(store,'tx','result',{value:5},2),'conflict');assert.equal(commitStateFixture(store,'late','result',{value:5},1),'conflict');assert.equal(store.records.result.revision,1);assert.deepEqual(store.records.result.payload,{value:4});});
test('delivery recovery reuses saved reply without new inference',()=>{const state=finish(initial('delivery-uncertain'));const start=state.events.findIndex(event=>event.stateEvidence?.outcome==='delivery-only');assert.ok(start>=0);assert.ok(state.events.slice(start).every(event=>event.modelEvent?.type!=='launch'));assert.equal((state.stateSnapshot!.records.delivery.payload as {deliveryId:string}).deliveryId,'delivery-fixture');});

test('restart before physical launch restores zero attempts and rounds',()=>{const state=initial('resume-beforelaunch');const recovery=state.events.find(event=>event.stateRestore)!.stateRestore!;assert.equal(recovery.progress.attempts,0);assert.equal(recovery.progress.rounds,0);assert.equal(recovery.operations.some(op=>op.status==='running'),false);});

test('approval wait is persisted before it becomes interactive',()=>{let state=initial('approval-recovery');for(let i=0;i<1000&&state.status!=='waiting';i++)state=advanceSimulation(state,document);assert.equal(state.status,'waiting');assert.ok(Object.values(state.stateSnapshot!.records).some(record=>JSON.stringify(record.payload).includes(state.wait!.id)));assert.ok(state.stateSnapshot!.checkpointRef);});

test('restart expires old runtime-session grants while persistent grants remain subject to fresh review',()=>{
 const matcher={agentId:'lina',workspaceId:'workspace-demo',accountId:'account-demo',action:'tool.invoke',target:'fixture-calculator',argumentDigest:'fixture-digest:reviewed-arguments',catalogRevision:7};
 const grants=[{id:'saved-session',lifetime:'session' as const,sessionId:'fixture-session-1',matcher,policyRevision:1,generation:1,status:'active' as const,storage:'fixture-only' as const},{id:'saved-persistent',lifetime:'persistent' as const,sessionId:'fixture-session-1',matcher,policyRevision:1,generation:1,status:'active' as const,storage:'fixture-only' as const}];
 let state=startSimulation('cli',document,false,'direct-answer',3,'fits','parallel','openai-chat','answer','policy-allow',grants,'approval-recovery');
 for(let i=0;i<1000&&state.status!=='waiting';i++)state=advanceSimulation(state,document);
 assert.equal(state.status,'waiting');assert.equal(state.safetyGrants.find(grant=>grant.id==='saved-session')?.status,'expired');assert.equal(state.safetyGrants.find(grant=>grant.id==='saved-persistent')?.status,'active');
 state=finish(state);assert.equal(state.safetyGrants.find(grant=>grant.id==='saved-session')?.status,'expired');assert.equal(state.safetyGrants.find(grant=>grant.id==='saved-persistent')?.status,'active');
});


test('restored approvals preserve their reviewed matcher, account and catalog revision',()=>{
 let state=initial('approval-recovery');
 for(let n=0;n<1000&&state.status!=='waiting';n++)state=advanceSimulation(state,document);
 assert.equal(state.status,'waiting');
 for(const wait of state.waits){assert.equal(wait.kind,'approval');assert.ok('reviewedMatcher' in wait && wait.reviewedMatcher);if('reviewedMatcher' in wait){assert.equal(wait.reviewedMatcher?.accountId,'account-demo');assert.equal(wait.reviewedMatcher?.catalogRevision,7);}}
});


test('a selected restored approval completes while the other stays pending',()=>{
 let state=initial('approval-recovery');
 for(let n=0;n<1000&&state.status!=='waiting';n++)state=advanceSimulation(state,document);
 assert.equal(state.waits.length,2);
 const first=state.waits[0].id,second=state.waits[1].id;
 state=answerSimulation(selectSimulationWait(state,second),document,'allow-once',second);
 for(let n=0;n<1000&&state.status!=='waiting';n++)state=advanceSimulation(state,document);
 assert.equal(state.status,'waiting');assert.equal(state.wait?.id,first);
 assert.equal(state.results.find(result=>result.callId==='call-002')?.status,'success');
 assert.equal(state.operations.find(op=>op.callId==='call-001')?.status,'waiting');
});


test('Stop checkpoints retain observed model counters and the cancellation latch',()=>{
 let state=initial('fresh');
 for(let n=0;n<1000&&state.events[state.step]?.modelEvent?.type!=='launch';n++)state=advanceSimulation(state,document);
 assert.equal(state.attempts,1);assert.equal(state.rounds,1);
 state=finish(stopSimulation(state,document));
 assert.equal(state.outcome,'cancelled');
 const checkpoint=state.stateSnapshot!.checkpoints.at(-1)!;
 assert.equal(checkpoint.restore.progress.attempts,1);assert.equal(checkpoint.restore.progress.rounds,1);
 assert.equal(checkpoint.restore.stopRequested,true);
});
