import { commitStateFixture, type StateFixtureState } from './stateFixtures';
import type { PlanningFixtureState } from './planningFixtures';
import type { SimulationEvent } from './inputSimulation';

/** Join Planning's semantic records into the existing fixture State journal.
 * This preserves source-owner snapshots; it does not make browser state durable.
 * Each agent gets its own journal and checkpoints, never a parent's mutable plan. */
export function attachPlanningState(events:SimulationEvent[]):SimulationEvent[] {
 if(!events.some(event=>event.planningSnapshot))return events;
 const journals=new Map<string,StateFixtureState>();
 const plans=new Map<string,PlanningFixtureState>();
 const outcomes=new Map<string,SimulationEvent['update']['outcome']>();
 return events.map(original=>{
  const event={...original},agentId=event.agentId??'main';
  const previous=journals.get(agentId);
  if(event.nodeId==='lina-execution-settle'&&event.update.outcome)outcomes.set(agentId,event.update.outcome);
  let journal=event.stateSnapshot?structuredClone(event.stateSnapshot):previous;
  if(journal&&previous&&journal!==previous){
   for(const [id,record] of Object.entries(previous.records))if(id.startsWith('task-plan:')||record.transactionId.startsWith('planning-settlement:'))journal.records[id]=record;
   for(const checkpoint of journal.checkpoints){const saved=previous.checkpoints.find(row=>row.id===checkpoint.id);if(saved?.restore.planningSnapshot){checkpoint.restore.planningSnapshot=saved.restore.planningSnapshot;for(const [id,revision] of Object.entries(saved.recordRevisions))if(id.startsWith('task-plan:'))checkpoint.recordRevisions[id]=revision;}}
   for(const [id,transaction] of Object.entries(previous.transactions))if(id.startsWith('planning-state:')||id.startsWith('planning-settlement:'))journal.transactions[id]=transaction;
  }
  if(event.planningSnapshot?.scope.agentId===agentId)plans.set(agentId,event.planningSnapshot);
  const plan=plans.get(agentId),evidence=event.planningEvidence;
  if(plan&&event.nodeId==='lina-state-record'&&evidence?.outcome==='committed'){
   if(journal===previous&&journal)journal=structuredClone(journal);
   journal??={storage:'fixture-only',ownerRevision:1,records:{},transactions:{},checkpoints:[]};
   const transactionId=`planning-state:${event.id}:${plan.revision}`;
   const recordId=`task-plan:${plan.planId}`;
   const outcome=commitStateFixture(journal,transactionId,recordId,plan);
   event.stateEvidence={phase:'commit',transactionId,recordId,outcome,ownerRevision:journal.ownerRevision,reason:'Scoped plan revision/attempts/assessments recorded by fixture State owner'};
  }
  if(journal&&plan&&event.nodeId==='lina-state-record'&&event.stateEvidence?.recordId?.startsWith('settle-turn:')){
   const recordId=event.stateEvidence.recordId,row=journal.records[recordId];
   if(row){
    const payload=structuredClone(row.payload) as {progress:Record<string,unknown>};
    payload.progress={...payload.progress,outcome:outcomes.get(agentId),planningGoalStatus:plan.goalStatus};
    commitStateFixture(journal,`planning-settlement:${event.id}`,recordId,payload);
   }
  }
  if(journal&&plan){
   const recordId=`task-plan:${plan.planId}`;
   for(const checkpoint of journal.checkpoints){
    if(checkpoint.id!==journal.checkpointRef||event.nodeId!=='lina-state-checkpoint')continue;
    const record=journal.records[recordId];
    if(record){if(outcomes.has(agentId))checkpoint.restore.progress.outcome=outcomes.get(agentId);checkpoint.recordRevisions[recordId]=record.revision;checkpoint.restore.planningSnapshot=structuredClone(record.payload) as PlanningFixtureState;}
   }
   if(event.stateRestore){
    const checkpoint=journal.checkpoints.find(row=>row.id===journal!.checkpointRef);
    event.stateRestore={...event.stateRestore,planningSnapshot:checkpoint?.restore.planningSnapshot??event.stateRestore.planningSnapshot};
   }
  }
  if(journal){journals.set(agentId,journal);if(event.stateSnapshot||event.nodeId.startsWith('lina-state-')&&event.planningEvidence)event.stateSnapshot=journal;}
  return event;
 });
}
