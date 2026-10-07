import type { LinaDocument } from './linaModel';
import { LINA_NODE_WIDTH } from './edgeRouting';

/** Empty canvas regions reserve design areas; they are not executable nodes. */
const plannedBlocks = [
  { key: 'context', title: 'Context' },
  { key: 'memory', title: 'Memory' },
  { key: 'tools', title: 'Tools' },
  { key: 'model', title: 'Model Interface' },
  { key: 'planning', title: 'Planning' },
  { key: 'safety', title: 'Safety and permissions' },
  { key: 'environment', title: 'Execution Environment' },
  { key: 'computer', title: 'Computer Use' },
  { key: 'output', title: 'Output and delivery' },
  { key: 'observability', title: 'Observability' },
  { key: 'state', title: 'State, persistence and recovery' },
];

export function plannedBlockRegions(document: LinaDocument) {
  const left = Math.max(1600, ...document.nodes.map(node => node.x + LINA_NODE_WIDTH)) + 180;
  return plannedBlocks.filter(block => !document.nodes.some(node => node.id.startsWith(`lina-${block.key}-`)))
    .map((block, index) => ({ ...block, number: String(index + 3).padStart(2, '0'),
      x: left + index % 2 * 720, y: 80 + Math.floor(index / 2) * 400,
      width: 660, height: 320 }));
}
