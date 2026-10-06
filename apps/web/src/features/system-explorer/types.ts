/** Teaching graphs retain repository-specific names and behavior; they are not harness execution contracts. */
export type SourceAnchor = { file: string; line: number; symbol: string };
export type NodeKind = 'component' | 'state' | 'decision' | 'store' | 'external';
export type EdgeKind = 'call' | 'data' | 'transition' | 'background';
export type ExplorerNode = {
  id: string;
  label: string;
  kind: NodeKind;
  groupId: string;
  summary: string;
  source: readonly SourceAnchor[];
  inputs?: string;
  outputs?: string;
  conditions?: string;
  failures?: string;
  notes?: string;
};
export type ExplorerGroup = { id: string; label: string; summary: string };
export type ExplorerEdge = {
  id: string; from: string; to: string; kind: EdgeKind; label: string;
  source: readonly SourceAnchor[];
  condition?: string;
};
export type ExplorerTrace = {
  id: string; label: string; description: string;
  steps: readonly { nodeId: string; detail: string }[];
};
export type ExplorerGraph = {
  id: string; name: string; repository: string; commit: string;
  description: string;
  scope: string;
  limitations: readonly string[];
  groups: readonly ExplorerGroup[];
  nodes: readonly ExplorerNode[];
  edges: readonly ExplorerEdge[];
  traces: readonly ExplorerTrace[];
};
