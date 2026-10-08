import { SUBAGENT_STATE_ROUTES } from './subagentsBlock';
import type { LinaDocument } from './linaModel';
import type { SimulationAnswer, SimulationEvent, SimulationOperation, SimulationResult } from './inputSimulation';

export type SubagentCase = 'disabled' | 'one-child' | 'parallel' | 'capacity-queued' | 'nested' | 'depth-rejected' | 'tree-budget' | 'selected-context' | 'fork-context' | 'task-only' | 'specialist' | 'restricted-memory' | 'child-approval' | 'child-review' | 'background' | 'detached' | 'persistent-followup' | 'steer' | 'selective-join' | 'partial-failure' | 'timeout' | 'stop-cascade' | 'owner-close' | 'unknown-launch' | 'recover-siblings' | 'duplicate-event' | 'stale-event' | 'late-result' | 'delivery-retry' | 'invalid-result';
export const SUBAGENT_CASES: {value:SubagentCase;label:string}[] = [
 ['disabled','No delegation'],['one-child','One child'],['parallel','Parallel children'],['capacity-queued','Capacity queues children'],['nested','Child delegates again'],['depth-rejected','Depth limit rejects delegation'],['tree-budget','Task-tree budget exhausted'],['selected-context','Selected context handoff'],['fork-context','Transcript fork'],['task-only','Fresh task only'],['specialist','Specialist worker profile'],['restricted-memory','Child memory access restricted'],['child-approval','Child tool approval'],['child-review','Child memory publication review'],['background','Parent continues; join later'],['detached','Detached child survives parent Stop'],['persistent-followup','Persistent session follow-up'],['steer','Steer active child'],['selective-join','Join selected children'],['partial-failure','One child fails'],['timeout','Child deadline expires'],['stop-cascade','Stop cascades to descendants'],['owner-close','Detached owner closes'],['unknown-launch','Launch acknowledgement unknown'],['recover-siblings','Recover without replaying completed sibling'],['duplicate-event','Duplicate completion'],['stale-event','Stale owner completion'],['late-result','Result after cancellation'],['delivery-retry','Retry parent result delivery'],['invalid-result','Child result fails output contract'],
].map(([value,label])=>({value:value as SubagentCase,label}));
export interface SubagentSettings {
 maxDepth:number; maxConcurrent:number; maxTreeChildren:number;
 contextMode:'selected'|'fork'|'task-only'; completion:'await-result'|'return-handle';
 lifetime:'attached'|'detached'; persistent:boolean; workerProfile:'general'|'specialist';
 modelRoute:string; tools:string[]; memoryAccess:'private'|'shared-read';
}
export const DEFAULT_SUBAGENT_SETTINGS:SubagentSettings={maxDepth:3,maxConcurrent:3,maxTreeChildren:8,contextMode:'selected',completion:'await-result',lifetime:'attached',persistent:false,workerProfile:'general',modelRoute:'inherited',tools:['read','search'],memoryAccess:'private'};
export interface SubagentChildSpec {
 agentId:string;parentAgentId:string;depth:number;sessionId:string;taskId:string;
 priorResultRefs:string[];steering:string[];
 contextMode:SubagentSettings['contextMode'];workerProfile:SubagentSettings['workerProfile'];
 skillRefs?:string[];connectorBindingRefs?:string[];
 modelRoute:string;tools:string[];memoryAccess:SubagentSettings['memoryAccess'];
 context:{source:'task'|'selected-evidence'|'transcript-fork';records:string[];instructionAuthority:'worker-profile';parentPrivateMemoryIncluded:false};
 toolScenario?:'approval'|'parallel';safetyCase?:'mandatory-review'|'policy-allow';memoryCase?:'child-proposal'|'child-denied'|'child-shared';followup:boolean;
}
export interface SubagentTask extends SubagentChildSpec {
 status:'queued'|'prepared'|'running'|'waiting'|'success'|'failed'|'cancelled'|'unknown';
 parentOperationId:string;callId:string;joinCallId:string;batchId:string;launchId:string;ownerRevision:number;lifetime:SubagentSettings['lifetime'];completion:SubagentSettings['completion'];
 deadline:number;launches:number;resultId?:string;failure?:string;
}
export interface SubagentResult {id:string;taskId:string;status:'success'|'failed'|'cancelled';artifactRef:string;valid:boolean;delivery:'pending'|'delivered';deliveries:number}
export interface SubagentRequest {taskId:string;parentAgentId:string;callId:string;joinCallId:string;parentOperationId:string;batchId:string;workerProfile:SubagentSettings['workerProfile'];contextMode:SubagentSettings['contextMode'];completion:SubagentSettings['completion'];followup:boolean;admission:'requested'|'admitted'|'rejected'}
export interface SubagentFixtureState {
 storage:'fixture-only';ownerRevision:number;requests:Record<string,SubagentRequest>;tasks:Record<string,SubagentTask>;
 sessions:Record<string,{agentId:string;status:'active'|'closed';persistent:boolean;taskIds:string[];history:string[]}>;
 launches:Record<string,{taskId:string;status:'intent'|'started'|'unknown';attempts:number}>;
 joins:Record<string,{taskIds:string[];status:'waiting'|'settled';resultIds:string[]}>;
 controls:{id:string;taskId:string;kind:'steer'|'cancel'|'owner-close';accepted:boolean}[];
 results:Record<string,SubagentResult>;observations:string[];parentStatus:'running'|'continued'|'stopped';
}
export interface SubagentEvidence {phase:'validate'|'prepare'|'launch'|'coordinate'|'join'|'cancel'|'reconcile'|'return';outcome:string;reason:string;taskId?:string;agentId?:string;sessionId?:string;resultId?:string}
export function createSubagentFixtureState():SubagentFixtureState{return {storage:'fixture-only',ownerRevision:1,requests:{},tasks:{},sessions:{},launches:{},joins:{},controls:[],results:{},observations:[],parentStatus:'running'};}
/** Child observations are fenced and deduplicated before changing authoritative task state. */
export function acceptSubagentObservation(store:SubagentFixtureState,eventId:string,taskId:string,ownerRevision:number):'accepted'|'duplicate'|'stale'|'late'|'missing'{
 if(store.observations.includes(eventId))return 'duplicate';
 const task=store.tasks[taskId];if(!task)return 'missing';
 if(ownerRevision!==task.ownerRevision)return 'stale';
 if(task.status==='cancelled')return 'late';
 store.observations.push(eventId);return 'accepted';
}
export function subagentScenarioSettings(scenario:SubagentCase):Partial<SubagentSettings>{
 return {...(scenario==='capacity-queued'?{maxConcurrent:1}:{}),...(scenario==='depth-rejected'?{maxDepth:1}:{}),...(scenario==='tree-budget'?{maxTreeChildren:1}:{}),...(scenario==='fork-context'?{contextMode:'fork' as const}:{}),...(scenario==='task-only'?{contextMode:'task-only' as const}:{}),...(scenario==='specialist'?{workerProfile:'specialist' as const,modelRoute:'worker-specialist'}:{}),...(['background','detached','owner-close'].includes(scenario)?{completion:'return-handle' as const}:{}),...(['detached','owner-close'].includes(scenario)?{lifetime:'detached' as const}:{}),...(scenario==='persistent-followup'?{persistent:true}:{})};
}
const clone=<T>(value:T):T=>structuredClone(value);
/** Design fixture only. Stable launch/result identities survive replay; unknown launch is inspected,
 * never interpreted as permission to spawn a duplicate. Child runs are supplied by the real Studio compiler. */
export function withSubagents(base:SimulationEvent[],document:LinaDocument,scenario:SubagentCase='disabled',settings:Partial<SubagentSettings>={},options:{answers?:Record<string,SimulationAnswer>;seed?:SubagentFixtureState;stopped?:boolean;buildChild?:(spec:SubagentChildSpec)=>SimulationEvent[];cancelChild?:(spec:SubagentChildSpec,observed:SimulationEvent[])=>SimulationEvent[];contextRecords?:(spec:SubagentChildSpec)=>string[]}={}):SimulationEvent[]{
 if(scenario==='disabled')return base;
 const config={...DEFAULT_SUBAGENT_SETTINGS,...subagentScenarioSettings(scenario),...settings};
 const store=options.seed?clone(options.seed):createSubagentFixtureState(), output:SimulationEvent[]=[];let serial=0;
 const observed=new Map<string,SimulationEvent[]>();
 const operation=(task:SubagentTask,status:SimulationOperation['status'],join=false):SimulationOperation=>({callId:join?task.joinCallId:task.callId,batchId:task.batchId,attemptId:join?`join:${task.taskId}`:task.parentOperationId,nodeId:n('coordinate'),status,effectClass:'read',accountId:'delegation-owner',catalogRevision:7});
 const toolResult=(task:SubagentTask,status:SimulationResult['status'],join=false):SimulationResult=>({callId:join?task.joinCallId:task.callId,status,artifactRef:`artifact:${task.taskId}:output`});
 const n=(suffix:string)=>`lina-subagents-${suffix}`;
 function emit(source:string,target:string,phase:SubagentEvidence['phase'],outcome:string,reason:string,task?:SubagentTask,extra:Partial<SimulationEvent>={}){
  const edge=document.edges.find(edge=>edge.source===source&&edge.target===target);
  output.push({id:`subagents:${serial++}:${phase}:${task?.taskId??'parent'}`,nodeId:target,sourceNodeId:source,edgeId:edge?.id??`missing-subagents-edge:${source}:${target}`,update:{detail:reason},subagentEvidence:{phase,outcome,reason,taskId:task?.taskId,agentId:task?.agentId,sessionId:task?.sessionId},subagentSnapshot:clone(store),...extra});
 }
 function persist(owner:string,phase:string,task?:SubagentTask){
  const route=SUBAGENT_STATE_ROUTES.find(route=>route.source===n(owner)&&route.phase===phase);if(!route)return;
  emit(route.source,route.target,owner as SubagentEvidence['phase'],route.kind==='record'?'committed':'inspected',`${phase}: original identity retained in fixture ledger`,task);
  emit(route.target,route.returnTarget,owner as SubagentEvidence['phase'],'acknowledged',`${phase}: same owner continuation`,task);
 }
 function admit(index:number,parent='main',depth=1,followup=false):SubagentTask|undefined{
  const taskId=followup?'task:child-1:followup':`task:child-${index}`,agentId=followup?'child-1':`child-${index}`,sessionId=`session:${agentId}`;
  const previous=store.tasks[taskId];if(previous)return previous;
  store.requests??={};store.requests[taskId]={taskId,parentAgentId:parent,callId:`call:delegation:${taskId}`,joinCallId:`call:join:${taskId}`,parentOperationId:`delegation:${taskId}`,batchId:`batch:delegation:${parent}`,workerProfile:config.workerProfile,contextMode:config.contextMode,completion:config.completion,followup,admission:'requested'};
  const count=Object.keys(store.tasks).length;
  emit(parent==='main'?'lina-tools-dispatch':n('coordinate'),n('validate'),'validate','requested',`Delegation intent for ${taskId}`,undefined,{agentId:parent==='main'?undefined:parent,subagentEvidence:{phase:'validate',outcome:'requested',reason:'Original requested delegation retained before admission',taskId}});
  if(depth>config.maxDepth||count>=config.maxTreeChildren){
   const request=store.requests[taskId];request.admission='rejected';
   const reason=depth>config.maxDepth?'Configured recursion depth exceeded':'Total task-tree admission budget exhausted';
   emit(n('validate'),n('return'),'return','rejected',reason,undefined,{agentId:parent==='main'?undefined:parent,subagentEvidence:{phase:'return',outcome:'rejected',reason,taskId},operations:[{callId:request.callId,batchId:request.batchId,attemptId:request.parentOperationId,nodeId:n('return'),status:'denied',effectClass:'read',accountId:'delegation-owner',catalogRevision:7}],results:[{callId:request.callId,status:'denied',artifactRef:`artifact:${taskId}:admission-refusal`}]});
   emit(n('return'),'lina-tools-collect','return','refusal-returned','Exact requesting parent receives failed admission; no child allocated');return;
  }
  const task:SubagentTask={agentId,parentAgentId:parent,depth,sessionId,taskId,priorResultRefs:followup?store.sessions[sessionId]?.history.filter(id=>id.startsWith('result:'))??[]:[],steering:[],contextMode:config.contextMode,workerProfile:config.workerProfile,skillRefs:config.workerProfile==='specialist'?['skill:fixture-source-review:v1']:[],connectorBindingRefs:config.workerProfile==='specialist'?['binding:fixture-docs:read']:[],modelRoute:config.modelRoute,tools:[...config.tools],memoryAccess:config.memoryAccess,context:{source:config.contextMode==='fork'?'transcript-fork':config.contextMode==='selected'?'selected-evidence':'task',records:config.contextMode==='task-only'?['delegated-task']:config.contextMode==='fork'?['delegated-task','parent:user-message','parent:tool-observation']:['delegated-task','selected:source-evidence'],instructionAuthority:'worker-profile',parentPrivateMemoryIncluded:false},followup,status:'prepared',parentOperationId:`delegation:${taskId}`,callId:`call:delegation:${taskId}`,joinCallId:`call:join:${taskId}`,batchId:`batch:delegation:${parent}`,launchId:`launch:${taskId}`,ownerRevision:store.ownerRevision,lifetime:config.lifetime,completion:config.completion,deadline:50,launches:0,...(scenario==='child-approval'?{toolScenario:'approval' as const,safetyCase:'mandatory-review' as const}:{}),...(scenario==='child-review'?{memoryCase:'child-proposal' as const,toolScenario:'parallel' as const}:scenario==='restricted-memory'?{memoryCase:'child-denied' as const}:config.memoryAccess==='shared-read'?{memoryCase:'child-shared' as const}:{})};
  store.tasks[taskId]=task;store.requests[taskId].admission='admitted';
  const admission={operationId:task.parentOperationId,phase:'admission' as const,decision:'allow' as const,reason:'Fixture policy admits exact inherited worker scopes',argumentDigest:JSON.stringify({taskId,tools:task.tools,modelRoute:task.modelRoute,memoryAccess:task.memoryAccess,lifetime:task.lifetime}),policyRevision:1};
  emit(n('validate'),'lina-safety-evaluate','validate','scope-review','Evaluate exact delegation task/profile/tools/model/memory/owner scopes',task,{safetyEvidence:{...admission,phase:'evaluate'}});
  emit('lina-safety-authorize',n('validate'),'validate','scope-allowed','Original delegation admission returned; child grants remain independent',task,{safetyEvidence:admission});
  persist('validate','reserve-delegation-capacity',task);
  const session=store.sessions[sessionId]??{agentId,status:'active' as const,persistent:config.persistent,taskIds:[],history:[]};session.taskIds.push(taskId);store.sessions[sessionId]=session;
  if(options.contextRecords)task.context.records=[...options.contextRecords(task)];
  emit(n('validate'),n('prepare'),'prepare','prepared','Explicit worker profile owns instructions; inherited transcript is task data and grants no access',task);
  persist('prepare','record-immutable-child-packet',task);
  return task;
 }
 function recordResult(task:SubagentTask,status:SubagentResult['status'],valid=true){
  const resultId=`result:${task.taskId}`;
  if(store.results[resultId])return;
  task.status=status==='success'?'success':status==='failed'?'failed':'cancelled';task.resultId=resultId;
  store.results[resultId]={id:resultId,taskId:task.taskId,status,artifactRef:`artifact:${task.taskId}:output`,valid,delivery:'pending',deliveries:0};
  store.sessions[task.sessionId].history.push(resultId);if(!config.persistent)store.sessions[task.sessionId].status='closed';
  persist('coordinate','record-child-lifecycle-event',task);
  emit(n('coordinate'),n('join'),'join',status,'Child outcome stored independently; successful siblings remain available',task);
 }
 function cancel(task:SubagentTask,reason:string){
  if(['success','failed','cancelled'].includes(task.status))return;
  store.controls.push({id:`cancel:${task.taskId}`,taskId:task.taskId,kind:'cancel',accepted:true});
  emit(n('coordinate'),n('cancel'),'cancel','requested',reason,task);
  persist('cancel','record-child-cancel-intent',task);
  const cancelled=options.cancelChild?.(task,observed.get(task.taskId)??[])??[];
  for(const event of cancelled)output.push({...event,agentId:task.agentId,parentAgentId:task.parentAgentId,agentDepth:task.depth,subagentSnapshot:clone(store)});
  if(cancelled.some(event=>event.wait||event.waits?.length)){task.status='waiting';emit(n('cancel'),n('reconcile'),'reconcile','cancel-unresolved','Child cancellation retains underlying pending effect or local settlement wait',task);return;}
  if(task.status==='unknown'){emit(n('cancel'),n('reconcile'),'reconcile','unknown','Cancellation request cannot establish whether uncertain child launch ran',task);const id=`subagents:cancel:${task.taskId}`,answer=options.answers?.[id];if(answer==='known-success'||answer==='known-no-effect'){recordResult(task,answer==='known-success'?'success':'cancelled');emit(n('reconcile'),n('coordinate'),'coordinate','settled','Matched evidence establishes original child outcome; no replay',task,{id,resumeWait:true});return;}emit(n('reconcile'),'lina-execution-wait','reconcile','waiting','Retain original uncertain child ownership until evidence is available',task,{id,wait:{id,kind:'subagent',owner:'subagents',taskId:task.taskId,ownerNodeId:n('reconcile')}});return;}
  store.sessions[task.sessionId].status='closed';
  recordResult(task,'cancelled');emit(n('cancel'),n('coordinate'),'coordinate','cancelled','Descendant cancellation is explicit; completed results are retained',task,{agentId:task.parentAgentId==='main'?undefined:task.parentAgentId,operations:[operation(task,'cancelled',task.completion==='return-handle')],results:[toolResult(task,'cancelled',task.completion==='return-handle')]});
 }
 if(options.stopped){
  store.parentStatus='stopped';
  for(const task of Object.values(store.tasks)){
   if(task.lifetime==='attached'||scenario==='owner-close')cancel(task,'Parent Stop closes attached task ownership');
   else if(!['success','failed','cancelled'].includes(task.status)){
    emit(n('coordinate'),n('return'),'return','detached-running','Parent stops while configured detached owner retains task',task);
    for(const event of childEvents(task)){output.push({...event,subagentSnapshot:clone(store)});observed.set(task.taskId,[...(observed.get(task.taskId)??[]),event]);if(event.wait||event.waits?.length){task.status='waiting';break;}}
    complete(task);
    if(task.resultId)emit(n('coordinate'),n('return'),'return','retained-after-parent-stop','Detached child result retained for later inspection; ended parent is not resumed',task);
   }
  }
  return [...output,...base];
 }
 const dispatchIndex=base.findIndex(event=>event.nodeId==='lina-tools-dispatch');
 const parentStart=dispatchIndex>=0?dispatchIndex+1:base.findIndex(event=>event.nodeId==='lina-execution-settle');
 const split=parentStart<0?base.length:parentStart;
 output.push(...base.slice(0,split));
 const tasks:SubagentTask[]=[];
 const first=admit(1);if(first)tasks.push(first);
 if(['parallel','capacity-queued','selective-join','partial-failure','recover-siblings'].includes(scenario)){const second=admit(2);if(second)tasks.push(second);}
 const parentTail=config.completion==='return-handle'?base.slice(split).filter(event=>!['lina-execution-settle','lina-execution-release','lina-input-delivery'].includes(event.nodeId)):[];
 let parentTailIndex=0,nestedAttempted=false;
 function launch(task:SubagentTask){
  if(['success','failed','cancelled'].includes(task.status))return;
  if(task.status==='running')return;
  store.launches[task.launchId]??={taskId:task.taskId,status:'intent',attempts:0};
  emit(n('prepare'),n('launch'),'launch','intent-staged','Stable task/session/launch identity staged before starting child',task);
  persist('launch','record-child-launch-intent',task);
  if(scenario==='unknown-launch'){
   persist('launch','inspect-original-child-launch',task);
   task.status='unknown';store.launches[task.launchId].status='unknown';
   emit(n('launch'),n('reconcile'),'reconcile','unknown','Lost launch acknowledgment requires inspection of original child identity',task);
   const id=`subagents:launch:${task.taskId}`,answer=options.answers?.[id];
   if(!answer||answer==='stale'){
    emit(n('reconcile'),'lina-execution-wait','reconcile','waiting','No evidence permits another launch',task,{id,wait:{id,kind:'subagent',owner:'subagents',taskId:task.taskId,ownerNodeId:n('reconcile')}});return;
   }
   if(answer==='known-no-effect'){task.status='failed';task.failure='Launch known not started';recordResult(task,'failed');emit(n('reconcile'),n('coordinate'),'coordinate','not-started','No automatic respawn; return failed launch to parent',task,{id,resumeWait:true});return;}
   if(answer!=='known-success')return;
   emit(n('reconcile'),n('coordinate'),'coordinate','found-running','Inspect proves original child exists; attach without new launch',task,{id,resumeWait:true});
  }
  const launchAdmission={operationId:task.launchId,phase:'dispatch' as const,decision:'allow' as const,reason:'Fixture launch rechecks exact task packet and owner revision',argumentDigest:JSON.stringify({launchId:task.launchId,ownerRevision:task.ownerRevision,tools:task.tools}),policyRevision:1};
  emit(n('launch'),'lina-safety-authorize','launch','recheck','Recheck admitted launch under current owner fence before child starts',task,{safetyEvidence:launchAdmission});
  emit('lina-safety-authorize',n('launch'),'launch','allowed','Exact original launch scope returned; no grant is copied into child',task,{safetyEvidence:launchAdmission});
  task.status='running';task.launches=1;store.launches[task.launchId]={taskId:task.taskId,status:'started',attempts:1};
  emit(n('launch'),n('coordinate'),'coordinate','running','Child has its own model attempts, tools, Context and Memory',task,{agentId:task.parentAgentId==='main'?undefined:task.parentAgentId,operations:[operation(task,'running')]});
  if(config.completion==='return-handle'){store.parentStatus='continued';emit(n('coordinate'),n('return'),'return','handle','Accepted original child handle permits parent continuation; completion remains pending',task);emit(n('return'),'lina-tools-collect','return','handle-returned','Handle returns to exact delegation call; child outcome is not implied',task,{agentId:task.parentAgentId==='main'?undefined:task.parentAgentId,operations:[operation(task,'success')],results:[{...toolResult(task,'success'),artifactRef:`artifact:${task.taskId}:handle`}]});}
  if(scenario==='detached'){store.parentStatus='stopped';output.push({id:'subagents:parent-stop',nodeId:'lina-execution-cancel',sourceNodeId:'lina-execution-controls',edgeId:'lina-execution-edge-controls-cancel',update:{outcome:'cancelled',detail:'Parent Stop; detached child retains explicit owner'},subagentSnapshot:clone(store)});}
 }
 function childEvents(task:SubagentTask):SimulationEvent[]{
  let events=options.buildChild?.(task)??[];
  if(['timeout','stop-cascade','late-result','owner-close'].includes(scenario)){const delegate=scenario==='stop-cascade'&&task.agentId==='child-1'?events.findIndex(event=>event.nodeId==='lina-tools-dispatch'):-1,invoke=delegate>=0?delegate:events.findIndex(event=>event.modelEvent?.type==='launch'||event.nodeId==='lina-model-invoke');events=events.slice(0,invoke>=0?invoke+1:Math.max(1,Math.floor(events.length/2)));}

  return events.map(event=>({...event,agentId:task.agentId,parentAgentId:task.parentAgentId,agentDepth:task.depth,subagentSnapshot:clone(store)}));
 }
 function complete(task:SubagentTask){
  if(task.status==='waiting'||task.status==='unknown')return;
  if(['timeout','stop-cascade','late-result','owner-close'].includes(scenario)){
   if(scenario==='timeout'){task.failure='Configured deadline reached';cancel(task,'Child deadline expires; cancel in-flight work');}
   else {store.parentStatus='stopped';if(scenario==='owner-close'){store.controls.push({id:`owner-close:${task.taskId}`,taskId:task.taskId,kind:'owner-close',accepted:true});store.ownerRevision++;task.ownerRevision=store.ownerRevision;}cancel(task,scenario==='owner-close'?'Detached owner explicitly closes':'Stop cascades through attached descendants');}
   if(scenario==='late-result'){const ignored=acceptSubagentObservation(store,`completion:${task.taskId}`,task.taskId,task.ownerRevision);emit(n('coordinate'),n('reconcile'),'reconcile',ignored==='late'?'late-result-ignored':'completion-ignored','Late completion cannot reopen terminal cancellation',task);}
   return;
  }
  const terminal=observed.get(task.taskId)?.filter(event=>event.update.outcome).at(-1)?.update.outcome;
  if(!terminal){task.status='unknown';emit(n('coordinate'),n('reconcile'),'reconcile','missing-terminal','No child terminal evidence; do not manufacture a completed result',task);return;}
  const observation=acceptSubagentObservation(store,`completion:${task.taskId}`,task.taskId,task.ownerRevision);if(observation!=='accepted')return;
  const failed=terminal==='failed'||terminal==='exhausted'||scenario==='partial-failure'&&task.agentId==='child-2';
  recordResult(task,terminal==='cancelled'?'cancelled':failed?'failed':'success',scenario!=='invalid-result');
  if(scenario==='invalid-result'){task.failure='Output schema mismatch';store.results[task.resultId!].status='failed';task.status='failed';emit(n('join'),n('return'),'return','invalid-result','Invalid output retained as failure evidence; never promoted to success',task);}
 }
 if(scenario==='recover-siblings'&&first){recordResult(first,'success');first.launches=1;store.launches[first.launchId]={taskId:first.taskId,status:'started',attempts:1};store.ownerRevision++;emit(n('coordinate'),n('reconcile'),'reconcile','restored','Completed sibling reused; only unfinished original task can resume',first);}
 for(let start=0;start<tasks.length;start+=Math.max(1,config.maxConcurrent)){
  const wave=tasks.slice(start,start+Math.max(1,config.maxConcurrent));
  for(const queued of tasks.slice(start+Math.max(1,config.maxConcurrent))){if(queued.status==='prepared'){queued.status='queued';emit(n('prepare'),n('coordinate'),'coordinate','queued','Concurrency bound queues child without allocating a launch',queued);}}
  for(const task of wave)launch(task);
  if(scenario==='steer'&&first&&!first.steering.length)first.steering.push('Focus on source evidence');
  const runs=wave.filter(task=>task.status==='running').map(task=>({task,events:childEvents(task),index:0,waiting:false}));
  if(scenario==='steer'&&first){store.controls.push({id:'control:steer:1',taskId:first.taskId,kind:'steer',accepted:true});store.sessions[first.sessionId].history.push('steering:focus-on-source');emit(n('coordinate'),'lina-execution-controls','coordinate','steered','Steering enters the addressed child task; sibling configuration unchanged',first);}
  // Round-robin ordering is a visualization schedule, not an assertion of physical event order.
  while(runs.some(run=>!run.waiting&&run.index<run.events.length))for(const run of runs){
   if(run.waiting||run.index>=run.events.length)continue;
   const original=run.events[run.index++],remaining=original.waits?.filter(wait=>!options.answers?.[wait.id]),event={...original,wait:original.wait&&!options.answers?.[original.wait.id]?original.wait:undefined,...(original.waits?{waits:remaining}:{}),subagentSnapshot:clone(store)};output.push(event);observed.set(run.task.taskId,[...(observed.get(run.task.taskId)??[]),event]);
   if(parentTailIndex<parentTail.length)output.push(parentTail[parentTailIndex++]);
   if(run.task.agentId==='child-1'&&!nestedAttempted&&['nested','depth-rejected','tree-budget','stop-cascade'].includes(scenario)&&(event.nodeId==='lina-tools-dispatch'||event.nodeId==='lina-execution-controls'&&!run.events.some(event=>event.nodeId==='lina-tools-dispatch'))){nestedAttempted=true;const descendant=admit(2,'child-1',2);if(descendant){tasks.push(descendant);launch(descendant);runs.push({task:descendant,events:childEvents(descendant),index:0,waiting:false});}}
   if(event.update.outcome)complete(run.task);
   if(event.wait||event.waits?.length){run.waiting=true;run.task.status='waiting';emit(n('coordinate'),n('return'),'return','child-waiting','Wait remains owned by its child; parent cannot answer a different child prompt',run.task);}
  }
  for(const {task} of runs)complete(task);
 }
 if(scenario==='persistent-followup'&&first?.status==='success'){
  const task=admit(1,'main',1,true)!;tasks.push(task);persist('prepare','read-persistent-child-session',task);launch(task);for(const event of childEvents(task)){output.push(event);observed.set(task.taskId,[...(observed.get(task.taskId)??[]),event]);if(event.wait||event.waits?.length){task.status='waiting';break;}}complete(task);
 }
 if(scenario==='duplicate-event'||scenario==='stale-event'){
  const task=tasks[0];if(task){const outcome=acceptSubagentObservation(store,scenario==='duplicate-event'?`completion:${task.taskId}`:`old-owner:${task.taskId}`,task.taskId,scenario==='stale-event'?task.ownerRevision-1:task.ownerRevision);emit(n('coordinate'),n('reconcile'),'reconcile',outcome,scenario==='duplicate-event'?'Same result identity acknowledged without second insertion':'Old owner fence cannot replace current result or task state',task);}
 }
 const selected=scenario==='selective-join'?tasks.slice(0,1):tasks;
 const settled=selected.every(task=>['success','failed','cancelled'].includes(task.status));
 store.joins['join:parent']={taskIds:selected.map(task=>task.taskId),status:settled?'settled':'waiting',resultIds:selected.flatMap(task=>task.resultId?[task.resultId]:[])};
 persist('join','record-child-join-set');
 emit(n('coordinate'),n('join'),'join',settled?'settled':'waiting',scenario==='selective-join'?'Join requested subset; other handles remain independently inspectable':'Retain each required child status and bounded result separately');
 if(settled){
  for(const task of selected){const result=task.resultId?store.results[task.resultId]:undefined;if(!result)continue;
   if(scenario==='delivery-retry'){result.deliveries=1;emit(n('join'),n('return'),'return','delivery-unacknowledged','Result retained under original identity; retry transport without rerunning child',task);}
   result.delivery='delivered';result.deliveries++;persist('return','record-parent-result-delivery',task);emit(n('join'),n('return'),'return',result.status,'Return exact parent request identity with bounded result and artifact reference',task,{agentId:task.parentAgentId==='main'?undefined:task.parentAgentId,operations:[operation(task,result.status==='failed'?'error':result.status==='cancelled'?'cancelled':'success',task.completion==='return-handle')],results:[toolResult(task,result.status==='failed'?'error':result.status==='cancelled'?'cancelled':'success',task.completion==='return-handle')]});
  }
  emit(n('return'),'lina-tools-collect','return','returned','Delegation result returns through the tool boundary');
 }
 if(settled){if(config.completion==='await-result')output.push(...base.slice(split));else {output.push(...parentTail.slice(parentTailIndex));if(store.parentStatus!=='stopped')output.push(...base.slice(split).filter(event=>['lina-execution-settle','lina-execution-release','lina-input-delivery'].includes(event.nodeId)));}}
 return output;
}
