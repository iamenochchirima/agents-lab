import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture } from '../src/features/lina/architectureDocument';
import { relationshipBlockLayout } from '../src/features/lina/blockLayout';
import { blockForNode } from '../src/features/lina/blockMembership';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
import type { LinaDocument, LinaNode } from '../src/features/lina/linaModel';

const blocks = ['input', 'execution', 'context', 'tools', 'model', 'safety', 'state', 'memory', 'subagents'] as const;
type Block = typeof blocks[number];
const copy = <T>(value: T): T => structuredClone(value);
function members(document: LinaDocument, block: Block): LinaNode[] {
  return document.nodes.filter(node => blockForNode(node) === block);
}
function bounds(document: LinaDocument, block: Block) {
  const nodes = members(document, block);
  assert.ok(nodes.length, `Expected populated ${block} block`);
  return {
    left: Math.min(...nodes.map(node => node.x)),
    right: Math.max(...nodes.map(node => node.x + LINA_NODE_WIDTH)),
    top: Math.min(...nodes.map(node => node.y)),
    bottom: Math.max(...nodes.map(node => node.y + LINA_NODE_HEIGHT)),
  };
}
function assertRigidTranslation(before: LinaDocument, after: LinaDocument) {
  for (const block of blocks) {
    const nodes = members(before, block);
    if (!nodes.length) continue;
    const anchor = after.nodes.find(node => node.id === nodes[0].id)!;
    const dx = anchor.x - nodes[0].x, dy = anchor.y - nodes[0].y;
    for (const original of nodes) {
      const placed = after.nodes.find(node => node.id === original.id)!;
      assert.equal(placed.x - original.x, dx, `${original.id}: internal x changed`);
      assert.equal(placed.y - original.y, dy, `${original.id}: internal y changed`);
    }
  }
}

test('relationship placement translates every block as a group, including Execution reconciliation', () => {
  const original = copy(linaArchitecture);
  // Preserve user edits inside the blocks, rather than restoring preset coordinates.
  original.nodes.forEach((node, index) => { node.x += index % 3 * 13; node.y += index % 4 * 17; });
  const placed = relationshipBlockLayout(original);
  assertRigidTranslation(original, placed);
  assert.equal(blockForNode(placed.nodes.find(node => node.id === 'lina-input-reconcile')!), 'execution');
  assert.deepEqual(placed.nodes.map(node => node.id), original.nodes.map(node => node.id));
});

test('relationship placement preserves notes, status, edges and unrelated custom nodes without mutating input', () => {
  const original = copy(linaArchitecture);
  Object.assign(original.nodes[0], { title: 'My input', status: 'studying', experiments: 'Try two variants', decisions: 'Keep this decision', references: 'local:research' });
  const custom = { ...original.nodes[0], id: 'custom-observer', area: 'My notes', x: 12345, y: -400 };
  original.nodes.push(custom);
  original.edges.push({ id: 'custom-connection', source: custom.id, target: original.nodes[0].id, label: 'My connection' });
  const snapshot = copy(original);
  const placed = relationshipBlockLayout(original);
  assert.deepEqual(original, snapshot, 'Layout must not mutate the saved/editable input');
  assert.deepEqual(placed.edges, original.edges);
  assert.deepEqual(placed.nodes.find(node => node.id === custom.id), custom);
  for (const originalNode of original.nodes) {
    const { x: _x, y: _y, ...originalContent } = originalNode;
    const { x: _placedX, y: _placedY, ...placedContent } = placed.nodes.find(node => node.id === originalNode.id)!;
    assert.deepEqual(placedContent, originalContent);
  }
});

test('relationship placement is deterministic and idempotent after arbitrary block translations', () => {
  const original = copy(linaArchitecture);
  original.nodes.forEach(node => {
    const index = blocks.indexOf(blockForNode(node)!);
    node.x += index * 211 - 900;
    node.y += index * 307 - 700;
  });
  const placed = relationshipBlockLayout(original);
  assert.deepEqual(relationshipBlockLayout(copy(original)), placed);
  assert.deepEqual(relationshipBlockLayout(placed), placed);
  assertRigidTranslation(original, placed);
});

test('populated block rectangles do not overlap and reflect Input → Execution → Tools relationships', () => {
  const placed = relationshipBlockLayout(linaArchitecture);
  for (let first = 0; first < blocks.length; first++) {
    for (let second = first + 1; second < blocks.length; second++) {
      const a = bounds(placed, blocks[first]), b = bounds(placed, blocks[second]);
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        `${blocks[first]} and ${blocks[second]} group rectangles overlap`);
    }
  }
  const input = bounds(placed, 'input'), execution = bounds(placed, 'execution');
  const tools = bounds(placed, 'tools'), context = bounds(placed, 'context'), model = bounds(placed, 'model');
  assert.ok(input.right < execution.left, 'Input belongs left of Execution');
  assert.ok(execution.right < tools.left, 'Tools belongs right of Execution');
  assert.ok(context.top > execution.bottom, 'Context belongs below Execution');
  assert.ok(model.left > context.right, 'Model belongs beside Context');
  assert.ok(model.top > tools.bottom, 'Model belongs below Tools');
  assert.ok(model.left < tools.right && model.right > tools.left, 'Model shares the Tools column');
});

test('empty and partial documents remain valid without inventing missing nodes or edges', () => {
  const empty: LinaDocument = { version: 1, nodes: [], edges: [] };
  assert.deepEqual(relationshipBlockLayout(empty), empty);
  const partial: LinaDocument = { version: 1, nodes: copy(members(linaArchitecture, 'context')), edges: [] };
  const placed = relationshipBlockLayout(partial);
  assert.equal(placed.nodes.length, partial.nodes.length);
  assert.deepEqual(placed.edges, []);
  assert.ok(placed.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assertRigidTranslation(partial, placed);
  assert.deepEqual(relationshipBlockLayout(placed), placed);
});
