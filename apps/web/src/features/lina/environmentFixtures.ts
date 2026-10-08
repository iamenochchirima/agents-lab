import type { LinaDocument } from './linaModel';
import type { SimulationAnswer, SimulationEvent, SimulationOperation, SimulationResult } from './inputSimulation';

export type EnvironmentCase = 'disabled'|'local'|'sandbox-reuse'|'read-only'|'copied-workspace'|'unavailable'|'missing-dependency'|'resource-exhaustion'|'background'|'stdin'|'truncated-output'|'timeout'|'uncertain-launch'|'uncertain-termination'|'stale-binding'|'child-shared'|'child-separate'|'disk-restart'|'memory-resume'|'unsupported-resume'|'staging-failure'|'export-failure'|'release-repeat'|'cleanup-uncertain'|'pure-bypass'|'external-bypass';
export const ENVIRONMENT_CASES:{value:EnvironmentCase;label:string}[] = [
 ['disabled','No workspace operation'],['local','Local file roundtrip'],['sandbox-reuse','Reuse Docker workspace'],['read-only','Read-only mount'],['copied-workspace','Copy project into sandbox'],['unavailable','Backend unavailable'],['missing-dependency','Required software missing'],['resource-exhaustion','Resource limit reached'],['background','Background process and poll'],['stdin','Interactive process input'],['truncated-output','Bounded output with retained log'],['timeout','Command deadline'],['uncertain-launch','Launch acknowledgement lost'],['uncertain-termination','Termination acknowledgement lost'],['stale-binding','Stale environment generation'],['child-shared','Children share workspace'],['child-separate','Children own separate workspaces'],['disk-restart','Restart preserving files'],['memory-resume','Resume preserving memory'],['unsupported-resume','Backend cannot resume memory'],['staging-failure','Workspace import failed'],['export-failure','Artifact export failed'],['release-repeat','Repeated release'],['cleanup-uncertain','Cleanup acknowledgement lost'],['pure-bypass','Pure tool bypass'],['external-bypass','External service bypass'],
].map(([value,label])=>({value:value as EnvironmentCase,label}));
export interface EnvironmentSettings {backend:'local'|'docker'|'remote';workspaceAccess:'copy'|'read-only'|'read-write';sharing:'shared'|'agent';network:'inherit'|'none'|'restricted';lifetime:'retain'|'release';commandTimeoutMs:number;maxOutputBytes:number}
export const DEFAULT_ENVIRONMENT_SETTINGS:EnvironmentSettings={backend:'local',workspaceAccess:'read-write',sharing:'shared',network:'inherit',lifetime:'retain',commandTimeoutMs:30_000,maxOutputBytes:4096};
export function environmentScenarioSettings(scenario:EnvironmentCase):Partial<EnvironmentSettings>{
 const docker:EnvironmentCase[]=['sandbox-reuse','read-only','copied-workspace','resource-exhaustion','disk-restart','unsupported-resume','staging-failure','export-failure','release-repeat','cleanup-uncertain'];
 return {...(docker.includes(scenario)?{backend:'docker' as const}:{}),...(scenario==='memory-resume'?{backend:'remote' as const}:{}),...(scenario==='read-only'?{workspaceAccess:'read-only' as const}:{}),...(scenario==='copied-workspace'?{workspaceAccess:'copy' as const}:{}),...(scenario==='child-separate'?{sharing:'agent' as const}:{}),...(['release-repeat','cleanup-uncertain','export-failure'].includes(scenario)?{lifetime:'release' as const}:{}),...(scenario==='truncated-output'?{maxOutputBytes:16}:{}),...(scenario==='timeout'?{commandTimeoutMs:1}: {})};
}
export interface EnvironmentCapabilities {filesystem:boolean;process:boolean;stdin:boolean;reconnect:boolean;memoryResume:boolean;diskRestore:boolean;cpuLimit:boolean;memoryLimit:boolean;networkRestriction:boolean}
export interface EnvironmentBinding {id:string;nativeId:string;generation:number;backend:EnvironmentSettings['backend'];status:'absent'|'ready'|'unavailable'|'stopped'|'released'|'unknown';ownership:'attached'|'created';capabilities:EnvironmentCapabilities;profile:{requested:EnvironmentSettings;enforced:{network:boolean;cpu:boolean;memory:boolean;workspaceBoundary:boolean}}}
export interface EnvironmentWorkspace {id:string;environmentId:string;generation:number;root:string;storage:'local'|'bind-mount'|'copy';access:EnvironmentSettings['workspaceAccess'];originalFiles:Record<string,string>;files:Record<string,string>;staging:'pending'|'ready'|'failed'}
export interface EnvironmentProcess {id:string;operationId:string;callId:string;attemptId:string;environmentId:string;generation:number;ownerAgentId:string;native:{pid?:number;sessionId?:string;commandId?:string};kind:'command'|'write'|'read';path?:string;status:'intent'|'running'|'exited'|'failed'|'unknown'|'cancelled';effect:'none'|'applied'|'unknown';exitCode?:number;signal?:string;cancellation:'none'|'requested'|'confirmed'|'unknown';stdout:string;stderr:string;outputCursor:number;fullOutput:string;truncated:boolean;input:string[]}
export interface EnvironmentArtifact {id:string;processId:string;environmentId:string;generation:number;path:string;content:string;exportStatus:'pending'|'exported'|'failed';destination?:string}
export interface EnvironmentLease {id:string;agentId:string;environmentId:string;generation:number;status:'active'|'released';owned:boolean}
export interface EnvironmentFixtureState {storage:'fixture-only';agentId:string;environment:EnvironmentBinding;workspace:EnvironmentWorkspace;processes:Record<string,EnvironmentProcess>;leases:Record<string,EnvironmentLease>;artifacts:Record<string,EnvironmentArtifact>;transactions:Record<string,{fingerprint:string;outcome:string}>;clock:number;restoration?:'filesystem-only'|'filesystem-and-memory';cleanup:'none'|'retained'|'blocked'|'released'|'unknown';error?:string}
export interface EnvironmentEvidence {phase:string;outcome:string;reason:string;environmentId:string;generation:number;operationId?:string;processId?:string;operationKind?:EnvironmentProcess['kind'];path?:string;output?:string;capabilities?:EnvironmentCapabilities}
export interface EnvironmentSimulationEvent extends SimulationEvent {environmentSnapshot?:EnvironmentFixtureState;environmentEvidence?:EnvironmentEvidence}
const clone=<T>(value:T):T=>structuredClone(value);
const live=(process:EnvironmentProcess)=>['intent','running','unknown'].includes(process.status);

/** Local filesystem roots are conventions, not OS containment. Profiles retain requested
 * restrictions separately from those the selected fixture backend actually enforces. */
export function createEnvironmentFixtureState(agentId='main',settings:Partial<EnvironmentSettings>={}):EnvironmentFixtureState {
 const config={...DEFAULT_ENVIRONMENT_SETTINGS,...settings},id=`environment:${config.sharing==='shared'?'conversation':agentId}`;
 const sandbox=config.backend!=='local',capabilities:EnvironmentCapabilities={filesystem:true,process:true,stdin:true,reconnect:sandbox,memoryResume:config.backend==='remote',diskRestore:sandbox,cpuLimit:sandbox,memoryLimit:sandbox,networkRestriction:sandbox};
 return {storage:'fixture-only',agentId,environment:{id,nativeId:`fixture:${config.backend}:${id}`,generation:1,backend:config.backend,status:'absent',ownership:sandbox?'created':'attached',capabilities,profile:{requested:config,enforced:{network:sandbox&&config.network!=='inherit',cpu:sandbox,memory:sandbox,workspaceBoundary:sandbox}}},workspace:{id:`workspace:${id}`,environmentId:id,generation:1,root:sandbox?'/workspace':'/fixture/current-project',storage:sandbox?config.workspaceAccess==='copy'?'copy':'bind-mount':'local',access:config.workspaceAccess,originalFiles:{'input.txt':'fixture input'},files:{'input.txt':'fixture input'},staging:'pending'},processes:{},leases:{},artifacts:{},transactions:{},clock:0,cleanup:'none'};
}
export function acquireEnvironment(store:EnvironmentFixtureState,available=true):'ready'|'unavailable'{
 if(!available){store.environment.status='unavailable';store.error='backend-unavailable';return 'unavailable';}
 if(store.environment.status==='released'){store.error='released-environment';return 'unavailable';}
 store.environment.status='ready';const id=`lease:${store.agentId}:${store.environment.generation}`;
 store.leases[id]??={id,agentId:store.agentId,environmentId:store.environment.id,generation:store.environment.generation,status:'active',owned:store.environment.ownership==='created'};
 if(store.agentId!=='main'&&store.environment.profile.requested.sharing==='shared'){const parentId=`lease:main:${store.environment.generation}`;store.leases[parentId]??={id:parentId,agentId:'main',environmentId:store.environment.id,generation:store.environment.generation,status:'active',owned:false};}return 'ready';
}
export function bindEnvironmentWorkspace(store:EnvironmentFixtureState,success=true):'ready'|'failed'{
 if(store.environment.status!=='ready'||!success){store.workspace.staging='failed';store.error='workspace-unavailable';return 'failed';}
 store.workspace.staging='ready';store.workspace.generation=store.environment.generation;return 'ready';
}
/** Admission records intent before any fixture effect. Replay returns the original handle,
 * while changed content under the same operation identity is a conflict. */
export function launchEnvironmentProcess(store:EnvironmentFixtureState,request:{operationId:string;callId:string;attemptId:string;generation:number;kind:EnvironmentProcess['kind'];path?:string;content?:string},acknowledged=true):'launched'|'duplicate'|'conflict'|'rejected'|'unknown'{
 const fingerprint=JSON.stringify(request),prior=store.transactions[request.operationId];
 if(prior)return prior.fingerprint===fingerprint?'duplicate':'conflict';
 if(store.environment.status!=='ready'||store.workspace.staging!=='ready'||request.generation!==store.environment.generation||store.workspace.generation!==request.generation){store.error='stale-or-unavailable-binding';return 'rejected';}
 if(request.kind==='write'&&store.workspace.access==='read-only'){store.error='read-only';return 'rejected';}
 if(request.path&&(request.path.startsWith('/')||request.path.split('/').includes('..'))){store.error='invalid-workspace-path';return 'rejected';}
 const process:EnvironmentProcess={id:`process:${request.operationId}`,operationId:request.operationId,callId:request.callId,attemptId:request.attemptId,environmentId:store.environment.id,generation:request.generation,ownerAgentId:store.agentId,native:{pid:1000+Object.keys(store.processes).length,...(store.environment.backend!=='local'?{sessionId:`session:${store.agentId}`,commandId:request.operationId}:{})},kind:request.kind,path:request.path,status:'intent',effect:'none',cancellation:'none',stdout:'',stderr:'',fullOutput:'',truncated:false,outputCursor:0,input:[]};
 store.processes[request.operationId]=process;store.transactions[request.operationId]={fingerprint,outcome:'intent'};
 // Unknown launch does not reveal whether the backend performed an effect.
 process.status=acknowledged?'running':'unknown';process.effect=acknowledged?'none':'unknown';store.transactions[request.operationId].outcome=acknowledged?'launched':'unknown';return acknowledged?'launched':'unknown';
}
export function observeEnvironmentProcess(store:EnvironmentFixtureState,operationId:string,observation:{generation:number;status:'running'|'success'|'failed'|'no-effect';stdout?:string;stderr?:string;content?:string;exitCode?:number}):'observed'|'stale'|'unmatched'{
 const process=store.processes[operationId];if(!process)return 'unmatched';if(observation.generation!==process.generation||process.generation!==store.environment.generation)return 'stale';
 if(['exited','failed','cancelled'].includes(process.status))return 'observed';
 process.fullOutput+=observation.stdout??'';process.stderr+=observation.stderr??'';process.outputCursor++;
 const limit=store.environment.profile.requested.maxOutputBytes,encoded=new TextEncoder().encode(process.fullOutput);process.truncated=encoded.byteLength>limit;process.stdout=new TextDecoder().decode(encoded.slice(0,limit));
 if(observation.status==='running'){process.status='running';return 'observed';}
 process.status=observation.status==='success'?'exited':'failed';process.exitCode=observation.exitCode??(observation.status==='success'?0:1);process.effect=observation.status==='success'&&process.kind==='write'?'applied':'none';
 if(observation.status==='success'&&process.path&&process.kind==='write'){store.workspace.files[process.path]=observation.content??'fixture output';if(store.workspace.storage!=='copy')store.workspace.originalFiles[process.path]=store.workspace.files[process.path];}
 if(observation.status==='success'&&process.kind==='read'&&process.path){process.fullOutput=store.workspace.files[process.path]??'';process.stdout=process.fullOutput;}
 if(process.truncated){const id=`artifact:log:${operationId}`;store.artifacts[id]={id,processId:process.id,environmentId:store.environment.id,generation:process.generation,path:`logs/${process.native.pid}.txt`,content:process.fullOutput,exportStatus:'pending'};}
 return 'observed';
}
export function sendEnvironmentInput(store:EnvironmentFixtureState,operationId:string,input:string):'sent'|'rejected'{const process=store.processes[operationId];if(!process||process.status!=='running'||!store.environment.capabilities.stdin)return 'rejected';process.input.push(input);return 'sent';}
/** Cancellation never overwrites a previously observed success. Confirmation applies only
 * to this owned operation; unknown acknowledgement keeps cleanup blocked. */
export function cancelEnvironmentProcess(store:EnvironmentFixtureState,operationId:string,acknowledged=true):'cancelled'|'terminal'|'unknown'|'unmatched'{
 const process=store.processes[operationId];if(!process||process.ownerAgentId!==store.agentId)return 'unmatched';if(!live(process))return 'terminal';process.cancellation='requested';
 if(!acknowledged){process.cancellation='unknown';process.status='unknown';return 'unknown';}
 process.cancellation='confirmed';process.status='cancelled';process.signal='SIGTERM';process.effect=process.effect==='unknown'?'unknown':process.effect;return 'cancelled';
}
export function recoverEnvironment(store:EnvironmentFixtureState,preservation:'filesystem-only'|'filesystem-and-memory'):'recovered'|'unsupported'{
 if(preservation==='filesystem-and-memory'&&!store.environment.capabilities.memoryResume||preservation==='filesystem-only'&&!store.environment.capabilities.diskRestore)return 'unsupported';
 store.restoration=preservation;store.environment.generation++;store.workspace.generation=store.environment.generation;store.environment.status='ready';
 for(const process of Object.values(store.processes)){if(preservation==='filesystem-and-memory')process.generation=store.environment.generation;else if(live(process)){process.status='unknown';process.cancellation='unknown';}}
 for(const lease of Object.values(store.leases))if(lease.status==='active')lease.generation=store.environment.generation;return 'recovered';
}
export function exportEnvironmentArtifact(store:EnvironmentFixtureState,id:string,success=true):'exported'|'failed'|'unmatched'{const artifact=store.artifacts[id];if(!artifact)return 'unmatched';artifact.exportStatus=success?'exported':'failed';if(success)artifact.destination=`fixture-run-artifacts/${id}`;return artifact.exportStatus;}
/** Release is idempotent and scoped to the agent lease. Shared users retain their leases;
 * attached host workspaces are never deleted. Export and live work are cleanup barriers. */
export function releaseEnvironment(store:EnvironmentFixtureState,acknowledged=true):'released'|'retained'|'blocked'|'unknown'{
 if(store.cleanup==='released')return 'released';
 if(Object.values(store.processes).some(process=>live(process)||process.effect==='unknown')||Object.values(store.artifacts).some(artifact=>artifact.exportStatus!=='exported')){store.cleanup='blocked';return 'blocked';}
 if(store.environment.profile.requested.lifetime==='retain'){store.cleanup='retained';return 'retained';}
 if(!acknowledged){store.cleanup='unknown';return 'unknown';}
 for(const lease of Object.values(store.leases))if(lease.agentId===store.agentId)lease.status='released';
 const active=Object.values(store.leases).some(lease=>lease.status==='active');store.environment.status=active?'ready':store.environment.ownership==='created'?'released':'ready';store.cleanup='released';return 'released';
}

/** Rewrite only known arithmetic fixture structures into a declared workspace tool.
 * Stream arguments, encoded catalog and prior result history change together. */
export function environmentModelEvent(original:SimulationEvent,scenario:EnvironmentCase):SimulationEvent {
 if(['disabled','pure-bypass','external-bypass'].includes(scenario))return original;
 const event=clone(original),commandCases:EnvironmentCase[]=['background','stdin','timeout','uncertain-launch','uncertain-termination','truncated-output','resource-exhaustion'];
 const args=(index=0)=>commandCases.includes(scenario)?{operation:'command',command:'fixture process'}:index===0?{operation:'write',path:'result.txt',content:'fixture output'}:{operation:'read',path:'result.txt'};
 const schema={type:'object',properties:{operation:{type:'string',enum:['write','read','command']},path:{type:'string'},content:{type:'string'},command:{type:'string'}},required:['operation'],additionalProperties:false};
 function rewrite(value:unknown,index=0,key=''):unknown {
  if(Array.isArray(value))return value.map((item,i)=>rewrite(item,i,key));
  if(value&&typeof value==='object'){
   const row=value as Record<string,unknown>;if(typeof row.index==='number')index=row.index;
   if(row.properties&&typeof row.properties==='object'&&'expression' in row.properties)return schema;
   if('expression' in row)return args(index);
   const next=Object.fromEntries(Object.entries(row).map(([field,item])=>[field,rewrite(item,index,field)]));
   if(row.role==='tool'&&(row.content==='4'||row.content==='6'))next.content=JSON.stringify({status:'success',artifactRef:'fixture-workspace-result'});
   if(row.type==='function_call_output'&&(row.output==='4'||row.output==='6'))next.output=JSON.stringify({status:'success',artifactRef:'fixture-workspace-result'});
   if(row.type==='tool_result'&&(row.content==='4'||row.content==='6'))next.content=JSON.stringify({status:'success',artifactRef:'fixture-workspace-result'});
   if(row.name==='calculator'){next.name='workspace_fixture';if('arguments' in row)next.arguments=typeof row.arguments==='string'?JSON.stringify(args(index)):args(index);if('input' in row)next.input=args(index);if('args' in row)next.args=args(index);}
   return next;
  }
  if(value==='calculator'&&(key==='name'||key==='toolNames'))return 'workspace_fixture';
  if(value==='Fixture calculator')return 'Fixture workspace operation';
  if(typeof value==='string'&&['arguments','partial_json','argsFragment','fragment'].includes(key)){
   if(value.startsWith('{"expression":'))return JSON.stringify(args(index));
   if(value==='"2+2"}'||value==='"3+3"}')return '';
   try {const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object'&&'expression' in parsed)return JSON.stringify(args(index));}catch{}
  }
  if(value==='The result is 4.')return 'The workspace fixture result is available.';
  if(value==='I will calculate both.')return 'I will execute the workspace fixture operations.';
  if(value==='Calculate 2 + 2 and 3 + 3.')return 'Write fixture output and inspect it in the selected workspace.';
  if(value==='Fixture only: calculate using the available functions.')return 'Fixture only: use workspace_fixture in the selected environment.';
  return value;
 }
 if(event.modelRequest&&!event.modelRequest.manifest.transformations.includes('Declared workspace fixture catalog and history; synthetic character token estimate')){const previous=JSON.stringify(event.modelRequest.wireBody);event.modelRequest.wireBody=rewrite(event.modelRequest.wireBody) as Record<string,unknown>;event.modelRequest.manifest.inputTokens+=Math.max(0,Math.ceil((JSON.stringify(event.modelRequest.wireBody).length-previous.length)/4));event.modelRequest.manifest.originalSchema=rewrite(event.modelRequest.manifest.originalSchema) as Record<string,unknown>;event.modelRequest.manifest.projectedSchema=rewrite(event.modelRequest.manifest.projectedSchema) as Record<string,unknown>;
  const digest=(value:unknown)=>{let hash=2166136261;for(const character of JSON.stringify(value))hash=Math.imul(hash^character.charCodeAt(0),16777619);return `fixture-fnv32:${(hash>>>0).toString(16)}`;};event.modelRequest.manifest.originalSchemaDigest=digest(event.modelRequest.manifest.originalSchema);event.modelRequest.manifest.projectedSchemaDigest=digest(event.modelRequest.manifest.projectedSchema);event.modelRequest.manifest.toolAliases=Object.fromEntries(Object.entries(event.modelRequest.manifest.toolAliases).map(([name,alias])=>[name==='calculator'?'workspace_fixture':name,alias==='calculator'?'workspace_fixture':alias]));
  event.modelRequest.manifest.transformations.push('Declared workspace fixture catalog and history; synthetic character token estimate');}
 if(event.modelEvent){const index=event.modelEvent.type==='arguments-delta'||event.modelEvent.type==='item-start'?Number(event.modelEvent.itemId.replace('tool-',''))||0:0;event.modelEvent=rewrite(event.modelEvent,index) as typeof event.modelEvent;}
 if(event.prelaunchOutcome)event.prelaunchOutcome=rewrite(event.prelaunchOutcome) as typeof event.prelaunchOutcome;
 if(event.operations)event.operations=event.operations.map(operation=>{const ordinal=Number(operation.callId.match(/call-(\d+)/)?.[1]??(operation.callId==='one'?1:2));return {...operation,effectClass:commandCases.includes(scenario)||ordinal%2===1?'write':'read'};});
 return event;
}

/** Correlate actual retained observations into provider-specific result history.
 * Only owned call IDs present in the environment ledger are replaced. */
export function projectEnvironmentResults(event:SimulationEvent,store:EnvironmentFixtureState,results:ReadonlyMap<string,SimulationResult>):SimulationEvent {
 if(!event.modelRequest||!results.size)return event;
 const next=clone(event),request=next.modelRequest!,previous=JSON.stringify(request.wireBody);
 function projected(callId:unknown):Record<string,unknown>|undefined{
  if(typeof callId!=='string')return;const result=results.get(callId);if(!result)return;
  const process=Object.values(store.processes).filter(process=>process.callId===callId&&process.ownerAgentId===store.agentId).at(-1);if(!process)return;
  return {...result,agentId:process.ownerAgentId,environmentId:process.environmentId,generation:process.generation,operationId:process.operationId,evidenceSource:'fixture-observation',output:process.stdout,...(process.exitCode!==undefined?{exitCode:process.exitCode}:{}),...(process.signal?{signal:process.signal}:{}),truncated:process.truncated};
 }
 function visit(value:unknown):unknown{
  if(Array.isArray(value))return value.map(visit);
  if(!value||typeof value!=='object')return value;
  const row=value as Record<string,unknown>,mapped=projected(row.tool_call_id??row.call_id??row.tool_use_id);
  if(mapped&&row.role==='tool')return {...row,content:JSON.stringify(mapped)};
  if(mapped&&row.type==='function_call_output')return {...row,output:JSON.stringify(mapped)};
  if(mapped&&row.type==='tool_result')return {...row,content:JSON.stringify(mapped)};
  // Gemini carries the original call ID inside response.result rather than a tool_call_id.
  if(row.name==='workspace_fixture'&&row.response&&typeof row.response==='object'){
   const response=row.response as Record<string,unknown>,result=response.result;
   const retained=result&&typeof result==='object'?projected((result as Record<string,unknown>).callId):undefined;
   if(retained)return {...row,response:{...response,result:retained}};
  }
  return Object.fromEntries(Object.entries(row).map(([key,item])=>[key,visit(item)]));
 }
 request.wireBody=visit(request.wireBody) as Record<string,unknown>;
 request.manifest.inputTokens+=Math.max(0,Math.ceil((JSON.stringify(request.wireBody).length-previous.length)/4));
 if(!request.manifest.transformations.includes('Exact owned workspace result observations replace legacy fixture results'))request.manifest.transformations.push('Exact owned workspace result observations replace legacy fixture results');
 return next;
}

/** Compile declared workspace fixture actions onto existing admitted tool identities.
 * There is no real shell, Docker daemon, provider health probe or external filesystem. */
export function withEnvironment(base:SimulationEvent[],document:LinaDocument,scenario:EnvironmentCase='disabled',settings:Partial<EnvironmentSettings>={},options:{seed?:EnvironmentFixtureState;answers?:Record<string,SimulationAnswer>;stopped?:boolean;agentId?:string}={}):EnvironmentSimulationEvent[]{
 if(scenario==='disabled'||scenario==='pure-bypass'||scenario==='external-bypass')return base;
 const config={...DEFAULT_ENVIRONMENT_SETTINGS,...environmentScenarioSettings(scenario),...settings},store=options.seed?clone(options.seed):createEnvironmentFixtureState(options.agentId??'main',config),output:EnvironmentSimulationEvent[]=[];
 let serial=0,acquired=Boolean(options.seed),terminalFailure=false;
 const owned=(event:SimulationEvent)=>(event.agentId??options.agentId??'main')===store.agentId,n=(suffix:string)=>`lina-environment-${suffix}`;
 const mapped=new Map<string,{kind:EnvironmentProcess['kind'];path?:string}>(),retainedResults=new Map<string,SimulationResult>();
 function emit(source:string,target:string,phase:string,outcome:string,reason:string,extra:Partial<EnvironmentSimulationEvent>={}){
  const edge=document.edges.find(row=>row.source===source&&row.target===target);output.push({id:`environment:${store.agentId}:${serial++}:${phase}`,agentId:options.agentId,sourceNodeId:source,nodeId:target,edgeId:edge?.id??`missing-environment-edge:${source}:${target}`,update:{detail:reason},environmentSnapshot:clone(store),environmentEvidence:{phase,outcome,reason,environmentId:store.environment.id,generation:store.environment.generation},...extra});
 }
 function persist(owner:string,phase:string,outcome:string){emit(n(owner),'lina-state-record',phase,outcome,'Persist scoped environment lifecycle/operation receipt');emit('lina-state-record',n(owner),phase,'acknowledged','Resume original environment owner after State receipt');}
 function receipt(event:SimulationEvent,phase:string,outcome:string,reason:string):EnvironmentSimulationEvent{return {...event,environmentSnapshot:clone(store),environmentEvidence:{phase,outcome,reason,environmentId:store.environment.id,generation:store.environment.generation}};}
 function setup(source:string):boolean {
  acquired=true;emit(source,n('profile'),'profile','selected',`${config.backend}: explicit workspace backend; local root is not containment`);
  emit(n('profile'),n('workspace'),'workspace','bound','Bind explicit workspace identity and access mappings');
  emit(n('workspace'),n('acquire'),'acquire','requested','Acquire or attach fixture environment, retaining resource ownership');
  persist('acquire','acquire-intent','intent-recorded');const ready=acquireEnvironment(store,scenario!=='unavailable');persist('acquire','acquire',ready);emit(n('acquire'),n('ready'),'inspect',ready,'Inspect backend capability and environment generation');
  if(ready==='unavailable'){emit(n('acquire'),n('collect'),'inspect','failed','Selected backend unavailable; no host fallback');emit(n('collect'),'lina-execution-settle','inspect','failed','No workspace launch',{update:{outcome:'failed'}});return false;}
  emit(n('ready'),n('stage'),'stage','binding',`${store.workspace.storage}: explicit original and execution files`);
  persist('stage','stage-intent','intent-recorded');const bound=bindEnvironmentWorkspace(store,scenario!=='staging-failure');persist('stage','stage',bound);emit(n('stage'),n('ready'),'prepare',bound,'Stage configured workspace without changing original copied project');
  if(bound==='failed'||scenario==='missing-dependency'){store.error=bound==='failed'?'staging-failure':'missing-dependency';emit(n('ready'),n('collect'),'prepare','failed',store.error);emit(n('collect'),'lina-execution-settle','prepare','failed',store.error,{update:{outcome:'failed'}});return false;}
  emit(n('ready'),n('stage'),'ready','ready','Prepared fixture environment; requested and enforced profile retained');
  emit(n('stage'),n('ready'),'stage','ready','Input stage returned verified workspace binding');
  emit(n('ready'),'lina-execution-prepare','ready','bound','Return environment/workspace binding to normal context preparation');return true;
 }
 function wait(source:string,operationId:string,reason:string):SimulationAnswer|undefined{
  const id=`environment:reconcile:${store.agentId}:${operationId}`,answer=options.answers?.[id];
  emit(source,n('reconcile'),'reconcile','unknown',reason);
  emit(n('reconcile'),'lina-execution-wait','reconcile','waiting',reason,{wait:{id,kind:'environment-reconciliation',owner:'environment',environmentId:store.environment.id,operationId,ownerNodeId:n('reconcile')}});
  if(answer==='known-success'||answer==='known-no-effect'){emit('lina-execution-wait',n('reconcile'),'reconcile',answer,'Inspect existing identity; never relaunch unresolved work',{resumeWait:true});return answer;}return undefined;
 }
 function finalize(source:string,forceRelease=false){
  emit(source,n('release'),'release','requested','Account obligations at turn settlement');
  emit(n('release'),n('artifacts'),'artifacts','collected','Collect selected output references before retention or cleanup');
  for(const artifact of Object.values(store.artifacts)){const exported=exportEnvironmentArtifact(store,artifact.id,scenario!=='export-failure');persist('artifacts','export',exported);emit(n('artifacts'),n('collect'),'export',exported,`${artifact.id}: explicit fixture transfer`);emit(n('collect'),n('artifacts'),'artifacts',exported,'Retain export receipt and source identity');}
  emit(n('artifacts'),n('release'),'release','requested','Release owned lease; attached workspace cannot be deleted');
  const released=releaseEnvironment(store,scenario!=='cleanup-uncertain');persist('release','release',released);
  if(released==='unknown'){const answer=wait(n('release'),'cleanup','Cleanup response lost; environment deletion unconfirmed');if(!answer)return false;if(answer==='known-success'){releaseEnvironment(store,true);}else{store.cleanup='retained';}emit(n('reconcile'),n('release'),'release',store.cleanup,'Observed original cleanup disposition');}
  if(store.cleanup==='blocked'){
   const operationId=Object.values(store.artifacts).some(artifact=>artifact.exportStatus!=='exported')?'export-barrier':'process-barrier';
   const answer=wait(n('release'),operationId,'Cleanup withheld until required artifact custody and process outcomes are known');if(!answer)return false;
   if(operationId==='export-barrier'&&answer==='known-success'){for(const artifact of Object.values(store.artifacts))exportEnvironmentArtifact(store,artifact.id,true);}
   else if(operationId==='process-barrier'){for(const process of Object.values(store.processes))if(live(process)||process.effect==='unknown'){if(answer==='known-no-effect'){process.effect='none';cancelEnvironmentProcess(store,process.operationId,true);}else if(process.generation!==store.environment.generation){process.status='failed';process.effect='none';process.cancellation='confirmed';}else observeEnvironmentProcess(store,process.operationId,{generation:store.environment.generation,status:'success'});}}
   releaseEnvironment(store,true);emit(n('reconcile'),n('release'),'release',store.cleanup,'Barrier inspected under original operation identities');if(store.cleanup==='blocked')return false;
  }
  persist('release','release',store.cleanup);
  if(scenario==='release-repeat'){releaseEnvironment(store,true);output.push({id:`environment:${store.agentId}:${serial++}:duplicate-release`,nodeId:n('release'),update:{detail:'Idempotent repeated lease release'},environmentSnapshot:clone(store)});}
  if(forceRelease||!base.some(event=>owned(event)&&event.nodeId==='lina-execution-release'))emit(n('release'),'lina-execution-release','release',store.cleanup,'Environment retention outcome recorded independently of turn outcome');return true;
 }
 for(const sourceEvent of base){
  if(!owned(sourceEvent)){output.push(sourceEvent);continue;}
  const original=projectEnvironmentResults(environmentModelEvent(sourceEvent,scenario),store,retainedResults);
  if(original.modelRequest){const request=original.modelRequest,text=JSON.stringify({type:'execution-environment',authority:'environment-data',environmentId:store.environment.id,generation:store.environment.generation,backend:store.environment.backend,workspace:{id:store.workspace.id,root:store.workspace.root,access:store.workspace.access,storage:store.workspace.storage},capabilities:store.environment.capabilities,requested:{network:config.network,commandTimeoutMs:config.commandTimeoutMs,maxOutputBytes:config.maxOutputBytes},enforced:store.environment.profile.enforced});
   request.manifest.inputTokens+=Math.ceil(text.length/4);request.manifest.transformations.push('Bounded environment binding metadata; fixture character-based token estimate');
   const body=request.wireBody;if(request.binding.protocol==='openai-chat')body.messages=[...(body.messages as unknown[]),{role:'user',content:text}];else if(request.binding.protocol==='openai-responses')body.input=[...(body.input as unknown[]),{role:'user',content:[{type:'input_text',text}]}];else if(request.binding.protocol==='anthropic-messages')body.messages=[...(body.messages as unknown[]),{role:'user',content:[{type:'text',text}]}];else body.contents=[...(body.contents as unknown[]),{role:'user',parts:[{text}]}];
  }
  if(!acquired&&original.nodeId==='lina-execution-start'){output.push(original);if(!setup(original.nodeId))return output;continue;}
  if(!acquired&&original.nodeId==='lina-execution-prepare'){if(!setup(original.sourceNodeId??original.nodeId))return output;}
  if(original.nodeId==='lina-tools-dispatch'&&original.operations?.some(operation=>operation.status==='running')&&!options.stopped){
   const event=clone(original),running=event.operations!.filter(operation=>operation.status==='running');
   output.push({...event,operations:event.operations!.map(operation=>operation.status==='running'?{...operation,status:'pending'}:operation)});

   for(const operation of running){
    const ordinal=Number(operation.callId.match(/call-(\d+)/)?.[1]??(operation.callId==='one'?1:2));
    const kind:EnvironmentProcess['kind']=['background','stdin','timeout','uncertain-launch','uncertain-termination','truncated-output','resource-exhaustion'].includes(scenario)?'command':ordinal%2===1?'write':'read',path=kind==='command'?undefined:'result.txt';mapped.set(operation.callId,{kind,path});
    const operationId=`environment-operation:${operation.attemptId}`;
    const outcome=launchEnvironmentProcess(store,{operationId,callId:operation.callId,attemptId:operation.attemptId,generation:scenario==='stale-binding'?0:store.environment.generation,kind,path},scenario!=='uncertain-launch');
    const process=store.processes[operationId];
    if(process){const status=process.status,effect=process.effect,outcomeBefore=store.transactions[operationId].outcome;process.status='intent';process.effect='none';store.transactions[operationId].outcome='intent';
     emit('lina-tools-dispatch',n(kind==='command'?'start':'files'),'intent','recorded','Register original workspace operation before backend invocation',{operations:[{...operation,status:'pending',nodeId:n(kind==='command'?'start':'files')}]});
     emit(n(kind==='command'?'start':'files'),'lina-state-record','intent','recorded','Record exact launch identity and environment generation');
     emit('lina-state-record',n(kind==='command'?'start':'files'),'intent','acknowledged','Same operation returns to original execution owner');process.status=status;process.effect=effect;store.transactions[operationId].outcome=outcomeBefore;
    }
    output.push({id:`environment:${store.agentId}:${serial++}:launch`,nodeId:n(kind==='command'?'start':'files'),agentId:options.agentId,update:{detail:'Observe original launch admission'},environmentSnapshot:clone(store),environmentEvidence:{phase:'launch',outcome,reason:'Fixture invocation follows intent receipt',environmentId:store.environment.id,generation:store.environment.generation,operationId,operationKind:kind,path},operations:[{...operation,status:outcome==='rejected'?'error':outcome==='unknown'?'unknown':'running',nodeId:n(kind==='command'?'start':'files')}]});

    if(outcome==='unknown'){const answer=wait(n(kind==='command'?'start':'files'),operationId,'Unknown launch does not prove no effect');if(!answer)return output;observeEnvironmentProcess(store,operationId,{generation:store.environment.generation,status:answer==='known-success'?'success':'no-effect',content:'fixture output'});emit(n('reconcile'),n('collect'),'reconcile',answer,'Original launch reconciled without replay');}
    if(outcome==='rejected')terminalFailure=true;
    if(kind==='command'&&process?.status==='running')emit(n('start'),n('process'),'process','running','Register original process handle independently of observation connection');
    if(scenario==='background'){observeEnvironmentProcess(store,operationId,{generation:store.environment.generation,status:'running',stdout:'starting\n'});emit(n('process'),n('process'),'observe','running','Background handle retained; poll observes same process');}
    if(scenario==='stdin'&&kind==='command'){emit(n('process'),n('process'),'input',sendEnvironmentInput(store,operationId,'yes\n'),'Input targets running owned process');emit(n('process'),n('process'),'observe','running','Same process continues after input');}
    emit(n(kind==='command'?(process?.status==='running'?'process':'start'):'files'),n('collect'),'observe','collecting','Return native handle/evidence to owning tool call');
   }
   emit(n('collect'),'lina-tools-collect','observe','registered','Workspace operations remain bound to original tool call and attempt');continue;
  }
  let event=clone(original) as EnvironmentSimulationEvent;
  if(event.stateRestore){
   // State was compiled before environment evidence. Restore only receipts that this
   // environment actually observed; an unobserved legacy result is not rewritten.
   event.stateRestore={...event.stateRestore,results:event.stateRestore.results.map(result=>retainedResults.get(result.callId)??result),environmentSnapshot:clone(store)};
  }
  if(event.results?.length&&mapped.size){
   event.results=event.results.map(result=>{
    const mapping=mapped.get(result.callId);if(!mapping)return result;const retained=retainedResults.get(result.callId);if(retained)return retained;
    const process=Object.values(store.processes).find(row=>row.callId===result.callId&&live(row))??Object.values(store.processes).filter(row=>row.callId===result.callId).at(-1);
    const failed=!process||['resource-exhaustion','timeout'].includes(scenario),initialStatus:SimulationResult['status']=failed?'error':result.status;let status=initialStatus;
    if(process){
     if(scenario==='uncertain-termination'){cancelEnvironmentProcess(store,process.operationId,false);const answer=wait(n('process'),process.operationId,'Termination unconfirmed; preserve process identity');if(!answer)return {callId:result.callId,status:'skipped',artifactRef:`unresolved:${process.id}`};if(answer==='known-success')cancelEnvironmentProcess(store,process.operationId,true);else observeEnvironmentProcess(store,process.operationId,{generation:process.generation,status:'success',content:'fixture output'});}
     else if(scenario==='timeout')cancelEnvironmentProcess(store,process.operationId,true);
     else {const observed=observeEnvironmentProcess(store,process.operationId,{generation:process.generation,status:status==='success'?'success':'failed',content:'fixture output',stdout:scenario==='truncated-output'?'Long fixture output retained in artifact log\n':'fixture process output\n',stderr:failed?scenario:''});if(observed==='stale'){status='error';terminalFailure=true;}}
     if(process.status==='failed')status='error';if(process.status==='cancelled')status='cancelled';if(process.status==='unknown'){status='error';terminalFailure=true;}
     if(status==='success'&&mapping.path&&mapping.kind==='write'){const id=`artifact:workspace:${process.operationId}`;store.artifacts[id]={id,processId:process.id,environmentId:store.environment.id,generation:process.generation,path:mapping.path,content:store.workspace.files[mapping.path]??'',exportStatus:'pending'};}
    }
    const accounted={callId:result.callId,status,artifactRef:process?`environment-result:${process.id}`:`environment-error:${result.callId}`};retainedResults.set(result.callId,accounted);if(status==='error'||status==='cancelled')terminalFailure=true;return accounted;
   });
   if(output.at(-1)?.wait)return output;persist('collect','collect','observed');
   event.operations=event.operations?.map(operation=>mapped.has(operation.callId)?{...operation,status:event.results!.find(row=>row.callId===operation.callId)?.status??operation.status,nodeId:'lina-tools-collect'}:operation);
   event=receipt(event,'observe',event.results.some(row=>row.status==='error')?'failed':'observed','Workspace fixture result replaces arithmetic value; original call identity retained');
   if(['disk-restart','memory-resume','unsupported-resume'].includes(scenario)&&!store.restoration){const preservation=scenario==='disk-restart'?'filesystem-only':'filesystem-and-memory';emit(n('collect'),n('reconcile'),'recover',recoverEnvironment(store,preservation),'Inspect actual disk/memory preservation and generation');emit(n('reconcile'),n('collect'),'recover',store.restoration??'unsupported','Return recovery evidence, not an automatic command replay');event=receipt(event,'recover',store.restoration??'unsupported','Actual preservation retained');}
  }
  if(event.nodeId==='lina-execution-tool-outcomes'&&(terminalFailure||['resource-exhaustion','timeout'].includes(scenario))){
   event.update={...event.update,toolOutcome:'fatal-error'};output.push(event);
   const edge=document.edges.find(edge=>edge.source===event.nodeId&&edge.target==='lina-execution-settle');output.push({id:`environment:${store.agentId}:${serial++}:failed-settle`,nodeId:'lina-execution-settle',sourceNodeId:event.nodeId,edgeId:edge?.id??'lina-execution-edge-outcomes-terminal',agentId:options.agentId,update:{outcome:'failed',detail:'Nonretryable workspace fixture result'},environmentSnapshot:clone(store)});
   finalize('lina-execution-settle',true);return output;
  }
  if(terminalFailure||['resource-exhaustion','timeout'].includes(scenario)){if(event.nodeId==='lina-execution-observe')event.update={...event.update,toolOutcome:'fatal-error'};if(event.modelEvent||event.modelRequest||event.modelWork?.purpose==='invocation')continue;if(event.update.outcome==='completed')event.update={...event.update,outcome:'failed'};}
  if(event.nodeId==='lina-execution-cancel'||options.stopped&&event.nodeId==='lina-tools-collect'){for(const process of Object.values(store.processes))if(live(process))cancelEnvironmentProcess(store,process.operationId,scenario!=='uncertain-termination');persist('process','cancel','observed');event=receipt(event,'cancel','observed','Cancel owned work without destroying environment');}
  if(event.nodeId==='lina-execution-settle'){output.push(event);if(!finalize(event.nodeId))return output;continue;}
  if(event.nodeId==='lina-execution-release'&&acquired){const edge=document.edges.find(edge=>edge.source===n('release')&&edge.target===event.nodeId);event={...receipt(event,'release',store.cleanup,'Original execution release receives environment lease disposition'),sourceNodeId:n('release'),edgeId:edge?.id};}
  output.push(event);
 }
 return output;
}
