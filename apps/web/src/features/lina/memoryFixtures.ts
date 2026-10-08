import type { LinaDocument } from './linaModel';
import type { SimulationEvent, SimulationCase, ToolScenario, SimulationAnswer } from './inputSimulation';

/** Deterministic design evidence only. These records are discarded on reset. */
export type MemoryCase = 'baseline' | 'disabled' | 'no-matches' | 'unavailable' | 'child-shared' | 'child-denied' | 'child-proposal' | 'explicit-search' | 'remember' | 'correction' | 'conflict' | 'duplicate-write' | 'lost-ack' | 'index-lag' | 'consolidate' | 'forget' | 'forget-pending' | 'stale-recall' | 'poisoned-source' | 'cancel-beforewrite' | 'cancel-afterwrite';
export const MEMORY_CASES: {value:MemoryCase;label:string}[] = [
 ['baseline','Profile and admitted automatic memory'],['disabled','Memory disabled'],['no-matches','No matching memories'],['unavailable','Optional memory unavailable'],['child-shared','Child reads permitted shared memory'],['child-denied','Child private access denied'],['child-proposal','Parent reviews child publication'],['explicit-search','Explicit memory search'],['remember','Explicit remember request'],['correction','Correct a preference'],['conflict','Conflicting claim remains unresolved'],['duplicate-write','Duplicate mutation identity'],['lost-ack','Lost write acknowledgment'],['index-lag','Commit before index visibility'],['consolidate','Consolidate eligible experiences'],['forget','Forget source and derivatives'],['forget-pending','Forget with pending replica cleanup'],['stale-recall','Reject cached recall after forgetting'],['poisoned-source','Reject recalled instruction as new memory'],['cancel-beforewrite','Cancel unstarted memory write'],['cancel-afterwrite','Cancel after committed memory write'],
].map(([value,label])=>({value:value as MemoryCase,label}));
export interface MemoryRecord {id:string;revision:number;namespace:'user-private'|'workspace-shared'|'agent-private'|'task-local';kind:'fact'|'episode'|'procedure';text:string;status:'active'|'superseded'|'revoked'|'purged';sources:string[];derivedFrom:string[];supersedes?:string;origin:'user-assertion'|'observed-result'|'derived';validFrom?:string;validUntil?:string;observedAt?:string;}
export interface MemoryEvidence {phase:'scope'|'query'|'retrieve'|'select'|'capture'|'extract'|'validate'|'resolve'|'commit'|'inspect'|'index'|'consolidate'|'forget';outcome:string;reason:string;operationId?:string;recordIds?:string[];}
export interface MemoryFixtureState {storage:'fixture-only';records:Record<string,MemoryRecord>;transactions:Record<string,{fingerprint:string;recordId:string}>;index:{generation:number;recordRevisions:Record<string,number>;pending:string[]};visibilityGeneration:number;selection?:{recordIds:string[];visibilityGeneration:number;recordRevisions:Record<string,number>};cleanup?:{status:'pending'|'complete';targets:string[];coverage:string[];pending:string[]};job?:{status:'proposed'|'cancelled'|'committed';sourceIds:string[];};}
const clone=<T>(value:T):T=>structuredClone(value);
export function createMemoryFixtureState():MemoryFixtureState {
 const records:MemoryFixtureState['records']={
  preference:{id:'preference',revision:1,namespace:'user-private',kind:'fact',text:'Prefer concise answers',status:'active',sources:['input:user:preference'],derivedFrom:[],origin:'user-assertion',validFrom:'2026-10-01T00:00:00Z',observedAt:'2026-10-01T00:00:00Z'},
  episode:{id:'episode',revision:1,namespace:'workspace-shared',kind:'episode',text:'Observed tests passed after using the documented command',status:'active',sources:['artifact:verified-test-result'],derivedFrom:[],origin:'observed-result'},
  private:{id:'private',revision:1,namespace:'agent-private',kind:'fact',text:'Parent private investigation note',status:'active',sources:['input:parent:note'],derivedFrom:[],origin:'user-assertion'},
 };
 return {storage:'fixture-only',records,transactions:{},index:{generation:1,recordRevisions:{preference:1,episode:1,private:1},pending:[]},visibilityGeneration:1};
}
/** Stable operation identity plus expected revisions: an acknowledged duplicate is a no-op. */
export function commitMemoryFixture(store:MemoryFixtureState,operationId:string,record:MemoryRecord,expectedRevision:number):'applied'|'already-applied'|'conflict'|'revoked-source' {
 const fingerprint=JSON.stringify({record,expectedRevision});const previous=store.transactions[operationId];
 if(previous)return previous.fingerprint===fingerprint?'already-applied':'conflict';
 if(record.derivedFrom.some(id=>!store.records[id]||store.records[id].status!=='active'))return 'revoked-source';
 if((store.records[record.id]?.revision??0)!==expectedRevision)return 'conflict';
 store.records[record.id]=clone(record);store.transactions[operationId]={fingerprint,recordId:record.id};
 if(!store.index.pending.includes(record.id))store.index.pending.push(record.id);return 'applied';
}
/** Revocation precedes purge and invalidates cached selections and pending derivation. */
export function forgetMemoryFixture(store:MemoryFixtureState,target:string,pending=false):string[] {
 const targets=new Set([target]);let changed=true;
 while(changed){changed=false;for(const record of Object.values(store.records))if(record.derivedFrom.some(id=>targets.has(id))&&!targets.has(record.id)){targets.add(record.id);changed=true;}}
 for(const id of targets){const record=store.records[id];if(record){record.status='revoked';record.revision++;}}
 store.visibilityGeneration++;store.selection=undefined;
 if(store.job?.sourceIds.some(id=>targets.has(id)))store.job.status='cancelled';
 store.cleanup={status:pending?'pending':'complete',targets:[...targets],coverage:['authoritative records','derived records','local index','cached selections','pending consolidation'],pending:pending?['configured remote replica']:[]};
 return [...targets];
}
export function selectMemoryFixture(store:MemoryFixtureState,ids:string[],namespaces:MemoryRecord['namespace'][]):MemoryRecord[] {
 return ids.flatMap(id=>{const row=store.records[id];return row&&row.status==='active'&&namespaces.includes(row.namespace)?[clone(row)]:[];});
}
export function memoryScenarioSettings(scenario:MemoryCase):Partial<{executionCase:SimulationCase;toolScenario:ToolScenario}> {
 return ['child-proposal','explicit-search','remember','correction','conflict','duplicate-write','lost-ack','forget','forget-pending','stale-recall'].includes(scenario)?{executionCase:'tool-round',toolScenario:'parallel'}:{};
}

/** Branches return to the requesting owner. Memory never invents model attempts or tool results. */
export function withMemory(base:SimulationEvent[],document:LinaDocument,scenario:MemoryCase='baseline',seed?:MemoryFixtureState,options?:{stopped?:boolean;answers?:Record<string,SimulationAnswer>;childAgentId?:string;sharedRead?:boolean}):SimulationEvent[] {
 const store=seed?clone(seed):createMemoryFixtureState(),output:SimulationEvent[]=[];let serial=0,recalled=false,mutated=false;const observedArtifacts=new Set<string>();
 // Child fixtures start in their own empty private store. Only an explicit
 // shared-read scope may expose the shared seed; parent/user private seeds never cross.
 if(options?.childAgentId&&!seed){
  store.records=Object.fromEntries(Object.entries(store.records).filter(([,record])=>options.sharedRead&&record.namespace==='workspace-shared'));
  store.index.recordRevisions=Object.fromEntries(Object.entries(store.index.recordRevisions).filter(([id])=>Boolean(store.records[id])));
 }
 const emit=(source:string,target:string,evidence:MemoryEvidence)=>{
  const edge=document.edges.find(edge=>edge.source===source&&edge.target===target);
  output.push({id:`memory:${serial++}:${evidence.phase}`,nodeId:target,sourceNodeId:source,edgeId:edge?.id??`missing-memory-edge:${source}:${target}`,update:{detail:evidence.reason},memoryEvidence:evidence,memorySnapshot:clone(store)});
 };
 const step=(source:string,target:string,phase:MemoryEvidence['phase'],outcome:string,reason:string,recordIds?:string[],operationId?:string)=>emit(source,target,{phase,outcome,reason,recordIds,operationId});
 const n=(suffix:string)=>`lina-memory-${suffix}`;
 function recall(owner:string,explicit=false){
  const receiver=owner==='lina-tools-dispatch'?'lina-tools-collect':owner;
  step(owner,n('scope'),'scope','requested',explicit?'Explicit registered memory search':'Optional small profile requested by Context');
  if(scenario==='disabled'||scenario==='unavailable'||scenario==='child-denied'){
   step(n('scope'),receiver,'scope',scenario==='disabled'?'disabled':scenario==='unavailable'?'unavailable':'denied',scenario==='child-denied'?'Child cannot read parent-private namespace':'Optional dependency returns a distinct empty/failure outcome');return;
  }
  const child=scenario==='child-shared',namespaces:MemoryRecord['namespace'][]=child?['workspace-shared']:options?.childAgentId?['agent-private']:['user-private','workspace-shared'];
  if(explicit)step(n('scope'),n('query'),'query','ready','Original explicit query retained; exact/lexical fixture control');
  step(explicit?n('query'):n('scope'),n('retrieve'),'retrieve',scenario==='no-matches'?'no-matches':'candidates',child?'Child receives only explicitly permitted shared namespace':'Bounded profile exact lookup; index revision is declared');
  const ids=scenario==='no-matches'?[]:child?['episode']:options?.childAgentId?Object.values(store.records).filter(record=>record.namespace==='agent-private').map(record=>record.id):explicit?['episode']:['preference'];
  const selected=selectMemoryFixture(store,ids,namespaces);
  store.selection={recordIds:selected.map(r=>r.id),visibilityGeneration:store.visibilityGeneration,recordRevisions:Object.fromEntries(selected.map(r=>[r.id,r.revision]))};
  step(n('retrieve'),n('select'),'select',selected.length?'selected':'no-matches','Filter permissions and retired records before packaging evidence',store.selection.recordIds);
  step(n('select'),receiver,'select','returned','Context owns final exposure budget; memory evidence grants no instructions',store.selection.recordIds);
 }
 function mutation(owner:string,automatic=false,callId?:string){
  const receiver=owner==='lina-tools-dispatch'?'lina-tools-collect':owner;
  const operationId=`memory-operation:${callId??'turn-fixture:auto-write'}`;
  step(owner,n('scope'),'scope','requested',automatic?'Eligible completed-turn observations requested':'Explicit memory mutation retains original tool call identity',undefined,operationId);
  if(['disabled','unavailable','child-denied','child-shared','no-matches','explicit-search'].includes(scenario)){step(n('scope'),receiver,'scope','no-op','No mutation admitted for this case');return;}
  if(['forget','forget-pending','stale-recall'].includes(scenario)){
   store.records.lesson={id:'lesson',revision:1,namespace:'workspace-shared',kind:'procedure',text:'Derived preference lesson',status:'active',sources:['input:user:preference'],derivedFrom:['preference'],origin:'derived'};
   store.job={status:'proposed',sourceIds:['preference']};
   step(n('scope'),n('forget'),'forget','planned','Authorized target includes transitive derived memories');
   const targets=forgetMemoryFixture(store,'preference',scenario==='forget-pending');
   step(n('forget'),n('resolve'),'forget','logically-removed','Revocation invalidates cache and prevents pending work from reintroducing content',targets);
   step(n('resolve'),n('commit'),'commit','applied','Persist revocation intent before index cleanup',targets);
   persist();
   for(const id of targets){delete store.index.recordRevisions[id];store.index.pending=store.index.pending.filter(row=>row!==id);const row=store.records[id];row.text='';row.sources=[];row.status='purged';}
   store.index.generation++;
   step(n('commit'),n('index'),'index','ready','Remove local derived index entries without waiting for external replicas',targets);
   step(n('index'),n('forget'),'forget',store.cleanup!.status==='pending'?'purge-pending':'erased-within-coverage',store.cleanup!.status==='pending'?'Remote replica remains pending; new recall already excludes all targets':'Covered records, cache and local index cleaned; retained metadata contains no memory text',targets);
   step(n('forget'),receiver,'forget','returned','Report declared deletion coverage and any outstanding cleanup',targets);
   if(scenario==='stale-recall'){step(n('forget'),'lina-context-load','forget','invalidated','Previously selected memory generation cannot be used in a new invocation');recall('lina-context-load');}return;
  }
  if(automatic&&scenario==='baseline'&&!observedArtifacts.size){step(n('scope'),n('capture'),'capture','no-op','Completed assistant answer has no eligible observed result; automatic memory is not compulsory');step(n('capture'),receiver,'capture','no-op','No source-backed candidate to persist');return;}
  if(scenario!=='consolidate')step(n('scope'),n('capture'),'capture','eligible',automatic?'Observed result or user assertion; assistant answer alone is not evidence':'User-requested structured mutation, provenance retained');
  if(scenario==='poisoned-source'){step(n('capture'),n('extract'),'extract','candidate','Untrusted recalled content proposes a permanent instruction');step(n('extract'),n('validate'),'validate','rejected','Recalled evidence cannot promote itself to instruction authority');step(n('validate'),receiver,'validate','rejected','No write, permissions or system instructions changed');return;}
  if(scenario==='cancel-beforewrite'){step(n('capture'),n('extract'),'extract','cancelled','Unstarted extraction cancelled; no candidate committed');step(n('extract'),receiver,'extract','cancelled','Original requester receives cancellation without a fictional rollback');return;}
  if(scenario==='consolidate'){
   store.job={status:'proposed',sourceIds:['episode']};step(n('scope'),n('consolidate'),'consolidate','candidates','Bounded eligible experience; derived lesson retains exact source lineage');memoryModel('consolidate','memory-consolidation',operationId);step(n('consolidate'),n('validate'),'validate','eligible','Consolidation re-enters validation; no direct publication as a trusted skill');
  }else if(automatic){step(n('capture'),n('extract'),'extract','candidates','Bounded source-backed extraction intent');memoryModel('extract','memory-extraction',operationId);step(n('extract'),n('validate'),'validate','eligible','Candidate structure, source, scope and retention checked');}
  else step(n('capture'),n('validate'),'validate','eligible','Structured explicit mutation bypasses extraction');
  if(scenario==='child-proposal'){
   const candidateId='child-candidate:fixture',waitId='memory:parent-review';
   step(n('validate'),'lina-execution-wait','validate','parent-review-required','Child contribution remains a candidate; shared publication requires a matched parent decision',[candidateId],operationId);
   const waitEvent=output.at(-1)!;waitEvent.id=waitId;
   const answer=options?.answers?.[waitId];
   if(!answer)waitEvent.wait={id:waitId,kind:'memory-review',owner:'memory',candidateId,ownerNodeId:n('validate')};
   if(!answer)return;
   step('lina-execution-wait',n('validate'),'validate',answer==='allow-once'?'reviewed':'rejected',answer==='allow-once'?'Parent reviews this exact child candidate; no persistent publication grant is created':'Parent denies or expires the candidate; no shared write',[candidateId],operationId);
   output.at(-1)!.resumeWait=true;
   if(answer!=='allow-once'){step(n('validate'),receiver,'validate','rejected','Child proposal is not committed or published',[candidateId],operationId);return;}
  }
  step(n('validate'),n('resolve'),'resolve',scenario==='conflict'?'unresolved':'reviewed',scenario==='conflict'?'Ambiguous contradictory claims retained for review; newest text does not silently win':'Stable identity, expected revision and provenance bound');
  if(scenario==='conflict'){step(n('resolve'),receiver,'resolve','unresolved','No authoritative fact overwritten');return;}
  const correction=scenario==='correction';
  const record:MemoryRecord={id:correction?'preference-current':scenario==='consolidate'?'lesson':'remembered',revision:1,namespace:options?.childAgentId&&scenario!=='child-proposal'?'agent-private':automatic||scenario==='child-proposal'?'workspace-shared':'user-private',kind:scenario==='consolidate'?'procedure':'fact',text:correction?'Prefer detailed explanations':scenario==='consolidate'?'Use the documented test command':'Requested preference or observed fact',status:'active',sources:[scenario==='child-proposal'?'child:fixture:source':automatic?[...observedArtifacts][0]??'artifact:verified-test-result':'input:user:remember'],derivedFrom:scenario==='consolidate'?['episode']:[],...(correction?{supersedes:'preference',validFrom:'2026-10-08T00:00:00Z'}:{}),observedAt:'2026-10-08T00:00:00Z',origin:scenario==='consolidate'?'derived':automatic?'observed-result':'user-assertion'};
  step(n('resolve'),n('commit'),'commit','intent','Reviewed conditional mutation staged; it is not a published memory yet',[record.id],operationId);
  step(n('commit'),'lina-safety-authorize','commit','requested','Final exact mutation scope and current policy authority recheck',[record.id],operationId);
  step('lina-safety-authorize',n('commit'),'commit','admitted','Bounded mutation admitted; no tool permission is broadened',[record.id],operationId);
  step(n('commit'),'lina-state-record','commit','requested','Persist original memory transaction and expected revisions',[record.id],operationId);
  const committed=commitMemoryFixture(store,operationId,record,0);
  if(correction){store.records.preference.status='superseded';store.records.preference.validUntil='2026-10-08T00:00:00Z';store.records.preference.revision++;delete store.index.recordRevisions.preference;}
  if(store.job)store.job.status='committed';
  step('lina-state-record',n('commit'),'commit',scenario==='lost-ack'?'unknown':committed,scenario==='lost-ack'?'Fixture mutation may be applied; inspect same transaction before continuation':'Known fixture acknowledgment publishes authoritative memory',[record.id],operationId);
  if(scenario==='lost-ack'){step(n('commit'),'lina-state-load','inspect','requested','Inspect original transaction identity',[record.id],operationId);step('lina-state-load',n('commit'),'inspect','applied','Original transaction found; no new mutation identity',[record.id],operationId);}
  if(scenario==='duplicate-write'){const replay=commitMemoryFixture(store,operationId,record,0);step(n('commit'),'lina-state-load','inspect','requested','Replay checks original mutation identity',[record.id],operationId);step('lina-state-load',n('commit'),'commit',replay,'Identical operation replay preserves record revision',[record.id],operationId);}
  if(scenario!=='index-lag'){store.index.recordRevisions[record.id]=record.revision;store.index.pending=[];store.index.generation++;}
  step(n('commit'),n('index'),'index',scenario==='index-lag'?'pending':'ready',scenario==='index-lag'?'Acknowledged authoritative write is not yet searchable; exact record lookup remains possible':'Derived index records committed revision; index is replaceable',[record.id]);
  step(n('index'),receiver,'index','returned',scenario==='cancel-afterwrite'?'Cancellation preserves an already committed write; no rollback claimed':'Return correlated memory outcome without inventing another tool result',[record.id]);
 }
 function memoryModel(owner:'extract'|'consolidate',purpose:string,operationId:string){
  step(n(owner),'lina-model-resolve',owner,'requested',`${purpose}: bounded auxiliary request, independent of main turn rounds`,undefined,operationId);
  step('lina-model-resolve','lina-model-encode',owner,'bound',`${purpose}: fixture account, model and budget bound`,undefined,operationId);
  step('lina-model-encode','lina-model-invoke',owner,'fixture-invocation',`${purpose}: simulated model work; no network call or benchmark measurement`,undefined,operationId);
  step('lina-model-invoke','lina-model-normalize',owner,'candidates',`${purpose}: normalized candidate evidence, no main-agent tool dispatch`,undefined,operationId);
  step('lina-model-normalize',n(owner),owner,'returned',`${purpose}: return to exact auxiliary purpose owner`,undefined,operationId);
 }
 function persist(){step(n('commit'),'lina-state-record','commit','requested','Memory semantic owner requests supported State acknowledgment');step('lina-state-record',n('commit'),'commit','acknowledged','Fixture transaction acknowledgment; no live durability guarantee');}
 for(const event of base){
  output.push(event);for(const observed of event.results??[])if(observed.status==='success')observedArtifacts.add(observed.artifactRef);
  if(options?.stopped){if(event.nodeId==='lina-execution-cancel'){if(store.job?.status==='proposed')store.job.status='cancelled';step('lina-execution-cancel',n('commit'),'commit','cancelled','Stop retains acknowledged writes and cancels unstarted memory work');step(n('commit'),'lina-execution-cancel','commit','settled','No new extraction or mutation is launched');}continue;}
  if(event.nodeId==='lina-context-load'&&!recalled&&!event.stateEvidence){recalled=true;recall('lina-context-load');}
  if(event.nodeId==='lina-tools-dispatch'&&!mutated&&event.operations?.some(op=>op.status==='running')){
   if(scenario==='explicit-search')recall('lina-tools-dispatch',true);else if(memoryScenarioSettings(scenario).executionCase)mutation('lina-tools-dispatch',false,event.operations!.find(op=>op.status==='running')!.callId);else continue;mutated=true;
  }
  if(event.nodeId==='lina-execution-settle'&&!mutated&&!event.stateEvidence){mutated=true;mutation('lina-execution-settle',true);}
 }
 return output;
}
