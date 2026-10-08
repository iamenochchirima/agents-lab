import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaModelBlock } from '../src/features/lina/modelBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';

test('an 87-node saved design gains four Model nodes once without moving user content', () => {
 const old=structuredClone(linaArchitecture);
 old.nodes=old.nodes.filter(node=>!node.id.startsWith('lina-model-') && !node.id.startsWith('lina-safety-') && !node.id.startsWith('lina-state-') && !node.id.startsWith('lina-memory-') && !node.id.startsWith('lina-subagents-') && !node.id.startsWith('lina-planning-') && !node.id.startsWith('lina-environment-')).map(node=>({...node,x:node.x+220,y:node.y+600,status:'studying',experiments:'Saved user experiment'}));
 old.edges=old.edges.filter(edge=>!edge.id.startsWith('lina-model-edge-'));
 assert.equal(old.nodes.length,87);
 const custom={...old.nodes[0],id:'custom-model-study',title:'My model notes',x:80,y:10000};
 old.nodes.push(custom);old.edges.push({id:'custom-model-route',source:old.nodes[0].id,target:custom.id,label:'User route'});
 const before=structuredClone(old),updated=refreshDocumentation(old);
 assert.equal(updated.nodes.length,141);
 for(const saved of old.nodes){const actual=updated.nodes.find(node=>node.id===saved.id)!;assert.deepEqual([actual.x,actual.y,actual.status,actual.experiments],[saved.x,saved.y,saved.status,saved.experiments]);}
 assert.deepEqual(updated.edges.find(edge=>edge.id==='custom-model-route'),old.edges.at(-1));
 assert.deepEqual(refreshDocumentation(updated),updated);assert.deepEqual(old,before);
 assert.equal(updated.nodes.filter(node=>blockForNode(node)==='model').length,4);
});

test('Model group restoration follows the saved group and replaces only its empty region', () => {
 const old=structuredClone(linaArchitecture);
 old.nodes=old.nodes.map(node=>node.id.startsWith('lina-model-')?{...node,x:node.x+310,y:node.y+430,status:'studying',experiments:'Compare cache layout'}:node);
 const encode=old.nodes.find(node=>node.id==='lina-model-encode')!;
 old.nodes=old.nodes.filter(node=>node.id!==encode.id);
 const updated=refreshDocumentation(old),restored=updated.nodes.find(node=>node.id===encode.id)!;
 assert.deepEqual([restored.x,restored.y],[encode.x,encode.y]);
 const resolve=updated.nodes.find(node=>node.id==='lina-model-resolve')!;assert.equal(resolve.experiments,'Compare cache layout');
 const regions=plannedBlockRegions(updated);
 assert.equal(regions.some(region=>region.key==='model'),false);
 assert.equal(regions.some(region=>region.key==='subagents'),false);
 assert.equal(regions.some(region=>region.key==='planning'),false);
 assert.equal(regions.find(region=>region.key==='computer')?.note,'Deferred');
 assert.deepEqual(refreshDocumentation(updated),updated);
});

test('Model has only four nodes and all metadata, auth, cancellation and terminal endpoints exist', () => {
 assert.equal(linaArchitecture.nodes.length,140);assert.equal(linaModelBlock.nodes.length,4);
 assert.equal(linaModelBlock.edges.length,21);
 const ids=new Set(linaArchitecture.nodes.map(node=>node.id));
 for(const edge of linaModelBlock.edges){assert.ok(ids.has(edge.source),edge.id);assert.ok(ids.has(edge.target),edge.id);}
 assert.equal(linaArchitecture.edges.some(edge=>edge.id==='lina-execution-edge-model-decide'),false);
 assert.equal(linaModelBlock.edges.find(edge=>edge.id==='lina-model-edge-context-resolve')?.source,'lina-context-load');
 assert.equal(linaModelBlock.edges.find(edge=>edge.id==='lina-model-edge-normalize-decide')?.target,'lina-execution-decide');
});
