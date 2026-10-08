import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaInputBlock } from '../src/features/lina/inputBlock';
import { linaExecutionBlock } from '../src/features/lina/executionBlock';
import { linaContextBlock } from '../src/features/lina/contextBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import type { LinaDocument } from '../src/features/lina/linaModel';

const copy = <T>(value: T): T => structuredClone(value);

test('an older design gains execution once, preserving user data and retiring obsolete release', () => {
  const old = copy(linaInputBlock);
  old.nodes[0] = { ...old.nodes[0], x: 333, y: 222, status: 'studying', experiments: 'User experiment' };
  old.nodes.push({ ...old.nodes[0], id: 'custom-node', title: 'Custom', x: 2400, y: 3500 });
  old.edges.push({ id: 'custom-edge', source: old.nodes[0].id, target: 'custom-node', label: 'User edge' },
    { id: 'lina-input-edge-44', source: 'lina-input-runtime', target: 'lina-input-queue', label: 'old release' });
  const before = JSON.stringify(old);
  const updated = refreshDocumentation(old);
  const first = updated.nodes.find(node => node.id === old.nodes[0].id)!;
  assert.equal(first.x, 333);
  assert.equal(first.y, 222);
  assert.equal(first.status, 'studying');
  assert.equal(first.experiments, 'User experiment');
  assert.deepEqual(updated.nodes.find(node => node.id === 'custom-node'), old.nodes.at(-1));
  assert.deepEqual(updated.edges.find(edge => edge.id === 'custom-edge'), old.edges.at(-2));
  assert.equal(updated.edges.some(edge => edge.id === 'lina-input-edge-44'), false);
  assert.equal(updated.nodes.filter(node => blockForNode(node) === 'execution').length, linaExecutionBlock.nodes.length);
  assert.deepEqual(refreshDocumentation(updated), updated);
  assert.equal(JSON.stringify(old), before);
});

test('missing execution nodes follow a user-moved block and avoid occupied positions', () => {
  const moved = copy(linaArchitecture);
  moved.nodes = moved.nodes.map(node => node.id.startsWith('lina-execution-') ? { ...node, x: node.x + 600, y: node.y + 400 } : node);
  const missing = moved.nodes.find(node => node.id === 'lina-execution-tools')!;
  moved.nodes = moved.nodes.filter(node => node.id !== missing.id);
  moved.nodes.push({ ...missing, id: 'custom-obstacle', title: 'Custom obstacle' });
  const updated = refreshDocumentation(moved);
  const restored = updated.nodes.find(node => node.id === missing.id)!;
  assert.equal(restored.y, missing.y);
  assert.ok(restored.x > missing.x);
  assert.deepEqual(updated.nodes.find(node => node.id === 'lina-execution-start'), moved.nodes.find(node => node.id === 'lina-execution-start'));
  assert.deepEqual(refreshDocumentation(updated), updated);
});

test('a new execution block stays together below shifted Input and clear of custom nodes', () => {
  const old = copy(linaInputBlock);
  old.nodes = old.nodes.map(node => ({ ...node, x: node.x + 450, y: node.y + 1000 }));
  const maxY = Math.max(...old.nodes.map(node => node.y + 144));
  old.nodes.push({ ...old.nodes[0], id: 'obstacle', title: 'Obstacle', x: 530, y: maxY + 220 });
  const updated = refreshDocumentation(old);
  const start = updated.nodes.find(node => node.id === 'lina-execution-start')!;
  assert.ok(start.y > maxY + 220);
  for (const preset of linaExecutionBlock.nodes) {
    const node = updated.nodes.find(node => node.id === preset.id)!;
    assert.equal(node.x - start.x, preset.x - linaExecutionBlock.nodes[0].x);
    assert.equal(node.y - start.y, preset.y - linaExecutionBlock.nodes[0].y);
  }
});

test('composed graph has unique identities and valid boundary endpoints', () => {
  const document: LinaDocument = refreshDocumentation({ version: 1, nodes: [], edges: [] });
  assert.equal(new Set(document.nodes.map(node => node.id)).size, document.nodes.length);
  assert.equal(new Set(document.edges.map(edge => edge.id)).size, document.edges.length);
  const ids = new Set(document.nodes.map(node => node.id));
  for (const edge of document.edges) {
    assert.ok(ids.has(edge.source), edge.id);
    assert.ok(ids.has(edge.target), edge.id);
  }
  assert.ok(document.edges.some(edge => edge.source === 'lina-execution-release' && edge.target === 'lina-input-queue'));
  assert.equal(document.edges.some(edge => edge.source === 'lina-input-runtime' && edge.target === 'lina-input-queue'), false);
});

test('older channel routing gains the Telegram router without resetting existing node edits', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => node.id !== 'lina-input-telegram-route');
  const telegram = old.nodes.find(node => node.id === 'lina-input-telegram')!;
  telegram.x = 999;
  telegram.status = 'studying';
  telegram.experiments = 'Compare topic routing';
  old.edges = old.edges.filter(edge => !['lina-input-edge-55', 'lina-input-edge-56'].includes(edge.id));
  old.edges.find(edge => edge.id === 'lina-input-edge-2')!.target = 'lina-input-envelope';
  const updated = refreshDocumentation(old);
  assert.ok(updated.nodes.some(node => node.id === 'lina-input-telegram-route'));
  const preserved = updated.nodes.find(node => node.id === telegram.id)!;
  assert.equal(preserved.x, 999);
  assert.equal(preserved.status, 'studying');
  assert.equal(preserved.experiments, 'Compare topic routing');
  assert.equal(updated.edges.find(edge => edge.id === 'lina-input-edge-2')!.target, 'lina-input-telegram-route');
  assert.deepEqual(refreshDocumentation(updated), updated);
});

test('an older saved design gains Context below moved execution as one collision-free group', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => !node.id.startsWith('lina-context-')).map(node =>
    node.id.startsWith('lina-execution-') ? { ...node, x: node.x + 420, y: node.y + 800 } : node);
  old.edges = old.edges.filter(edge => !edge.id.startsWith('lina-context-edge-'));
  const bottom = Math.max(...old.nodes.map(node => node.y + 144));
  old.nodes.push({ ...old.nodes[0], id: 'context-obstacle', title: 'Custom', x: 500, y: bottom + 220 });
  const before = copy(old);
  const updated = refreshDocumentation(old);
  const load = updated.nodes.find(node => node.id === 'lina-context-load')!;
  assert.ok(load.y > bottom + 220);
  for (const preset of linaContextBlock.nodes) {
    const actual = updated.nodes.find(node => node.id === preset.id)!;
    assert.equal(actual.x - load.x, preset.x - linaContextBlock.nodes.find(node => node.id === 'lina-context-load')!.x);
    assert.equal(actual.y - load.y, preset.y - linaContextBlock.nodes.find(node => node.id === 'lina-context-load')!.y);
  }
  assert.deepEqual(updated.nodes.find(node => node.id === 'context-obstacle'), old.nodes.at(-1));
  assert.deepEqual(refreshDocumentation(updated), updated);
  assert.deepEqual(old, before);
});

test('a missing Context node follows saved group position and preserves user choices', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.map(node => node.id.startsWith('lina-context-')
    ? { ...node, x: node.x + 310, y: node.y + 500, status: 'studying', experiments: 'Compare masking' } : node);
  const missing = old.nodes.find(node => node.id === 'lina-context-prune')!;
  old.nodes = old.nodes.filter(node => node.id !== missing.id);
  old.nodes.push({ ...missing, id: 'prune-obstacle', title: 'Custom obstacle' });
  const updated = refreshDocumentation(old);
  const restored = updated.nodes.find(node => node.id === missing.id)!;
  assert.equal(restored.y, missing.y);
  assert.ok(restored.x > missing.x);
  const load = updated.nodes.find(node => node.id === 'lina-context-load')!;
  assert.equal(load.x, linaContextBlock.nodes.find(node => node.id === 'lina-context-load')!.x + 310);
  assert.equal(load.y, 4980);
  assert.equal(load.status, 'studying');
  assert.equal(load.experiments, 'Compare masking');
  assert.deepEqual(refreshDocumentation(updated), updated);
});

test('Context handoff returns to launch gate and replaces its reserved region without renumbering Memory', () => {
  const edge = (id: string) => linaArchitecture.edges.find(item => item.id === id)!;
  assert.equal(edge('lina-context-edge-prepare-scope').source, 'lina-execution-prepare');
  assert.equal(edge('lina-context-edge-publish-prepare').target, 'lina-execution-prepare');
  assert.equal(edge('lina-execution-edge-prepare-model').target, 'lina-execution-model');
  for (const id of ['load-terminal', 'budget-terminal', 'compact-terminal', 'validate-terminal']) {
    assert.equal(edge(`lina-context-edge-${id}`).target, 'lina-execution-settle');
  }
  const regions = plannedBlockRegions(linaArchitecture);
  assert.equal(regions.some(region => region.key === 'context'), false);
  assert.equal(plannedBlockRegions(linaInputBlock).find(region => region.key === 'memory')!.number, '04');
  assert.equal(plannedBlockRegions(linaInputBlock).find(region => region.key === 'context')!.number, '03');
});

test('Tools has detailed call and dependency boundaries with source staging and no summary bypass', () => {
  const tools = linaArchitecture.nodes.filter(node => node.id.startsWith('lina-tools-'));
  assert.equal(tools.length, 33);
  assert.ok(tools.every(node => node.status === 'proposed' && node.area === 'Tools'));
  const edge = (id: string) => linaArchitecture.edges.find(item => item.id === id)!;
  assert.equal(edge('lina-tools-edge-execution-resolve').source, 'lina-execution-tools');
  assert.equal(edge('lina-tools-edge-publish-outcomes').target, 'lina-execution-tool-outcomes');
  assert.equal(edge('lina-tools-edge-publish-reconcile').target, 'lina-input-reconcile');
  assert.equal(edge('lina-tools-edge-catalog-context').target, 'lina-context-load');
  assert.equal(edge('lina-tools-edge-skill-activate-context').target, 'lina-context-load');
  assert.equal(edge('lina-tools-edge-skill-resources-context').target, 'lina-context-load');
  assert.equal(linaArchitecture.edges.some(edge => edge.id === 'lina-execution-edge-tools-outcomes'), false, 'only detailed Tools publication returns results');
  const regions = plannedBlockRegions(linaArchitecture);
  assert.equal(regions.some(region => region.key === 'tools'), false);
  assert.equal(plannedBlockRegions(linaInputBlock).find(region => region.key === 'memory')!.number, '04');
  assert.equal(regions.some(region => region.key === 'model'), false);
});

test('an existing design gains Tools below moved Context without resetting custom data', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => !node.id.startsWith('lina-tools-')).map(node =>
    node.id.startsWith('lina-context-') ? { ...node, x: node.x + 250, y: node.y + 700 } : node);
  old.edges = old.edges.filter(edge => !edge.id.startsWith('lina-tools-edge-'));
  const bottom = Math.max(...old.nodes.map(node => node.y + 144));
  old.nodes.push({ ...old.nodes[0], id: 'tools-obstacle', title: 'Custom obstacle', x: 330, y: bottom + 220 });
  old.edges.push({ id: 'custom-tools-reference', source: old.nodes[0].id, target: 'tools-obstacle', label: 'User reference' });
  const before = copy(old);
  const updated = refreshDocumentation(old);
  const config = updated.nodes.find(node => node.id === 'lina-tools-config')!;
  assert.ok(config.y > bottom + 220);
  const maintained = linaArchitecture.nodes.filter(node => node.id.startsWith('lina-tools-'));
  for (const preset of maintained) {
    const actual = updated.nodes.find(node => node.id === preset.id)!;
    assert.equal(actual.x - config.x, preset.x - maintained[0].x);
    assert.equal(actual.y - config.y, preset.y - maintained[0].y);
  }
  assert.deepEqual(updated.nodes.find(node => node.id === 'tools-obstacle'), old.nodes.at(-1));
  assert.deepEqual(updated.edges.find(edge => edge.id === 'custom-tools-reference'), old.edges.at(-1));
  assert.deepEqual(old, before);
  assert.deepEqual(refreshDocumentation(updated), updated);
});

test('restoring a Tools node follows its moved group and preserves user annotations', () => {
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.map(node => node.id.startsWith('lina-tools-')
    ? { ...node, x: node.x + 500, y: node.y + 400, status: 'studying', experiments: 'Compare concurrency limits' } : node);
  const removed = old.nodes.find(node => node.id === 'lina-tools-schedule')!;
  old.nodes = old.nodes.filter(node => node.id !== removed.id);
  old.nodes.push({ ...removed, id: 'schedule-obstacle', title: 'Custom obstacle' });
  const updated = refreshDocumentation(old);
  const schedule = updated.nodes.find(node => node.id === removed.id)!;
  assert.equal(schedule.y, removed.y);
  assert.ok(schedule.x > removed.x);
  const config = updated.nodes.find(node => node.id === 'lina-tools-config')!;
  assert.equal(config.x, 580);
  assert.equal(config.y, 5800);
  assert.equal(config.status, 'studying');
  assert.equal(config.experiments, 'Compare concurrency limits');
  assert.deepEqual(refreshDocumentation(updated), updated);
});

test('the 79-node saved design gains eight boundaries and relocates reconciliation once', () => {
  const added = new Set(['lina-execution-wait', 'lina-execution-cancel', 'lina-context-scope', 'lina-context-observations', 'lina-tools-resource-read', 'lina-tools-prompt-get', 'lina-tools-hooks', 'lina-tools-retry']);
  const old = copy(linaArchitecture);
  old.nodes = old.nodes.filter(node => !node.id.startsWith('lina-model-') && !node.id.startsWith('lina-safety-') && !node.id.startsWith('lina-state-') && !node.id.startsWith('lina-memory-') && !node.id.startsWith('lina-subagents-') && !node.id.startsWith('lina-planning-') && !node.id.startsWith('lina-environment-') && !node.id.startsWith('lina-output-') && !added.has(node.id)).map(node => node.id === 'lina-input-reconcile'
    ? { ...node, area: 'Input', x: 1800, y: 2400, status: 'studying', experiments: 'Retain my reconciliation comparison' }
    : { ...node, x: node.x + 300, y: node.y + 400 });
  old.edges = old.edges.filter(edge => !added.has(edge.source) && !added.has(edge.target));
  assert.equal(old.nodes.length, 79);
  const before = copy(old);
  const updated = refreshDocumentation(old);
  assert.equal(updated.nodes.length, 153);
  const reconcile = updated.nodes.find(node => node.id === 'lina-input-reconcile')!;
  assert.equal(blockForNode(reconcile), 'execution');
  assert.equal(reconcile.area, 'Turn Execution');
  assert.equal(reconcile.status, 'studying');
  assert.equal(reconcile.experiments, 'Retain my reconciliation comparison');
  assert.notDeepEqual([reconcile.x, reconcile.y], [1800, 2400]);
  for (const saved of old.nodes.filter(node => node.id !== reconcile.id)) {
    const actual = updated.nodes.find(node => node.id === saved.id)!;
    assert.deepEqual([actual.x, actual.y], [saved.x, saved.y], saved.id);
  }
  assert.deepEqual(refreshDocumentation(updated), updated);
  assert.deepEqual(old, before);
});
