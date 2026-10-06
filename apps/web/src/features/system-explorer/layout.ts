import type { ExplorerGraph, ExplorerGroup, ExplorerNode } from './types';

export const nodeSize = { width: 280, height: 104 };
export type PlacedNode = ExplorerNode & { x: number; y: number };
export type PlacedGroup = ExplorerGroup & { x: number; y: number; width: number; height: number };

/** Region placement expresses reading order only. Connections carry the source relationships. */
export function placeGraph(graph: ExplorerGraph) {
  const width = 920, gap = 70, padding = 40;
  const groups: PlacedGroup[] = [];
  const nodes: PlacedNode[] = [];
  let y = padding;
  for (let row = 0; row < Math.ceil(graph.groups.length / 3); row++) {
    const rowGroups = graph.groups.slice(row * 3, row * 3 + 3);
    const heights = rowGroups.map(group => 150 + Math.ceil(graph.nodes.filter(n => n.groupId === group.id).length / 2) * 155);
    const rowHeight = Math.max(...heights);
    rowGroups.forEach((group, column) => {
      const x = padding + column * (width + gap);
      groups.push({ ...group, x, y, width, height: heights[column] });
      graph.nodes.filter(n => n.groupId === group.id).forEach((node, slot) => {
        nodes.push({ ...node, x: x + 80 + (slot % 2) * 465, y: y + 120 + Math.floor(slot / 2) * 155 });
      });
    });
    y += rowHeight + gap;
  }
  return { groups, nodes, width: padding * 2 + 3 * width + 2 * gap, height: y - gap + padding };
}
