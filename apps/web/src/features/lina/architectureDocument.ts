import type { LinaDocument } from './linaModel';
import { linaInputBlock } from './inputBlock';
import { linaExecutionBlock } from './executionBlock';
import { LINA_NODE_WIDTH, LINA_NODE_HEIGHT } from './edgeRouting';

/** Maintained design data, separate from transient simulated execution. */
export const linaArchitecture: LinaDocument = {
  version: 1,
  nodes: [...linaInputBlock.nodes, ...linaExecutionBlock.nodes],
  edges: [...linaInputBlock.edges, ...linaExecutionBlock.edges],
};

/** Adopt reviewed notes/connections without resetting saved layout or user notes.
 * Missing execution nodes follow the existing block offset, or start below Input.
 * This refresh changes the editable draft; only explicit Save commits it.
 */
export function refreshDocumentation(document: LinaDocument): LinaDocument {
  const defaults = new Map(linaArchitecture.nodes.map(node => [node.id, node]));
  const nodes = document.nodes.filter(node => !(node.title === 'New component'
    && ['purpose', 'inputs', 'outputs', 'decisions', 'references', 'experiments'].every(key => !node[key as keyof typeof node])
    && !document.edges.some(edge => edge.source === node.id || edge.target === node.id)))
    .map(node => {
      const maintained = defaults.get(node.id);
      return maintained ? { ...node, purpose: maintained.purpose, inputs: maintained.inputs,
        outputs: maintained.outputs, decisions: maintained.decisions, references: maintained.references } : node;
    });

  const overlaps = (x: number, y: number) => nodes.some(node =>
    x < node.x + LINA_NODE_WIDTH + 40 && node.x < x + LINA_NODE_WIDTH + 40
    && y < node.y + LINA_NODE_HEIGHT + 40 && node.y < y + LINA_NODE_HEIGHT + 40);
  for (const maintained of linaInputBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = maintained.x;
    while (overlaps(x, maintained.y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x });
  }

  const anchor = linaExecutionBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedAnchor = anchor && nodes.find(node => node.id === anchor.id);
  const inputs = nodes.filter(node => node.id.startsWith('lina-input-'));
  const dx = anchor && savedAnchor ? savedAnchor.x - anchor.x
    : Math.min(...inputs.map(node => node.x)) - Math.min(...linaInputBlock.nodes.map(node => node.x));
  let dy = anchor && savedAnchor ? savedAnchor.y - anchor.y
    : Math.max(0, Math.max(...inputs.map(node => node.y + LINA_NODE_HEIGHT)) + 220
      - Math.min(...linaExecutionBlock.nodes.map(node => node.y)));
  // Keep a newly introduced block together when unrelated saved nodes occupy its preset.
  if (!anchor) {
    while (linaExecutionBlock.nodes.some(node => overlaps(node.x + dx, node.y + dy))) dy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaExecutionBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = maintained.x + dx;
    const y = maintained.y + dy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const customEdges = document.edges.filter(edge =>
    !edge.id.startsWith('lina-input-edge-') && !edge.id.startsWith('lina-execution-edge-'));
  return { ...document, nodes, edges: [...linaArchitecture.edges, ...customEdges] };
}
