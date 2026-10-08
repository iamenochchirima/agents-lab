import type { LinaDocument } from './linaModel';
import type { SimulationAnswer, SimulationEvent } from './inputSimulation';

export type PlanningCase = 'disabled'|'sequential'|'parallel'|'delegation'|'plan-only'|'review-before-execution'|'insufficient-evidence'|'failed-prerequisite'|'replan'|'user-change'|'invalid-reference'|'cycle'|'duplicate-update'|'conflict'|'unknown-ack'|'compaction'|'recovery'|'budget'|'stop-uncertain'|'partial'|'child-local';
export const PLANNING_CASES:{value:PlanningCase;label:string}[] = [
 ['disabled','Direct loop'],['sequential','Sequential dependencies'],['parallel','Independent ready work'],['delegation','Bind delegated work'],['plan-only','Plan only'],['review-before-execution','Review before execution'],['insufficient-evidence','Completion lacks evidence'],['failed-prerequisite','Failed prerequisite'],['replan','Revise after observation'],['user-change','User changes scope'],['invalid-reference','Missing dependency'],['cycle','Dependency cycle'],['duplicate-update','Duplicate plan update'],['conflict','Revision conflict'],['unknown-ack','Unknown write acknowledgement'],['compaction','Reload after compaction'],['recovery','Recover accepted work'],['budget','Replanning budget reached'],['stop-uncertain','Stop with unresolved work'],['partial','Partial result'],['child-local','Child owns local plan'],
].map(([value,label])=>({value:value as PlanningCase,label}));
export interface PlanningSettings {strategy:'direct'|'model-led'|'authored-workflow';executionMode:'execute'|'plan-only'|'review-before-execution';maxReplans:number;maxReady:number}
export const DEFAULT_PLANNING_SETTINGS:PlanningSettings={strategy:'model-led',executionMode:'execute',maxReplans:2,maxReady:3};
export type PlanningTaskStatus='pending'|'running'|'blocked'|'completed'|'failed'|'cancelled'|'superseded';
export interface PlanningTask {
 id:string;title:string;dependencies:string[];required:boolean;status:PlanningTaskStatus;
 acceptance:{criterionId:string;description:string;method:'model-assertion'|'tool-result'|'child-result';requiredRefs:number}[];
 evidence:{criterionId:string;sourceRef:string;method:'model-assertion'|'tool-result'|'child-result';verdict:'accepted'|'failed'|'uncertain'}[];
 bindings:{kind:'tool'|'child'|'model';operationId:string;callId?:string;taskId?:string;agentId:string;planRevision?:number;taskAttemptId?:string;status:'running'|'completed'|'failed'|'unknown'}[];
}
export interface PlanningFixtureState {
 storage:'fixture-only';scope:{workspaceId:string;conversationId:string;branchId:string;agentId:string};
 goalId:string;planId:string;revision:number;tasks:Record<string,PlanningTask>;
 transactions:Record<string,{fingerprint:string;revision:number}>;replans:number;approved:boolean;
 goalStatus:'open'|'complete'|'planned'|'partial'|'blocked'|'failed'|'cancelled';
 projection?:{revision:number;taskIds:string[];sourceRef:string};pendingUpdate?:PlanningUpdate;
}
export interface PlanningUpdate {operationId:string;expectedRevision:number;scope:PlanningFixtureState['scope'];tasks:PlanningTask[];reason:string}
export interface PlanningEvidence {phase:'policy'|'load'|'update'|'ready'|'bind'|'review'|'replan'|'complete';outcome:string;reason:string;planId:string;revision:number;operationId?:string;taskIds?:string[];verification?:'model-assertion'|'fixture-check';sourceKind?:'model-assertion'|'tool-result'|'child-result';independentlyVerified?:false}
const clone=<T>(value:T):T=>structuredClone(value);
export function createPlanningFixtureState(agentId='main'):PlanningFixtureState {
 return {storage:'fixture-only',scope:{workspaceId:'fixture-workspace',conversationId:'fixture-conversation',branchId:'main',agentId},goalId:`goal:${agentId}`,planId:`plan:${agentId}`,revision:0,tasks:{},transactions:{},replans:0,approved:false,goalStatus:'open'};
}
/** Validate the complete candidate graph before changing any canonical state. */
export function validatePlanningTasks(tasks:PlanningTask[]):string|undefined {
 const rows=new Map(tasks.map(task=>[task.id,task]));
 if(rows.size!==tasks.length)return 'duplicate-task';
 for(const task of tasks){
  if(!task.id||!task.title||!task.acceptance.length)return 'missing-task-contract';
  if(task.required&&task.status==='superseded')return 'required-task-retired';
  if(new Set(task.dependencies).size!==task.dependencies.length)return 'duplicate-dependency';
  if(task.dependencies.some(id=>!rows.has(id)))return 'missing-dependency';
  if(task.dependencies.includes(task.id))return 'self-dependency';
  if(new Set(task.acceptance.map(row=>row.criterionId)).size!==task.acceptance.length||task.acceptance.some(row=>row.requiredRefs<1))return 'invalid-acceptance';
  if(task.evidence.some(row=>!task.acceptance.some(criterion=>criterion.criterionId===row.criterionId&&criterion.method===row.method)))return 'unmatched-evidence';
 }
 const active=new Set<string>(),done=new Set<string>();
 function visit(id:string):boolean {if(active.has(id))return false;if(done.has(id))return true;active.add(id);for(const dependency of rows.get(id)!.dependencies)if(!visit(dependency))return false;active.delete(id);done.add(id);return true;}
 return tasks.some(task=>!visit(task.id))?'cycle':undefined;
}
/** Conditional fixture transaction: replay of the same command is idempotent; a reused ID
 * with different content conflicts. Expected revision is checked before the atomic replacement. */
export function applyPlanningUpdate(store:PlanningFixtureState,command:PlanningUpdate):'applied'|'duplicate'|'conflict'|'invalid'|'wrong-scope' {
 if(JSON.stringify(store.scope)!==JSON.stringify(command.scope))return 'wrong-scope';
 const fingerprint=JSON.stringify(command),previous=store.transactions[command.operationId];
 if(previous)return previous.fingerprint===fingerprint?'duplicate':'conflict';
 if(store.revision!==command.expectedRevision)return 'conflict';
 if(validatePlanningTasks(command.tasks))return 'invalid';
 // A replan must retain accepted work/evidence explicitly; it cannot erase an unresolved effect.
 for(const old of Object.values(store.tasks)){
  const next=command.tasks.find(task=>task.id===old.id);
  for(const binding of old.bindings.filter(binding=>binding.status==='running'||binding.status==='unknown'))if(!next?.bindings.some(candidate=>JSON.stringify(candidate)===JSON.stringify(binding)))return 'invalid';
  if(old.status==='completed'&&(!next||next.status!=='completed'||old.evidence.some(row=>!next.evidence.some(candidate=>JSON.stringify(candidate)===JSON.stringify(row)))))return 'invalid';
 }
 store.tasks=Object.fromEntries(command.tasks.map(task=>[task.id,clone(task)]));store.revision++;
 store.transactions[command.operationId]={fingerprint,revision:store.revision};store.projection=undefined;return 'applied';
}
export function selectPlanningReady(store:PlanningFixtureState,maxReady=3):{ready:string[];blocked:string[]} {
 const pending=Object.values(store.tasks).filter(task=>task.status==='pending');
 const accepted=(id:string)=>{const row=store.tasks[id];return row?.status==='completed'&&row.acceptance.every(criterion=>new Set(row.evidence.filter(evidence=>evidence.criterionId===criterion.criterionId&&evidence.method===criterion.method&&evidence.verdict==='accepted').map(evidence=>evidence.sourceRef)).size>=criterion.requiredRefs)&&row.bindings.every(binding=>binding.status==='completed');};
 return {ready:pending.filter(task=>task.dependencies.every(accepted)).slice(0,Math.max(0,Math.floor(maxReady))).map(task=>task.id),blocked:pending.filter(task=>task.dependencies.some(id=>!accepted(id))).map(task=>task.id)};
}
/** Evidence is correlated to the task's admitted binding. A successful handle is not a
 * successful child result, and an assertion is labelled rather than independently verified. */
export function reviewPlanningTask(store:PlanningFixtureState,taskId:string,observation:{operationId:string;sourceRef:string;method:PlanningTask['acceptance'][number]['method'];status:'success'|'failed'|'unknown'}):'accepted'|'insufficient'|'failed'|'uncertain'|'unmatched' {
 const task=store.tasks[taskId],binding=task?.bindings.find(row=>row.operationId===observation.operationId);
 if(!task||!binding||!observation.sourceRef)return 'unmatched';
 if(observation.status==='unknown'){binding.status='unknown';return 'uncertain';}
 if(observation.status==='failed'){binding.status='failed';task.status='failed';return 'failed';}
 binding.status='completed';
 for(const criterion of task.acceptance.filter(row=>row.method===observation.method))if(!task.evidence.some(row=>row.criterionId===criterion.criterionId&&row.sourceRef===observation.sourceRef))task.evidence.push({criterionId:criterion.criterionId,sourceRef:observation.sourceRef,method:observation.method,verdict:'accepted'});
 const enough=task.acceptance.every(criterion=>new Set(task.evidence.filter(row=>row.criterionId===criterion.criterionId&&row.method===criterion.method&&row.verdict==='accepted').map(row=>row.sourceRef)).size>=criterion.requiredRefs);
 if(enough){task.status='completed';return 'accepted';}task.status='blocked';return 'insufficient';
}
export function assessPlanningCompletion(store:PlanningFixtureState):PlanningFixtureState['goalStatus'] {
 const tasks=Object.values(store.tasks),required=tasks.filter(task=>task.required);
 if(!required.length)return 'blocked';
 if(tasks.some(task=>task.bindings.some(binding=>binding.status==='unknown'||binding.status==='running')))return 'blocked';
 if(required.every(task=>task.status==='completed'&&task.acceptance.every(criterion=>new Set(task.evidence.filter(row=>row.criterionId===criterion.criterionId&&row.verdict==='accepted'&&row.method===criterion.method).map(row=>row.sourceRef)).size>=criterion.requiredRefs)))return 'complete';
 if(required.some(task=>task.status==='completed'))return 'partial';
 if(required.some(task=>task.status==='failed'))return 'failed';
 return 'blocked';
}
export function planningScenarioSettings(scenario:PlanningCase):Partial<PlanningSettings> {
 return scenario==='disabled'?{strategy:'direct'}:scenario==='plan-only'?{executionMode:'plan-only'}:scenario==='review-before-execution'?{executionMode:'review-before-execution'}:scenario==='budget'?{maxReplans:0}:{};
}
export function planningTaskProjection(store:PlanningFixtureState,maxTasks=8) {
 const taskIds=Object.values(store.tasks).filter(task=>task.status!=='superseded').slice(0,maxTasks).map(task=>task.id);
 return {revision:store.revision,taskIds,sourceRef:`${store.planId}:revision:${store.revision}`};
}
/** Task state is user-level evidence, never new system/developer instructions. */
export function planningModelRequest(event:SimulationEvent,store:PlanningFixtureState):SimulationEvent {
 if(!event.modelRequest)return event;
 const request=clone(event.modelRequest),text=JSON.stringify({type:'scoped-task-plan',scope:store.scope,goalId:store.goalId,planId:store.planId,...planningTaskProjection(store),tasks:Object.values(store.tasks).slice(0,8).map(row=>({id:row.id,title:row.title,status:row.status,dependencies:row.dependencies,evidence:row.evidence})),authority:'task-data'});
 request.manifest.inputTokens+=Math.ceil(text.length/4);
 request.manifest.transformations.push('Scoped task plan; character-based fixture token estimate, not measured provider usage');
 const body=request.wireBody;
 if(request.binding.protocol==='openai-chat')body.messages=[...(body.messages as unknown[]),{role:'user',content:text}];
 else if(request.binding.protocol==='openai-responses')body.input=[...(body.input as unknown[]),{role:'user',content:[{type:'input_text',text}]}];
 else if(request.binding.protocol==='anthropic-messages')body.messages=[...(body.messages as unknown[]),{role:'user',content:[{type:'text',text}]}];
 else body.contents=[...(body.contents as unknown[]),{role:'user',parts:[{text}]}];
 return {...event,modelRequest:request};
}
const task=(id:string,dependencies:string[]=[],method:PlanningTask['acceptance'][number]['method']='model-assertion'):PlanningTask=>({id,title:id==='work'?'Produce the requested result':id==='check'?'Check the result against the goal':'Independent evidence review',dependencies,required:true,status:'pending',acceptance:[{criterionId:`criterion:${id}`,description:'Declared fixture acceptance criterion',method,requiredRefs:1}],evidence:[],bindings:[]});

/** A deterministic design compiler, not a live planner or task scheduler. Existing model,
 * tool and child events retain their identities and supply all execution observations. */
export function withPlanning(base:SimulationEvent[],document:LinaDocument,scenario:PlanningCase='disabled',settings:Partial<PlanningSettings>={},options:{seed?:PlanningFixtureState;answers?:Record<string,SimulationAnswer>;stopped?:boolean;childAgentId?:string}={}):SimulationEvent[] {
 if(scenario==='disabled')return base;
 const config={...DEFAULT_PLANNING_SETTINGS,...planningScenarioSettings(scenario),...settings};
 const store=options.seed?clone(options.seed):createPlanningFixtureState(options.childAgentId??'main');
 const output:SimulationEvent[]=[],n=(suffix:string)=>`lina-planning-${suffix}`;let serial=0,started=false,reviewed=false,replanned=false,pendingRevision=false;
 const owned=(event:SimulationEvent)=>(event.agentId??options.childAgentId??'main')===store.scope.agentId;
 function emit(source:string,target:string,phase:PlanningEvidence['phase'],outcome:string,reason:string,extra:Partial<SimulationEvent>={}) {
  const edge=document.edges.find(row=>row.source===source&&row.target===target);
  output.push({id:`planning:${store.scope.agentId}:${serial++}:${phase}`,nodeId:target,sourceNodeId:source,edgeId:edge?.id??`missing-planning-edge:${source}:${target}`,agentId:options.childAgentId,update:{detail:reason},planningSnapshot:clone(store),planningEvidence:{phase,outcome,reason,planId:store.planId,revision:store.revision},...extra});
 }
 function persist(owner:string,inspect=false) {
  const target=inspect?'lina-state-load':'lina-state-record',requestId=`planning-state:${store.planId}:${owner}:${store.revision}`;
  const evidence={phase:owner as PlanningEvidence['phase'],outcome:inspect?'inspected':store.pendingUpdate&&owner==='update'?'intent-recorded':'committed',reason:`${requestId}: exact plan scope and revision retained`,planId:store.planId,revision:store.revision,operationId:requestId};
  emit(n(owner),target,owner as PlanningEvidence['phase'],evidence.outcome,evidence.reason,{planningEvidence:evidence});
  emit(target,n(owner),owner as PlanningEvidence['phase'],'acknowledged',`${requestId}: return to same requesting owner`);
 }
 function update(tasks:PlanningTask[],reason:string,id=`plan-update:${store.planId}:${store.revision}`,defer=false) {
  const command:PlanningUpdate={operationId:id,expectedRevision:store.revision,scope:clone(store.scope),tasks:clone(tasks),reason};
  if(scenario==='conflict'&&store.revision===0)command.expectedRevision=7;
  const outcome=defer?'unknown':applyPlanningUpdate(store,command);emit(n('load'),n('update'),'update',outcome,reason,{planningEvidence:{phase:'update',outcome,reason,planId:store.planId,revision:store.revision,operationId:id}});
  if(outcome==='applied'){persist('update');if(scenario==='duplicate-update'){const duplicate=applyPlanningUpdate(store,command);emit(n('update'),'lina-state-record','update',duplicate,'Identical original mutation returns prior revision');emit('lina-state-record',n('update'),'update',duplicate,'No extra revision committed');}}
  return command;
 }
 function readiness() {
  const selected=selectPlanningReady(store,config.maxReady);
  emit(n('update'),n('ready'),'ready',selected.ready.length?'ready':'blocked','Resolve explicit dependencies; selection grants no execution authority',{planningEvidence:{phase:'ready',outcome:selected.ready.length?'ready':'blocked',reason:'Ready set is bounded by configured capacity',planId:store.planId,revision:store.revision,taskIds:selected.ready}});
  return selected.ready;
 }
 function start(source:string):boolean {
  started=true;emit(source,n('policy'),'policy',config.strategy==='direct'?'bypass':config.executionMode,`${config.strategy}: plan choice is distinct from action authorization`);
  if(config.strategy==='direct'){emit(n('policy'),'lina-execution-prepare','policy','bypass','Continue ordinary model/tool loop');return true;}
  emit(n('policy'),n('load'),'load',store.revision?'found':'absent','Exact workspace/conversation/branch/agent plan scope');persist('load',true);
  if(!store.revision){
   const method=scenario==='delegation'?'child-result':base.some(event=>owned(event)&&(event.results?.length??0)>0)?'tool-result':'model-assertion';
   const tasks=[task('work',[],method),task('check',scenario==='parallel'?[]:['work'],scenario==='parallel'?method:'model-assertion')];
   if(scenario==='invalid-reference')tasks[1].dependencies=['missing'];if(scenario==='cycle')tasks[0].dependencies=['check'];
   if(scenario==='recovery'){
    const previousResult=base.flatMap(event=>owned(event)?event.results??[]:[]).find(result=>result.status==='success');
    if(previousResult){tasks[0].status='completed';tasks[0].evidence=[{criterionId:'criterion:work',sourceRef:`checkpoint:prior:${previousResult.artifactRef}`,method,verdict:'accepted'}];tasks[0].bindings=[{kind:'tool',operationId:`prior:${previousResult.callId}`,callId:`prior:${previousResult.callId}`,agentId:store.scope.agentId,status:'completed',planRevision:1,taskAttemptId:'attempt:work:prior'}];}
   }
   const command=update(tasks,config.strategy==='authored-workflow'?'Trusted configured fixture workflow; dependency structure authored before run':scenario==='recovery'?'Restore compatible saved fixture plan including accepted prior evidence':'Model-proposed fixture plan with declared criteria',undefined,scenario==='unknown-ack');
   if(scenario==='unknown-ack'){
    store.pendingUpdate=command;persist('update');persist('update',true);
    const waitId=`planning:ack:${store.planId}`,answer=options.answers?.[waitId];
    if(answer!=='known-success'&&answer!=='known-no-effect'){
     emit(n('update'),'lina-execution-wait','update','unknown','Unknown acknowledgement retains original mutation identity; do not mint a new update',{wait:{id:waitId,kind:'planning-commit',owner:'planning',planId:store.planId,ownerNodeId:n('update')}});return false;
    }
    // Inspection supplies one of two deterministic fixture outcomes. Both retain the
    // original command; only a proven non-commit permits retrying its mutation.
    const receipt=applyPlanningUpdate(store,command);
    emit('lina-execution-wait',n('update'),'update',answer==='known-success'?'found-committed':'known-not-committed',answer==='known-success'?'Inspection reconstructs committed original transaction; no replay':'Inspection proves no prior commit; retry same original identity once',{resumeWait:true});
    if(answer==='known-no-effect'&&receipt==='applied')persist('update');store.pendingUpdate=undefined;
   }
  }
  if(['compaction','recovery'].includes(scenario)){
   store.projection=planningTaskProjection(store);emit(n('load'),'lina-context-task','load','projected','Bounded task view is reconstructed from canonical revision after compaction/recovery');
   emit('lina-context-load',n('load'),'load','reload','Reload original plan, not a summary-derived replacement');persist('load',true);
  }
  const ready=readiness();
  if(!ready.length){store.goalStatus='blocked';emit(n('ready'),n('complete'),'complete','blocked','Invalid/conflicting plan cannot authorize execution');emit(n('complete'),'lina-execution-settle','complete','blocked','No runnable work admitted',{update:{outcome:'failed',detail:'Plan validation or revision conflict'}});return false;}
  if(config.executionMode==='plan-only'){store.goalStatus='planned';emit(n('ready'),n('complete'),'complete','planned','Plan-only concludes planning, not task completion');persist('complete');emit(n('complete'),'lina-execution-settle','complete','planned','No operational work launched',{update:{outcome:'completed',detail:'Plan produced; goal execution not attempted'}});return false;}
  if(config.executionMode==='review-before-execution'){
   const id=`planning:review:${store.planId}`,answer=options.answers?.[id];
   if(!answer){emit(n('ready'),'lina-execution-wait','ready','review-required','Plan review is separate from per-action Safety grants',{wait:{id,kind:'planning-review',owner:'planning',planId:store.planId,ownerNodeId:n('ready')}});return false;}
   if(!['approve','allow-once','ready'].includes(answer)){store.goalStatus='blocked';emit(n('ready'),n('complete'),'complete','review-denied','No execution after denied plan review');emit(n('complete'),'lina-execution-settle','complete','blocked','Plan review declined',{update:{outcome:'failed',detail:'Plan review declined'}});return false;}
   store.approved=true;emit('lina-execution-wait',n('ready'),'ready','reviewed','Plan review admitted; actual actions retain normal admission checks',{resumeWait:true});
  }
  emit(n('ready'),n('bind'),'bind','selected','Selected work awaits exact actual execution handles');emit(n('bind'),'lina-execution-controls','bind','continuation','Existing Turn Execution owns model/tool/child launches');return true;
 }
 function bind(event:SimulationEvent) {
  const ready=selectPlanningReady(store,config.maxReady).ready;
  const operations=event.operations?.filter(operation=>operation.status==='running')??[];
  for(const [index,operation] of operations.entries()){
   const row=store.tasks[ready[index]];if(!row)continue;
   const sourceKind=event.subagentEvidence?'child-result':'tool-result';if(!row.acceptance.some(criterion=>criterion.method===sourceKind))continue;
   if(row.bindings.some(binding=>binding.operationId===operation.attemptId))continue;
   row.bindings.push({kind:event.subagentEvidence?'child':'tool',operationId:operation.attemptId,callId:operation.callId,agentId:store.scope.agentId,status:'running',planRevision:store.revision,taskAttemptId:`attempt:${row.id}:${operation.attemptId}`});row.status='running';
   emit(event.subagentEvidence?'lina-subagents-prepare':'lina-tools-dispatch',n('bind'),'bind','bound','Bind task to admitted original call, not to its display order',{planningEvidence:{phase:'bind',outcome:'bound',reason:'Original batch/call/attempt correlation',planId:store.planId,revision:store.revision,operationId:operation.attemptId,taskIds:[row.id]}});persist('bind');emit(n('bind'),event.subagentEvidence?'lina-subagents-launch':'lina-tools-dispatch','bind','owner-resumed','Same admitted identity returns to its execution owner before launch');
  }
 }
 function review(event:SimulationEvent) {
  const results=event.results??[];
  for(const result of results){for(const row of Object.values(store.tasks)){
   const terminalOperation=event.operations?.find(operation=>operation.callId===result.callId&&['success','error','denied','cancelled'].includes(operation.status));
   const candidates=row.bindings.filter(binding=>binding.callId===result.callId&&(!terminalOperation||binding.operationId===terminalOperation.attemptId));
   if(candidates.length!==1)continue;const binding=candidates[0];
   // A subagent launch handle carries no completed work evidence.
   if(result.artifactRef.endsWith(':handle'))continue;
   const method=binding.kind==='child'?'child-result':'tool-result';
   const observation={operationId:binding.operationId,sourceRef:result.artifactRef,method:method as 'child-result'|'tool-result',status:result.status==='success'?'success' as const:'failed' as const};
   const outcome=scenario==='insufficient-evidence'?reviewPlanningTask(store,row.id,{...observation,method:'model-assertion'}):reviewPlanningTask(store,row.id,observation);
   reviewed=true;emit(binding.kind==='child'?'lina-subagents-return':'lina-tools-collect',n('review'),'review',outcome,'Check declared fixture criterion against exact observed result',{planningEvidence:{phase:'review',outcome,reason:'Observed source plus declared fixture acceptance check; not independent verification',planId:store.planId,revision:store.revision,taskIds:[row.id],verification:'fixture-check',sourceKind:observation.method,independentlyVerified:false}});persist('review');
  }}
 }
 function finish(source:string,event:SimulationEvent) {
  for(const row of Object.values(store.tasks))if(row.status==='pending'&&row.dependencies.every(id=>store.tasks[id]?.status==='completed')&&row.acceptance.every(criterion=>criterion.method==='model-assertion')){
   if(['insufficient-evidence','partial','failed-prerequisite'].includes(scenario))continue;
   const operationId=`assertion:${store.planId}:${row.id}`;row.bindings.push({kind:'model',operationId,agentId:store.scope.agentId,status:'running',planRevision:store.revision,taskAttemptId:`attempt:${row.id}:assertion`});row.status='running';
   const outcome=reviewPlanningTask(store,row.id,{operationId,sourceRef:`${event.id}:assertion:${row.id}`,method:'model-assertion',status:event.update.outcome==='completed'?'success':'failed'});
   if(source!==n('review'))emit(source,n('complete'),'complete','candidate','Model candidate reaches goal accounting');
   emit(n('bind'),n('review'),'review',outcome,'Model asserts criterion satisfaction; this is not independent verification',{planningEvidence:{phase:'review',outcome,reason:'Explicit model assertion fixture',planId:store.planId,revision:store.revision,taskIds:[row.id],verification:'model-assertion',sourceKind:'model-assertion',independentlyVerified:false}});source=n('review');
  }
  if(scenario==='failed-prerequisite'&&store.tasks.work){store.tasks.work.status='failed';store.tasks.check.status='blocked';}
  if(['replan','user-change','budget'].includes(scenario)&&(!replanned||pendingRevision)){
   const previouslyRequested=pendingRevision;pendingRevision=false;
   replanned=true;emit(source,n('replan'),'replan',!previouslyRequested&&store.replans>=config.maxReplans?'exhausted':'revision-proposal','Existing model round supplies revision proposal; completed evidence retained');
   if(!previouslyRequested&&store.replans>=config.maxReplans){store.goalStatus='blocked';emit(n('replan'),n('complete'),'complete','blocked','Replan cap does not reset main loop limits');source=n('complete');}
   else {if(!previouslyRequested)store.replans++;const tasks=Object.values(store.tasks).map(clone);for(const row of tasks.filter(row=>row.status!=='completed'))row.title+=' (revised)';if(scenario==='user-change'&&!tasks.some(row=>row.id==='scope-addition'))tasks.push(task('scope-addition',['work'],'tool-result'));
    emit(n('replan'),n('update'),'update','proposal','Revision proposal retains all completed task evidence');applyPlanningUpdate(store,{operationId:`revision:${store.planId}:${store.replans}`,expectedRevision:store.revision,scope:clone(store.scope),tasks,reason:scenario==='user-change'?'user scope changed':'observation changed remaining work'});persist('update');readiness();emit(n('ready'),n('complete'),'complete','candidate','Revised plan inspected; unfinished work remains explicit');source=n('complete');}
  }
  store.goalStatus=scenario==='budget'?'blocked':assessPlanningCompletion(store);if(source!==n('complete'))emit(source,n('complete'),'complete',store.goalStatus,'Goal accounting preserves required unfinished tasks and uncertain obligations');persist('complete');

 }
 if(options.stopped){
  let recorded=false;
  const account=()=>{
   for(const row of Object.values(store.tasks))if(row.status!=='completed')row.status=row.bindings.some(binding=>['running','unknown'].includes(binding.status))?'blocked':'cancelled';
   store.goalStatus=Object.values(store.tasks).some(row=>row.bindings.some(binding=>['running','unknown'].includes(binding.status)))?'blocked':'cancelled';
  };
  const record=()=>{account();emit('lina-execution-cancel',n('complete'),'complete',store.goalStatus,'Actual owner cancellation evidence precedes stopped task accounting; uncertain effects remain unresolved');persist('complete');recorded=true;};
  for(const event of base){
   for(const operation of event.operations??[])for(const row of Object.values(store.tasks))for(const binding of row.bindings)if(binding.callId===operation.callId&&binding.operationId===operation.attemptId){
    if(operation.status==='unknown')binding.status='unknown';
    else if(operation.status==='success')binding.status='completed';
    else if(['error','cancelled','denied','skipped'].includes(operation.status))binding.status='failed';
   }
   if(event.nodeId==='lina-execution-settle'&&!recorded)record();
   account();output.push({...event,planningSnapshot:clone(store)});
   if(event.wait&&!recorded)record();
  }
  if(!recorded)record();return output;
 }

 let permitted=true;
 for(const event of base){
  if(!started&&owned(event)&&event.nodeId==='lina-execution-start'){output.push(event);permitted=start(event.nodeId);if(!permitted)break;continue;}
  if(!started&&owned(event)&&event.nodeId==='lina-execution-settle'){permitted=start('lina-execution-start');if(!permitted)break;}
  if(config.strategy==='direct'){output.push(event);continue;}
  if(owned(event)&&event.nodeId==='lina-context-task'){
   store.projection=planningTaskProjection(store);
   emit('lina-context-load',n('load'),'load','projection-requested','Context requests current agent-scoped plan before task selection and budget checks');persist('load',true);
   emit(n('load'),'lina-context-task','load','projected','Bounded canonical task projection stages as task data; normal Context budget/validation follow');
  }
  if(owned(event)&&event.nodeId==='lina-execution-prepare'&&reviewed&&!replanned&&['replan','user-change','budget'].includes(scenario)){
   replanned=true;emit(n('review'),n('replan'),'replan',store.replans>=config.maxReplans?'exhausted':'revision-requested','Observation/user change uses next ordinary preparation and its shared model limits');
   if(store.replans>=config.maxReplans){store.goalStatus='blocked';emit(n('replan'),n('complete'),'complete','blocked','No additional model call admitted after configured revision budget');persist('complete');emit(n('complete'),'lina-execution-settle','complete','blocked','Settle bounded replanning exhaustion',{update:{outcome:'exhausted',detail:'Planning revision budget exhausted'}});break;}
   store.replans++;pendingRevision=true;persist('replan');emit(n('replan'),'lina-execution-prepare','replan','model-requested','Use existing next model round, not an uncounted planning loop');
  }
  if(owned(event)&&event.nodeId==='lina-execution-settle')finish(reviewed?n('review'):'lina-execution-controls',event);
  // Correlate the compiler's admitted handles before revealing their running event.
  // This remains a fixture ordering boundary; Tools/Subagents still own actual launch.
  if(owned(event)&&event.operations?.some(operation=>operation.status==='running'))bind(event);
  if(owned(event)&&event.operations?.some(operation=>operation.status==='unknown')){
   for(const row of Object.values(store.tasks))for(const binding of row.bindings)if(event.operations.some(operation=>operation.callId===binding.callId&&operation.attemptId===binding.operationId&&operation.status==='unknown'))binding.status='unknown';
  }
  const enriched=started&&owned(event)?planningModelRequest(event,store):event;
  output.push({...enriched,...(owned(event)&&event.nodeId==='lina-execution-settle'?{sourceNodeId:n('complete'),edgeId:'lina-planning-edge-complete-settle'}:{}),...(started&&owned(event)?{planningSnapshot:clone(store)}:{}),...(owned(event)&&event.nodeId==='lina-execution-settle'&&store.goalStatus!=='complete'?{update:{...event.update,outcome:event.update.outcome==='cancelled'?'cancelled' as const:'failed' as const,detail:`Planning goal: ${store.goalStatus}`}}:{})});
  if(!owned(event))continue;
  if(event.results?.length)review(event);
 }
 return output;
}
