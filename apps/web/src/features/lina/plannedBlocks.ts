import type { LinaDocument } from './linaModel';
import { blockBounds } from './blockLayout';
import { blockForNode } from './blockMembership';
import { LINA_NODE_WIDTH } from './edgeRouting';

/** Empty canvas regions reserve design areas; they are not executable nodes. */
const plannedBlocks = [
  { key: 'context', title: 'Context' },
  { key: 'memory', title: 'Memory' },
  { key: 'tools', title: 'Tools' },
  { key: 'model', title: 'Model Interface' },
  { key: 'planning', title: 'Planning and task management' },
  { key: 'safety', title: 'Safety and permissions' },
  { key: 'environment', title: 'Execution Environment' },
  { key: 'computer', title: 'Computer Use', note: 'Deferred' },
  { key: 'output', title: 'Output and delivery' },
  { key: 'observability', title: 'Observability' },
  { key: 'state', title: 'State, persistence and recovery' },
  { key: 'subagents', title: 'Subagents / multi-agent orchestration' },
];

export function plannedBlockRegions(document: LinaDocument) {
  const left = Math.max(1600, ...document.nodes.map(node => node.x + LINA_NODE_WIDTH)) + 180;
  const anchor = (key: 'input' | 'execution' | 'context' | 'tools' | 'safety' | 'memory' | 'subagents' | 'environment') => {
    const nodes = document.nodes.filter(node => blockForNode(node) === key);
    return nodes.length ? blockBounds(nodes) : undefined;
  };
  const input = anchor('input'), execution = anchor('execution'), context = anchor('context'), tools = anchor('tools'), safety = anchor('safety');
  const memory = anchor('memory'), subagents = anchor('subagents'), environment = anchor('environment');
  const memoryY = context && context.y + context.height + 220;
  const futureY = Math.max(memory ? memory.y + memory.height + 220 : memoryY! + 400, subagents ? subagents.y + subagents.height + 220 : 0);
  const environmentX = tools && Math.max(tools.x + tools.width, safety ? safety.x + safety.width : 0) + 220;
  // Future regions sit near their expected consumers. They remain empty design
  // reservations, without invented executable connections.
  const nearby: Record<string, { x: number; y: number } | undefined> = {
    planning: execution && { x: execution.x, y: Math.max(80, execution.y - 460) },
    safety: tools && { x: tools.x, y: Math.max(80, tools.y - 460) },
    memory: context && { x: context.x, y: memoryY! },
    subagents: context && { x: context.x, y: futureY },
    environment: tools && { x: environmentX!, y: tools.y },
    computer: tools && { x: environment?.x ?? environmentX!, y: environment ? environment.y + environment.height + 220 : tools.y + 400 },
    output: input && { x: input.x, y: input.y + input.height + 220 },
    state: input && { x: input.x, y: input.y + input.height + 620 },
    observability: context && { x: context.x + 880, y: futureY },
  };
  return plannedBlocks.map((block, index) => ({ ...block, number: String(index + 3).padStart(2, '0') }))
    .filter(block => !document.nodes.some(node => node.id.startsWith(`lina-${block.key}-`)))
    .map((block, index) => ({ ...block,
      ...(nearby[block.key] ?? { x: left + index % 2 * 720, y: 80 + Math.floor(index / 2) * 400 }),
      width: 660, height: 320 }));
}
