import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaEnvironmentBlock, ENVIRONMENT_STATE_ROUTES } from '../src/features/lina/environmentBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
const intersects=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('twelve Environment responsibilities replace their region and have unique valid paths',()=>{
 assert.deepEqual(linaEnvironmentBlock.nodes.map(n=>n.id),['profile','workspace','acquire','ready','stage','files','start','process','collect','artifacts','reconcile','release'].map(id=>`lina-environment-${id}`));
 assert.ok(linaEnvironmentBlock.nodes.every(n=>blockForNode(n)==='environment'));
 assert.equal(plannedBlockRegions(linaArchitecture).some(r=>r.key==='environment'),false);
 const ids=new Set(linaArchitecture.nodes.map(n=>n.id));
 assert.equal(new Set(linaArchitecture.edges.map(e=>e.id)).size,linaArchitecture.edges.length);
 for(const e of linaEnvironmentBlock.edges){assert.ok(ids.has(e.source),e.id);assert.ok(ids.has(e.target),e.id);}
});
test('State inspection and receipts resume exact environment requester phase',()=>{
 for(const r of ENVIRONMENT_STATE_ROUTES){assert.equal(r.source,r.returnTarget);assert.equal(linaEnvironmentBlock.edges.find(e=>e.id===r.returnId)?.target,r.source);}
 assert.ok(ENVIRONMENT_STATE_ROUTES.some(r=>r.kind==='load'&&r.phase==='inspect-original-acquisition'));
 assert.ok(ENVIRONMENT_STATE_ROUTES.some(r=>r.kind==='record'&&r.phase==='record-command-launch-intent'));
});
test('requesters, cancellation, recovery and independent custody have explicit distinct routes',()=>{
 const paths=[['collect-tools','lina-environment-collect','lina-tools-collect'],['collect-context','lina-environment-collect','lina-context-load'],['stage-input','lina-environment-stage','lina-input-custody'],['ready-subagents','lina-environment-ready','lina-subagents-prepare'],['cancel-process','lina-execution-cancel','lina-environment-process'],['start-reconcile','lina-environment-start','lina-environment-reconcile'],['release-artifacts','lina-environment-release','lina-environment-artifacts'],['recovery-reconcile','lina-state-recover','lina-environment-reconcile']];
 for(const [id,source,target] of paths){const e=linaEnvironmentBlock.edges.find(e=>e.id===`lina-environment-edge-${id}`)!;assert.equal(e.source,source);assert.equal(e.target,target);}
 assert.equal(linaEnvironmentBlock.edges.some(e=>e.source==='lina-environment-reconcile'&&e.target==='lina-environment-start'),false,'inspection cannot silently relaunch');
});
test('new Environment group preserves saved coordinates, notes and custom links',()=>{
 const old=structuredClone(linaArchitecture);
 old.nodes=old.nodes.filter(n=>blockForNode(n)!=='environment').map(n=>({...n,x:n.x+80,y:n.y+150,experiments:'My note'}));old.edges=old.edges.filter(e=>!e.id.startsWith('lina-environment-edge-'));
 const bounds=blockBounds(old.nodes.filter(n=>blockForNode(n)==='safety'));
 const note={...old.nodes[0],id:'environment-annotation',x:bounds.x+bounds.width+320,y:Math.min(...old.nodes.filter(n=>blockForNode(n)==='tools').map(n=>n.y))};
 old.nodes.push(note);old.edges.push({id:'custom-environment-link',source:note.id,target:old.nodes[0].id,label:'My link'});
 const updated=refreshDocumentation(old);
 for(const n of old.nodes)assert.deepEqual(updated.nodes.find(x=>x.id===n.id),n);
 assert.ok(updated.edges.some(e=>e.id==='custom-environment-link'));
 for(const n of updated.nodes.filter(n=>blockForNode(n)==='environment'))assert.ok(!intersects({...n,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...note,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}));
 assert.deepEqual(refreshDocumentation(updated),updated);
});
test('Environment layout clears all occupied blocks and moves Computer Use reservation below it',()=>{
 const placed=relationshipBlockLayout(linaArchitecture),env=blockBounds(placed.nodes.filter(n=>blockForNode(n)==='environment'));
 const safety=blockBounds(placed.nodes.filter(n=>blockForNode(n)==='safety'));assert.equal(env.x,safety.x);assert.ok(env.y>safety.y+safety.height);
 for(const key of ['input','execution','context','tools','model','safety','state','memory','subagents','planning'] as const)assert.ok(!intersects(env,blockBounds(placed.nodes.filter(n=>blockForNode(n)===key))),key);
 for(const r of plannedBlockRegions(placed))assert.ok(!intersects(env,r),r.key);
 assert.deepEqual(relationshipBlockLayout(placed),placed);
});
test('canonical Environment presets do not overlap maintained nodes',()=>{
 for(const n of linaEnvironmentBlock.nodes)for(const other of linaArchitecture.nodes.filter(n=>blockForNode(n)!=='environment'))assert.ok(!intersects({...n,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...other,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}),`${n.id}/${other.id}`);
});
test('missing Environment node follows saved block offset without replacing annotations',()=>{
 const old=structuredClone(linaArchitecture);
 old.nodes=old.nodes.map(n=>blockForNode(n)==='environment'?{...n,x:n.x+220,y:n.y+330,experiments:'Retain outputs'}:n);
 const missing=old.nodes.find(n=>n.id==='lina-environment-start')!;
 old.nodes=old.nodes.filter(n=>n.id!==missing.id);old.nodes.push({...missing,id:'custom-environment-start-note'});
 const updated=refreshDocumentation(old),restored=updated.nodes.find(n=>n.id===missing.id)!;
 assert.equal(restored.y,missing.y);assert.ok(restored.x>missing.x);
 assert.deepEqual(updated.nodes.find(n=>n.id==='custom-environment-start-note'),old.nodes.at(-1));
 assert.deepEqual(refreshDocumentation(updated),updated);
});
