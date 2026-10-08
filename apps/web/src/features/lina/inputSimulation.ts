import { attachEnvironmentState } from './environmentState';
import { withEnvironment, environmentModelEvent, DEFAULT_ENVIRONMENT_SETTINGS, environmentScenarioSettings, type EnvironmentCase, type EnvironmentSettings, type EnvironmentEvidence, type EnvironmentFixtureState } from './environmentFixtures';
import { attachPlanningState } from './planningState';
import { withPlanning, DEFAULT_PLANNING_SETTINGS, planningScenarioSettings, type PlanningCase, type PlanningSettings, type PlanningEvidence, type PlanningFixtureState } from './planningFixtures';
import { withSubagents, DEFAULT_SUBAGENT_SETTINGS, subagentScenarioSettings, type SubagentCase, type SubagentSettings, type SubagentChildSpec, type SubagentEvidence, type SubagentFixtureState } from './subagentsFixtures';
import { childHarnessEvents, subagentModelInput, attachSubagentParentHistory } from './subagentHarness';
import { withMemory, memoryScenarioSettings, type MemoryCase, type MemoryEvidence, type MemoryFixtureState } from './memoryFixtures';
import { commitStateFixture, withState, stateScenarioSettings, type StateCase, type StateEvidence, type StateFixtureState, type StateRestore } from './stateFixtures';
import { matchingSafetyGrant, safetyMatcher, type SafetyCase, type SafetyGrant, type SafetyEvidence } from './safetyFixtures';
import type { LinaDocument } from './linaModel';
import { buildModelFixture, createModelFixtureState, applyModelFixtureEvent, cancelModelFixtureEvent, unavailableModelUsage, type ModelProtocol, type ModelCase, type ModelFixture, type ModelFixtureEvent, type ModelFixtureState, type ModelOutcome } from './modelFixtures';

export type SimulationChannel = 'cli' | 'whatsapp' | 'telegram';
export type SimulationCase = 'direct-answer' | 'tool-round' | 'model-retry' | 'tool-error-correction' | 'tool-failure' | 'model-failure' | 'loop-exhausted';
export type ContextCase = 'fits' | 'prune' | 'compact' | 'compact-failure' | 'too-large' | 'invalid' | 'catalog-change' | 'hook' | 'resource' | 'prompt' | 'foreign-scope';
export type ToolScenario = 'parallel' | 'conflict' | 'mixed' | 'approval' | 'auth' | 'input' | 'uncertain' | 'retry' | 'hook';
export type SimulationAnswer = 'allow-once' | 'allow-session' | 'allow-always' | 'approve' | 'deny' | 'expire' | 'ready' | 'known-success' | 'known-no-effect' | 'stale' | 'wrong-account';
export type TurnOutcome = 'completed' | 'failed' | 'exhausted' | 'cancelled';
export type OperationStatus = 'pending' | 'running' | 'waiting' | 'success' | 'error' | 'denied' | 'cancelled' | 'skipped' | 'unknown';
export interface SimulationOperation {
  callId: string;
  batchId: string;
  attemptId: string;
  nodeId: string;
  status: OperationStatus;
  effectClass: 'read' | 'write';
  accountId: string;
  catalogRevision: number;
}
export interface SimulationResult { callId: string; status: 'success' | 'error' | 'denied' | 'cancelled' | 'skipped'; value?: number; artifactRef: string }
export type SimulationWait = {id:string;kind:'environment-readiness'|'environment-reconciliation';owner:'environment';environmentId:string;operationId:string;ownerNodeId:string} | {id:string;kind:'planning-review'|'planning-commit';owner:'planning';planId:string;ownerNodeId:string} | {id:string;kind:'subagent';owner:'subagents';taskId:string;ownerNodeId:string} | {id:string;kind:'memory-review';owner:'memory';candidateId:string;ownerNodeId:string} | { id: string; kind: 'delivery-reconciliation'; owner: 'delivery'; deliveryId: string; ownerNodeId: string } | { id: string; kind: 'approval' | 'auth' | 'input' | 'reconciliation'; owner?: 'tool'; reviewedMatcher?: SafetyGrant['matcher']; callId: string; batchId: string; ownerNodeId: string } | { id: string; kind: 'auth' | 'model-settlement'; owner: 'model'; intentId: string; purpose: 'metadata' | 'invocation'; attemptId?: string; ownerNodeId: string };
export interface SimulationModelWork { intentId: string; purpose: 'metadata' | 'invocation'; phase: 'resolving' | 'encoding' | 'waiting' | 'running' | 'terminal' | 'cancelled'; nodeId: string; attemptId?: string }
export interface SimulationProgress {
  contextPreparations: number;
  contextReductions: number;
  contextSnapshotRef?: string;
  catalogRevision: number;
  rounds: number;
  attempts: number;
  toolOutcome?: 'success' | 'correctable-error' | 'fatal-error';
  outcome?: TurnOutcome;
  detail?: string;
}
/** Fixture events carry graph transitions and work updates separately. A result
 * can arrive at the same node while another operation remains active. */
export interface SimulationEvent {
  id: string;
  fixtureId?: string;
  agentId?: string;
  parentAgentId?: string;
  agentDepth?: number;
  environmentEvidence?: EnvironmentEvidence;
  environmentSnapshot?: EnvironmentFixtureState;
  planningEvidence?: PlanningEvidence;
  planningSnapshot?: PlanningFixtureState;
  subagentEvidence?: SubagentEvidence;
  subagentSnapshot?: SubagentFixtureState;
  nodeId: string;
  edgeId?: string;
  sourceNodeId?: string;
  update: Partial<SimulationProgress>;
  operations?: SimulationOperation[];
  results?: SimulationResult[];
  wait?: SimulationWait;
  resumeWait?: boolean;
  stopRequested?: boolean;
  waits?: SimulationWait[];
  safetyGrants?: SafetyGrant[];
  safetyEvidence?: SafetyEvidence;
  modelWork?: SimulationModelWork;
  modelEvent?: ModelFixtureEvent;
  modelRequest?: ModelFixture['encodedRequest'];
  prelaunchOutcome?: ModelOutcome;
  memoryEvidence?: MemoryEvidence;
  memorySnapshot?: MemoryFixtureState;
  memoryError?: string;
  stateEvidence?: StateEvidence;
  stateSnapshot?: StateFixtureState;
  stateError?: string;
  stateRestore?: StateRestore;
}
export interface SimulationState extends SimulationProgress {
  environmentCase: EnvironmentCase;
  environmentSettings: EnvironmentSettings;
  planningCase: PlanningCase;
  planningSettings: PlanningSettings;
  planningSnapshot?: PlanningFixtureState;
  environmentEvidence?: EnvironmentEvidence;
  environmentSnapshot?: EnvironmentFixtureState;
  planningEvidence?: PlanningEvidence;
  subagentCase: SubagentCase;
  subagentSettings: SubagentSettings;
  subagentSnapshot?: SubagentFixtureState;
  subagentEvidence?: SubagentEvidence;
  agents: Record<string, SimulationState>;
  selectedAgentId: string;
  activeAgentId: string;
  childTaskId?: string;
  memoryCase: MemoryCase;
  stateCase: StateCase;
  memoryEvidence?: MemoryEvidence;
  memorySnapshot?: MemoryFixtureState;
  memoryError?: string;
  stateEvidence?: StateEvidence;
  stateSnapshot?: StateFixtureState;
  safetyCase: SafetyCase;
  initialSafetyGrants: SafetyGrant[];
  safetyGrants: SafetyGrant[];
  safetyEvidence?: SafetyEvidence;
  waits: SimulationWait[];
  channel: SimulationChannel;
  executionCase: SimulationCase;
  contextCase: ContextCase;
  toolScenario: ToolScenario;
  maxRounds: number;
  modelProtocol: ModelProtocol;
  modelCase: ModelCase;
  model?: ModelFixtureState;
  modelWork?: SimulationModelWork;
  modelRequest?: ModelFixture['encodedRequest'];
  modelHistory: ModelFixtureState[];
  modelOutcome?: ModelOutcome;
  automatic: boolean;
  events: SimulationEvent[];
  /** Ordered event cursor locations, not an assertion that concurrent events form one path. */
  route: string[];
  transitions: string[];
  operations: SimulationOperation[];
  results: SimulationResult[];
  wait?: SimulationWait;
  answer?: SimulationAnswer;
  answers?: Record<string, SimulationAnswer>;
  stopRequested: boolean;
  step: number;
  status: 'running' | 'paused' | 'waiting' | 'completed' | 'blocked';
  error?: string;
}
const activeStatuses: OperationStatus[] = ['running', 'waiting'];
export const activeSimulationNodes = (state: SimulationState) => [...new Set([...state.operations.filter(op => activeStatuses.includes(op.status)).map(op => op.nodeId), ...(state.modelWork && !['terminal','cancelled'].includes(state.modelWork.phase) ? [state.modelWork.nodeId] : [])])];
const terminal = (status: OperationStatus) => ['success', 'error', 'denied', 'cancelled', 'skipped'].includes(status);

/** Builds reproducible fixture events. No adapter, credential, model or clock is executed. */
function compileFixture(channel: SimulationChannel, executionCase: SimulationCase, maxRounds: number, contextCase: ContextCase, toolScenario: ToolScenario, document: LinaDocument, modelProtocol: ModelProtocol = 'openai-chat', modelCase: ModelCase = 'answer', answers: Record<string, SimulationAnswer> = {}, childSpec?:SubagentChildSpec) {
  const events: SimulationEvent[] = [];
  const retainedResults = new Map<string, SimulationResult>();
  const retainedCalls = new Map<string, ModelOutcome['toolCalls'][number]>();
  let current: SimulationProgress = { rounds: 0, attempts: 0, contextPreparations: 0, contextReductions: 0, catalogRevision: 7 };
  let cursor = `lina-input-${channel}`;
  function append(nodeId: string, edgeId?: string, update: Partial<SimulationProgress> = {}, work: Pick<SimulationEvent, 'operations' | 'results' | 'wait' | 'resumeWait' | 'modelWork' | 'modelEvent' | 'modelRequest' | 'prelaunchOutcome'> = {}, sourceNodeId = cursor) {
    events.push({ id: `fixture-event-${events.length}`, nodeId, ...(edgeId ? { edgeId, sourceNodeId } : {}), update, ...work });
    for(const result of work.results??[])retainedResults.set(result.callId,result);
    current = { ...current, ...update }; cursor = nodeId;
  }
  const go = (block: string, node: string, edge: string, update: Partial<SimulationProgress> = {}, work: Pick<SimulationEvent, 'operations' | 'results' | 'wait' | 'resumeWait' | 'modelWork' | 'modelEvent' | 'modelRequest' | 'prelaunchOutcome'> = {}) => append(`lina-${block}-${node}`, `lina-${block}-edge-${edge}`, update, work);
  const execution = (node: string, edge: string, update: Partial<SimulationProgress> = {}, work: Pick<SimulationEvent, 'operations' | 'results' | 'wait' | 'resumeWait' | 'modelWork' | 'modelEvent' | 'modelRequest' | 'prelaunchOutcome'> = {}) => go('execution', node, edge, update, work);
  const context = (node: string, edge: string, update: Partial<SimulationProgress> = {}) => go('context', node, edge, update);
  function tools(node: string, edge: string, detail: string, work: Pick<SimulationEvent, 'operations' | 'results' | 'wait' | 'resumeWait' | 'modelWork' | 'modelEvent' | 'modelRequest' | 'prelaunchOutcome'> = {}) { go('tools', node, edge, { detail }, work); }
  const inputRoute = [cursor, ...(channel === 'telegram' ? ['lina-input-telegram-route'] : []), ...['envelope','identity','access','activation','conversation','claim','intent','accept','dispatch','burst','admission','runtime'].map(id => `lina-input-${id}`)];
  append(cursor);
  for (const target of inputRoute.slice(1)) {
    const edge = document.edges.find(edge => edge.source === cursor && edge.target === target);
    append(target, edge?.id ?? 'missing-input-edge');
  }
  let metadataReady = false;
  let metadataAuthDone = false;
  let bindingChanged = false;
  let recoveryDone = false;
  let contextRecovered = false;
  function modelStep(node: string, edge: string, detail: string, work: Pick<SimulationEvent, 'modelWork' | 'modelEvent' | 'modelRequest' | 'prelaunchOutcome' | 'wait' | 'resumeWait'> = {}, update: Partial<SimulationProgress> = {}) {
    append(`lina-model-${node}`, `lina-model-edge-${edge}`, { detail, ...update }, work);
  }
  function modelAuth(purpose: 'metadata' | 'invocation', intentId: string): boolean {
    const work: SimulationModelWork = { intentId, purpose, phase: 'waiting', nodeId: 'lina-model-resolve' };
    append('lina-execution-wait','lina-model-edge-resolve-wait',{detail:'Register Model credential readiness; no tool call is invented'},{modelWork:work});
    append('lina-tools-auth','lina-model-edge-wait-auth',{detail:'Provider/account readiness through protected credential owner'});
    tools('credential-reference','auth-credential-reference','Native provider audience and original account reference');
    tools('credential-retrieve','credential-reference-credential-retrieve','Fixture readiness metadata only');
    tools('credential-validity','credential-retrieve-credential-validity','Missing model credential readiness');
    tools('credential-authorize','credential-validity-credential-authorize','Await matched provider/account readiness',{wait:{id:`model-wait:${intentId}`,kind:'auth',owner:'model',intentId,purpose,ownerNodeId:'lina-model-resolve'}});
    const readinessAnswer=answers[`model-wait:${intentId}`];
    const denied=readinessAnswer==='deny'||readinessAnswer==='expire';
    if(denied){
      // Failed sign-in returns through its lifecycle owner before resolving the retained intent.
      tools('monitor','credential-authorize-monitor','Authorization denied or expired',{resumeWait:true});

    } else {
      tools('credential-store','credential-authorize-credential-store','Matched fixture account; store acknowledgement',{resumeWait:true});
      tools('credential-validity','credential-store-credential-validity','Recheck committed original binding');
      tools('auth','credential-validity-auth','Provider readiness returned without secret material');
    }
    append('lina-execution-wait','lina-tools-edge-auth-resolve',{detail:'Model-tagged readiness resolves original owner'},{},'lina-tools-auth');
    modelStep('resolve','wait-resolve',denied?'Readiness refused; pending intent remains unlaunched':'Resume original Model purpose and scoped binding',{modelWork:{...work,phase:'resolving'}});
    return !denied;
  }
  function prepareContext(): boolean {
    const first = current.contextPreparations === 0;
    context('scope', 'prepare-scope', { detail: 'Fixture: bind agent history, permitted sources and account scope' });
    if (first && contextCase === 'foreign-scope') {
      append('lina-execution-settle', 'lina-context-edge-scope-terminal', { outcome: 'failed', detail: 'Foreign agent history refused before loading' }); return false;
    }
    context('load', 'scope-load', { contextPreparations: current.contextPreparations + 1, contextSnapshotRef: undefined, detail: 'Fixture: stage versioned source contributions under one preparation' });
    if (!metadataReady) {
      const intentId = `metadata:preparation-${current.contextPreparations}`;
      modelStep('resolve','context-resolve','Resolve versioned capabilities before Context budgeting',{modelWork:{intentId,purpose:'metadata',phase:'resolving',nodeId:'lina-model-resolve'}});
      if(modelCase==='metadata-credential-wait' && !metadataAuthDone){metadataAuthDone=true;if(!modelAuth('metadata',intentId)){append('lina-context-load','lina-model-edge-resolve-context',{detail:'Required capabilities unavailable after readiness refusal'},{modelWork:{intentId,purpose:'metadata',phase:'terminal',nodeId:'lina-model-resolve'}});append('lina-execution-settle','lina-context-edge-load-terminal',{outcome:'failed',detail:'Metadata readiness unavailable; zero attempts'});return false;}}
      append('lina-context-load','lina-model-edge-resolve-context',{detail:'Same preparation resumes with exact capability/budget profile'},{modelWork:{intentId,purpose:'metadata',phase:'terminal',nodeId:'lina-model-resolve'}});
      metadataReady=true;
    }
    if (first && (contextCase === 'resource' || contextCase === 'prompt')) {
      const resource = contextCase === 'resource';
      tools(resource ? 'resource-read' : 'prompt-get', resource ? 'context-resource-request' : 'context-prompt-request', 'Fixture: scoped selected acquisition; no network request');
      append('lina-context-load', `lina-tools-edge-${resource ? 'resource-context' : 'prompt-context'}`, { detail: resource ? 'Resource evidence staged with original provenance' : 'Selected prompt staged in its supplied role' });
    }
    context('instructions','load-instructions',{ detail:'Fixture: retain precedence, source revisions and selected skill provenance' });
    context('history','instructions-history',{ detail: current.rounds ? 'Fixture: complete correlated call/result groups' : 'Fixture: scoped canonical history' });
    context('task','history-task',{ detail:'Fixture: permitted task evidence; resources are data, not authority' });
    context('tools','task-tools',{ detail:`Exact catalog revision ${current.catalogRevision}; model exposure grants no execution permission` });
    context('observations','tools-observations',{ detail:'Fixture: shape rich observations; preserve canonical records and raw artifacts' });
    const selectedCase = first ? contextCase : 'fits';
    if (selectedCase === 'hook') {
      append('lina-tools-hooks','lina-context-edge-observations-hooks',{detail:'Fixture: declared context hook runs once for candidate generation'});
      append('lina-context-budget','lina-tools-edge-hooks-context-budget',{ detail:'Hook output is budgeted and validated again' });
    } else context('budget','observations-budget',{ detail: selectedCase === 'fits' || selectedCase === 'invalid' ? 'Fixture: input and output reservation fit' : 'Fixture: evaluate selected projection budget' });
    if (selectedCase === 'too-large') { append('lina-execution-settle','lina-context-edge-budget-terminal',{outcome:'failed',detail:'Protected context cannot fit; model not called'}); return false; }
    if (['prune','compact','compact-failure'].includes(selectedCase)) {
      const compact = selectedCase !== 'prune';
      context(compact?'compact':'prune',compact?'budget-compact':'budget-prune',{contextReductions:current.contextReductions+1,detail:compact?'Fixture summary; canonical records preserved':'Fixture: mask eligible observations and retain artifact/call identities'});
      if(selectedCase==='compact-failure'){append('lina-execution-settle','lina-context-edge-compact-terminal',{outcome:'failed',detail:'Fixture summary failed; prior history retained'});return false;}
      context('budget',compact?'compact-budget':'prune-budget',{detail:'Fixture: reduced projection fits; bounded reduction'});
    }
    context('validate','budget-validate',{detail:'Fixture: validate scope, complete groups, schema identity and provenance'});
    if(selectedCase==='invalid'){append('lina-execution-settle','lina-context-edge-validate-terminal',{outcome:'failed',detail:'Orphan observation refused; no model launch'});return false;}
    context('publish','validate-publish',{contextSnapshotRef:`fixture-context-preparation-${current.contextPreparations}`,detail:'Fixture: immutable snapshot with source/catalog generation vector'});
    if(selectedCase==='catalog-change'){
      append('lina-execution-prepare','lina-context-edge-publish-reprepare',{contextSnapshotRef:undefined,catalogRevision:8,detail:'Catalog changed; bounded reprepare without a model attempt'});
      return prepareContext();
    }
    append('lina-execution-prepare','lina-context-edge-publish-prepare',{detail:'Recheck launch authority and snapshot generations'});return true;
  }
  function toolBatch(toolOutcome: SimulationProgress['toolOutcome']) {
    const round = current.rounds;
    const calls = [0,1].map(index => ({callId:`call-${String((round-1)*2+index+1).padStart(3,'0')}`,batchId:`batch-${round}`,attemptId:`tool-attempt-${round}-${index+1}:1`,nodeId:'lina-tools-dispatch',status:'pending' as OperationStatus,effectClass: (toolScenario==='conflict'||toolScenario==='uncertain') && index===0 ? 'write' as const : toolScenario==='conflict' ? 'write' as const : 'read' as const,accountId:'account-demo',catalogRevision:current.catalogRevision}));
    const result=(op:SimulationOperation,status:SimulationResult['status']='success'):SimulationResult=>({callId:op.callId,status,...(status==='success'?{value:op.callId===calls[0].callId?4:6}:{}),artifactRef:`artifact:${op.callId}:safe-result`});
    execution('tools','decide-tools',{toolOutcome:undefined,detail:'Delegate versioned batch; retain both call identities'});
    tools('resolve','execution-resolve','Fixture: exact catalog, account and adapter binding',{operations:calls});
    tools('hooks','resolve-hooks',toolScenario==='hook'?'Declared argument hook changes candidate before validation':'No argument hook; preserve original arguments');
    tools('validate','hooks-validate','Validate final arguments and digests');
    tools('permissions','validate-permissions','Fixture permission decision; Safety owner remains a future dependency');
    tools('schedule','permissions-schedule',toolScenario==='conflict'?'Shared write conflict: two ordered waves':'Independent calls: bounded parallel wave');
    tools('dispatch','schedule-dispatch','Fixture: launch eligible calls',{operations:calls.map((op,index)=>({...op,status:(toolScenario==='conflict'&&index===1)||(['approval','auth'].includes(toolScenario)&&index===0)?'pending':toolScenario==='mixed'&&index===0?'error':'running'}))});
    tools('collect','dispatch-collect','Retain started work and match outcomes by call/attempt');
    if(toolScenario==='conflict'){
      append(cursor,undefined,{detail:'First write settled; second has not started'},{operations:[{...calls[0],status:'success'}],results:[result(calls[0])]});
      append('lina-tools-dispatch','lina-tools-edge-schedule-dispatch',{detail:'After conflict barrier, second wave starts'},{operations:[{...calls[1],status:'running',nodeId:'lina-tools-dispatch'}]},'lina-tools-schedule');
      tools('collect','dispatch-collect','Collect second ordered wave');
    }else{
      append(cursor,undefined,{detail:'Second call settled first; peer remains owned'},{operations:[{...calls[1],status:'success',nodeId:cursor}],results:[result(calls[1])]});
    }
    if(['approval','auth','input'].includes(toolScenario)){
      const kind=toolScenario as 'approval'|'auth'|'input';
      const ownerNodeId=kind==='approval'?'lina-tools-permissions':kind==='auth'?'lina-tools-resolve':'lina-tools-collect';
      const wait:SimulationWait={id:`wait:${kind}:${calls[0].callId}`,kind,callId:calls[0].callId,batchId:calls[0].batchId,ownerNodeId};
      // This is an owner notification from the actual boundary, not a traversal that starts it twice.
      append('lina-execution-wait',`lina-tools-edge-${kind==='approval'?'permissions-wait':kind==='auth'?'resolve-wait':'collect-wait'}`,{detail:`Fixture: retained ${kind} wait; sibling success preserved`},{...(kind==='auth'?{}:{wait}),operations:[{...calls[0],status:'waiting',nodeId:'lina-execution-wait'}]},ownerNodeId);
      if(kind==='auth'){
        append('lina-tools-auth','lina-execution-edge-wait-auth-request',{detail:'Wait registered before requesting authorization'});
        tools('credential-reference','auth-credential-reference','Original account credential reference only');
        tools('credential-retrieve','credential-reference-credential-retrieve','Fixture metadata; no secret read');
        tools('credential-validity','credential-retrieve-credential-validity','Fixture: missing grant');
        tools('credential-authorize','credential-validity-credential-authorize','Fixture: await verified original-account callback',{wait});
        tools('credential-store','credential-authorize-credential-store','Fixture: matched account; protected commit acknowledged',{resumeWait:true});
        tools('credential-validity','credential-store-credential-validity','Fixture: recheck original issuer/resource/scopes');
        tools('auth','credential-validity-auth','Original account readiness restored');
        append('lina-execution-wait','lina-tools-edge-auth-resolve',{detail:'Only the registered wait resumes original work'});
      }
      const toolAnswer=answers[wait.id];
      const denied=toolAnswer==='deny'||toolAnswer==='expire';
      if(kind==='approval'){
        append('lina-tools-permissions','lina-execution-edge-wait-approval',{detail:denied?'Exact operation denied/expired; peer unaffected':'Matched operation approval rechecked'},{resumeWait:true});
        if(denied)tools('collect','permissions-collect','Known denial; no effect',{operations:[{...calls[0],status:'denied'}],results:[result(calls[0],'denied')]});
        else {tools('schedule','permissions-schedule','Admit originally unstarted call');tools('dispatch','schedule-dispatch','Launch original approved call',{operations:[{...calls[0],status:'running'}]});tools('collect','dispatch-collect','Collect original call');}
      }else if(kind==='auth'){
        append('lina-tools-resolve','lina-execution-edge-wait-auth',{detail:'Verified original account ready; recheck resolution/validation/permission'},{resumeWait:true});
        tools('hooks','resolve-hooks','Recheck original operation');tools('validate','hooks-validate','Original schema/digest');tools('permissions','validate-permissions','Authentication is not operation permission');tools('schedule','permissions-schedule','Retain already settled peer');tools('dispatch','schedule-dispatch','Launch retained unstarted call',{operations:[{...calls[0],status:'running'}]});tools('collect','dispatch-collect','Collect original call');
      }else append('lina-tools-collect','lina-execution-edge-wait-input',{detail:'Resume same protocol continuation; do not replay effect'},{resumeWait:true,operations:[{...calls[0],status:'running'}]});
    }
    if(toolScenario==='retry'){
      tools('retry','collect-retry','Known no-effect read failure; bounded retry');
      tools('resolve','retry-resolve','Retain call ID; increment only tool attempt');
      tools('hooks','resolve-hooks','Rerun admission for retry');tools('validate','hooks-validate','Same schema/digest');tools('permissions','validate-permissions','Recheck current decision');tools('schedule','permissions-schedule','Retry pending call only');
      tools('dispatch','schedule-dispatch','Second tool attempt',{operations:[{...calls[0],attemptId:`tool-attempt-${round}-1:2`,status:'running'}]});tools('collect','dispatch-collect','Retry result correlated to new attempt');
    }
    if(toolScenario==='uncertain'){
      append(cursor,undefined,{detail:'Write acknowledgement lost; effect unknown, sibling success retained'},{operations:[{...calls[0],status:'unknown'}]});
      tools('publish','collect-publish','Retain unresolved effect instead of fabricated error');
      append('lina-input-reconcile','lina-tools-edge-publish-reconcile',{detail:'Reconciliation needs effect evidence; ownership retained'},{wait:{id:`wait:reconcile:${calls[0].callId}`,kind:'reconciliation',callId:calls[0].callId,batchId:calls[0].batchId,ownerNodeId:'lina-input-reconcile'}});
      append('lina-tools-publish','lina-execution-edge-reconcile-publish',{detail:answers[`wait:reconcile:${calls[0].callId}`]==='known-no-effect'?'Evidence proves no effect':'Evidence establishes successful effect'},{resumeWait:true,operations:[{...calls[0],status:answers[`wait:reconcile:${calls[0].callId}`]==='known-no-effect'?'error':'success'}],results:[result(calls[0],answers[`wait:reconcile:${calls[0].callId}`]==='known-no-effect'?'error':'success')]});
    }else{
      const denied=(toolScenario==='approval')&&(['deny','expire'].includes(answers[`wait:approval:${calls[0].callId}`]??''));
      const firstStatus=denied?'denied':toolScenario==='mixed'||toolOutcome==='correctable-error'||toolOutcome==='fatal-error'?'error':'success';
      append(cursor,undefined,{detail:'Required work joined; every requested call accounted for'},{operations:[{...calls[0],attemptId:toolScenario==='retry'?`tool-attempt-${round}-1:2`:calls[0].attemptId,status:firstStatus},{...calls[1],status:'success'}],results:[result(calls[0],firstStatus),result(calls[1])]});
      tools('publish','collect-publish','Publish stable call order and full result references');
    }
    append('lina-execution-tool-outcomes','lina-tools-edge-publish-outcomes',{toolOutcome,detail:toolOutcome==='fatal-error'?'Selected terminal outcome policy':'Known results inform the next model round'});
  }
  function runModel(responseKind: 'answer'|'tools'|'text-tools'|'continuation', retry=false, override?:ModelCase):ModelOutcome {
    const round = retry ? current.rounds : current.rounds+1;
    const attemptId=`model-attempt-${current.attempts+1}`;
    const intentId=`model-intent:${round}:${current.attempts+1}`;
    const selected=override ?? (current.attempts===0 && modelCase!=='metadata-credential-wait' ? modelCase : 'answer');
    const priorToolResults = [...retainedCalls.values()].flatMap(call => {
      const result = retainedResults.get(call.callId);
      return result ? [{ callId: call.callId, name: call.name, arguments: call.arguments, result }] : [];
    });
    const bindingRevision = bindingChanged && modelCase === 'binding-change' ? 2 : 1;
    const capabilityRevision = bindingChanged && modelCase === 'budget-change' ? 2 : 1;
    const build = (selectedCase: ModelCase) => buildModelFixture({
      protocol: modelProtocol, modelCase: selectedCase, attemptId, roundId: `round-${round}`,
      agentId: childSpec?.agentId ?? 'lina-main', responseKind,
      callIds: [1, 2].map(index => `call-${String((round - 1) * 2 + index).padStart(3, '0')}`),
      priorToolResults,
      encodeInput: { snapshotRef: current.contextSnapshotRef, bindingRevision,
        expectedBindingRevision: bindingRevision, capabilityRevision,
        expectedCapabilityRevision: capabilityRevision, ...(childSpec ? subagentModelInput(childSpec) : {}) },
    });
    let fixture = build(selected);
    execution('model','prepare-model',{detail:'Delegate invocation intent; no attempt counted yet'});
    modelStep('resolve','execution-resolve','Current model/codec/account binding and effective budget profile',{modelWork:{intentId,purpose:'invocation',phase:'resolving',nodeId:'lina-model-resolve'}});
    if(fixture.readinessWait){
      if(modelAuth('invocation',intentId))fixture=build('answer');
    }
    if(fixture.reprepare&&!bindingChanged){
      bindingChanged=true;metadataReady=false;
      if(selected==='budget-change')modelStep('encode','resolve-encode','Check changed output/reasoning budget profile',{modelWork:{intentId,purpose:'invocation',phase:'encoding',nodeId:'lina-model-encode'}});
      append('lina-execution-prepare',`lina-model-edge-${selected==='budget-change'?'encode':'resolve'}-reprepare`,{detail:'Binding/budget changed; bounded Context refresh without counter reset'},{modelWork:{intentId,purpose:'invocation',phase:'terminal',nodeId:'lina-model-resolve'}});
      if(!prepareContext())return fixture.outcome;
      return runModel(responseKind,retry,'answer');
    }
    if(fixture.prelaunchFailure){
      if(fixture.prelaunchFailure.stage!=='resolve')modelStep('encode','resolve-encode','Validate required media/schema/setting and opaque compatibility',{modelWork:{intentId,purpose:'invocation',phase:'encoding',nodeId:'lina-model-encode'},modelRequest:fixture.encodedRequest});
      modelStep('normalize',fixture.prelaunchFailure.stage==='resolve'?'resolve-normalize':'encode-normalize','Prelaunch failure; no inference and no fabricated usage',{prelaunchOutcome:fixture.outcome,modelWork:{intentId,purpose:'invocation',phase:'terminal',nodeId:'lina-model-normalize'}});
    } else {
      modelStep('encode','resolve-encode','Faithful protocol projection with schema and history mapping',{modelWork:{intentId,purpose:'invocation',phase:'encoding',nodeId:'lina-model-encode'},modelRequest:fixture.encodedRequest});
      for(const event of fixture.events){
        modelStep('invoke',event.type==='launch'?'encode-invoke':'invoke-progress',event.type==='launch'?'Launch one physical request under current authority':event.type==='terminal'?'Provider terminal evidence collected':`Draft ${event.type}; tools remain unlaunchable`,{modelEvent:event,modelWork:{intentId,purpose:'invocation',phase:event.type==='terminal'?'terminal':'running',nodeId:'lina-model-invoke',attemptId}},event.type==='launch'?{rounds:retry?current.rounds:round,attempts:current.attempts+1}:{});
      }
      modelStep('normalize','invoke-normalize','Classify terminal usability, raw reason, complete calls and usage',{modelWork:{intentId,purpose:'invocation',phase:'terminal',nodeId:'lina-model-normalize'}});
    }
    for(const call of fixture.outcome.toolCalls)retainedCalls.set(call.callId,call);
    append('lina-execution-decide','lina-model-edge-normalize-decide',{detail:`Normalized ${fixture.outcome.status}: ${fixture.outcome.rawFinishReason??fixture.outcome.failure?.code??'unavailable'}`});
    return fixture.outcome;
  }
  execution('start','handoff');let gate='start-limits';
  while(true){
    const exhausted=current.rounds>=maxRounds;
    execution('limits',gate,{detail:exhausted?'Round limit reached':`Round ${current.rounds+1} allowed`});
    if(exhausted){execution('settle','limits-terminal',{outcome:'exhausted',detail:'No further model call allowed'});break;}
    execution('prepare','limits-prepare');if(!prepareContext())break;
    const nextRound=current.rounds+1;
    const selectedTools=executionCase==='tool-failure'||executionCase==='tool-round'&&nextRound===1||executionCase==='tool-error-correction'&&nextRound<=2;
    const responseKind=selectedTools?'tools':executionCase==='loop-exhausted'?'continuation':'answer';
    let result=runModel(responseKind,false,executionCase==='model-failure'?'http200-error':executionCase==='model-retry'&&!recoveryDone?'retry-before-output':undefined);
    if(result.failure?.contextRefresh&&!contextRecovered){
      contextRecovered=true;execution('recover','decide-recover',{detail:'Provider overflow: count failed attempt, request Context refresh'});execution('prepare','recover-prepare');metadataReady=false;
      if(!prepareContext())break;
      result=runModel(responseKind,true,'answer');
    } else if(result.failure?.retryable&&!recoveryDone&&executionCase!=='model-failure'){
      recoveryDone=true;execution('recover','decide-recover',{detail:'Execution owns bounded retry; preserve round and prior evidence'});execution('prepare','recover-prepare');result=runModel(responseKind,true,'answer');
    }
    if(result.status!=='complete') {execution('settle','decide-terminal',{outcome:result.status==='aborted'?'cancelled':'failed',detail:result.failure?.code??'Unusable model outcome'});break;}
    if(result.kind==='refusal'||result.kind==='blocked') {execution('controls','decide-answer');execution('settle','controls-finish',{outcome:'completed',detail:'Provider refusal retained as terminal response; no tools'});break;}
    const needsTools=result.toolCalls.length>0;
    if(needsTools){
      if(result.toolCalls.some(call=>!call.catalogMapped)){execution('tools','decide-tools');tools('resolve','execution-resolve','Unknown native tool name retained; catalog lookup rejects it');append('lina-tools-collect','lina-tools-edge-resolve-collect',{detail:'Known unknown-tool rejection; no dispatch'});tools('publish','collect-publish','Publish known resolution failure');append('lina-execution-tool-outcomes','lina-tools-edge-publish-outcomes',{detail:'Unknown tool cannot execute'});execution('settle','outcomes-terminal',{outcome:'failed',detail:'Fixture policy terminates on unknown tool'});break;}
      const outcome=executionCase==='tool-failure'?'fatal-error':executionCase==='tool-error-correction'&&current.rounds===1?'correctable-error':'success';toolBatch(outcome);if(outcome==='fatal-error'){execution('settle','outcomes-terminal',{outcome:'failed',detail:'Selected terminal policy; not inferred from every tool error'});break;}execution('controls','outcomes-controls');
    }
    else if(result.continuationHint)execution('controls','decide-continue',{detail:'Explicit client continuation hint; Execution owns round policy'});
    else {execution('controls','decide-answer');execution('settle','controls-finish',{outcome:'completed',detail:'Answer complete'});break;}
    gate='controls-continue';
  }
  execution('release','settle-release');return events;
}

/** Inserts the same permission boundary around fixture calls and Context acquisitions.
 * The records are reproducible design evidence, not a live authorization service. */
function withSafety(base:SimulationEvent[], document:LinaDocument, scenario:SafetyCase, initial:SafetyGrant[], answers:Record<string,SimulationAnswer>, toolScenario:ToolScenario):SimulationEvent[] {
  const output:SimulationEvent[]=[];
  let grants=initial.map(grant=>({...grant}));
  const denied=new Set<string>();
  const seen=new Set<string>();
  const settled=new Map<string,'success'|'denied'>();
  let sequence=0;
  const emit=(nodeId:string,sourceNodeId:string,detail:string,work:Partial<SimulationEvent>={})=>{
    const edge=document.edges.find(edge=>edge.source===sourceNodeId&&edge.target===nodeId&&edge.id.startsWith('lina-safety-edge-'))??document.edges.find(edge=>edge.source===sourceNodeId&&edge.target===nodeId);
    output.push({id:`safety-${sequence++}`,nodeId,sourceNodeId,edgeId:edge?.id??'missing-safety-edge',update:{detail},...work});
  };
  const evidence=(operationId:string,phase:SafetyEvidence['phase'],reason:string,decision?:SafetyEvidence['decision']):SafetyEvidence=>({operationId,phase,reason,decision,argumentDigest:scenario==='binding-change'&&phase==='dispatch'?'fixture-digest:changed-arguments':'fixture-digest:reviewed-arguments',policyRevision:scenario==='policy-change'&&phase==='dispatch'?2:1});
  function admission(owner:string,operations:SimulationOperation[]) {
    const operationId=operations[0]?.callId??`acquisition:${owner}`;
    const matcher=safetyMatcher(operations[0]?.accountId??'account-demo',operations[0]?.catalogRevision??7,owner==='lina-tools-permissions'?'tool.invoke':owner.endsWith('resource-read')?'resource.read':'prompt.get');
    emit('lina-safety-evaluate',owner,'Evaluate exact post-validation operation');
    emit('lina-safety-policy','lina-safety-evaluate','Resolve trusted fixture rules; deny before required review before allow',{safetyEvidence:evidence(operationId,'policy','fixture-policy-1')});
    emit('lina-safety-evaluate','lina-safety-policy','Policy resolution returned to original operation');
    if(scenario==='session-end'||scenario==='revoked'){
      grants=grants.map(grant=>({...grant,status:scenario==='revoked'?'revoked':grant.lifetime==='session'?'expired':grant.status,generation:grant.generation+1}));
    }
    emit('lina-safety-grants','lina-safety-evaluate','Lookup exact reviewed matcher; account authentication supplies no permission',{safetyGrants:grants,safetyEvidence:evidence(operationId,scenario==='revoked'?'revoke':scenario==='session-end'?'session-end':'lookup','fixture-only')});
    const grant=matchingSafetyGrant(grants,matcher,operationId);
    emit('lina-safety-evaluate','lina-safety-grants',grant?'Matching active grant found':'No matching reusable grant');
    const needsReview=toolScenario==='approval'||scenario!=='policy-allow'&&scenario!=='hard-deny'&&scenario!=='binding-change'&&scenario!=='policy-change'&&(!grant||scenario==='mandatory-review');
    let refused=scenario==='hard-deny';
    if(needsReview){
      const reviewed=scenario==='parallel-review'||scenario==='mandatory-review'?operations:operations.slice(0,1);
      const actual=reviewed.length?reviewed:[undefined];
      emit('lina-safety-approval','lina-safety-evaluate',scenario==='mandatory-review'?'Required fresh review; saved grant cannot override rule':'Review exact displayed scope; four choices');
      emit(owner,'lina-safety-approval','Retain approval owner before delivering prompt');
      emit('lina-execution-wait',owner,'Register independent permission waits');
      emit('lina-safety-approval','lina-execution-wait','Wait registration acknowledged');
      const waits:SimulationWait[]=actual.map(op=>({id:`wait:approval:${op?.callId??operationId}`,kind:'approval',reviewedMatcher:matcher,callId:op?.callId??operationId,batchId:op?.batchId??'context-preparation-1',ownerNodeId:owner}));
      // Unreviewed independent siblings can complete while the selected operation awaits review.
      const siblings=operations.filter(op=>!reviewed.some(selected=>selected.callId===op.callId));
      if(siblings.length){
        for(const op of siblings){
          emit('lina-safety-authorize','lina-safety-evaluate','Independent sibling admitted by fixture policy');
          emit('lina-tools-permissions','lina-safety-authorize','Return independently allowed sibling admission');
          output.push({id:`safety-sibling-schedule:${op.callId}`,nodeId:'lina-tools-schedule',sourceNodeId:'lina-tools-permissions',edgeId:'lina-tools-edge-permissions-schedule',update:{detail:'Schedule unreviewed policy-allowed sibling independently'}});
          output.push({id:`safety-sibling-queue:${op.callId}`,nodeId:'lina-tools-dispatch',sourceNodeId:'lina-tools-schedule',edgeId:'lina-tools-edge-schedule-dispatch',update:{detail:'Sibling queued; reviewed peer remains unstarted'}});
          emit('lina-safety-authorize','lina-tools-dispatch','Recheck independent sibling immediately before launch');
          emit('lina-safety-grants','lina-safety-authorize','Reserve exact sibling launch identity');
          emit('lina-safety-authorize','lina-safety-grants','Sibling launch authorization acknowledged');
          emit('lina-tools-dispatch','lina-safety-authorize','Launch independently allowed sibling',{operations:[{...op,status:'running'}]});
          output.push({id:`safety-sibling-${op.callId}`,nodeId:'lina-tools-collect',sourceNodeId:'lina-tools-dispatch',edgeId:'lina-tools-edge-dispatch-collect',update:{detail:'Independent sibling fixture completed; approval operation unstarted'},operations:[{...op,status:'success',nodeId:'lina-tools-collect'}],results:[{callId:op.callId,status:'success',value:6,artifactRef:`artifact:${op.callId}:safe-result`}]});
          settled.set(op.callId,'success');
        }
      }
      // Each answer has its own wait ID. Other pending decisions remain retained.
      emit('lina-input-delivery','lina-safety-approval','Fixture prompt delivered only after wait registration',{waits:waits.filter(wait=>!answers[wait.id]),wait:waits.find(wait=>!answers[wait.id]),operations:reviewed.map(op=>({...op,status:'waiting',nodeId:'lina-safety-approval'}))});
      const ordered=Object.keys(answers).flatMap(id=>waits.filter(wait=>wait.id===id));
      const handled:string[]=[];
      for(const wait of ordered){
        if(wait.owner==='model'||wait.owner==='delivery'||wait.owner==='memory'||wait.owner==='subagents'||wait.owner==='planning'||wait.owner==='environment')continue;
        const answer=answers[wait.id];
        if(!answer)continue;
        output.push({id:`safety-answer-input:${wait.id}`,nodeId:'lina-input-prompt',update:{detail:'Fixture answer correlates exact prompt and eligible responder'}});
        output.push({id:`safety-answer-wait:${wait.id}`,nodeId:'lina-execution-wait',sourceNodeId:'lina-input-prompt',edgeId:'lina-execution-edge-prompt-answer',update:{detail:'Resume only the registered wait'}});
        emit(owner,'lina-execution-wait','Input-correlated answer resumes exact permission owner');
        emit('lina-safety-approval',owner,'Validate responder, prompt, lifetime and unchanged scope',{resumeWait:true,safetyEvidence:evidence(wait.callId,'approval',answer,answer==='deny'||answer==='expire'?'deny':'allow')});
        if(answer==='deny'||answer==='expire'){denied.add(wait.callId);emit('lina-safety-authorize','lina-safety-approval','Denied/expired operation has known no-launch result');}
        else {
        const lifetime=answer==='allow-always'?'persistent':answer==='allow-session'?'session':'once';
        const transactionId=`fixture-grant-commit:${wait.callId}`;
        const failed=lifetime==='persistent'&&scenario==='persistence-failed';
        const unknown=lifetime==='persistent'&&scenario==='persistence-unknown';
        if(!failed&&!unknown){grants=grants.filter(grant=>grant.id!==`fixture-grant:${wait.callId}`);grants.push({id:`fixture-grant:${wait.callId}`,lifetime,sessionId:'fixture-session-1',...(lifetime==='once'?{operationId:wait.callId}:{}),matcher,policyRevision:1,generation:1,status:'active',storage:'fixture-only'});}
        emit('lina-safety-grants','lina-safety-approval',failed?'Fixture grant persistence failed; no saved grant':unknown?'Fixture commit acknowledgment unknown; inspect same transaction ID':'Fixture grant committed with acknowledged lifetime',{safetyGrants:grants,safetyEvidence:{...evidence(wait.callId,'commit',failed?'failed':unknown?'unknown':'committed',failed?'deny':unknown?'unknown':'allow'),transactionId}});
        emit('lina-safety-authorize','lina-safety-grants',failed||unknown?'Withhold dispatch until grant evidence is authoritative':'Admission references committed grant');
        if(unknown){
          emit('lina-safety-grants','lina-safety-authorize','Inspect original commit transaction, without blind retry',{safetyEvidence:{...evidence(wait.callId,'inspect','stable transaction inspection found no committed grant','deny'),transactionId}});
          emit('lina-safety-authorize','lina-safety-grants','Known uncommitted outcome: no dispatch and no durable grant');
        }
        if(failed||unknown)denied.add(wait.callId);
        }
        if(reviewed.length>1){
          emit(owner,'lina-safety-authorize','One reviewed operation admitted independently; other waits retained');
          const op=operations.find(op=>op.callId===wait.callId);
          if(op){
            output.push({id:`safety-selected-queue:${wait.id}`,nodeId:'lina-tools-dispatch',sourceNodeId:'lina-tools-schedule',edgeId:'lina-tools-edge-schedule-dispatch',update:{detail:'Reviewed call queued independently'}});
            emit('lina-safety-authorize','lina-tools-dispatch','Fresh exact-attempt check for the selected reviewed call');
            emit('lina-safety-grants','lina-safety-authorize','Consume exact selected attempt reservation');
            grants=grants.map(grant=>grant.lifetime==='once'&&grant.operationId===op.callId?{...grant,status:'consumed'}:grant);
            emit('lina-safety-authorize','lina-safety-grants','Selected reservation acknowledged',{safetyGrants:grants});
            const status=denied.has(op.callId)?'denied':'success';
            emit('lina-tools-dispatch','lina-safety-authorize',status==='denied'?'Known no launch':'Launch selected fixture call',{operations:[{...op,status:status==='denied'?'denied':'running'}]});
            output.push({id:`safety-selected-settled:${wait.id}`,nodeId:'lina-tools-collect',sourceNodeId:'lina-tools-dispatch',edgeId:'lina-tools-edge-dispatch-collect',update:{detail:'Selected operation settled; pending siblings retained'},operations:[{...op,status,nodeId:'lina-tools-collect'}],results:[{callId:op.callId,status,...(status==='success'?{value:op.callId===operations[0].callId?4:6}:{}),artifactRef:`artifact:${op.callId}:safe-result`}]});
            settled.set(op.callId,status);
          }
          handled.push(wait.id);
          const remaining=waits.filter(wait=>!handled.includes(wait.id)&&!answers[wait.id]);
          output.push({id:`safety-residual:${handled.join(',')}`,nodeId:'lina-safety-approval',update:{detail:remaining.length?'Other independent approval remains pending':'All requested reviews accounted for'},waits:remaining,wait:remaining[0]});
        }
      }
    }else emit('lina-safety-authorize','lina-safety-evaluate',refused?'Trusted hard deny; reusable grant cannot override':'Policy or matching grant admits operation',{safetyEvidence:evidence(operationId,'admission',refused?'hard-deny':grant?'grant-match':'policy-allow',refused?'deny':'allow')});
    if(refused)for(const op of operations)denied.add(op.callId);
    emit(owner,'lina-safety-authorize','Return admission evidence; scheduling does not confer unlimited launch authority');
    return !refused&&!denied.has(operationId);
  }
  for(const original of base){
    let event={...original};
    if(event.wait?.kind==='approval'){event={...event,wait:undefined};}
    if(event.nodeId==='lina-tools-permissions'&&event.edgeId==='lina-tools-edge-validate-permissions'){
      output.push(event);
      const operations=base.slice(0,base.indexOf(original)+1).reverse().find(item=>item.operations?.length)?.operations??[];
      admission(event.nodeId,operations);
      continue;
    }
    if(['lina-tools-resource-read','lina-tools-prompt-get'].includes(event.nodeId)&&event.edgeId?.includes('context-')){
      output.push(event);
      const permitted=admission(event.nodeId,[]);
      emit('lina-safety-authorize',event.nodeId,'Fresh Context dependency launch permission; no model round invented',{safetyEvidence:evidence(`acquisition:${event.nodeId}`,'dispatch',permitted?'allow':'deny',permitted?'allow':'deny')});
      emit(event.nodeId,'lina-safety-authorize',permitted?'Fixture acquisition admitted':'Fixture acquisition refused');
      if(!permitted){const edge=document.edges.find(edge=>edge.source==='lina-context-load'&&edge.target==='lina-execution-settle');output.push({id:'safety-acquisition-failed',nodeId:'lina-context-load',update:{detail:'Required Context source unavailable; inference withheld'}});output.push({id:'safety-acquisition-terminal',nodeId:'lina-execution-settle',sourceNodeId:'lina-context-load',edgeId:edge?.id,update:{outcome:'failed'}});output.push({id:'safety-acquisition-release',nodeId:'lina-execution-release',sourceNodeId:'lina-execution-settle',edgeId:'lina-execution-edge-settle-release',update:{}});break;}
      continue;
    }
    if(event.operations)event.operations=event.operations.map(op=>settled.has(op.callId)?{...op,status:settled.get(op.callId)!,nodeId:'lina-tools-collect'}:op);
    if(event.operations?.some(op=>op.status==='running')&&event.nodeId==='lina-tools-dispatch'){
      // Reach the queued dispatch boundary without marking an operation started.
      output.push({...event,id:`${event.id}:queued`,operations:event.operations.map(op=>({...op,status:op.status==='running'?'pending':op.status}))});
      emit('lina-safety-authorize','lina-tools-dispatch','Fresh launch check: current argument/account/catalog/policy/grant generation and owner fence');
      emit('lina-safety-grants','lina-safety-authorize','Reserve and consume exact physical attempt; duplicates cannot reuse a permit');
      for(const op of event.operations.filter(op=>op.status==='running')){
        if(scenario==='binding-change'||scenario==='policy-change'||seen.has(op.attemptId)){denied.add(op.callId);}
        seen.add(op.attemptId);
        grants=grants.map(grant=>grant.lifetime==='once'&&grant.operationId===op.callId?{...grant,status:'consumed'}:grant);
      }
      emit('lina-safety-authorize','lina-safety-grants','Launch reservation returns matched generation',{safetyGrants:grants,safetyEvidence:evidence(event.operations[0].callId,'dispatch',scenario==='binding-change'?'changed arguments/account rejected':scenario==='policy-change'?'changed policy rejected':'current generation checked',event.operations.some(op=>denied.has(op.callId))?'deny':'allow')});
      const edge=document.edges.find(edge=>edge.id==='lina-safety-edge-authorize-dispatch');
      event={...event,edgeId:edge?.id??'missing-safety-edge',sourceNodeId:'lina-safety-authorize'};
    }
    if(event.operations)event.operations=event.operations.map(op=>denied.has(op.callId)?{...op,status:'denied',nodeId:'lina-tools-collect'}:op);
    if(event.results)event.results=event.results.map(result=>denied.has(result.callId)?{callId:result.callId,status:'denied',artifactRef:`artifact:${result.callId}:safe-result`}:result);
    if(event.modelRequest&&denied.size){
      const shape=(value:unknown):unknown=>{
        if(typeof value==='string'){try{const parsed=JSON.parse(value);return JSON.stringify(shape(parsed));}catch{return value;}}
        if(Array.isArray(value))return value.map(shape);
        if(value&&typeof value==='object'){const record=value as Record<string,unknown>;if(typeof record.callId==='string'&&denied.has(record.callId)&&typeof record.artifactRef==='string')return {callId:record.callId,status:'denied',artifactRef:record.artifactRef};return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,shape(item)]));}
        return value;
      };
      event.modelRequest=shape(event.modelRequest) as ModelFixture['encodedRequest'];
    }
    output.push(event);
  }
  return output;
}

function eventError(events: SimulationEvent[], document: LinaDocument): string | undefined {
  for(const event of events){
    if(!document.nodes.some(node=>node.id===event.nodeId))return `Simulation needs the missing component: ${event.nodeId}.`;
    if(event.edgeId&&!document.edges.some(edge=>edge.id===event.edgeId&&edge.source===event.sourceNodeId&&edge.target===event.nodeId))return `Simulation needs the missing connection: ${event.sourceNodeId} → ${event.nodeId} (${event.edgeId}).`;
  }
}
/** Continuations retain observed identities and distinguish newly emitted storage phases. */
function joinSimulationContinuation(prefix:SimulationEvent[],tail:SimulationEvent[]):SimulationEvent[]{
 const seen=new Set(prefix.map(event=>event.id));
 return [...prefix,...tail.map(event=>{let id=event.id;while(seen.has(id))id+=':continuation';seen.add(id);return id===event.id?event:{...event,id,fixtureId:event.fixtureId??event.id};})];
}
function program(events:SimulationEvent[]){return {events,route:events.map(event=>event.nodeId),transitions:events.slice(1).map(event=>event.edgeId??'')};}
function reduceInstanceEvent(state:SimulationState,event:SimulationEvent,step:number):SimulationState{
  // Recovery replaces the volatile work view with a checkpoint projection. Domain
  // owners still decide permission, retries and effects after this transition.
  if (event.stateRestore) {
    const restore = event.stateRestore;
    state = { ...state, ...restore.progress, operations: restore.operations, results: restore.results,
      waits: restore.waits, wait: undefined, stopRequested: restore.stopRequested ?? state.stopRequested,
      safetyGrants: restore.safetyGrants ?? state.safetyGrants, environmentSnapshot: restore.environmentSnapshot ?? state.environmentSnapshot, memorySnapshot: restore.memorySnapshot ?? state.memorySnapshot, planningSnapshot: restore.planningSnapshot ?? state.planningSnapshot };
  }
  if (state.stopRequested && (event.edgeId === 'lina-execution-edge-prepare-model' || event.modelEvent?.type === 'launch')) return {...state,status:'blocked',error:'Stopped turn cannot launch another provider attempt.'};
  const operations=new Map(state.operations.map(op=>[op.callId,op]));
  for(const op of event.operations??[])operations.set(op.callId,op);
  const results=new Map(state.results.map(result=>[result.callId,result]));
  for(const result of event.results??[]){const previous=results.get(result.callId);if(previous&&JSON.stringify(previous)!==JSON.stringify(result))return {...state,status:'blocked',error:`Conflicting terminal fixture result for ${result.callId}.`};results.set(result.callId,result);}
  let model=state.model;
  const modelHistory=[...state.modelHistory];
  if(event.modelEvent){
    if(event.modelEvent.type==='launch' && model?.attemptId!==event.modelEvent.attemptId){if(model)modelHistory.push(model);model=createModelFixtureState(event.modelEvent.attemptId,state.modelProtocol);}
    if(model)model=applyModelFixtureEvent(model,event.modelEvent);
  }
  return {...state,...event.update,stopRequested:event.stopRequested??state.stopRequested,environmentSnapshot:event.environmentSnapshot??state.environmentSnapshot,environmentEvidence:event.environmentEvidence??state.environmentEvidence,planningSnapshot:event.planningSnapshot??state.planningSnapshot,planningEvidence:event.planningEvidence??state.planningEvidence,memoryEvidence:event.memoryEvidence??state.memoryEvidence,memorySnapshot:event.memorySnapshot??state.memorySnapshot,stateEvidence:event.stateEvidence??state.stateEvidence,stateSnapshot:event.stateSnapshot??state.stateSnapshot,...((event.stateError||event.memoryError)?{error:event.stateError??event.memoryError}:{}),model,modelHistory,modelWork:event.modelWork??state.modelWork,modelRequest:event.modelRequest??state.modelRequest,modelOutcome:event.modelEvent?.type==='launch'?undefined:event.prelaunchOutcome??(event.nodeId==='lina-model-normalize'?model?.outcome:undefined)??state.modelOutcome,detail:event.update.detail,operations:[...operations.values()],results:[...results.values()].sort((a,b)=>[...operations.keys()].indexOf(a.callId)-[...operations.keys()].indexOf(b.callId)),safetyGrants:event.safetyGrants??state.safetyGrants,safetyEvidence:event.safetyEvidence??state.safetyEvidence,waits:event.waits??(event.wait?[event.wait]:event.resumeWait&&state.wait?state.waits.filter(wait=>wait.id!==state.wait!.id):state.waits),wait:event.waits?.[0]??event.wait??(event.resumeWait?undefined:state.wait),step,status:event.stateError||event.memoryError?'blocked':event.wait||event.waits?.length?'waiting':step===state.events.length-1?'completed':state.automatic?'running':'paused'};
}
/** Each child reuses the harness compiler but owns its request, grants and state.
 * Interleaving is a deterministic display schedule, not measured concurrency. */
type SimulationConfiguration = Pick<SimulationState,'channel'|'executionCase'|'maxRounds'|'contextCase'|'toolScenario'|'modelProtocol'|'modelCase'|'safetyCase'|'initialSafetyGrants'|'stateCase'|'memoryCase'|'subagentCase'|'subagentSettings'|'planningCase'|'planningSettings'|'environmentCase'|'environmentSettings'>;
function compileSimulationProgram(config:SimulationConfiguration,document:LinaDocument,answers:Record<string,SimulationAnswer>):SimulationEvent[]{
  const base=withState(withMemory(withSafety(compileFixture(config.channel,config.executionCase,config.maxRounds,config.contextCase,config.toolScenario,document,config.modelProtocol,config.modelCase,answers).map(event=>environmentModelEvent(event,config.environmentCase)),document,config.safetyCase,config.initialSafetyGrants,answers,config.toolScenario),document,config.memoryCase,undefined,{answers}),document,config.stateCase,answers);
  const childTraces=new Map<string,SimulationEvent[]>();
  const delegated=withSubagents(base,document,config.subagentCase,config.subagentSettings,{
    answers,
    contextRecords:spec=>childContextRecords(spec,spec.parentAgentId==='main'?base:childTraces.get(spec.parentAgentId)??[]),
    buildChild:spec=>{
      const localAnswers=Object.fromEntries(Object.entries(answers).map(([id,answer])=>[id.startsWith(`${spec.taskId}:`)?id.slice(spec.taskId.length+1):id,answer]));
      const nested=['nested','depth-rejected','tree-budget','stop-cascade'].includes(config.subagentCase)&&spec.agentId==='child-1';
      const hasFixtureTool=spec.tools.some(tool=>tool==='read'||tool==='calculator');
      const executionCase=config.subagentCase==='partial-failure'&&spec.agentId==='child-2'?'model-failure':hasFixtureTool&&(nested||spec.toolScenario||spec.memoryCase||config.environmentCase==='child-shared'||config.environmentCase==='child-separate')?'tool-round':'direct-answer';
      const toolScenario=spec.toolScenario??'parallel';
      const memoryCase=spec.memoryCase??(spec.memoryAccess==='shared-read'?'child-shared':'baseline');
      let full=withState(withMemory(withSafety(compileFixture(config.channel,executionCase,config.maxRounds,spec.connectorBindingRefs?.length?'resource':'fits',toolScenario,document,config.modelProtocol,'answer',localAnswers,spec).map(event=>environmentModelEvent(event,config.environmentCase)),document,spec.safetyCase??'policy-allow',[],localAnswers,toolScenario),document,memoryCase,undefined,{answers:localAnswers,childAgentId:spec.agentId,sharedRead:spec.memoryAccess==='shared-read'}),document,'fresh',localAnswers);
      if(spec.skillRefs?.length){
        const at=full.findIndex(event=>event.nodeId==='lina-context-load');
        const contribution:SimulationEvent[]=[
          {id:'worker-skill:inventory',nodeId:'lina-tools-skill-discover',update:{detail:'Fixture specialist inventory; metadata does not grant tool access'}},
          {id:'worker-skill:activate',nodeId:'lina-tools-skill-activate',sourceNodeId:'lina-tools-skill-discover',edgeId:'lina-tools-edge-skill-discover-skill-activate',update:{detail:'Activate selected source-review fixture skill with worker profile authority'}},
          {id:'worker-skill:resources',nodeId:'lina-tools-skill-resources',sourceNodeId:'lina-tools-skill-activate',edgeId:'lina-tools-edge-skill-activate-skill-resources',update:{detail:'Load selected fixture skill evidence under its resource root'}},
          {id:'worker-skill:context',nodeId:'lina-context-load',sourceNodeId:'lina-tools-skill-resources',edgeId:'lina-tools-edge-skill-resources-context',update:{detail:'Stage scoped skill contribution; source-review instruction appears in encoded worker request'}}
        ];
        if(at>=0)full=[...full.slice(0,at+1),...contribution,...full.slice(at+1)];
      }
      if(config.planningCase==='child-local')full=withPlanning(full,document,'sequential',config.planningSettings,{answers:localAnswers,childAgentId:spec.agentId});
      full=withEnvironment(full,document,config.environmentCase,config.environmentSettings,{answers:localAnswers,agentId:spec.agentId});
      const trace=childHarnessEvents(full,spec);childTraces.set(spec.agentId,trace);return trace;
    },
    cancelChild:(spec,observed)=>cancelChildTrace(config,spec,observed,document)
  });
  const execution=config.subagentCase==='disabled'?delegated:attachSubagentParentHistory(applyFixtureParentStop(delegated,document,config));
  const environment=completeEnvironmentSettlement(withEnvironment(execution,document,config.environmentCase,config.environmentSettings,{answers}),document);
  const planned=completePlanningSettlement(withPlanning(environment,document,config.planningCase,config.planningSettings,{answers}),document);
  const journal=attachEnvironmentState(attachPlanningState(planned));
  return config.planningCase==='stop-uncertain'?applyPlanningFixtureStop(journal,document,config):journal;
}
function completeEnvironmentSettlement(events:SimulationEvent[],document:LinaDocument):SimulationEvent[]{
 const last=events.at(-1);
 if(last?.nodeId!=='lina-execution-settle'||!last.environmentSnapshot)return events;
 const seed=events.findLast(event=>event.stateSnapshot)?.stateSnapshot;
 const tail=withState([last,{id:`${last.id}:release`,nodeId:'lina-execution-release',sourceNodeId:last.nodeId,edgeId:'lina-execution-edge-settle-release',update:{}}],document,'fresh',{},seed);
 return joinSimulationContinuation(events.slice(0,-1),tail);
}
/** Early plan-only/refused/exhausted paths settle through the same State owner and release boundary. */
function completePlanningSettlement(events:SimulationEvent[],document:LinaDocument):SimulationEvent[]{
  const last=events.at(-1);
  if(last?.nodeId!=='lina-execution-settle'||!last.planningSnapshot)return events;
  const progress:Partial<SimulationProgress>={};const operations=new Map<string,SimulationOperation>(),results=new Map<string,SimulationResult>();
  for(const event of events){Object.assign(progress,event.update);for(const operation of event.operations??[])operations.set(operation.callId,operation);for(const result of event.results??[])results.set(result.callId,result);}
  const seed=events.findLast(event=>event.stateSnapshot)?.stateSnapshot;
  const release:SimulationEvent={id:`${last.id}:release`,nodeId:'lina-execution-release',sourceNodeId:last.nodeId,edgeId:'lina-execution-edge-settle-release',update:{},planningSnapshot:last.planningSnapshot};
  const tail=withState([last,release],document,'fresh',{},seed,{progress,operations:[...operations.values()],results:[...results.values()],waits:[],planningSnapshot:last.planningSnapshot});
  return joinSimulationContinuation(events.slice(0,-1),tail);
}
/** Exercise Stop on the observed uncertain operation using the ordinary lifecycle owner. */
function applyPlanningFixtureStop(events:SimulationEvent[],document:LinaDocument,config:SimulationConfiguration):SimulationEvent[]{
  let state={...startSimulation(config.channel,document,false),...config,...program(events)};
  for(let index=0;index<events.length;index++){
    state=reduceEvent(state,events[index],index);
    if(events[index].operations?.some(operation=>operation.status==='unknown')){const stopped=stopSimulation(state,document).events;const boundary=index+1;return stopped.map((event,at)=>at===boundary?{...event,stopRequested:true}:event);}
  }
  return events;
}
/** Fixture owner-close/Stop uses the ordinary cancellation path too. Suppress
 * future parent model work, while detached child events keep their separate owner. */
function applyFixtureParentStop(events:SimulationEvent[],document:LinaDocument,config:SimulationConfiguration):SimulationEvent[]{
  if(!['detached','stop-cascade','owner-close','late-result'].includes(config.subagentCase))return events;
  let parent=startSimulation(config.channel,document,false,'tool-round',config.maxRounds),stopped=false;
  const output:SimulationEvent[]=[],deferred:SimulationEvent[]=[];
  for(const event of events){
    if(!stopped&&event.subagentSnapshot?.parentStatus==='stopped'){
      stopped=true;
      const main=output.filter(item=>!item.agentId||item.agentId==='main');
      parent={...parent,...program(main),step:Math.max(0,main.length-1),status:'paused'};
      const cancelled=stopSimulation(parent,document);
      const tail=cancelled.events.slice(main.length).map((item,index)=>({...item,id:`fixture-parent-stop:${index}:${item.id}`,stopRequested:true}));
      if(config.subagentCase==='detached')output.push(...tail);
      else {
        const terminalAt=tail.findIndex(item=>item.update.outcome==='cancelled'&&item.nodeId==='lina-execution-settle');
        output.push(...tail.slice(0,terminalAt<0?tail.length:terminalAt));
        if(terminalAt>=0)deferred.push(...tail.slice(terminalAt));
      }
    }
    if(stopped&&!event.agentId&&!event.subagentEvidence)continue;
    output.push(event);
    if(!stopped&&(!event.agentId||event.agentId==='main'))parent=reduceInstanceEvent({...parent,...program(output.filter(item=>!item.agentId||item.agentId==='main'))},event,output.length-1);
  }
  return [...output,...deferred];
}
/** Only complete, scoped task evidence crosses the child boundary. Pending tool
 * calls, provider replay tokens, instructions and permission grants stay with their owner. */
function childContextRecords(spec:SubagentChildSpec,source:SimulationEvent[]):string[]{
  const boundary=source.findIndex(event=>event.nodeId==='lina-tools-dispatch');
  const prefix=boundary>=0?source.slice(0,boundary+1):source;
  const requests=prefix.filter(event=>event.modelRequest).map(event=>event.modelRequest!);
  const request=requests[0];
  const body=request?.wireBody;
  const user=request?.binding.protocol==='openai-chat'?(body?.messages as {role:string;content:unknown}[])?.find(message=>message.role==='user')?.content:
    request?.binding.protocol==='openai-responses'?(body?.input as {role:string;content:unknown}[])?.find(message=>message.role==='user')?.content:
    request?.binding.protocol==='anthropic-messages'?(body?.messages as {role:string;content:unknown}[])?.find(message=>message.role==='user')?.content:
    (body?.contents as {role:string;parts:unknown}[])?.find(message=>message.role==='user')?.parts;
  const task=JSON.stringify({kind:'delegated-task',taskId:spec.taskId,sourceAgentId:spec.parentAgentId,content:'Inspect the supplied fixture evidence and return a bounded result.'});
  if(spec.contextMode==='task-only')return [task];
  if(spec.contextMode==='selected')return [task,JSON.stringify({kind:'selected-evidence',sourceAgentId:spec.parentAgentId,snapshotRef:requests.at(-1)?.snapshotRef??null,content:user??'Fixture source evidence',authority:'data'})];
  const completed=new Map(prefix.flatMap(event=>event.results??[]).map(result=>[result.callId,result]));
  // The current small fixture has no earlier canonical user turn; retain its actual
  // user input and only observed complete operation groups, never an open batch.
  return [task,JSON.stringify({kind:'parent-user',sourceAgentId:spec.parentAgentId,content:user??'Fixture user input',authority:'data'}),
    ...[...completed.values()].map(result=>JSON.stringify({kind:'complete-tool-group',sourceAgentId:spec.parentAgentId,call:prefix.flatMap(event=>event.operations??[]).find(operation=>operation.callId===result.callId),result,authority:'data'}))];
}
function emptyChild(state:SimulationState,agentId:string,events:SimulationEvent[]):SimulationState {
  return {...state,agents:{},selectedAgentId:agentId,activeAgentId:agentId,subagentCase:'disabled',
    ...program(events),step:0,rounds:0,attempts:0,contextPreparations:0,contextReductions:0,
    contextSnapshotRef:undefined,catalogRevision:7,operations:[],results:[],waits:[],wait:undefined,
    safetyGrants:[],initialSafetyGrants:[],safetyEvidence:undefined,model:undefined,modelHistory:[],
    modelWork:undefined,modelRequest:undefined,modelOutcome:undefined,memorySnapshot:undefined,
    memoryEvidence:undefined,environmentSnapshot:undefined,environmentEvidence:undefined,planningSnapshot:undefined,planningEvidence:undefined,stateSnapshot:undefined,stateEvidence:undefined,outcome:undefined,
    stopRequested:false,error:undefined,status:state.automatic?'running':'paused'};
}
function reduceEvent(state:SimulationState,event:SimulationEvent,step:number):SimulationState {
  const agentId=event.agentId??'main';
  const shared={subagentSnapshot:event.subagentSnapshot??state.subagentSnapshot,subagentEvidence:event.subagentEvidence??state.subagentEvidence,activeAgentId:agentId};
  if(agentId==='main')return {...reduceInstanceEvent(state,event,step),...shared};
  const task=event.subagentSnapshot&&Object.values(event.subagentSnapshot.tasks).sort((left,right)=>right.taskId.length-left.taskId.length).find(task=>task.agentId===agentId&&event.id.startsWith(`${task.taskId}:`));
  const taskId=task?.taskId;
  const events=state.events.filter(item=>item.agentId===agentId&&(!taskId||item.id.startsWith(`${taskId}:`)));
  let child=state.agents[agentId];
  if(!child||taskId&&child.childTaskId!==taskId)child={...emptyChild(state,agentId,events),childTaskId:taskId};
  child={...child,automatic:state.automatic,...program(events)};
  const localStep=Math.max(0,events.findIndex(item=>item.id===event.id));
  const next=reduceInstanceEvent(child,event,localStep);
  return {...state,...shared,agents:{...state.agents,[agentId]:next},step,
    wait:next.wait,waits:next.waits,status:next.status==='blocked'?'blocked':next.wait?'waiting':step===state.events.length-1?'completed':state.automatic?'running':'paused',
    ...(next.error?{error:next.error}:{})};
}
function cancelChildTrace(config:SimulationConfiguration,spec:SubagentChildSpec,observed:SimulationEvent[],document:LinaDocument):SimulationEvent[]{
  // Start from the actual observed model/tool state; no completed child is replayed.
  const shell=startSimulation(config.channel,document,false,'direct-answer',config.maxRounds);
  let child={...emptyChild(shell,spec.agentId,observed),step:0};
  for(let index=0;index<observed.length;index++)child=reduceInstanceEvent(child,observed[index],index);
  child={...child,status:'paused',automatic:false};
  const stopped=stopSimulation(child,document);
  return stopped.events.slice(observed.length).map(event=>({...event,id:`${spec.taskId}:cancel:${event.id}`,agentId:spec.agentId,parentAgentId:spec.parentAgentId,agentDepth:spec.depth}));
}
/** Select which instance supplies the graph trail and model/context inspector. */
export function selectSimulationAgent(state:SimulationState,id:string):SimulationState {
  return id==='active'||id==='main'||state.agents[id]?{...state,selectedAgentId:id}:state;
}
export function simulationView(state:SimulationState):SimulationState {
  const id=state.selectedAgentId==='active'?state.activeAgentId:state.selectedAgentId;
  if(id!=='main'&&state.agents[id])return state.agents[id];
  const events=state.events.slice(0,state.step+1).filter(event=>(event.agentId??'main')==='main');
  return {...state,...program(events),step:Math.max(0,events.length-1)};
}
/** Start one reproducible simulation. Missing fixture edges stop rather than being skipped. */
export function startSimulation(channel:SimulationChannel,document:LinaDocument,running=true,executionCase:SimulationCase='direct-answer',maxRounds=3,contextCase:ContextCase='fits',toolScenario:ToolScenario='parallel',modelProtocol:ModelProtocol='openai-chat',modelCase:ModelCase='answer',safetyCase:SafetyCase='policy-allow',safetyGrants:SafetyGrant[]=[],stateCase:StateCase='fresh',memoryCase:MemoryCase='baseline',subagentCase:SubagentCase='disabled',subagentSettings:Partial<SubagentSettings>={},planningCase:PlanningCase='disabled',planningSettings:Partial<PlanningSettings>={},environmentCase:EnvironmentCase='disabled',environmentSettings:Partial<EnvironmentSettings>={}):SimulationState{
  const environmentConfig={...DEFAULT_ENVIRONMENT_SETTINGS,...environmentScenarioSettings(environmentCase),...environmentSettings};
  if(!['disabled','pure-bypass','external-bypass'].includes(environmentCase))executionCase='tool-round';
  if(environmentCase==='child-shared'||environmentCase==='child-separate')subagentCase='parallel';
  const planningConfig={...DEFAULT_PLANNING_SETTINGS,...planningScenarioSettings(planningCase),...planningSettings};
  if(planningCase!=='disabled'){
    executionCase=planningConfig.executionMode==='plan-only'||planningConfig.strategy==='direct'?'direct-answer':'tool-round';
    if(planningCase==='delegation'||planningCase==='child-local')subagentCase='parallel';
    if(planningCase==='failed-prerequisite'||planningCase==='partial')toolScenario='mixed';
    if(planningCase==='compaction')contextCase='compact';
    if(planningCase==='stop-uncertain')toolScenario='uncertain';
  }
  const configured = {...stateScenarioSettings(stateCase),...memoryScenarioSettings(memoryCase)};
  if(subagentCase!=='disabled')executionCase='tool-round';
  executionCase = configured.executionCase ?? executionCase;
  toolScenario = configured.toolScenario ?? toolScenario;
  safetyCase = configured.safetyCase ?? safetyCase;
  const limit=Math.max(1,Math.min(10,Math.trunc(maxRounds)||3));
  const settings={...DEFAULT_SUBAGENT_SETTINGS,...subagentScenarioSettings(subagentCase),...subagentSettings};
  const events=compileSimulationProgram({channel,executionCase,maxRounds:limit,contextCase,toolScenario,modelProtocol,modelCase,safetyCase,initialSafetyGrants:safetyGrants,stateCase,memoryCase,subagentCase,subagentSettings:settings,planningCase,planningSettings:planningConfig,environmentCase,environmentSettings:environmentConfig},document,{});
  const error=eventError(events,document);
  return {environmentCase,environmentSettings:environmentConfig,planningCase,planningSettings:planningConfig,subagentCase,subagentSettings:settings,agents:{},selectedAgentId:"active",activeAgentId:"main",memoryCase,stateCase,safetyCase,initialSafetyGrants:safetyGrants.map(grant=>({...grant})),safetyGrants:safetyGrants.map(grant=>({...grant})),waits:[],channel,executionCase,contextCase,toolScenario,modelProtocol,modelCase,modelHistory:[],maxRounds:limit,automatic:running,...program(events),step:0,rounds:0,attempts:0,contextPreparations:0,contextReductions:0,catalogRevision:7,operations:[],results:[],stopRequested:false,status:error?'blocked':running?'running':'paused',...(error?{error}:{})};
}
/** Both timer and Next apply this reducer. External waits require a matched simulated answer. */
export function advanceSimulation(state:SimulationState,document:LinaDocument):SimulationState{
  if(['blocked','completed','waiting'].includes(state.status))return state;
  const error=eventError(state.events,document);if(error)return {...state,status:'blocked',error};
  const step=Math.min(state.step+1,state.events.length-1);return reduceEvent(state,state.events[step],step);
}
export function pauseSimulation(state:SimulationState):SimulationState{return state.status==='running'?{...state,automatic:false,status:'paused'}:state;}
export function resumeSimulation(state:SimulationState):SimulationState{return state.status==='paused'?{...state,automatic:true,status:'running'}:state;}
/** Stop continuations start from observed work, so their checkpoints retain counters and settled siblings. */
function persistStoppedTail(state:SimulationState,tail:SimulationEvent[],document:LinaDocument):SimulationEvent[]{
  const initial:StateRestore={
    progress:{rounds:state.rounds,attempts:state.attempts,contextPreparations:state.contextPreparations,contextReductions:state.contextReductions,contextSnapshotRef:state.contextSnapshotRef,catalogRevision:state.catalogRevision,toolOutcome:state.toolOutcome,outcome:state.outcome},
    operations:state.operations,results:state.results,waits:state.waits,stopRequested:true,safetyGrants:state.safetyGrants,environmentSnapshot:state.environmentSnapshot,memorySnapshot:state.memorySnapshot,planningSnapshot:state.planningSnapshot
  };
  return withState(withMemory(tail,document,state.memoryCase,state.memorySnapshot,{stopped:true}),document,'fresh',{},state.stateSnapshot,initial);
}
/** A stale/wrong-account event cannot clear a wait. All approved paths retain their operation ID. */
export function answerSimulation(state:SimulationState,document:LinaDocument,answer:SimulationAnswer,waitId?:string):SimulationState{
  if(waitId&&!state.waits.some(wait=>wait.id===waitId))return {...state,detail:'Stale or duplicate wait ID refused; original wait retained'};
  if(waitId)state=selectSimulationWait(state,waitId);
  if(state.status!=='waiting'||!state.wait)return state;
  if (state.wait.owner === 'delivery') {
    if (!['known-success', 'known-no-effect'].includes(answer) || !state.stateSnapshot) return { ...state, detail: 'Unmatched delivery observation refused; original obligation retained' };
    const snapshot = structuredClone(state.stateSnapshot);
    const transactionId = `fixture-delivery:observation:${state.wait.deliveryId}`;
    const original = snapshot.records.delivery?.payload as Record<string, unknown>;
    const deliveryStatus = answer === 'known-success' ? 'delivered' : 'known-not-sent';
    commitStateFixture(snapshot, transactionId, 'delivery', { ...original, status: deliveryStatus, automaticResend: false });
    const evidence: StateEvidence = { phase: 'reconcile', outcome: deliveryStatus, ownerRevision: snapshot.ownerRevision, transactionId, recordId: 'delivery', reason: answer === 'known-success' ? 'Original delivery confirmed; no duplicate send' : 'No send confirmed; owed reply retained without automatic resend' };
    const tail: SimulationEvent[] = [
      { id: 'state:delivery-observation-write', nodeId: 'lina-state-record', sourceNodeId: 'lina-input-delivery', edgeId: 'lina-state-edge-delivery-record', update: {}, stateEvidence: evidence, stateSnapshot: snapshot },
      { id: 'state:delivery-observation-ack', nodeId: 'lina-input-delivery', sourceNodeId: 'lina-state-record', edgeId: 'lina-state-edge-record-delivery', update: { detail: evidence.reason }, stateEvidence: evidence, stateSnapshot: snapshot, waits: [], resumeWait: true }
    ];
    const events = [...state.events.slice(0, state.step + 1), ...tail];
    const error = eventError(events, document);
    return { ...state, ...program(events), answers: { ...state.answers, [state.wait.id]: answer }, wait: undefined, waits: [], status: error ? 'blocked' : state.automatic ? 'running' : 'paused', ...(error ? { error } : {}) };
  }
  const allowed:Record<SimulationWait['kind'],SimulationAnswer[]>={approval:['approve','allow-once','allow-session','allow-always','deny','expire'],auth:['ready'],input:['ready'],reconciliation:['known-success','known-no-effect'],'delivery-reconciliation':['known-success','known-no-effect'],'model-settlement':['ready'],'memory-review':['allow-once','deny','expire'],subagent:['known-success','known-no-effect'],'planning-review':['allow-once','deny','expire'],'planning-commit':['known-success','known-no-effect'],'environment-readiness':['ready'],'environment-reconciliation':['known-success','known-no-effect']};
  if(!(state.wait.owner==='model'&&state.wait.kind==='auth'?['ready','deny','expire']:allowed[state.wait.kind]).includes(answer))return {...state,detail:'Stale or mismatched simulated answer refused; original wait retained'};
  if(state.stopRequested&&state.wait.owner==='environment'&&state.environmentSnapshot){
    const answers={...state.answers,[state.wait.id]:answer};
    const settle:SimulationEvent={id:'environment-stop-settle',nodeId:'lina-execution-settle',update:{outcome:'cancelled'}};
    const tail=withEnvironment([settle],document,state.environmentCase,state.environmentSettings,{seed:state.environmentSnapshot,answers,stopped:true});
    const events=attachEnvironmentState(joinSimulationContinuation(state.events.slice(0,state.step+1),tail));
    const error=eventError(events,document);
    return {...state,...program(events),answers,wait:undefined,waits:[],status:error?'blocked':state.automatic?'running':'paused',...(error?{error}:{})};
  }
  if(state.stopRequested&&state.wait.owner==='subagents'&&state.subagentSnapshot){
    const answers={...state.answers,[state.wait.id]:answer},observed=state.events.slice(0,state.step+1);
    const parentTail=state.events.slice(state.step+1).filter(event=>!event.agentId&&!event.subagentEvidence);
    const tail=withSubagents(parentTail,document,state.subagentCase,state.subagentSettings,{stopped:true,seed:state.subagentSnapshot,answers,
      cancelChild:spec=>cancelChildTrace(state,spec,observed.filter(event=>event.agentId===spec.agentId&&event.id.startsWith(`${spec.taskId}:`)),document),
      buildChild:spec=>state.events.slice(state.step+1).filter(event=>event.agentId===spec.agentId&&event.id.startsWith(`${spec.taskId}:`))});
    const seen=new Set(observed.map(event=>event.id));
    const future=tail.map(event=>{let id=event.id;while(seen.has(id))id+=`:reconcile:${state.wait!.id}`;seen.add(id);return {...event,id,fixtureId:event.fixtureId??event.id};});
    const events=[...observed,...future],error=eventError(events,document);
    return {...state,...program(events),answers,answer,wait:undefined,waits:[],status:error?'blocked':state.automatic?'running':'paused',...(error?{error}:{})};
  }
  if(state.stopRequested && state.wait.owner==='model'){
    if(state.wait.kind!=='model-settlement'||!state.model)return state;
    const owner=state.modelWork!;
    const tail:SimulationEvent[]=[
      {id:'model-stop-settled',nodeId:'lina-model-invoke',edgeId:'lina-model-edge-wait-invoke',sourceNodeId:'lina-execution-wait',update:{detail:'Local request accounted; remote computation/usage remain unknown'},resumeWait:true,modelEvent:cancelModelFixtureEvent(state.model),modelWork:{...owner,phase:'terminal',nodeId:'lina-model-invoke'}},
      {id:'model-stop-normalized',nodeId:'lina-model-normalize',edgeId:'lina-model-edge-invoke-normalize',sourceNodeId:'lina-model-invoke',update:{},modelWork:{...owner,phase:'terminal',nodeId:'lina-model-normalize'}},
      {id:'model-stop-decided',nodeId:'lina-execution-decide',edgeId:'lina-model-edge-normalize-decide',sourceNodeId:'lina-model-normalize',update:{}},
      {id:'model-stop-terminal',nodeId:'lina-execution-settle',edgeId:'lina-execution-edge-decide-terminal',sourceNodeId:'lina-execution-decide',update:{outcome:'cancelled'}},
      {id:'model-stop-release',nodeId:'lina-execution-release',edgeId:'lina-execution-edge-settle-release',sourceNodeId:'lina-execution-settle',update:{}}
    ];
    const events=attachPlanningState(joinSimulationContinuation(state.events.slice(0,state.step+1),withPlanning(persistStoppedTail(state,tail,document),document,state.planningCase,state.planningSettings,{seed:state.planningSnapshot,stopped:true,answers:state.answers})));
    const error=eventError(events,document);
    return {...state,...program(events),wait:undefined,answer,status:error?'blocked':state.automatic?'running':'paused',...(error?{error}:{})};
  }
  if(state.stopRequested){
    const retainedWait=state.wait;
    if(retainedWait.owner==='model'||retainedWait.owner==='memory'||retainedWait.owner==='subagents'||retainedWait.owner==='planning'||retainedWait.owner==='environment')return state;
    const operation=state.operations.find(op=>op.callId===retainedWait.callId)!;
    const resolved=state.operations.map(op=>op.callId===operation.callId?{...op,status:answer==='known-success'?'success' as const:'cancelled' as const}:op);
    const tail:SimulationEvent[]=[{id:'stop-effect-reconciled',nodeId:'lina-execution-settle',edgeId:'lina-execution-edge-reconcile-settle',sourceNodeId:'lina-input-reconcile',update:{outcome:'cancelled',detail:'Effect evidence established; stopped turn can settle'},resumeWait:true,operations:resolved,results:[{callId:operation.callId,status:answer==='known-success'?'success':'cancelled',artifactRef:`artifact:${operation.callId}:reconciled`}]},{id:'stop-owner-released',nodeId:'lina-execution-release',edgeId:'lina-execution-edge-settle-release',sourceNodeId:'lina-execution-settle',update:{}}];
    const events=attachPlanningState(joinSimulationContinuation(state.events.slice(0,state.step+1),withPlanning(persistStoppedTail(state,tail,document),document,state.planningCase,state.planningSettings,{seed:state.planningSnapshot,stopped:true,answers:state.answers})));
    return {...state,...program(events),wait:undefined,answer,status:state.automatic?'running':'paused'};
  }
  const answers={...state.answers,[state.wait.id]:answer};
  const events=compileSimulationProgram(state,document,answers);

  // Preserve the already-observed prefix; a selected answer changes only future fixture events.
  const observedAnchor=state.events[state.step];
  const anchor=events.findIndex(event=>event.id===(observedAnchor.fixtureId??observedAnchor.id));
  const changedWait=anchor>=0&&events[anchor].wait&&events[anchor].wait!.id!==observedAnchor.wait?.id;
  const prefix=state.events.slice(0,state.step+1),seen=new Set(prefix.map(event=>event.id));
  const future=events.slice((anchor<0?state.step:anchor)+(changedWait?0:1)).map(event=>{
    let id=event.id;while(seen.has(id))id+=`:after-answer:${state.wait!.id}`;
    seen.add(id);return id===event.id?event:{...event,id,fixtureId:event.fixtureId??event.id};
  });
  const joined=[...prefix,...future];
  const error=eventError(joined,document);if(error)return {...state,status:'blocked',error};
  return {...state,...program(joined),answer,answers,waits:state.waits.filter(wait=>wait.id!==state.wait!.id),wait:undefined,status:state.automatic?'running':'paused',detail:'Matched simulated answer retained; continue original owning operation'};
}
/** Stop is an execution event. Unlike Pause it replaces future launch events and joins owned work. */
export function stopSimulation(state:SimulationState,document:LinaDocument):SimulationState{
  if(state.wait?.owner==='delivery'||state.stopRequested||['blocked','completed'].includes(state.status)||!state.route.slice(0,state.step+1).includes('lina-execution-start'))return state;
  const pending=state.operations.filter(op=>!terminal(op.status)&&!op.callId.startsWith('call:delegation:')&&!op.callId.startsWith('call:join:'));
  const unknown=pending.filter(op=>op.effectClass==='write'&&['running','unknown'].includes(op.status));
  const tail:SimulationEvent[]=[];
  const add=(nodeId:string,edgeId:string,sourceNodeId:string,update:Partial<SimulationProgress>={},work:Pick<SimulationEvent,'operations'|'results'|'wait'|'modelWork'|'modelEvent'|'prelaunchOutcome'>={})=>tail.push({id:`stop-event-${tail.length}`,nodeId,edgeId,sourceNodeId,update,...work});
  add('lina-execution-cancel','lina-execution-edge-turn-control','lina-input-control',{detail:'Stop latched; no fresh launch'});
  if(state.waits.some(wait=>wait.kind==='approval')){
    add('lina-safety-approval','lina-safety-edge-cancel-approval','lina-execution-cancel',{detail:'Cancel exact pending reviews; late answers cannot revive them'});
    add('lina-safety-authorize','lina-safety-edge-cancel-authorization','lina-execution-cancel',{detail:'Invalidate unstarted dispatch authority; existing grants retained'});
  }
  if(pending.length){
    add('lina-tools-collect','lina-execution-edge-cancel-tools','lina-execution-cancel',{detail:'Fixture: signal adapters and join retained work'},{operations:pending.map(op=>({...op,status:unknown.some(item=>item.callId===op.callId)?'unknown':op.status==='pending'?'skipped':'cancelled',nodeId:'lina-tools-collect'})),results:pending.filter(op=>!unknown.some(item=>item.callId===op.callId)).map(op=>({callId:op.callId,status:op.status==='pending'?'skipped':'cancelled',artifactRef:`artifact:${op.callId}:stop-outcome`}))});
    if(unknown.length){
      add('lina-tools-publish','lina-tools-edge-collect-publish','lina-tools-collect',{detail:'Unknown write effect retained'});
      add('lina-input-reconcile','lina-tools-edge-publish-reconcile','lina-tools-publish',{outcome:'cancelled',detail:'Stopped turn retains unresolved write; no clean release'},{wait:{id:`wait:stop:${unknown[0].callId}`,kind:'reconciliation',callId:unknown[0].callId,batchId:unknown[0].batchId,ownerNodeId:'lina-input-reconcile'}});
    }else{
      add('lina-tools-publish','lina-tools-edge-collect-publish','lina-tools-collect');
      add('lina-execution-tool-outcomes','lina-tools-edge-publish-outcomes','lina-tools-publish');
      add('lina-execution-controls','lina-execution-edge-outcomes-controls','lina-execution-tool-outcomes');
      add('lina-execution-cancel','lina-execution-edge-controls-cancel','lina-execution-controls');
      add('lina-execution-settle','lina-execution-edge-cancel-settle','lina-execution-cancel',{outcome:'cancelled',detail:'Owned operations known settled'});
    }
  } else if(state.modelWork && !['terminal','cancelled'].includes(state.modelWork.phase)) {
    const owner=state.modelWork;
    const cancelled={...owner,phase:'cancelled' as const};
    if(state.model?.lifecycle==='running'){
      add('lina-execution-model','lina-execution-edge-cancel-model','lina-execution-cancel',{detail:'Signal exact physical request; no retry'});
      const settlementWait=state.modelCase==='local-settlement-wait';
      add('lina-model-invoke','lina-model-edge-cancel-invoke','lina-execution-model',{detail:'Local abort requested; remote compute not confirmed'},settlementWait?{modelWork:{...owner,phase:'waiting',nodeId:'lina-model-invoke'}}:{modelEvent:cancelModelFixtureEvent(state.model),modelWork:{...cancelled,nodeId:'lina-model-invoke'}});
      if(settlementWait){
        add('lina-execution-wait','lina-model-edge-invoke-wait','lina-model-invoke',{outcome:'cancelled',detail:'Retain active request until local settlement is observed'},{wait:{id:`model-settlement:${state.model.attemptId}`,kind:'model-settlement',owner:'model',intentId:owner.intentId,purpose:'invocation',attemptId:state.model.attemptId,ownerNodeId:'lina-model-invoke'}});
      } else {
        add('lina-model-normalize','lina-model-edge-invoke-normalize','lina-model-invoke',{}, {modelWork:{...cancelled,nodeId:'lina-model-normalize'}});
        add('lina-execution-decide','lina-model-edge-normalize-decide','lina-model-normalize');
        add('lina-execution-settle','lina-execution-edge-decide-terminal','lina-execution-decide',{outcome:'cancelled'});
      }
    } else {
      const prelaunch:ModelOutcome={status:'aborted',kind:'error',text:'',toolCalls:[],rawFinishReason:null,usage:unavailableModelUsage(),failure:{code:'intent_cancelled_before_launch',stage:owner.phase==='encoding'?'encode':'resolve',retryable:false},localSettlement:'settled',remoteStatus:'unknown',continuationHint:false,continuation:[],attemptId:null,responseId:null};
      if(state.wait?.owner==='model'){
        add('lina-execution-wait','lina-model-edge-cancel-readiness','lina-execution-cancel',{detail:'Invalidate pending readiness token; late callback cannot resume'});
        add('lina-model-resolve','lina-model-edge-wait-resolve','lina-execution-wait',{}, {modelWork:cancelled});
      }else add(owner.phase==='encoding'?'lina-model-encode':'lina-model-resolve',`lina-model-edge-cancel-${owner.phase==='encoding'?'encode':'resolve'}`,'lina-execution-cancel',{detail:'Cancel unlaunched Model intent'}, {modelWork:cancelled});
      if(owner.purpose==='metadata'){
        add('lina-context-load','lina-model-edge-resolve-context','lina-model-resolve',{detail:'Cancelled dependency returns to original preparation'});
        add('lina-execution-settle','lina-context-edge-load-terminal','lina-context-load',{outcome:'cancelled'});
      } else {
        const source=owner.phase==='encoding'?'encode':'resolve';
        add('lina-model-normalize',`lina-model-edge-${source}-normalize`,`lina-model-${source}`,{}, {modelWork:{...cancelled,nodeId:'lina-model-normalize'},prelaunchOutcome:prelaunch});
        add('lina-execution-decide','lina-model-edge-normalize-decide','lina-model-normalize');
        add('lina-execution-settle','lina-execution-edge-decide-terminal','lina-execution-decide',{outcome:'cancelled'});
      }
    }
  }else add('lina-execution-settle','lina-execution-edge-cancel-settle','lina-execution-cancel',{outcome:'cancelled',detail:'No active external work'});
  const pendingModelSettlement=tail.some(event=>event.wait?.owner==='model'&&event.wait.kind==='model-settlement');
  if(!unknown.length&&!pendingModelSettlement)add('lina-execution-release','lina-execution-edge-settle-release','lina-execution-settle');
  let stoppedTail=persistStoppedTail(state,tail,document);
  if(state.subagentCase!=='disabled'&&state.subagentSnapshot){
    const observed=state.events.slice(0,state.step+1);
    stoppedTail=withSubagents(stoppedTail,document,state.subagentCase,state.subagentSettings,{
      stopped:true,seed:state.subagentSnapshot,answers:state.answers,
      cancelChild:spec=>cancelChildTrace(state,spec,observed.filter(event=>event.agentId===spec.agentId&&event.id.startsWith(`${spec.taskId}:`)),document),
      buildChild:spec=>state.events.slice(state.step+1).filter(event=>event.agentId===spec.agentId&&event.id.startsWith(`${spec.taskId}:`))
    });
  }
  stoppedTail=withPlanning(stoppedTail,document,state.planningCase,state.planningSettings,{stopped:true,seed:state.planningSnapshot,answers:state.answers,childAgentId:state.childTaskId?state.activeAgentId:undefined});
  stoppedTail=withEnvironment(stoppedTail,document,state.environmentCase,state.environmentSettings,{stopped:true,seed:state.environmentSnapshot,answers:state.answers,agentId:state.childTaskId?state.activeAgentId:undefined});
  const events=attachEnvironmentState(attachPlanningState(joinSimulationContinuation(state.events.slice(0,state.step+1),stoppedTail)));const error=eventError(events,document);
  return {...state,...program(events),waits:[],wait:undefined,stopRequested:true,status:error?'blocked':state.automatic?'running':'paused',...(error?{error}:{})};
}
export function resetSimulation(state:SimulationState,document:LinaDocument):SimulationState{return startSimulation(state.channel,document,false,state.executionCase,state.maxRounds,state.contextCase,state.toolScenario,state.modelProtocol,state.modelCase,state.safetyCase,state.initialSafetyGrants,state.stateCase,state.memoryCase,state.subagentCase,state.subagentSettings,state.planningCase,state.planningSettings,state.environmentCase,state.environmentSettings);}

/** Select one retained wait without answering another operation. */
export function selectSimulationWait(state:SimulationState,waitId:string):SimulationState {const wait=state.waits.find(wait=>wait.id===waitId);return wait?{...state,wait}:state;}
