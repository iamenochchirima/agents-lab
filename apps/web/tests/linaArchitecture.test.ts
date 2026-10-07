import assert from 'node:assert/strict';
import test from 'node:test';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaInputBlock } from '../src/features/lina/inputBlock';
import { linaExecutionBlock } from '../src/features/lina/executionBlock';
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
  assert.equal(updated.nodes.filter(node => node.id.startsWith('lina-execution-')).length, linaExecutionBlock.nodes.length);
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
