/** Lina is a design document, not an executable harness or measured run. */
export interface LinaNode {
  id: string; title: string; area: string; status: 'proposed' | 'studying' | 'decided';
  x: number; y: number; purpose: string; inputs: string; outputs: string;
  decisions: string; references: string; experiments: string;
}
export interface LinaEdge { id: string; source: string; target: string; label: string }
export interface LinaDocument { version: 1; nodes: LinaNode[]; edges: LinaEdge[] }
export const emptyLina: LinaDocument = { version: 1, nodes: [], edges: [] };
