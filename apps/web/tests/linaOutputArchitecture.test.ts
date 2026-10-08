import test from 'node:test';
import assert from 'node:assert/strict';
import { linaArchitecture, refreshDocumentation } from '../src/features/lina/architectureDocument';
import { linaOutputBlock, OUTPUT_STATE_ROUTES } from '../src/features/lina/outputBlock';
import { blockForNode } from '../src/features/lina/blockMembership';
import { relationshipBlockLayout, blockBounds } from '../src/features/lina/blockLayout';
import { plannedBlockRegions } from '../src/features/lina/plannedBlocks';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from '../src/features/lina/edgeRouting';
const intersects = (a: {
    x: number;
    y: number;
    width: number;
    height: number;
}, b: {
    x: number;
    y: number;
    width: number;
    height: number;
}) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
test('thirteen Output responsibilities replace empty reservation with valid branches', () => {
    assert.deepEqual(linaOutputBlock.nodes.map(n => n.id), ['intent', 'route', 'policy', 'render', 'media', 'stream', 'register', 'schedule', 'send', 'observe', 'retry', 'reconcile', 'settle'].map(id => `lina-output-${id}`));
    assert.ok(linaOutputBlock.nodes.every(n => blockForNode(n) === 'output'));
    assert.equal(plannedBlockRegions(linaArchitecture).some(r => r.key === 'output'), false);
    const ids = new Set(linaArchitecture.nodes.map(n => n.id));
    assert.equal(new Set(linaArchitecture.edges.map(e => e.id)).size, linaArchitecture.edges.length);
    for (const e of linaOutputBlock.edges) {
        assert.ok(ids.has(e.source), e.id);
        assert.ok(ids.has(e.target), e.id);
    }
});
test('Output State acknowledgments return to exact owner phase and preserve send identity', () => {
    for (const r of OUTPUT_STATE_ROUTES) {
        assert.equal(r.source, r.returnTarget);
        assert.equal(linaOutputBlock.edges.find(e => e.id === r.returnId)?.target, r.source);
    }
    assert.ok(OUTPUT_STATE_ROUTES.some(r => r.kind === 'record' && r.phase === 'record-output-upload'));
    assert.ok(OUTPUT_STATE_ROUTES.some(r => r.kind === 'load' && r.phase === 'inspect-original-output-upload'));
    assert.ok(OUTPUT_STATE_ROUTES.some(r => r.kind === 'record' && r.phase === 'record-output-send-start'));
    assert.ok(OUTPUT_STATE_ROUTES.some(r => r.kind === 'load' && r.phase === 'inspect-original-output-attempt'));
});
test('final, preview, internal, receipts and uncertainty have distinct ownership paths', () => {
    const paths = [['wait-intent', 'lina-execution-wait', 'lina-output-intent'], ['settle-wait', 'lina-output-settle', 'lina-execution-wait'], ['input-intent', 'lina-input-delivery', 'lina-output-intent'], ['input-observe', 'lina-input-delivery', 'lina-output-observe'], ['intent-coordinate', 'lina-output-intent', 'lina-subagents-coordinate'], ['model-stream', 'lina-model-invoke', 'lina-output-stream'], ['stream-policy', 'lina-output-stream', 'lina-output-policy'], ['media-environment', 'lina-output-media', 'lina-environment-artifacts'], ['send-reconcile', 'lina-output-send', 'lina-output-reconcile'], ['reconcile-wait', 'lina-output-reconcile', 'lina-execution-wait'], ['retry-schedule', 'lina-output-retry', 'lina-output-schedule'], ['register-release', 'lina-output-register', 'lina-execution-release']];
    for (const [id, source, target] of paths) {
        const e = linaOutputBlock.edges.find(e => e.id === `lina-output-edge-${id}`)!;
        assert.equal(e.source, source);
        assert.equal(e.target, target);
    }
    assert.equal(linaOutputBlock.edges.some(e => e.source === 'lina-output-reconcile' && e.target === 'lina-output-send'), false, 'uncertainty cannot directly redispatch');
    assert.equal(linaOutputBlock.edges.some(e => e.source === 'lina-output-stream' && e.target === 'lina-output-send'), false, 'previews require ordinary admission');
});
test('Output refresh preserves saved coordinates, notes and custom edges', () => {
    const old = structuredClone(linaArchitecture);
    old.nodes = old.nodes.filter(n => blockForNode(n) !== 'output').map(n => ({ ...n, experiments: 'Keep my experiment' }));
    old.edges = old.edges.filter(e => !e.id.startsWith('lina-output-edge-'));
    const input = blockBounds(old.nodes.filter(n => blockForNode(n) === 'input'));
    const note = { ...old.nodes[0], id: 'output-note', x: input.x, y: input.y + input.height + 220 };
    old.nodes.push(note);
    old.edges.push({ id: 'custom-output', source: note.id, target: old.nodes[0].id, label: 'Custom' });
    const updated = refreshDocumentation(old);
    for (const n of old.nodes)
        assert.deepEqual(updated.nodes.find(x => x.id === n.id), n);
    for (const n of updated.nodes.filter(n => blockForNode(n) === 'output'))
        assert.ok(!intersects({ ...n, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }, { ...note, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }));
    assert.ok(updated.edges.some(e => e.id === 'custom-output'));
    assert.deepEqual(refreshDocumentation(updated), updated);
});
test('Output follows moved saved group and avoids a missing-node annotation', () => {
    const old = structuredClone(linaArchitecture);
    old.nodes = old.nodes.map(n => blockForNode(n) === 'output' ? { ...n, x: n.x + 210, y: n.y + 310 } : n);
    const missing = old.nodes.find(n => n.id === 'lina-output-send')!;
    old.nodes = old.nodes.filter(n => n.id !== missing.id);
    old.nodes.push({ ...missing, id: 'output-send-note' });
    const refreshed = refreshDocumentation(old), restored = refreshed.nodes.find(n => n.id === missing.id)!;
    assert.equal(restored.y, missing.y);
    assert.ok(restored.x > missing.x);
    assert.deepEqual(refreshDocumentation(refreshed), refreshed);
});
test('Output stays beside originating routes and above State without block overlap', () => {
    const placed = relationshipBlockLayout(linaArchitecture), output = blockBounds(placed.nodes.filter(n => blockForNode(n) === 'output'));
    const input = blockBounds(placed.nodes.filter(n => blockForNode(n) === 'input')), state = blockBounds(placed.nodes.filter(n => blockForNode(n) === 'state'));
    assert.equal(output.x, input.x);
    assert.ok(output.y > input.y + input.height);
    assert.ok(state.y > output.y + output.height);
    for (const key of ['input', 'execution', 'context', 'tools', 'model', 'safety', 'state', 'memory', 'subagents', 'planning', 'environment'] as const)
        assert.ok(!intersects(output, blockBounds(placed.nodes.filter(n => blockForNode(n) === key))), key);
    for (const region of plannedBlockRegions(placed))
        assert.ok(!intersects(output, region), region.key);
    assert.deepEqual(relationshipBlockLayout(placed), placed);
});
test('canonical Output positions do not collide with maintained nodes', () => {
    for (const node of linaOutputBlock.nodes)
        for (const other of linaArchitecture.nodes.filter(n => blockForNode(n) !== 'output'))
            assert.ok(!intersects({ ...node, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }, { ...other, width: LINA_NODE_WIDTH, height: LINA_NODE_HEIGHT }), `${node.id}/${other.id}`);
});
