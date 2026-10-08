import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaMemoryBlock, MEMORY_STATE_ROUTES, MEMORY_REQUEST_ROUTES } from '../src/features/lina/memoryBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
const intersects = (a: {x:number;y:number;width:number;height:number},b: {x:number;y:number;width:number;height:number}) => a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height;
test('Memory has twelve branched responsibilities with real endpoints and no reserved region', () => {
  assert.deepEqual(linaMemoryBlock.nodes.map(node => node.id), ['scope','query','retrieve','select','capture','extract','validate','resolve','commit','index','consolidate','forget'].map(id=>`lina-memory-${id}`));
  assert.ok(linaMemoryBlock.nodes.every(node=>blockForNode(node)==='memory'));
  assert.equal(plannedBlockRegions(linaArchitecture).some(region=>region.key==='memory'),false);
  const nodes=new Set(linaArchitecture.nodes.map(node=>node.id));
  assert.equal(new Set(linaMemoryBlock.edges.map(edge=>edge.id)).size,linaMemoryBlock.edges.length);
  for(const edge of linaMemoryBlock.edges) { assert.ok(nodes.has(edge.source),edge.id);assert.ok(nodes.has(edge.target),edge.id); }
  assert.ok(linaMemoryBlock.edges.some(edge=>edge.source==='lina-memory-scope'&&edge.target==='lina-memory-retrieve'));
  assert.ok(linaMemoryBlock.edges.some(edge=>edge.source==='lina-memory-capture'&&edge.target==='lina-memory-validate'));
  assert.ok(linaMemoryBlock.edges.some(edge=>edge.source==='lina-memory-consolidate'&&edge.target==='lina-memory-validate'));
});
test('State outcomes and recall responses retain original phase owners',()=>{
  for(const route of MEMORY_STATE_ROUTES) {
    assert.equal(route.returnTarget,route.source);
    assert.deepEqual(linaMemoryBlock.edges.find(edge=>edge.id===route.returnId)?.target,route.source);
    assert.ok(route.phase);
  }
  for(const route of MEMORY_REQUEST_ROUTES) assert.equal(linaMemoryBlock.edges.find(edge=>edge.id===route.returnId)?.target,route.returnTarget);
  assert.ok(MEMORY_STATE_ROUTES.some(route=>route.phase==='inspect-memory-transaction'&&route.kind==='load'));
  assert.ok(MEMORY_STATE_ROUTES.some(route=>route.phase==='revoke-memory-visibility'&&route.kind==='record'));
});
test('Memory introduction preserves saved coordinates and notes and translates around occupied space',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.filter(node=>blockForNode(node)!=='memory').map(node=>({...node,x:node.x+170,y:node.y+230,experiments:'My notes'}));
  old.edges=old.edges.filter(edge=>!edge.id.startsWith('lina-memory-edge-'));
  const context=blockBounds(old.nodes.filter(node=>blockForNode(node)==='context'));
  const obstacle={...old.nodes[0],id:'custom-memory-notes',x:context.x,y:context.y+context.height+360};
  old.nodes.push(obstacle);old.edges.push({id:'custom-memory-link',source:obstacle.id,target:old.nodes[0].id,label:'My link'});
  const restored=refreshDocumentation(old);
  for(const node of old.nodes) assert.deepEqual(restored.nodes.find(item=>item.id===node.id),node);
  assert.ok(restored.edges.some(edge=>edge.id==='custom-memory-link'));
  for(const node of restored.nodes.filter(node=>blockForNode(node)==='memory')) assert.ok(!intersects({...node,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...obstacle,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}));
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('relationship layout keeps Memory near Context and every populated or reserved region clear',()=>{
  const placed=relationshipBlockLayout(linaArchitecture);
  const memory=blockBounds(placed.nodes.filter(node=>blockForNode(node)==='memory'));
  const context=blockBounds(placed.nodes.filter(node=>blockForNode(node)==='context'));
  assert.equal(memory.x,context.x);assert.ok(memory.y>context.y+context.height);
  for(const key of ['input','execution','context','tools','model','safety','state'] as const) assert.ok(!intersects(memory,blockBounds(placed.nodes.filter(node=>blockForNode(node)===key))),key);
  for(const region of plannedBlockRegions(placed)) assert.ok(!intersects(memory,region),region.key);
  assert.deepEqual(relationshipBlockLayout(placed),placed);
});
test('missing Memory nodes follow a moved saved group without overwriting an annotation',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.map(node=>blockForNode(node)==='memory'?{...node,x:node.x+350,y:node.y+550,experiments:'Compare recall'}:node);
  const missing=old.nodes.find(node=>node.id==='lina-memory-query')!;
  old.nodes=old.nodes.filter(node=>node.id!==missing.id);
  old.nodes.push({...missing,id:'custom-query-notes'});
  const restored=refreshDocumentation(old),query=restored.nodes.find(node=>node.id===missing.id)!;
  assert.equal(query.y,missing.y);assert.ok(query.x>missing.x);
  assert.deepEqual(restored.nodes.find(node=>node.id==='lina-memory-scope'),old.nodes.find(node=>node.id==='lina-memory-scope'));
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('canonical Memory nodes leave existing block presets clear',()=>{
  for(const memory of linaMemoryBlock.nodes) for(const other of linaArchitecture.nodes.filter(node=>blockForNode(node)!=='memory')) {
    assert.ok(!intersects({...memory,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...other,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}),`${memory.id}/${other.id}`);
  }
});
