import type { LinaDocument, LinaNode } from './linaModel';
import { blockForNode } from './blockMembership';
import { LINA_NODE_HEIGHT, LINA_NODE_WIDTH } from './edgeRouting';

type Block = NonNullable<ReturnType<typeof blockForNode>>;
export function blockBounds(nodes: LinaNode[]) {
  const x = Math.min(...nodes.map(node => node.x));
  const y = Math.min(...nodes.map(node => node.y));
  return { x, y, width: Math.max(...nodes.map(node => node.x + LINA_NODE_WIDTH)) - x,
    height: Math.max(...nodes.map(node => node.y + LINA_NODE_HEIGHT)) - y };
}

/** Translate complete groups without changing their internal paths or user notes.
 * Execution sits between admission and its dependencies. Context is below it,
 * with Model beside Context and below Tools for their shared readiness paths.
 * State is below Input and alongside the execution dependencies.
 * This is a deliberate architecture layout, not an assertion of serial execution.
 */
export function relationshipBlockLayout(document: LinaDocument): LinaDocument {
  const keys: Block[] = ['input', 'execution', 'context', 'tools', 'model', 'safety', 'state', 'memory', 'subagents', 'planning', 'environment', 'output'];
  const groups = new Map(keys.map(key => [key, document.nodes.filter(node => blockForNode(node) === key)]));
  const bounds = new Map(keys.filter(key => groups.get(key)!.length).map(key => [key, blockBounds(groups.get(key)!)]));
  if (!bounds.size) return document;
  const input = bounds.get('input') ?? { width: 0, height: 0 };
  const execution = bounds.get('execution') ?? { width: 0, height: 0 };
  const tools = bounds.get('tools') ?? { width: 0, height: 0 };
  const middleX = 80 + input.width + 320;
  const middleY = Math.max(120 + (bounds.get('planning')?.height ?? 0) + 360, 120 + input.height - execution.height - 300);
  const rightX = middleX + execution.width + 320;
  const contextY = middleY + execution.height + 360;
  const targets: Record<Block, { x: number; y: number }> = {
    environment: { x: rightX + tools.width + 320, y: middleY + (bounds.get('safety')?.height ?? 0) + 320 },
    planning: { x: middleX, y: 120 },
    subagents: { x: middleX + (bounds.get('memory')?.width ?? 0) + 320, y: Math.max(contextY + (bounds.get('context')?.height ?? 0) + 360, Math.max(contextY, middleY + tools.height + 340) + (bounds.get('model')?.height ?? 0) + 320) },
    memory: { x: middleX, y: contextY + (bounds.get('context')?.height ?? 0) + 360 },
    output: { x: 80, y: 120 + input.height + 320 },
    state: { x: 80, y: 120 + input.height + 640 + (bounds.get('output')?.height ?? 0) },
    input: { x: 80, y: 120 }, execution: { x: middleX, y: middleY },
    context: { x: middleX, y: contextY }, tools: { x: rightX, y: middleY },
    safety: { x: rightX + tools.width + 320, y: middleY },
    model: { x: middleX + (bounds.get('context')?.width ?? execution.width) + 320,
      y: Math.max(contextY, middleY + tools.height + 340) },
  };
  return { ...document, nodes: document.nodes.map(node => {
    const key = blockForNode(node), original = key && bounds.get(key);
    if (!key || !original) return node;
    return { ...node, x: targets[key].x + node.x - original.x,
      y: targets[key].y + node.y - original.y };
  }) };
}
