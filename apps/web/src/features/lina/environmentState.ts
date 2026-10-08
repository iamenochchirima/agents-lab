import { commitStateFixture, type StateFixtureState } from './stateFixtures';
import type { SimulationEvent } from './inputSimulation';
import type { EnvironmentFixtureState } from './environmentFixtures';

/** Persist each instance's reference ledger at State receipts. Backend inspection
 * remains necessary after restore; a checkpoint cannot prove a process still exists. */
export function attachEnvironmentState(events:SimulationEvent[]):SimulationEvent[] {
 if(!events.some(event=>event.environmentSnapshot))return events;
 const journals=new Map<string,StateFixtureState>(),ledgers=new Map<string,EnvironmentFixtureState>();
 return events.map(original=>{
  const event={...original},agentId=event.agentId??'main',prior=journals.get(agentId);
  let journal=event.stateSnapshot?structuredClone(event.stateSnapshot):prior;
  if(journal&&prior&&journal!==prior){
   for(const [id,record] of Object.entries(prior.records))if(id.startsWith('environment-ledger:'))journal.records[id]=record;
   for(const checkpoint of journal.checkpoints){const saved=prior.checkpoints.find(row=>row.id===checkpoint.id);if(saved?.restore.environmentSnapshot){checkpoint.restore.environmentSnapshot=structuredClone(saved.restore.environmentSnapshot);for(const [id,revision] of Object.entries(saved.recordRevisions))if(id.startsWith('environment-ledger:'))checkpoint.recordRevisions[id]=revision;}}
   for(const [id,transaction] of Object.entries(prior.transactions))if(id.startsWith('environment-state:'))journal.transactions[id]=transaction;
  }
  if(event.environmentSnapshot?.agentId===agentId)ledgers.set(agentId,event.environmentSnapshot);
  const ledger=ledgers.get(agentId);
  if(ledger&&event.nodeId==='lina-state-record'&&event.environmentEvidence){
   journal=journal?structuredClone(journal):{storage:'fixture-only',ownerRevision:1,records:{},transactions:{},checkpoints:[]};
   const recordId=`environment-ledger:${agentId}`,transactionId=`environment-state:${event.id}`;
   const outcome=commitStateFixture(journal,transactionId,recordId,ledger);
   event.stateEvidence={phase:'commit',outcome,recordId,transactionId,ownerRevision:journal.ownerRevision,reason:'Fixture State records exact environment generation, leases and operation ledger'};
  }
  if(journal&&ledger){
   if(event.nodeId==='lina-state-checkpoint'){
    const checkpoint=journal.checkpoints.find(row=>row.id===journal!.checkpointRef);
    if(checkpoint){checkpoint.restore.environmentSnapshot=structuredClone(ledger);const row=journal.records[`environment-ledger:${agentId}`];if(row)checkpoint.recordRevisions[`environment-ledger:${agentId}`]=row.revision;}
   }
   if(event.stateRestore){const checkpoint=journal.checkpoints.find(row=>row.id===journal!.checkpointRef);event.stateRestore={...event.stateRestore,environmentSnapshot:checkpoint?.restore.environmentSnapshot??event.stateRestore.environmentSnapshot};}
  }
  if(journal){journals.set(agentId,journal);if(event.stateSnapshot||event.nodeId.startsWith('lina-state-')&&event.environmentEvidence)event.stateSnapshot=journal;}
  return event;
 });
}
