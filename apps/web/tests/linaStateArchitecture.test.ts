import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaStateBlock, STATE_REQUEST_ROUTES } from '../src/features/lina/stateBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_WIDTH, LINA_NODE_HEIGHT } from '../src/features/lina/edgeRouting';
const copy = <T>(value: T): T => structuredClone(value);
const state = (id: string) => `lina-state-${id}`;
const intersects = (a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('State replaces region 13 with four responsibilities and real requester routes', () => {
  assert.deepEqual(linaStateBlock.nodes.map(node => node.id), ['load', 'record', 'checkpoint', 'recover'].map(state));
  assert.ok(linaStateBlock.nodes.every(node => blockForNode(node) === 'state' && node.area === 'State, persistence and recovery'));
  assert.equal(plannedBlockRegions(linaArchitecture).some(region => region.key === 'state'), false);
  assert.equal(plannedBlockRegions(linaArchitecture).some(region => region.key === 'subagents'), false);
  const ids = new Set(linaArchitecture.nodes.map(node => node.id));
  for (const edge of linaStateBlock.edges) { assert.ok(ids.has(edge.source), edge.id); assert.ok(ids.has(edge.target), edge.id); }
  assert.equal(new Set(linaStateBlock.edges.map(edge => edge.id)).size, linaStateBlock.edges.length);
});

test('storage acknowledgments return to the exact phase owner, without automatic checkpoint or launch', () => {
  for (const route of STATE_REQUEST_ROUTES) {
    assert.ok(route.phase);
    const request = linaStateBlock.edges.find(edge => edge.id === route.id)!;
    const reply = linaStateBlock.edges.find(edge => edge.id === route.returnId)!;
    assert.deepEqual([request.source, request.target], [route.source, route.target]);
    assert.deepEqual([reply.source, reply.target], [route.target, route.returnTarget]);
    if (route.source !== 'lina-input-recovery') assert.equal(route.returnTarget, route.source);
  }
  assert.equal(linaStateBlock.edges.some(edge => edge.source === state('record') && edge.target === state('checkpoint')), false);
  assert.equal(linaStateBlock.edges.some(edge => edge.source === state('recover') && ['lina-tools-dispatch', 'lina-model-invoke'].includes(edge.target)), false);
  const recoveryRead = STATE_REQUEST_ROUTES.find(route => route.source === 'lina-input-recovery')!;
  assert.equal(recoveryRead.returnTarget, state('recover'));
  const plan = linaStateBlock.edges.find(edge => edge.id === 'lina-state-edge-recovery-plan')!;
  assert.deepEqual([plan.source, plan.target], [state('recover'), 'lina-input-recovery']);
  assert.ok(STATE_REQUEST_ROUTES.some(route => route.source === 'lina-input-reconcile' && route.phase === 'record-reconciliation'));
});

test('missing State block follows saved Input without moving notes, custom connections or existing coordinates', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => blockForNode(node) !== 'state').map(node => ({ ...node, x: node.x + 470, y: node.y + 290 }));
  old.edges = old.edges.filter(edge => !edge.id.startsWith('lina-state-edge-'));
  const input = blockBounds(old.nodes.filter(node => blockForNode(node) === 'input'));
  const obstacle = { ...old.nodes[0], id: 'custom-state-notes', title: 'My notes', experiments: 'My recovery experiment', x: input.x, y: input.y + input.height + 620 };
  old.nodes.push(obstacle);
  old.edges.push({ id: 'custom-state-link', source: obstacle.id, target: old.nodes[0].id, label: 'Keep my connection' });
  const snapshot = copy(old), restored = refreshDocumentation(old);
  assert.equal(restored.nodes.length, old.nodes.length + 4);
  for (const node of old.nodes) {
    const actual = restored.nodes.find(item => item.id === node.id)!;
    assert.deepEqual([actual.x, actual.y, actual.title, actual.experiments], [node.x, node.y, node.title, node.experiments]);
  }
  const group = restored.nodes.filter(node => blockForNode(node) === 'state'), anchor = group[0];
  for (const preset of linaStateBlock.nodes) {
    const actual = group.find(node => node.id === preset.id)!;
    assert.equal(actual.x - anchor.x, preset.x - linaStateBlock.nodes[0].x);
    assert.equal(actual.y - anchor.y, preset.y - linaStateBlock.nodes[0].y);
    assert.ok(!intersects({ ...actual, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }, { ...obstacle, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }));
  }
  assert.deepEqual(restored.edges.find(edge => edge.id === 'custom-state-link'), old.edges.at(-1));
  assert.deepEqual(refreshDocumentation(restored), restored);
  assert.deepEqual(old, snapshot);
});

test('missing State nodes follow a moved saved block and avoid annotations occupying their preset', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.map(node => blockForNode(node) === 'state' ? { ...node, x: node.x + 777, y: node.y + 555, experiments: 'Recovery notes' } : node);
  const missing = old.nodes.find(node => node.id === state('record'))!;
  old.nodes = old.nodes.filter(node => node.id !== missing.id);
  old.nodes.push({ ...missing, id: 'custom-record-notes' });
  const restored = refreshDocumentation(old), record = restored.nodes.find(node => node.id === missing.id)!;
  assert.equal(record.y, missing.y); assert.ok(record.x > missing.x);
  assert.deepEqual(restored.nodes.find(node => node.id === state('load')), old.nodes.find(node => node.id === state('load')));
  assert.deepEqual(refreshDocumentation(restored), restored);
});

test('relationship layout locates State below Input beside dependencies and keeps future regions clear', () => {
  const placed = relationshipBlockLayout(linaArchitecture);
  const bounds = blockBounds(placed.nodes.filter(node => blockForNode(node) === 'state'));
  const input = blockBounds(placed.nodes.filter(node => blockForNode(node) === 'input'));
  assert.equal(bounds.x, input.x); assert.ok(bounds.y > input.y + input.height);
  for (const key of ['input', 'execution', 'context', 'tools', 'model', 'safety'] as const) {
    assert.ok(!intersects(bounds, blockBounds(placed.nodes.filter(node => blockForNode(node) === key))), key);
  }
  for (const region of plannedBlockRegions(placed)) assert.ok(!intersects(bounds, region), region.key);
  assert.deepEqual(relationshipBlockLayout(placed), placed);
});


test('canonical State presets leave existing block nodes and restored Model positions clear', () => {
  for (const stateNode of linaStateBlock.nodes) {
    for (const other of linaArchitecture.nodes.filter(node => blockForNode(node) !== 'state')) {
      assert.ok(!intersects({ ...stateNode, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }, { ...other, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }), `${stateNode.id} / ${other.id}`);
    }
  }
  const movedModel = linaArchitecture.nodes.filter(node => blockForNode(node) === 'model').map(node => ({ ...node, x: node.x + 310, y: node.y + 430 }));
  for (const stateNode of linaStateBlock.nodes) {
    for (const other of movedModel) {
      assert.ok(!intersects({ ...stateNode, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }, { ...other, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }), `${stateNode.id} / moved ${other.id}`);
    }
  }
});
