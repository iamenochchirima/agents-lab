import type { EnvironmentFixtureState } from './environmentFixtures';
import type { PlanningFixtureState } from './planningFixtures';
import type { MemoryFixtureState } from './memoryFixtures';
import { STATE_REQUEST_ROUTES, type StateRequestRoute } from './stateBlock';
import type { LinaDocument } from './linaModel';
import type { SimulationAnswer, SimulationEvent, SimulationOperation, SimulationProgress, SimulationResult, SimulationWait, SimulationCase, ToolScenario } from './inputSimulation';
import { safetyMatcher, type SafetyCase, type SafetyGrant } from './safetyFixtures';

/** All records are deterministic design fixtures, discarded when the simulation resets. */
export type StateCase = 'fresh' | 'duplicate-input' | 'lost-ack' | 'resume-beforelaunch' | 'parallel-recovery' | 'approval-recovery' | 'unknown-effect' | 'stop-recovery' | 'partial-checkpoint' | 'incompatible' | 'missing-artifact' | 'stale-owner' | 'storage-unavailable' | 'delivery-uncertain';
export const STATE_CASES: { value: StateCase; label: string }[] = [
 ['fresh','Fresh input'],['duplicate-input','Duplicate input'],['lost-ack','Commit acknowledgment lost'],['resume-beforelaunch','Restart before launch'],['parallel-recovery','Restart with completed sibling'],['approval-recovery','Restore approval wait'],['unknown-effect','Recover unknown tool effect'],['stop-recovery','Restart after Stop'],['partial-checkpoint','Incomplete latest checkpoint'],['incompatible','Incompatible checkpoint'],['missing-artifact','Required artifact missing'],['stale-owner','Stale execution owner'],['storage-unavailable','State unavailable'],['delivery-uncertain','Uncertain reply delivery'],
].map(([value,label])=>({value:value as StateCase,label}));
export interface StateEvidence { phase: 'read' | 'commit' | 'inspect' | 'checkpoint' | 'recover' | 'reconcile'; transactionId?: string; recordId?: string; outcome: string; ownerRevision: number; reason: string }
export interface StateFixtureRecord { revision: number; transactionId: string; ownerRevision: number; payload: unknown }
export interface StateRestore { environmentSnapshot?: EnvironmentFixtureState; planningSnapshot?: PlanningFixtureState; memorySnapshot?: MemoryFixtureState; progress: Partial<SimulationProgress>; operations: SimulationOperation[]; results: SimulationResult[]; waits: SimulationWait[]; stopRequested?: boolean; safetyGrants?: SafetyGrant[] }
export interface StateCheckpoint { id: string; committed: boolean; ownerRevision: number; recordRevisions: Record<string,number>; continuation: string; restore: StateRestore; compatible: boolean; artifactsPresent: boolean }
export interface StateFixtureState { storage: 'fixture-only'; ownerRevision: number; records: Record<string,StateFixtureRecord>; transactions: Record<string,{fingerprint:string; recordId:string; outcome:'applied'|'conflict'}>; checkpoints: StateCheckpoint[]; checkpointRef?: string; recovery?: string }
export function stateScenarioSettings(scenario:StateCase): Partial<{executionCase:SimulationCase;toolScenario:ToolScenario;safetyCase:SafetyCase}> {
 if(scenario==='approval-recovery')return {executionCase:'tool-round',toolScenario:'parallel',safetyCase:'mandatory-review'};
 if(scenario==='unknown-effect')return {executionCase:'tool-round',toolScenario:'uncertain',safetyCase:'policy-allow'};
 if(scenario==='parallel-recovery')return {executionCase:'tool-round',toolScenario:'parallel',safetyCase:'policy-allow'};
 return {};
}
const clone=<T>(value:T):T=>structuredClone(value);
/** Atomic record set: identity reuse cannot silently change payload; stale fences cannot write. */
export function commitStateFixture(state:StateFixtureState,transactionId:string,recordId:string,payload:unknown,ownerRevision=state.ownerRevision):'applied'|'already-applied'|'conflict' {
 const fingerprint=JSON.stringify({recordId,payload});
 if(ownerRevision!==state.ownerRevision)return 'conflict';
 const previous=state.transactions[transactionId];
 if(previous)return previous.fingerprint===fingerprint?'already-applied':'conflict';
 state.transactions[transactionId]={fingerprint,recordId,outcome:'applied'};
 state.records[recordId]={revision:(state.records[recordId]?.revision??0)+1,transactionId,ownerRevision,payload:clone(payload)};
 return 'applied';
}
/** State is requested by semantic owners, never chained into a generic storage pipeline. */
export function withState(base:SimulationEvent[],document:LinaDocument,scenario:StateCase,answers:Record<string,SimulationAnswer>={},seed?:StateFixtureState,initial?:StateRestore):SimulationEvent[] {
 const store:StateFixtureState=seed?clone(seed):{storage:'fixture-only',ownerRevision:1,records:{},transactions:{},checkpoints:[]};
 const output:SimulationEvent[]=[];
 const progress:SimulationProgress={rounds:0,attempts:0,contextPreparations:0,contextReductions:0,catalogRevision:7,...initial?.progress};
 const operations=new Map<string,SimulationOperation>((initial?.operations??[]).map(op=>[op.callId,clone(op)])), results=new Map<string,SimulationResult>((initial?.results??[]).map(result=>[result.callId,clone(result)]));
 let serial=0, restarted=false, lostAck=false;
 let currentGrants:SafetyGrant[]=clone(initial?.safetyGrants??[]);
 let stopRequested=initial?.stopRequested??false;
 let currentMemory=initial?.memorySnapshot;
 const expiredSessions=new Map<string,number>();
 if(scenario==='duplicate-input'){const original=base.find(event=>event.nodeId==='lina-input-claim');if(original)commitStateFixture(store,`fixture-write:${original.id}:claim-input`,'input-receipt',{progress:clone(progress),operations:[],results:[],waits:[]});commitStateFixture(store,'fixture-original-acceptance','acceptance',{inputId:'input-fixture',turnId:'turn-fixture',receiptId:'receipt-fixture',status:'accepted'});}
 const snapshot=()=>clone(store);
 const emit=(nodeId:string,evidence:StateEvidence,edgeId?:string,sourceNodeId?:string,extra:Partial<SimulationEvent>={})=>output.push({id:`state:${serial++}:${nodeId}:${evidence.phase}`,nodeId,edgeId,sourceNodeId,update:{detail:evidence.reason},stateEvidence:evidence,stateSnapshot:snapshot(),...extra});
 const route=(owner:string,kind:StateRequestRoute['kind'],phase?:string)=>STATE_REQUEST_ROUTES.find(r=>r.source===owner&&r.kind===kind&&(!phase||r.phase===phase));
 const request=(r:StateRequestRoute,evidence:StateEvidence,extra:Partial<SimulationEvent>={})=>{emit(r.target,evidence,r.id,r.source);emit(r.returnTarget,evidence,r.returnId,r.target,extra);};
 const evidence=(phase:StateEvidence['phase'],outcome:string,reason:string,transactionId?:string,recordId?:string):StateEvidence=>({phase,outcome,reason,ownerRevision:store.ownerRevision,transactionId,recordId});
 const restore=(waits:SimulationWait[]=[]):StateRestore=>({progress:clone(progress),operations:clone([...operations.values()]),results:clone([...results.values()]),waits:clone(waits),stopRequested,safetyGrants:clone(currentGrants),...(currentMemory?{memorySnapshot:clone(currentMemory)}:{})});
 const checkpoint=(owner:string,waits:SimulationWait[]=[]):StateCheckpoint|undefined=>{
  const r=route(owner,'checkpoint');if(!r)return;
  const cp:StateCheckpoint={id:`fixture-checkpoint:${store.checkpoints.length+1}`,committed:true,ownerRevision:store.ownerRevision,recordRevisions:Object.fromEntries(Object.entries(store.records).map(([id,row])=>[id,row.revision])),continuation:owner,restore:restore(waits),compatible:true,artifactsPresent:true};
  store.checkpoints.push(cp);store.checkpointRef=cp.id;
  request(r,evidence('checkpoint','committed','Committed manifest references exact record revisions; fixture storage only',cp.id));return cp;
 };
 const restart=(owner:string,waits:SimulationWait[]=[]):boolean=>{
  restarted=true;
  // A supported boundary can be requested independently by the execution coordinator.
  const checkpointOwner=route(owner,'checkpoint')?owner:'lina-execution-controls';
  if(checkpointOwner!==owner)emit(checkpointOwner,evidence('checkpoint','requested','Coordinator selects a supported continuation'));
  const cp=checkpoint(checkpointOwner,waits)!;
  if(scenario==='partial-checkpoint'){
   store.checkpoints.push({...clone(cp),id:'fixture-checkpoint:partial',committed:false});
   commitStateFixture(store,'fixture-later-observation','later-observation',{operationId:'fixture-op:record-only',launched:false,source:'journal-after-checkpoint'});
   emit('lina-state-checkpoint',evidence('checkpoint','incomplete','Fragments remain invisible; prior committed manifest is the recovery candidate'));
  }
  if(scenario==='incompatible')cp.compatible=false;
  if(scenario==='missing-artifact')cp.artifactsPresent=false;
  emit('lina-input-recovery',evidence('recover','restart','Simulated process restart; use original turn and work identities'));
  request(route('lina-input-recovery','load')!,evidence('read',scenario==='storage-unavailable'?'unavailable':'found',scenario==='storage-unavailable'?'Read failure is not empty history':'Load latest committed manifest and retained operation records'));
  if(scenario==='stale-owner'){store.ownerRevision++;commitStateFixture(store,'fixture-newer-owner','execution-owner',{turnId:'turn-fixture',fence:store.ownerRevision,holder:'newer-live-worker'});const conflict=commitStateFixture(store,'fixture-stale-acquire','execution-owner',{holder:'stale-worker'},cp.ownerRevision);request(route('lina-state-recover','record')!,evidence('commit',conflict,'Stale execution fence fails conditional owner transition','fixture-stale-acquire','execution-owner'));}
  const refused=scenario==='storage-unavailable'||!cp.compatible||!cp.artifactsPresent||scenario==='stale-owner';
  if(refused){store.recovery='reject';emit('lina-input-recovery',evidence('recover','reject',scenario==='stale-owner'?'A newer live owner prevents stale acquisition':scenario==='missing-artifact'?'Required artifact unavailable; continuation withheld':scenario==='incompatible'?'Checkpoint version incompatible; continuation withheld':'State unavailable; continuation withheld'),'lina-state-edge-recovery-plan','lina-state-recover',{stateError:scenario==='stale-owner'?'A newer live execution owner prevents recovery':scenario==='missing-artifact'?'Required recovery artifact unavailable':scenario==='incompatible'?'Checkpoint is incompatible':'State storage is unavailable'});return false;}
  if(scenario==='partial-checkpoint')request(route('lina-state-recover','load')!,evidence('inspect','found','Inspect operation records newer than previous committed checkpoint; do not replay them'));
  store.ownerRevision++;
  const tx=`fixture-owner:${store.ownerRevision}`;commitStateFixture(store,tx,'execution-owner',{turnId:'turn-fixture',fence:store.ownerRevision});
  request(route('lina-state-recover','record')!,evidence('commit','applied','Conditional owner reacquisition publishes a new execution fence',tx,'execution-owner'));
  store.recovery=scenario==='unknown-effect'?'reconcile':waits.length?'restore-waits':scenario==='stop-recovery'?'stopped':'resume';
  const recovered=clone(cp.restore);recovered.stopRequested=scenario==='stop-recovery';
  currentGrants=currentGrants.map(grant=>{if(grant.lifetime!=='session')return grant;expiredSessions.set(grant.id,grant.generation+1);return {...grant,status:'expired',generation:grant.generation+1};});
  recovered.safetyGrants=clone(currentGrants);
  emit('lina-input-recovery',evidence('recover',store.recovery,'Restore recorded counters, settled siblings and pending identities'),'lina-state-edge-recovery-plan','lina-state-recover',{stateRestore:{...recovered,waits:recovered.waits.filter(wait=>!answers[wait.id])}});
  return true;
 };
 for(const originalEvent of base){
  let event=originalEvent;
  if(restarted&&event.safetyEvidence?.phase==='commit'&&event.safetyEvidence.decision==='allow')expiredSessions.delete(`fixture-grant:${event.safetyEvidence.operationId}`);
  if(restarted&&event.safetyGrants)event={...event,safetyGrants:event.safetyGrants.map(grant=>expiredSessions.has(grant.id)?{...grant,status:'expired',generation:expiredSessions.get(grant.id)!}:grant)};
  const waits=event.waits??(event.wait?[event.wait]:[]);
  const approvalBoundary=event.nodeId==='lina-input-delivery'&&event.sourceNodeId==='lina-safety-approval';
  const savedWaits=approvalBoundary?(event.operations??[]).map(op=>{
   const id=`wait:approval:${op.callId}`;
   const registered=waits.find(wait=>wait.id===id);
   return registered??{id,kind:'approval' as const,callId:op.callId,batchId:op.batchId,ownerNodeId:'lina-tools-permissions',reviewedMatcher:safetyMatcher(op.accountId,op.catalogRevision)};
  }):waits;
  const launch=event.modelEvent?.type==='launch'||event.nodeId==='lina-tools-dispatch'&&event.operations?.some(op=>op.status==='running');
  const recoveryHere=!restarted&&scenario!=='fresh'&&scenario!=='duplicate-input'&&scenario!=='lost-ack'&&scenario!=='delivery-uncertain'&&(
   scenario==='parallel-recovery'?Boolean(event.results?.some(result=>result.callId==='call-002')):
   scenario==='approval-recovery'?approvalBoundary:
   scenario==='unknown-effect'?waits.some(wait=>wait.kind==='reconciliation'):launch);
  // Persist launch intent before the event that actually starts external work.
  const intentRoute=launch?route(event.nodeId,'record'):undefined;
  if(intentRoute){emit(event.nodeId,evidence('commit','requested','Stage intent without launching external work'),event.edgeId,event.sourceNodeId);const tx=`fixture-intent:${event.id}`;commitStateFixture(store,tx,tx,{operations:event.operations,model:event.modelEvent});request(intentRoute,evidence('commit','applied','Known intent commit precedes physical launch',tx,tx));}
  const observe=()=>{if(event.nodeId==='lina-execution-cancel')stopRequested=true;if(event.memorySnapshot)currentMemory=clone(event.memorySnapshot);Object.assign(progress,event.update);for(const op of event.operations??[])operations.set(op.callId,clone(op));for(const result of event.results??[])results.set(result.callId,clone(result));if(event.safetyGrants)currentGrants=clone(event.safetyGrants);};
  if(!recoveryHere||scenario==='parallel-recovery'||scenario==='approval-recovery'||scenario==='unknown-effect')observe();
  if(recoveryHere){
   if(scenario==='parallel-recovery'){output.push({...event});const r=route('lina-tools-collect','record')!;const tx=`fixture-result:${event.id}`;commitStateFixture(store,tx,tx,{results:event.results,operations:event.operations});request(r,evidence('commit','applied','Completed sibling committed before checkpoint',tx,tx));}
   if(savedWaits.length){const r=route('lina-execution-wait','record')!;const tx=`fixture-wait:${savedWaits.map(wait=>wait.id).join(':')}`;commitStateFixture(store,tx,tx,{waits:savedWaits});request(r,evidence('commit','applied','Correlated wait committed before restart',tx,tx));}
   if(scenario==='stop-recovery'){stopRequested=true;const r=route('lina-execution-cancel','record')!;const tx='fixture-stop:turn-fixture';commitStateFixture(store,tx,'stop',{requested:true});request(r,evidence('commit','applied','Persist Stop before restart',tx,'stop'));}
   if(!restart(event.nodeId,savedWaits))break;
   if(scenario==='stop-recovery'){emit('lina-execution-settle',evidence('recover','stopped','Persisted Stop withholds all fresh model and tool launches'),undefined,undefined,{update:{outcome:'cancelled'},stateRestore:{...restore(),stopRequested:true}});const r=route('lina-execution-release','record')!;const tx='fixture-stop-release';commitStateFixture(store,tx,'execution-owner',{turnId:'turn-fixture',released:true});request(r,evidence('commit','applied','Release cancelled ownership',tx,'execution-owner'));break;}
   if(scenario==='parallel-recovery')continue;
   if(scenario!=='approval-recovery'&&scenario!=='unknown-effect')observe();
  }
  output.push(waits.length?{...event,id:`state-stage:${event.id}`,wait:undefined,waits:undefined}:event);
  const ownerRoutes=STATE_REQUEST_ROUTES.filter(r=>r.source===event.nodeId&&r.returnTarget===event.nodeId);
  for(const r of ownerRoutes){
   if(r.kind==='checkpoint'){if(['lina-execution-controls','lina-execution-tool-outcomes','lina-execution-settle','lina-execution-wait'].includes(event.nodeId))checkpoint(event.nodeId,waits);continue;}
   if(launch&&r.kind==='record')continue;
   const tx=`fixture-write:${event.id}:${r.phase}`, recordId=r.phase==='claim-input'?'input-receipt':r.phase==='commit-acceptance'?'acceptance':`${r.phase}:${event.id}`;
   if(r.kind==='record'){
    const status=commitStateFixture(store,tx,recordId,{progress:clone(progress),operations:event.operations??[],results:event.results??[],waits});
    const unknown=scenario==='lost-ack'&&!lostAck&&r.phase==='claim-input';
    request(r,evidence('commit',unknown?'unknown':status,unknown?'Commit applied; acknowledgment lost. Inspect original transaction before retry':'Atomic fixture record acknowledged',tx,recordId));
    if(unknown){lostAck=true;const inspect=route(event.nodeId,'load');if(inspect)request(inspect,evidence('inspect','applied','Original transaction found; no second write identity',tx,recordId));}
   }else request(r,evidence('read','found','Return scoped fixture records to the requesting phase'));
  }
  if(waits.length)output.push(event);
  if(scenario==='duplicate-input'&&event.nodeId==='lina-input-claim'){
   emit('lina-input-duplicate',evidence('read','duplicate','Original input identity already claimed'));
   request(route('lina-input-duplicate','load')!,evidence('read','found','Return original acceptance receipt; do not start another turn',undefined,'acceptance'));break;
  }
 }
 if(scenario==='delivery-uncertain'){
  const answer={replyId:'reply-fixture',artifactRef:'artifact:reply-fixture',deliveryId:'delivery-fixture'};commitStateFixture(store,'fixture-delivery:intent','delivery',answer);
  emit('lina-input-recovery',evidence('recover','delivery-only','Execution is settled; reply delivery acknowledgment is uncertain'));
  request(route('lina-input-recovery','load')!,evidence('read','found','Load settled turn and original owed reply'));
  emit('lina-input-recovery',evidence('recover','delivery-only','Reuse saved answer and original delivery identity'),'lina-state-edge-recovery-plan','lina-state-recover');
  const edge=document.edges.find(edge=>edge.source==='lina-input-recovery'&&edge.target==='lina-input-delivery');
  emit('lina-input-delivery',evidence('inspect','unknown','Inspect original delivery; no model or tool rerun',undefined,'delivery'),edge?.id,'lina-input-recovery');
  const r=route('lina-input-delivery','load');if(r)request(r,evidence('inspect','unknown','Original delivery identity retained; absent ack is not proof of no delivery',undefined,'delivery'),{wait:{id:'wait:delivery:delivery-fixture',kind:'delivery-reconciliation',owner:'delivery',deliveryId:'delivery-fixture',ownerNodeId:'lina-input-delivery'}});
 }
 return output;
}
