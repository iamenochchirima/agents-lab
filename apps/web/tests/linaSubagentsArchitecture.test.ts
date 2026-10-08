import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaSubagentsBlock, SUBAGENT_STATE_ROUTES, SUBAGENT_REQUEST_ROUTES } from '../src/features/lina/subagentsBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
const intersects = (a: {x:number;y:number;width:number;height:number},b: {x:number;y:number;width:number;height:number}) => a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height;
test('eight child lifecycle responsibilities use real shared-loop endpoints', () => {
  assert.deepEqual(linaSubagentsBlock.nodes.map(node=>node.id),['validate','prepare','launch','coordinate','join','cancel','reconcile','return'].map(id=>`lina-subagents-${id}`));
  assert.ok(linaSubagentsBlock.nodes.every(node=>blockForNode(node)==='subagents'));
  assert.equal(plannedBlockRegions(linaArchitecture).some(region=>region.key==='subagents'),false);
  const nodes=new Set(linaArchitecture.nodes.map(node=>node.id));
  assert.equal(new Set(linaArchitecture.edges.map(edge=>edge.id)).size,linaArchitecture.edges.length);
  for(const edge of linaSubagentsBlock.edges){assert.ok(nodes.has(edge.source),edge.id);assert.ok(nodes.has(edge.target),edge.id);}
  const route=(id:string,source:string,target:string)=>assert.deepEqual(linaSubagentsBlock.edges.find(edge=>edge.id===`lina-subagents-edge-${id}`),{id:`lina-subagents-edge-${id}`,source,target,label:linaSubagentsBlock.edges.find(edge=>edge.id===`lina-subagents-edge-${id}`)!.label});
  route('launch-child-start','lina-subagents-launch','lina-execution-start');
  route('coordinate-validate','lina-subagents-coordinate','lina-subagents-validate');
  route('child-settle-coordinate','lina-execution-settle','lina-subagents-coordinate');
  route('child-release-coordinate','lina-execution-release','lina-subagents-coordinate');
  route('parent-cancel','lina-execution-cancel','lina-subagents-cancel');
});
test('launch, cancellation and result acknowledgment inspect their exact State continuation',()=>{
  for(const route of SUBAGENT_STATE_ROUTES){
    assert.equal(route.returnTarget,route.source);
    assert.equal(linaSubagentsBlock.edges.find(edge=>edge.id===route.returnId)?.target,route.source);
  }
  for(const phase of ['inspect-original-child-launch','inspect-descendant-cancellation','inspect-parent-result-delivery'])assert.ok(SUBAGENT_STATE_ROUTES.some(route=>route.phase===phase&&route.kind==='load'));
  for(const route of SUBAGENT_REQUEST_ROUTES)assert.equal(linaSubagentsBlock.edges.find(edge=>edge.id===route.returnId)?.target,route.returnTarget);
});
test('saved block introduction preserves annotations and is idempotent',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.filter(node=>blockForNode(node)!=='subagents').map(node=>({...node,x:node.x+170,y:node.y+230,experiments:'My notes'}));
  old.edges=old.edges.filter(edge=>!edge.id.startsWith('lina-subagents-edge-'));
  const memory=blockBounds(old.nodes.filter(node=>blockForNode(node)==='memory'));
  const obstacle={...old.nodes[0],id:'custom-child-notes',x:memory.x+memory.width+320,y:memory.y};
  old.nodes.push(obstacle);old.edges.push({id:'custom-child-link',source:obstacle.id,target:old.nodes[0].id,label:'My link'});
  const restored=refreshDocumentation(old);
  for(const node of old.nodes)assert.deepEqual(restored.nodes.find(item=>item.id===node.id),node);
  assert.ok(restored.edges.some(edge=>edge.id==='custom-child-link'));
  for(const node of restored.nodes.filter(node=>blockForNode(node)==='subagents'))assert.ok(!intersects({...node,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...obstacle,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}));
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('subagent lifecycle placement clears all populated and reserved blocks',()=>{
  const placed=relationshipBlockLayout(linaArchitecture);
  const child=blockBounds(placed.nodes.filter(node=>blockForNode(node)==='subagents'));
  for(const key of ['input','execution','context','tools','model','safety','state','memory'] as const)assert.ok(!intersects(child,blockBounds(placed.nodes.filter(node=>blockForNode(node)===key))),key);
  for(const region of plannedBlockRegions(placed))assert.ok(!intersects(child,region),region.key);
  assert.deepEqual(relationshipBlockLayout(placed),placed);
});
test('missing child nodes follow saved offsets without replacing occupied annotations',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.map(node=>blockForNode(node)==='subagents'?{...node,x:node.x+350,y:node.y+550,experiments:'Compare workers'}:node);
  const missing=old.nodes.find(node=>node.id==='lina-subagents-launch')!;
  old.nodes=old.nodes.filter(node=>node.id!==missing.id);old.nodes.push({...missing,id:'custom-launch-note'});
  const restored=refreshDocumentation(old),launch=restored.nodes.find(node=>node.id===missing.id)!;
  assert.equal(launch.y,missing.y);assert.ok(launch.x>missing.x);
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('canonical child lifecycle presets avoid every existing node',()=>{
  for(const child of linaSubagentsBlock.nodes)for(const other of linaArchitecture.nodes.filter(node=>blockForNode(node)!=='subagents')){
    assert.ok(!intersects({...child,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...other,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}),`${child.id}/${other.id}`);
  }
});
