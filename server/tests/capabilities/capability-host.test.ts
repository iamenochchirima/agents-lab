import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { CapabilityHost } from '../../src/capabilities/extensions/host.js';
import { contribution } from '../../src/capabilities/extensions/package-utils.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { RunEvidenceStore } from '../../src/control-plane/application/evidence-store.js';
import { buildRunManifest } from '../../src/control-plane/domain/manifest.js';
import { ToolRegistry } from '../../src/capabilities/tools/registry.js';
import { createDefaultSkillCatalog } from '../../src/capabilities/skills/catalog.js';

test('host rechecks frozen admission and authentication, deduplicates calls and rejects conflicting identities', async()=>{
  const root=await mkdtemp(join(tmpdir(),'capability-host-')); const app=Fastify(); let effects=0;
  try {
    const tool=contribution({id:'example',version:'1.0.0'},'write','Write a task value.',{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},'write',async (args,context)=>{effects++;if(args.value==='lose-ack')await mkdir(join(root,context.runId,'artifacts/capability-calls',createHash('sha256').update(context.toolCallId!).digest('hex')+'.json.pending'));context.onConnectionResult?.({requestId:'connection-one',status:'completed',output:{saved:true},attempts:[{requestId:'connection-one',attempt:1,startedAt:'2026-10-08T00:00:00.000Z',finishedAt:'2026-10-08T00:00:00.001Z',status:'completed',retryable:false,providerRequestId:'remote-one',errorCode:null,errorMessage:null}],error:null});return JSON.stringify(args);},'a'.repeat(64));
    const catalog=new CapabilityCatalog([],[],undefined,undefined,{toolDescriptors:[tool.descriptor]});
    const snapshot=catalog.toolSnapshot([tool.descriptor.definition.name]);
    const evidence=new RunEvidenceStore(root);
    const manifest=buildRunManifest({platform:'mastra',variant:'baseline',task:{kind:'prompt',prompt:'Write value'},model:{provider:'fake',model:'fake-completion'},capabilities:{tools:{enabledNames:[tool.descriptor.definition.name],approvedNames:[tool.descriptor.definition.name],maxRounds:4,maxCalls:4},toolCatalog:snapshot}}, {runId:'test-run',context:{turnId:'test-turn'}});
    await evidence.createRun(manifest);
    const host=new CapabilityHost(evidence,[tool],'b'.repeat(64));host.register(app);
    const body={runId:'test-run',turnId:'test-turn',catalogRevision:snapshot.revision,call:{toolCallId:'one',name:tool.descriptor.definition.name,arguments:{value:'ready'},round:1}};
    assert.equal((await app.inject({method:'POST',url:'/internal/capabilities/execute',payload:body})).statusCode,401);
    assert.equal(effects,0);
    const request=()=>app.inject({method:'POST',url:'/internal/capabilities/execute',headers:{authorization:`Bearer ${'b'.repeat(64)}`},payload:body});
    const [first, duplicate]=await Promise.all([request(),request()]);
    assert.equal(first.statusCode,200);assert.equal(duplicate.statusCode,200);assert.equal(first.json().status,'completed');assert.equal(effects,1);
    assert.equal((await host.execute(body,new AbortController().signal)).status,'completed');assert.equal(effects,1);
    await assert.rejects(host.execute({...body,call:{...body.call,arguments:{value:'other'}}},new AbortController().signal),/Conflicting/);
    await assert.rejects(host.execute({...body,catalogRevision:'c'.repeat(64)},new AbortController().signal),/Catalog/);
    const changedSource={...tool,descriptor:{...tool.descriptor,source:{...tool.descriptor.source,digest:'c'.repeat(64)}}};
    const replacementHost=new CapabilityHost(evidence,[changedSource],'b'.repeat(64));
    await assert.rejects(replacementHost.execute({...body,call:{...body.call,toolCallId:'changed-source'}},new AbortController().signal),/Frozen source is unavailable or changed/);
    assert.equal(effects,1,'a retained manifest must not dispatch a replacement source under its old authority');
    const invalid=await host.execute({...body,call:{...body.call,toolCallId:'two',arguments:{value:12}}},new AbortController().signal);
    assert.equal(invalid.status,'failed');assert.equal(effects,1);
    const denied=buildRunManifest({...manifest,task:manifest.task,capabilities:{...manifest.capabilities!,tools:{...manifest.capabilities!.tools,approvedNames:[]}}},{runId:'denied-run',context:{turnId:'test-turn'}});
    await evidence.createRun(denied);
    assert.equal((await host.execute({...body,runId:'denied-run'},new AbortController().signal)).status,'failed');assert.equal(effects,1);
    const directory=join(root,'test-run','artifacts','capability-calls');
    for(const file of await readdir(directory)) {
      const path=join(directory,file); const receipt=JSON.parse(await readFile(path,'utf8'));
      if(receipt.toolCallId==='one') { assert.equal(receipt.connectionResults[0].attempts[0].providerRequestId,'remote-one');assert.deepEqual(receipt.connectionResults[0].output,{saved:true}); delete receipt.result; receipt.status='pending'; await writeFile(path,JSON.stringify(receipt)); }
    }
    const cancelled=buildRunManifest({...manifest,task:manifest.task},{runId:'cancelled-run',context:{turnId:'test-turn'}});
    await evidence.createRun(cancelled);
    await evidence.appendEvent({runId:'cancelled-run',kind:'RunCancellationRequested',payload:{reason:'cancel before effect'},source:'test',sourceSequence:1,occurredAt:'2026-10-08T00:00:00.000Z'});
    assert.equal((await host.execute({...body,runId:'cancelled-run'},new AbortController().signal)).status,'cancelled');assert.equal(effects,1);
    const restarted=new CapabilityHost(evidence,[tool],'b'.repeat(64));
    assert.equal((await restarted.execute(body,new AbortController().signal)).status,'unknown');
    assert.equal(effects,1,'a retained pending dispatch is never repeated after restart');
    const lost={...body,call:{...body.call,toolCallId:'lost-ack',arguments:{value:'lose-ack'}}};
    assert.equal((await restarted.execute(lost,new AbortController().signal)).status,'unknown');
    assert.equal((await restarted.execute(lost,new AbortController().signal)).status,'unknown');
    assert.equal(effects,2,'receipt persistence failure never becomes a blind repeated write');
  } finally {await app.close();await rm(root,{recursive:true,force:true});}
});

test('explicit unknown side effects survive abort classification, and empty skill selection injects no instructions', async()=>{
  const registry=new ToolRegistry({enabledNames:['write'],approvedNames:['write']});const signal=new AbortController();
  registry.register({definition:{schemaVersion:1,name:'write',description:'Write',inputSchema:{type:'object'},riskClass:'write',executionKind:'connection',limits:{timeoutMs:100,maxArgumentBytes:100,maxResultBytes:512}},validateArguments:value=>value as Record<string,unknown>,execute:async()=>{signal.abort();const error=new Error('Acknowledgement lost');error.name='CAPABILITY_OUTCOME_UNKNOWN';throw error;}});
  const validation=registry.validateCall({toolCallId:'one',name:'write',arguments:{},round:1});assert.equal(validation.accepted,true);if(!validation.accepted)return;
  assert.equal((await registry.execute(validation,{runId:'run',turnId:'turn',signal:signal.signal})).status,'unknown');
  assert.deepEqual(createDefaultSkillCatalog().resolve([]),[]);
});

test('catalog publication retains the implementation admitted by old and new runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capability-revisions-'));
  try {
    const schema = { type: 'object', additionalProperties: false };
    const oldTool = contribution({ id: 'versioned', version: '1.0.0' }, 'read', 'Read revision.', schema, 'read', async () => 'old', 'a'.repeat(64));
    const newTool = contribution({ id: 'versioned', version: '2.0.0' }, 'read', 'Read revision.', schema, 'read', async () => 'new', 'c'.repeat(64));
    const evidence = new RunEvidenceStore(root);
    const admit = async (tool: typeof oldTool, runId: string) => {
      const catalog = new CapabilityCatalog([], [], undefined, undefined, { toolDescriptors: [tool.descriptor] });
      const snapshot = catalog.toolSnapshot([tool.descriptor.definition.name]);
      await evidence.createRun(buildRunManifest({
        platform: 'mastra', variant: 'baseline', task: { kind: 'prompt', prompt: 'Read the revision.' },
        model: { provider: 'fake', model: 'fake-completion' },
        capabilities: { tools: { enabledNames: [tool.descriptor.definition.name], maxRounds: 4, maxCalls: 4 }, toolCatalog: snapshot },
      }, { runId, context: { turnId: 'turn' } }));
      return { runId, turnId: 'turn', catalogRevision: snapshot.revision, call: { toolCallId: 'read', name: tool.descriptor.definition.name, arguments: {}, round: 1 } };
    };
    const oldCall = await admit(oldTool, 'old-run');
    const newCall = await admit(newTool, 'new-run');
    const host = new CapabilityHost(evidence, [oldTool], 'b'.repeat(64));
    host.replace([newTool]);
    assert.equal((await host.execute(oldCall, AbortSignal.timeout(1000))).content, 'old');
    assert.equal((await host.execute(newCall, AbortSignal.timeout(1000))).content, 'new');
    // Source content cannot be replaced under the same declared identity.
    assert.throws(() => host.replace([{ ...newTool, descriptor: { ...newTool.descriptor, definition: { ...newTool.descriptor.definition, description: 'Changed without new identity' } } }]), /cannot change/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
