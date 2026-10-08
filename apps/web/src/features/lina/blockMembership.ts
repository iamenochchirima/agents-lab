import type { LinaNode } from './linaModel';

/** Reconciliation keeps its original public ID while execution owns its lifecycle. */
export function blockForNode(node: LinaNode): 'input' | 'execution' | 'context' | 'tools' | 'model' | 'safety' | 'state' | 'memory' | 'subagents' | 'planning' | 'environment' | 'output' | undefined {
  if (node.id === 'lina-input-reconcile' || node.id.startsWith('lina-execution-')) return 'execution';
  if (node.id.startsWith('lina-input-')) return 'input';
  if (node.id.startsWith('lina-context-')) return 'context';
  if (node.id.startsWith('lina-tools-')) return 'tools';
  if (node.id.startsWith('lina-model-')) return 'model';
  if (node.id.startsWith('lina-safety-')) return 'safety';
  if (node.id.startsWith('lina-state-')) return 'state';
  if (node.id.startsWith('lina-memory-')) return 'memory';
  if (node.id.startsWith('lina-subagents-')) return 'subagents';
  if (node.id.startsWith('lina-planning-')) return 'planning';
  if (node.id.startsWith('lina-environment-')) return 'environment';
  if (node.id.startsWith('lina-output-')) return 'output';
}
