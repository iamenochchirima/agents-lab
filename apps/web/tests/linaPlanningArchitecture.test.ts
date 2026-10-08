import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaPlanningBlock, PLANNING_STATE_ROUTES, PLANNING_TOOL_ROUTES } from '../src/features/lina/planningBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
const intersects = (a: {x:number;y:number;width:number;height:number},b: {x:number;y:number;width:number;height:number}) => a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height;
test('eight Planning responsibilities replace only their reserved region and use real endpoints', () => {
  assert.deepEqual(linaPlanningBlock.nodes.map(node=>node.id),['policy','load','update','ready','bind','review','replan','complete'].map(id=>`lina-planning-${id}`));
  assert.ok(linaPlanningBlock.nodes.every(node=>blockForNode(node)==='planning'));
  assert.equal(plannedBlockRegions(linaArchitecture).some(region=>region.key==='planning'),false);
  const nodes=new Set(linaArchitecture.nodes.map(node=>node.id));
  assert.equal(new Set(linaArchitecture.edges.map(edge=>edge.id)).size,linaArchitecture.edges.length);
  for(const edge of linaPlanningBlock.edges){assert.ok(nodes.has(edge.source),edge.id);assert.ok(nodes.has(edge.target),edge.id);}
  for(const [id, source,target] of [
    ['policy-prepare','lina-planning-policy','lina-execution-prepare'],
    ['tools-update','lina-tools-dispatch','lina-planning-update'],
    ['subagents-review','lina-subagents-return','lina-planning-review'],
    ['recovery-load','lina-state-recover','lina-planning-load'],
    ['complete-settle','lina-planning-complete','lina-execution-settle'],
  ]){const route=linaPlanningBlock.edges.find(edge=>edge.id===`lina-planning-edge-${id}`)!;assert.equal(route.source,source);assert.equal(route.target,target);}
});
test('State and tool receipts preserve exact requester continuations',()=>{
  for(const route of PLANNING_STATE_ROUTES){
    assert.equal(route.returnTarget,route.source);
    assert.equal(linaPlanningBlock.edges.find(edge=>edge.id===route.returnId)?.target,route.source);
  }
  assert.ok(PLANNING_STATE_ROUTES.some(route=>route.phase==='inspect-original-plan-command'&&route.kind==='load'));
  for(const route of PLANNING_TOOL_ROUTES)assert.equal(linaPlanningBlock.edges.find(edge=>edge.id===route.returnId)?.target,'lina-tools-collect');
});
test('introducing Planning preserves user positions, annotations and custom links',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.filter(node=>blockForNode(node)!=='planning').map(node=>({...node,x:node.x+170,y:node.y+230,experiments:'My notes'}));
  old.edges=old.edges.filter(edge=>!edge.id.startsWith('lina-planning-edge-'));
  const execution=blockBounds(old.nodes.filter(node=>blockForNode(node)==='execution'));
  const obstacle={...old.nodes[0],id:'custom-plan-note',x:execution.x+execution.width+320,y:execution.y};
  old.nodes.push(obstacle);old.edges.push({id:'custom-plan-link',source:obstacle.id,target:old.nodes[0].id,label:'My link'});
  const restored=refreshDocumentation(old);
  for(const node of old.nodes)assert.deepEqual(restored.nodes.find(item=>item.id===node.id),node);
  assert.ok(restored.edges.some(edge=>edge.id==='custom-plan-link'));
  for(const node of restored.nodes.filter(node=>blockForNode(node)==='planning'))assert.ok(!intersects({...node,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...obstacle,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}));
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('Planning placement sits near Execution and clears populated and reserved blocks',()=>{
  const placed=relationshipBlockLayout(linaArchitecture);
  const planning=blockBounds(placed.nodes.filter(node=>blockForNode(node)==='planning'));
  const execution=blockBounds(placed.nodes.filter(node=>blockForNode(node)==='execution'));
  assert.equal(planning.x,execution.x);assert.ok(planning.y+planning.height<execution.y);
  for(const key of ['input','execution','context','tools','model','safety','state','memory','subagents'] as const)assert.ok(!intersects(planning,blockBounds(placed.nodes.filter(node=>blockForNode(node)===key))),key);
  for(const region of plannedBlockRegions(placed))assert.ok(!intersects(planning,region),region.key);
  assert.deepEqual(relationshipBlockLayout(placed),placed);
});
test('missing Planning node follows saved offset without replacing an annotation',()=>{
  const old=structuredClone(linaArchitecture);
  old.nodes=old.nodes.map(node=>blockForNode(node)==='planning'?{...node,x:node.x+350,y:node.y+550,experiments:'Compare plans'}:node);
  const missing=old.nodes.find(node=>node.id==='lina-planning-update')!;
  old.nodes=old.nodes.filter(node=>node.id!==missing.id);old.nodes.push({...missing,id:'custom-update-note'});
  const restored=refreshDocumentation(old),update=restored.nodes.find(node=>node.id===missing.id)!;
  assert.equal(update.y,missing.y);assert.ok(update.x>missing.x);
  assert.deepEqual(refreshDocumentation(restored),restored);
});
test('canonical Planning presets avoid existing nodes',()=>{
  for(const node of linaPlanningBlock.nodes)for(const other of linaArchitecture.nodes.filter(node=>blockForNode(node)!=='planning'))assert.ok(!intersects({...node,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT},{...other,width:LINA_NODE_WIDTH,height:LINA_NODE_HEIGHT}),`${node.id}/${other.id}`);
});
