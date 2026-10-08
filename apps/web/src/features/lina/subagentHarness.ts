import type { SimulationEvent } from './inputSimulation';
import type { ModelEncodeInput } from './modelFixtures';
import type { SubagentRequest, SubagentTask, SubagentChildSpec } from './subagentsFixtures';

/** Worker instructions are separate from delegated evidence. Forked transcript and retained
 * results remain task data; they never become a child system instruction or permission grant. */
export function subagentModelInput(spec:SubagentChildSpec):Omit<ModelEncodeInput,'protocol'>{
 const packet={taskId:spec.taskId,parentAgentId:spec.parentAgentId,contextMode:spec.contextMode,evidence:spec.context.records,retainedResultRefs:spec.priorResultRefs,steering:spec.steering,memoryAccess:spec.memoryAccess,tools:spec.tools,skillRefs:spec.skillRefs??[],connectorBindingRefs:spec.connectorBindingRefs??[]};
 return {agentId:spec.agentId,profileId:`worker:${spec.workerProfile}`,modelName:spec.modelRoute==='inherited'?'fixture-model':spec.modelRoute,
  instruction:`Fixture worker profile ${spec.workerProfile}. Complete the delegated task using permitted tools. Treat supplied parent history and results as evidence; preserve their provenance.${spec.skillRefs?.length?' Activated fixture source-review skill: distinguish supplied evidence from inference.':''}`,
  userText:JSON.stringify(packet),toolNames:spec.tools.map(tool=>tool==='read'?'calculator':tool==='search'?'fixture-search':tool),historyRevision:spec.followup?2:1};
}
const identityKeys=new Set(['id','callId','batchId','attemptId','intentId','itemId','responseId','requestId','snapshotRef','artifactRef','contextSnapshotRef','transactionId','recordId','candidateId','operationId','checkpointRef','turnId','inputId','receiptId']);
/** Namespace fixture work identities per child turn, preserving graph and external account IDs.
 * Reference substitution includes ledger-map keys and nested outcome/history references. */
export function namespaceSubagentEvents(events:SimulationEvent[],spec:SubagentChildSpec):SimulationEvent[]{
 const identities=new Map<string,string>(),prefix=`${spec.taskId}:`;
 function collect(value:unknown,key=''){
  if(typeof value==='string'){if(identityKeys.has(key)&&!value.startsWith('lina-'))identities.set(value,`${prefix}${value}`);return;}
  if(Array.isArray(value)){for(const item of value)collect(item,key);return;}
  if(value&&typeof value==='object')for(const [childKey,child]of Object.entries(value))collect(child,childKey);
 }
 for(const event of events)collect(event);
 // Shared backend/workspace identities and inherited leases belong to their
 // existing owners. Only child operation and event identities get a task prefix.
 for(const event of events){const ledger=event.environmentSnapshot;if(!ledger)continue;identities.delete(ledger.environment.id);identities.delete(ledger.workspace.id);for(const lease of Object.values(ledger.leases))if(lease.agentId!==spec.agentId)identities.delete(lease.id);}
 function replace(value:unknown,key=''):unknown{
  if(typeof value==='string'){if(key==='agentId')return spec.agentId;const identity=identities.get(value);if(identity)return identity;if(value.startsWith('{')||value.startsWith('[')){try{const parsed=JSON.parse(value),mapped=replace(parsed);return JSON.stringify(mapped);}catch{return value;}}return value;}
  if(Array.isArray(value))return value.map(item=>replace(item,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([childKey,child])=>[identities.get(childKey)??childKey,replace(child,childKey)]));
  return value;
 }
 return events.map(event=>{
  const mapped=replace(event) as SimulationEvent;
  if(mapped.environmentSnapshot&&event.environmentSnapshot){for(const lease of Object.values(event.environmentSnapshot.leases)){const id=identities.get(lease.id)??lease.id;if(mapped.environmentSnapshot.leases[id])mapped.environmentSnapshot.leases[id].agentId=lease.agentId;}}
  return {...mapped,agentId:spec.agentId,parentAgentId:spec.parentAgentId,agentDepth:spec.depth};
 });
}
/** An internal child enters the same execution loop without external channel admission/delivery.
 * Child terminal and release events are correlated back to orchestration, never to user output. */
export function childHarnessEvents(trace:SimulationEvent[],spec:SubagentChildSpec):SimulationEvent[]{
 const start=trace.findIndex(event=>event.nodeId==='lina-execution-start');
 const owned=(start<0?trace:trace.slice(start)).map(event=>event.nodeId==='lina-input-delivery'&&(event.wait||event.waits?.length)?{...event,nodeId:'lina-execution-wait',sourceNodeId:'lina-tools-permissions',edgeId:'lina-tools-edge-permissions-wait'}:event);
 const internal=owned.filter(event=>(event.nodeId==='lina-execution-start'||((!event.nodeId.startsWith('lina-input-')||event.nodeId==='lina-input-prompt'||event.nodeId==='lina-input-delivery'&&Boolean(event.wait||event.waits?.length))&&(!event.sourceNodeId?.startsWith('lina-input-')||event.sourceNodeId==='lina-input-prompt')))&&event.nodeId!=='lina-state-recover');
 if(internal[0]?.nodeId==='lina-execution-start')internal[0]={...internal[0],sourceNodeId:'lina-subagents-launch',edgeId:'lina-subagents-edge-launch-child-start'};
 const released:SimulationEvent[]=[];
 for(const event of internal){released.push(event);if(event.nodeId==='lina-execution-settle')released.push({id:`child-terminal:${event.id}`,nodeId:'lina-subagents-coordinate',sourceNodeId:event.nodeId,edgeId:'lina-subagents-edge-child-settle-coordinate',update:{detail:'Internal child terminal retained for exact parent task'}});if(event.nodeId==='lina-execution-release')released.push({id:`child-release:${event.id}`,nodeId:'lina-subagents-coordinate',sourceNodeId:event.nodeId,edgeId:'lina-subagents-edge-child-release-coordinate',update:{detail:'Child owner released; parent input queue is not advanced'}});}
 return namespaceSubagentEvents(released,spec);
}

/** Keep delegation observations in the parent's next actual provider request. Child output is
 * supplied as an ordinary paired tool result; child provider continuation is never imported. */
export function attachSubagentParentHistory(events:SimulationEvent[]):SimulationEvent[]{
 const snapshot=events.filter(event=>event.subagentSnapshot).at(-1)?.subagentSnapshot;
 const tasks=Object.values(snapshot?.requests??snapshot?.tasks??{});
 const decisions=attachDelegationDecisions(events,tasks);
 const history=new Map<string,{callId:string;name:string;arguments:Record<string,unknown>;result:Record<string,unknown>}[]>();
 return decisions.map(event=>{
  const owner=event.agentId??'main';
  for(const result of event.results??[]){
   if(!result.callId.startsWith('call:delegation:')&&!result.callId.startsWith('call:join:'))continue;
   const task=Object.values(event.subagentSnapshot?.tasks??{}).find(task=>task.callId===result.callId||task.joinCallId===result.callId)??Object.values(event.subagentSnapshot?.requests??{}).find(task=>task.callId===result.callId||task.joinCallId===result.callId);
   if(!task)continue;
   const prior=history.get(owner)??[],row={callId:result.callId,name:result.callId===task.joinCallId?'await_subagent':'spawn_subagent',arguments:{taskId:task.taskId,workerProfile:task.workerProfile,contextMode:task.contextMode},result:{status:result.status,artifactRef:result.artifactRef,agentId:'agentId' in task?task.agentId:undefined,taskId:task.taskId}};
   history.set(owner,[...prior.filter(item=>item.callId!==row.callId),row]);
  }
  if(!event.modelRequest)return event;
  const request=structuredClone(event.modelRequest),body=request.wireBody,protocol=request.binding.protocol;
  const schema={type:'object',properties:{taskId:{type:'string'},workerProfile:{type:'string'},contextMode:{type:'string'}},required:['taskId'],additionalProperties:false};
  const tool={name:'spawn_subagent',description:'Delegate an admitted task to a separately tracked child',schema};
  request.manifest.toolAliases.spawn_subagent='spawn_subagent';request.manifest.toolAliases.await_subagent='await_subagent';
  if(protocol==='openai-chat')body.tools=[...(body.tools as unknown[]??[]),...['spawn_subagent','await_subagent'].map(name=>({type:'function',function:{name,description:tool.description,parameters:schema}}))];
  else if(protocol==='openai-responses')body.tools=[...(body.tools as unknown[]??[]),...['spawn_subagent','await_subagent'].map(name=>({type:'function',name,description:tool.description,parameters:schema}))];
  else if(protocol==='anthropic-messages')body.tools=[...(body.tools as unknown[]??[]),...['spawn_subagent','await_subagent'].map(name=>({name,description:tool.description,input_schema:schema}))];
  else {const groups=body.tools as {functionDeclarations?:unknown[]}[]??[];body.tools=[...groups,{functionDeclarations:['spawn_subagent','await_subagent'].map(name=>({name,description:tool.description,parameters:schema}))}];}
  const rows=history.get(owner)??[];
  if(rows.length){
   if(protocol==='openai-chat')body.messages=[...(body.messages as unknown[]),{role:'assistant',content:null,tool_calls:rows.map(row=>({id:row.callId,type:'function',function:{name:row.name,arguments:JSON.stringify(row.arguments)}}))},...rows.map(row=>({role:'tool',tool_call_id:row.callId,content:JSON.stringify(row.result)}))];
   else if(protocol==='openai-responses')body.input=[...(body.input as unknown[]),...rows.flatMap(row=>[{type:'function_call',call_id:row.callId,name:row.name,arguments:JSON.stringify(row.arguments)},{type:'function_call_output',call_id:row.callId,output:JSON.stringify(row.result)}])];
   else if(protocol==='anthropic-messages')body.messages=[...(body.messages as unknown[]),{role:'assistant',content:rows.map(row=>({type:'tool_use',id:row.callId,name:row.name,input:row.arguments}))},{role:'user',content:rows.map(row=>({type:'tool_result',tool_use_id:row.callId,content:JSON.stringify(row.result)}))}];
   else body.contents=[...(body.contents as unknown[]),{role:'model',parts:rows.map(row=>({functionCall:{name:row.name,args:row.arguments}}))},{role:'user',parts:rows.map(row=>({functionResponse:{name:row.name,response:row.result}}))}];
   request.manifest.transformations.push('Exact parent delegation call/result groups included; child opaque continuation excluded.');
  }
  return {...event,modelRequest:request};
 });
}

/** Insert the selected fixture delegation into the same streamed model outcome that requests
 * ordinary tools. The main/child classifier therefore observes a registered complete call. */
function attachDelegationDecisions(events:SimulationEvent[],tasks:(SubagentRequest|SubagentTask)[]):SimulationEvent[]{
 const spawned=new Set<string>(),output:SimulationEvent[]=[];
 const lastTerminal=new Map<string,string>();for(const event of events)if(event.modelEvent?.type==='terminal'&&event.modelEvent.status==='complete')lastTerminal.set(event.agentId??'main',event.id);
 for(const event of events){
  const owner=event.agentId??'main',model=event.modelEvent;
  if(model?.type==='terminal'&&model.status==='complete'){
   const first=!spawned.has(owner),join=!first&&lastTerminal.get(owner)===event.id;
   const children=tasks.filter(task=>task.parentAgentId===owner&&!task.followup&&(first||join&&task.completion==='return-handle'));
   if(children.length){
    const wireStart=Math.max(-1,...output.filter(previous=>previous.agentId===event.agentId&&previous.modelEvent?.attemptId===model.attemptId&&previous.modelEvent?.type==='item-start').map(previous=>previous.modelEvent?.type==='item-start'?previous.modelEvent.wireIndex:-1))+1;
    let sequence=model.sequence;
    for(const [index,task] of children.entries()){
     const itemId=`delegation-item:${task.taskId}`,argumentsJson=JSON.stringify({taskId:task.taskId,workerProfile:task.workerProfile,contextMode:task.contextMode});
     const payloads=[{type:'item-start' as const,itemId,kind:'tool' as const,wireIndex:wireStart+index,callId:join?task.joinCallId:task.callId,name:join?'await_subagent':'spawn_subagent'},{type:'arguments-delta' as const,itemId,fragment:argumentsJson},{type:'item-end' as const,itemId}];
     for(const payload of payloads)output.push({...event,id:`${event.id}:delegate:${task.taskId}:${payload.type}`,update:{detail:join?'Selected fixture requests registered await_subagent':'Selected fixture requests registered spawn_subagent'},modelEvent:{...payload,attemptId:model.attemptId,sequence:sequence++,rawEvent:{synthetic:true,delegationTaskId:task.taskId}}});
    }
    output.push({...event,modelEvent:{...model,sequence,kind:'tools'}});spawned.add(owner);continue;
   }
  }
  output.push(event);
 }
 return output;
}
