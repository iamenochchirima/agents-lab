import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture as document } from '../src/features/lina/architectureDocument';
import { MEMORY_CASES, type MemoryCase } from '../src/features/lina/memoryFixtures';
import { advanceSimulation, answerSimulation, resetSimulation, startSimulation, stopSimulation, type SimulationState } from '../src/features/lina/inputSimulation';
const start=(memoryCase:MemoryCase,auto=false)=>startSimulation('cli',document,auto,'direct-answer',3,'fits','parallel','openai-chat','answer','policy-allow',[],'fresh',memoryCase);
function finish(state:SimulationState){for(let n=0;n<2000&&!['completed','blocked'].includes(state.status);n++){state=state.status==='waiting'?answerSimulation(state,document,['approval','memory-review'].includes(state.wait?.kind??'')?'allow-once':['reconciliation','delivery-reconciliation'].includes(state.wait?.kind??'')?'known-success':'ready'):advanceSimulation(state,document);}assert.equal(state.status,'completed',state.error);return state;}
for(const {value} of MEMORY_CASES)test(`${value}: integrated Auto and Next retain identical memory and main work`,()=>{
 const manual=finish(start(value)),auto=finish(start(value,true));
 assert.deepEqual(manual.memorySnapshot,auto.memorySnapshot);assert.deepEqual(manual.results,auto.results);
 assert.equal(manual.attempts,auto.attempts);assert.equal(manual.rounds,auto.rounds);
 assert.ok(manual.events.some(event=>event.memoryEvidence));
 const reset=resetSimulation(manual,document);assert.equal(reset.memoryCase,value);assert.equal(reset.step,0);
 assert.equal(reset.memorySnapshot,undefined);
});
test('Stop retains known memory and counters without launching new extraction',()=>{
 let state=start('remember');
 for(let n=0;n<2000&&!state.memorySnapshot?.records.remembered;n++)state=advanceSimulation(state,document);
 assert.ok(state.memorySnapshot?.records.remembered);const revision=state.memorySnapshot.records.remembered.revision,attempts=state.attempts;
 const stopAt=state.step;state=finish(stopSimulation(state,document));
 assert.equal(state.outcome,'cancelled');assert.equal(state.attempts,attempts);
 assert.equal(state.memorySnapshot!.records.remembered.revision,revision);
 assert.equal(state.events.slice(stopAt+1).some(event=>event.memoryEvidence?.phase==='extract'),false);
 const checkpoint=state.stateSnapshot!.checkpoints.at(-1)!;
 assert.equal(checkpoint.restore.memorySnapshot?.records.remembered.revision,revision);
});
test('recovery checkpoint retains scoped Memory projection with owned work',()=>{
 const state=finish(startSimulation('cli',document,false,'direct-answer',3,'fits','parallel','openai-chat','answer','policy-allow',[],'resume-beforelaunch','baseline'));
 const restored=state.events.find(event=>event.stateRestore)?.stateRestore;
 assert.ok(restored?.memorySnapshot?.selection);assert.equal(restored.progress.attempts,0);
 assert.deepEqual(restored.memorySnapshot.selection.recordIds,['preference']);
});
test('missing Memory route blocks instead of silently bypassing recall',()=>{
 const missing={...document,edges:document.edges.filter(edge=>!(edge.source==='lina-context-load'&&edge.target==='lina-memory-scope'))};
 const state=startSimulation('cli',missing,false);
 assert.equal(state.status,'blocked');assert.match(state.error??'',/missing connection/);
});

for (const decision of ['deny', 'expire'] as const) test(`child review ${decision} cannot publish shared knowledge`, () => {
 let state = start('child-proposal');
 while (state.status !== 'waiting' && !['completed', 'blocked'].includes(state.status)) state = advanceSimulation(state, document);
 assert.equal(state.wait?.kind, 'memory-review');
 const before = structuredClone(state.memorySnapshot);
 const stale = answerSimulation(state, document, 'allow-once', 'unmatched-review');
 assert.equal(stale.status, 'waiting');
 assert.deepEqual(stale.memorySnapshot, before);
 state = finish(answerSimulation(state, document, decision));
 assert.equal(state.memorySnapshot!.records.remembered, undefined);
});
test('Stop at parent review never resumes shared publication', () => {
 let state = start('child-proposal');
 while (state.status !== 'waiting' && !['completed', 'blocked'].includes(state.status)) state = advanceSimulation(state, document);
 assert.equal(state.wait?.kind, 'memory-review');
 state = finish(stopSimulation(state, document));
 assert.equal(state.outcome, 'cancelled');
 assert.equal(state.memorySnapshot!.records.remembered, undefined);
});
