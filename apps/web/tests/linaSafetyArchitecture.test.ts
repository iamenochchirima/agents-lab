import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaSafetyBlock } from '../src/features/lina/safetyBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_WIDTH, LINA_NODE_HEIGHT } from '../src/features/lina/edgeRouting';

const copy = <T>(value: T): T => structuredClone(value);
const safety = (id: string) => `lina-safety-${id}`;
const route = (id: string, source: string, target: string) => {
  const edge = linaArchitecture.edges.find(item => item.id === `lina-safety-edge-${id}`);
  assert.ok(edge, id);
  assert.deepEqual([edge.source, edge.target], [source, target], id);
};

test('Safety replaces its placeholder with five responsibilities and keeps populated Subagents out of reserved regions', () => {
  assert.deepEqual(linaSafetyBlock.nodes.map(node => node.id), ['policy', 'evaluate', 'approval', 'grants', 'authorize'].map(safety));
  assert.ok(linaSafetyBlock.nodes.every(node => blockForNode(node) === 'safety' && node.area === 'Safety and permissions'));
  const regions = plannedBlockRegions(linaArchitecture);
  assert.equal(regions.some(region => region.key === 'safety'), false);
  assert.equal(regions.some(region => region.key === 'state'), false);
  assert.equal(regions.some(region => region.key === 'subagents'), false);
  const ids = new Set(linaArchitecture.nodes.map(node => node.id));
  for (const edge of linaSafetyBlock.edges) { assert.ok(ids.has(edge.source), edge.id); assert.ok(ids.has(edge.target), edge.id); }
  assert.equal(new Set(linaSafetyBlock.edges.map(edge => edge.id)).size, linaSafetyBlock.edges.length);
});

test('admission, final dispatch authorization and registered review remain separate routes', () => {
  route('tool-request', 'lina-tools-permissions', safety('evaluate'));
  route('decision-tools', safety('authorize'), 'lina-tools-permissions');
  route('dispatch-authorize', 'lina-tools-dispatch', safety('authorize'));
  route('authorize-dispatch', safety('authorize'), 'lina-tools-dispatch');
  route('wait-registered', 'lina-execution-wait', safety('approval'));
  route('approval-prompt', safety('approval'), 'lina-input-delivery');
  route('approval-answer', 'lina-tools-permissions', safety('approval'));
  assert.equal(linaSafetyBlock.edges.some(edge => edge.source.startsWith('lina-input-') && edge.target === safety('approval')), false);
  route('approval-grants', safety('approval'), safety('grants'));
  route('grants-authorize', safety('grants'), safety('authorize'));
  for (const node of ['approval', 'authorization']) route(`cancel-${node}`, 'lina-execution-cancel', safety(node === 'authorization' ? 'authorize' : node));
});

test('resource and prompt acquisition retain their original owners and fresh launch gates', () => {
  for (const owner of ['resource-read', 'prompt-get']) {
    route(`${owner}-request`, `lina-tools-${owner}`, safety('evaluate'));
    route(`${owner}-return`, safety('authorize'), `lina-tools-${owner}`);
    route(`${owner}-authorize`, `lina-tools-${owner}`, safety('authorize'));
    route(`${owner}-answer`, `lina-tools-${owner}`, safety('approval'));
  }
  route('approval-wait-resource', safety('approval'), 'lina-tools-resource-read');
  route('approval-wait-prompt', safety('approval'), 'lina-tools-prompt-get');
});

test('a saved 91-node graph gains Safety beside Tools without moving annotations or unrelated nodes', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => blockForNode(node) !== 'safety' && blockForNode(node) !== 'state' && blockForNode(node) !== 'memory' && blockForNode(node) !== 'subagents' && blockForNode(node) !== 'planning' && blockForNode(node) !== 'environment').map(node => ({ ...node, x: node.x + 470, y: node.y + 290 }));
  old.edges = old.edges.filter(edge => !edge.id.startsWith('lina-safety-edge-'));
  assert.equal(old.nodes.length, 91);
  const tools = blockBounds(old.nodes.filter(node => blockForNode(node) === 'tools'));
  const obstacle = { ...old.nodes[0], id: 'custom-safety-notes', title: 'My notes', experiments: 'My own scope experiment', x: tools.x + tools.width + 320, y: tools.y };
  old.nodes.push(obstacle);
  old.edges.push({ id: 'custom-safety-link', source: obstacle.id, target: old.nodes[0].id, label: 'Keep my connection' });
  const snapshot = copy(old), restored = refreshDocumentation(old);
  assert.equal(restored.nodes.length, 141);
  for (const node of old.nodes) {
    const updated = restored.nodes.find(item => item.id === node.id)!;
    assert.deepEqual([updated.x, updated.y, updated.title, updated.experiments], [node.x, node.y, node.title, node.experiments]);
  }
  const group = restored.nodes.filter(node => blockForNode(node) === 'safety');
  const anchor = group.find(node => node.id === safety('policy'))!;
  for (const preset of linaSafetyBlock.nodes) {
    const actual = group.find(node => node.id === preset.id)!;
    assert.equal(actual.x - anchor.x, preset.x - linaSafetyBlock.nodes[0].x);
    assert.equal(actual.y - anchor.y, preset.y - linaSafetyBlock.nodes[0].y);
    assert.ok(actual.x >= tools.x + tools.width + 320);
    assert.ok(actual.x >= obstacle.x + LINA_NODE_WIDTH || obstacle.x >= actual.x + LINA_NODE_WIDTH || actual.y >= obstacle.y + LINA_NODE_HEIGHT || obstacle.y >= actual.y + LINA_NODE_HEIGHT);
  }
  assert.deepEqual(restored.edges.find(edge => edge.id === 'custom-safety-link'), old.edges.at(-1));
  assert.deepEqual(refreshDocumentation(restored), restored);
  assert.deepEqual(old, snapshot);
});

test('missing Safety nodes follow a moved saved block and avoid occupied coordinates', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.map(node => blockForNode(node) === 'safety' ? { ...node, x: node.x + 777, y: node.y + 555, experiments: 'Reviewed resource matcher' } : node);
  const missing = old.nodes.find(node => node.id === safety('grants'))!;
  old.nodes = old.nodes.filter(node => node.id !== missing.id);
  old.nodes.push({ ...missing, id: 'custom-grant-notes' });
  const restored = refreshDocumentation(old), grant = restored.nodes.find(node => node.id === missing.id)!;
  assert.equal(grant.y, missing.y); assert.ok(grant.x > missing.x);
  assert.deepEqual(restored.nodes.find(node => node.id === safety('policy')), old.nodes.find(node => node.id === safety('policy')));
  assert.deepEqual(refreshDocumentation(restored), restored);
});

test('relationship layout puts Safety beside Tools with no populated Environment overlap', () => {
  const placed = relationshipBlockLayout(linaArchitecture);
  const tools = blockBounds(placed.nodes.filter(node => blockForNode(node) === 'tools'));
  const safetyBounds = blockBounds(placed.nodes.filter(node => blockForNode(node) === 'safety'));
  assert.ok(safetyBounds.x > tools.x + tools.width);
  assert.equal(safetyBounds.y, tools.y);
  for (const key of ['input', 'execution', 'context', 'tools', 'model'] as const) {
    const other = blockBounds(placed.nodes.filter(node => blockForNode(node) === key));
    assert.ok(safetyBounds.x >= other.x + other.width || other.x >= safetyBounds.x + safetyBounds.width || safetyBounds.y >= other.y + other.height || other.y >= safetyBounds.y + safetyBounds.height, key);
  }
  const environment = blockBounds(placed.nodes.filter(node => blockForNode(node) === 'environment'));
  assert.equal(environment.x, safetyBounds.x);
  assert.ok(environment.y > safetyBounds.y + safetyBounds.height);
  assert.equal(plannedBlockRegions(placed).some(region => region.key === 'environment'), false);
  assert.deepEqual(relationshipBlockLayout(placed), placed);
});
