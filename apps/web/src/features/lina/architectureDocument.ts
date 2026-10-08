import type { LinaDocument } from './linaModel';
import { linaInputBlock } from './inputBlock';
import { linaExecutionBlock } from './executionBlock';
import { linaContextBlock } from './contextBlock';
import { linaToolsBlock } from './toolsBlock';
import { linaModelBlock } from './modelBlock';
import { linaSafetyBlock } from './safetyBlock';
import { linaStateBlock } from './stateBlock';
import { linaMemoryBlock } from './memoryBlock';
import { linaSubagentsBlock } from './subagentsBlock';
import { linaPlanningBlock } from './planningBlock';
import { linaEnvironmentBlock } from './environmentBlock';
import { linaOutputBlock } from './outputBlock';
import { blockForNode } from './blockMembership';
import { LINA_NODE_WIDTH, LINA_NODE_HEIGHT } from './edgeRouting';

/** Maintained design data, separate from transient simulated execution. */
export const linaArchitecture: LinaDocument = {
  version: 1,
  nodes: [...linaInputBlock.nodes, ...linaExecutionBlock.nodes, ...linaContextBlock.nodes, ...linaToolsBlock.nodes, ...linaModelBlock.nodes, ...linaSafetyBlock.nodes, ...linaStateBlock.nodes, ...linaMemoryBlock.nodes, ...linaSubagentsBlock.nodes, ...linaPlanningBlock.nodes, ...linaEnvironmentBlock.nodes, ...linaOutputBlock.nodes],
  edges: [...linaInputBlock.edges, ...linaExecutionBlock.edges, ...linaContextBlock.edges, ...linaToolsBlock.edges, ...linaModelBlock.edges, ...linaSafetyBlock.edges, ...linaStateBlock.edges, ...linaMemoryBlock.edges, ...linaSubagentsBlock.edges, ...linaPlanningBlock.edges, ...linaEnvironmentBlock.edges, ...linaOutputBlock.edges],
};

/** Adopt reviewed notes/connections without resetting saved layout or user notes.
 * Missing execution/Context/Tools/Model/Safety/State nodes follow their saved block offset; new blocks
 * start below their upstream block and move together around occupied positions.
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
        outputs: maintained.outputs, decisions: maintained.decisions, references: maintained.references,
        ...(node.id === 'lina-input-reconcile' ? { area: maintained.area } : {}) } : node;
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

  const anchor = linaExecutionBlock.nodes.find(node => node.id !== 'lina-input-reconcile' && nodes.some(saved => saved.id === node.id));
  const savedAnchor = anchor && nodes.find(node => node.id === anchor.id);
  const inputs = nodes.filter(node => blockForNode(node) === 'input');
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
    let x = Math.max(20, maintained.x + dx);
    const y = maintained.y + dy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const previousReconcile = document.nodes.find(node => node.id === 'lina-input-reconcile');
  if (previousReconcile && previousReconcile.area !== 'Turn Execution') {
    const maintained = defaults.get(previousReconcile.id)!;
    const currentReconcile = nodes.find(node => node.id === previousReconcile.id)!;
    const executionStart = nodes.find(node => node.id === 'lina-execution-start')!;
    const presetStart = linaExecutionBlock.nodes.find(node => node.id === 'lina-execution-start')!;
    const relocatedX = Math.max(20, maintained.x + executionStart.x - presetStart.x);
    let relocatedY = maintained.y + executionStart.y - presetStart.y;
    while (nodes.some(node => node.id !== currentReconcile.id && relocatedX < node.x + LINA_NODE_WIDTH + 40 && node.x < relocatedX + LINA_NODE_WIDTH + 40 && relocatedY < node.y + LINA_NODE_HEIGHT + 40 && node.y < relocatedY + LINA_NODE_HEIGHT + 40)) relocatedY += LINA_NODE_HEIGHT + 100;
    currentReconcile.x = relocatedX; currentReconcile.y = relocatedY;
  }

  const contextAnchor = linaContextBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedContextAnchor = contextAnchor && nodes.find(node => node.id === contextAnchor.id);
  const execution = nodes.filter(node => blockForNode(node) === 'execution');
  const contextDx = contextAnchor && savedContextAnchor ? savedContextAnchor.x - contextAnchor.x
    : Math.min(...execution.map(node => node.x)) - Math.min(...linaContextBlock.nodes.map(node => node.x));
  let contextDy = contextAnchor && savedContextAnchor ? savedContextAnchor.y - contextAnchor.y
    : Math.max(0, Math.max(...nodes.map(node => node.y + LINA_NODE_HEIGHT)) + 220
      - Math.min(...linaContextBlock.nodes.map(node => node.y)));
  // A wholly new block moves as one group so its reduction branches keep their shape.
  if (!contextAnchor) {
    while (linaContextBlock.nodes.some(node => overlaps(node.x + contextDx, node.y + contextDy))) {
      contextDy += LINA_NODE_HEIGHT + 100;
    }
  }
  for (const maintained of linaContextBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + contextDx);
    const y = maintained.y + contextDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const toolsAnchor = linaToolsBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedToolsAnchor = toolsAnchor && nodes.find(node => node.id === toolsAnchor.id);
  const context = nodes.filter(node => node.id.startsWith('lina-context-'));
  const toolsDx = toolsAnchor && savedToolsAnchor ? savedToolsAnchor.x - toolsAnchor.x
    : Math.min(...context.map(node => node.x)) - Math.min(...linaToolsBlock.nodes.map(node => node.x));
  let toolsDy = toolsAnchor && savedToolsAnchor ? savedToolsAnchor.y - toolsAnchor.y
    : Math.max(0, Math.max(...nodes.map(node => node.y + LINA_NODE_HEIGHT)) + 220
      - Math.min(...linaToolsBlock.nodes.map(node => node.y)));
  // Setup and execution lanes retain their relative positions when first introduced.
  if (!toolsAnchor) {
    while (linaToolsBlock.nodes.some(node => overlaps(node.x + toolsDx, node.y + toolsDy))) {
      toolsDy += LINA_NODE_HEIGHT + 100;
    }
  }
  for (const maintained of linaToolsBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + toolsDx);
    const y = maintained.y + toolsDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const modelAnchor = linaModelBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedModelAnchor = modelAnchor && nodes.find(node => node.id === modelAnchor.id);
  const tools = nodes.filter(node => blockForNode(node) === 'tools');
  const modelDx = modelAnchor && savedModelAnchor ? savedModelAnchor.x - modelAnchor.x
    : Math.min(...tools.map(node => node.x)) - Math.min(...linaModelBlock.nodes.map(node => node.x));
  let modelDy = modelAnchor && savedModelAnchor ? savedModelAnchor.y - modelAnchor.y
    : Math.max(0, Math.max(...nodes.map(node => node.y + LINA_NODE_HEIGHT)) + 220
      - Math.min(...linaModelBlock.nodes.map(node => node.y)));
  if (!modelAnchor) {
    while (linaModelBlock.nodes.some(node => overlaps(node.x + modelDx, node.y + modelDy))) modelDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaModelBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + modelDx);
    const y = maintained.y + modelDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const safetyAnchor = linaSafetyBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedSafetyAnchor = safetyAnchor && nodes.find(node => node.id === safetyAnchor.id);
  const safetyDx = safetyAnchor && savedSafetyAnchor ? savedSafetyAnchor.x - safetyAnchor.x
    : Math.max(...tools.map(node => node.x + LINA_NODE_WIDTH)) + 320 - Math.min(...linaSafetyBlock.nodes.map(node => node.x));
  let safetyDy = safetyAnchor && savedSafetyAnchor ? savedSafetyAnchor.y - safetyAnchor.y
    : Math.min(...tools.map(node => node.y)) - Math.min(...linaSafetyBlock.nodes.map(node => node.y));
  // Safety starts beside its Tools consumers rather than extending the vertical stack.
  if (!safetyAnchor) {
    while (linaSafetyBlock.nodes.some(node => overlaps(node.x + safetyDx, node.y + safetyDy))) safetyDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaSafetyBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + safetyDx);
    const y = maintained.y + safetyDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const stateAnchor = linaStateBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedStateAnchor = stateAnchor && nodes.find(node => node.id === stateAnchor.id);
  const stateDx = stateAnchor && savedStateAnchor ? savedStateAnchor.x - stateAnchor.x
    : Math.min(...inputs.map(node => node.x)) - Math.min(...linaStateBlock.nodes.map(node => node.x));
  let stateDy = stateAnchor && savedStateAnchor ? savedStateAnchor.y - stateAnchor.y
    : Math.max(...inputs.map(node => node.y + LINA_NODE_HEIGHT)) + 620 - Math.min(...linaStateBlock.nodes.map(node => node.y));
  // Storage sits below Input beside Execution, keeping its requester paths local.
  // Translate a new block as a group; existing user coordinates stay untouched.
  if (!stateAnchor) {
    while (linaStateBlock.nodes.some(node => overlaps(node.x + stateDx, node.y + stateDy))) stateDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaStateBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + stateDx);
    const y = maintained.y + stateDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const memoryAnchor = linaMemoryBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedMemoryAnchor = memoryAnchor && nodes.find(node => node.id === memoryAnchor.id);
  const contextBoundsX = Math.min(...context.map(node => node.x));
  const memoryDx = memoryAnchor && savedMemoryAnchor ? savedMemoryAnchor.x - memoryAnchor.x
    : contextBoundsX - Math.min(...linaMemoryBlock.nodes.map(node => node.x));
  let memoryDy = memoryAnchor && savedMemoryAnchor ? savedMemoryAnchor.y - memoryAnchor.y
    : Math.max(...context.map(node => node.y + LINA_NODE_HEIGHT)) + 360 - Math.min(...linaMemoryBlock.nodes.map(node => node.y));
  // Recall sits beside its Context consumers; preserve a saved block's coordinates.
  if (!memoryAnchor) {
    while (linaMemoryBlock.nodes.some(node => overlaps(node.x + memoryDx, node.y + memoryDy))) memoryDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaMemoryBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + memoryDx);
    const y = maintained.y + memoryDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const subagentsAnchor = linaSubagentsBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedSubagentsAnchor = subagentsAnchor && nodes.find(node => node.id === subagentsAnchor.id);
  const memoryNodes = nodes.filter(node => blockForNode(node) === 'memory');
  const subagentsDx = subagentsAnchor && savedSubagentsAnchor ? savedSubagentsAnchor.x - subagentsAnchor.x
    : Math.max(...memoryNodes.map(node => node.x + LINA_NODE_WIDTH)) + 320 - Math.min(...linaSubagentsBlock.nodes.map(node => node.x));
  let subagentsDy = subagentsAnchor && savedSubagentsAnchor ? savedSubagentsAnchor.y - subagentsAnchor.y
    : Math.min(...memoryNodes.map(node => node.y)) - Math.min(...linaSubagentsBlock.nodes.map(node => node.y));
  // Children reuse the shared loop; their lifecycle region sits beside Memory.
  // Place a new group around annotations without moving existing saved nodes.
  if (!subagentsAnchor) {
    while (linaSubagentsBlock.nodes.some(node => overlaps(node.x + subagentsDx, node.y + subagentsDy))) subagentsDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaSubagentsBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + subagentsDx);
    const y = maintained.y + subagentsDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const planningAnchor = linaPlanningBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedPlanningAnchor = planningAnchor && nodes.find(node => node.id === planningAnchor.id);
  const planningDx = planningAnchor && savedPlanningAnchor ? savedPlanningAnchor.x - planningAnchor.x
    : Math.max(...execution.map(node => node.x + LINA_NODE_WIDTH)) + 320 - Math.min(...linaPlanningBlock.nodes.map(node => node.x));
  let planningDy = planningAnchor && savedPlanningAnchor ? savedPlanningAnchor.y - planningAnchor.y
    : Math.min(...execution.map(node => node.y)) - Math.min(...linaPlanningBlock.nodes.map(node => node.y));
  // Introduce Planning beside the existing loop; keep saved coordinates and notes.
  if (!planningAnchor) {
    while (linaPlanningBlock.nodes.some(node => overlaps(node.x + planningDx, node.y + planningDy))) planningDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaPlanningBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + planningDx);
    const y = maintained.y + planningDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const environmentAnchor = linaEnvironmentBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedEnvironmentAnchor = environmentAnchor && nodes.find(node => node.id === environmentAnchor.id);
  const environmentDx = environmentAnchor && savedEnvironmentAnchor ? savedEnvironmentAnchor.x - environmentAnchor.x
    : Math.max(...tools.map(node => node.x + LINA_NODE_WIDTH), ...nodes.filter(node => blockForNode(node) === 'safety').map(node => node.x + LINA_NODE_WIDTH)) + 320 - Math.min(...linaEnvironmentBlock.nodes.map(node => node.x));
  let environmentDy = environmentAnchor && savedEnvironmentAnchor ? savedEnvironmentAnchor.y - environmentAnchor.y
    : Math.min(...tools.map(node => node.y)) - Math.min(...linaEnvironmentBlock.nodes.map(node => node.y));
  // New environment groups avoid saved annotations; existing layouts remain untouched.
  if (!environmentAnchor) {
    while (linaEnvironmentBlock.nodes.some(node => overlaps(node.x + environmentDx, node.y + environmentDy))) environmentDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaEnvironmentBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + environmentDx);
    const y = maintained.y + environmentDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const outputAnchor = linaOutputBlock.nodes.find(node => nodes.some(saved => saved.id === node.id));
  const savedOutputAnchor = outputAnchor && nodes.find(node => node.id === outputAnchor.id);
  const outputDx = outputAnchor && savedOutputAnchor ? savedOutputAnchor.x - outputAnchor.x
    : Math.min(...inputs.map(node => node.x)) - Math.min(...linaOutputBlock.nodes.map(node => node.x));
  let outputDy = outputAnchor && savedOutputAnchor ? savedOutputAnchor.y - outputAnchor.y
    : Math.max(...inputs.map(node => node.y + LINA_NODE_HEIGHT)) + 220 - Math.min(...linaOutputBlock.nodes.map(node => node.y));
  // Output stays near originating routes. Saved nodes and annotations keep their positions.
  if (!outputAnchor) {
    while (linaOutputBlock.nodes.some(node => overlaps(node.x + outputDx, node.y + outputDy))) outputDy += LINA_NODE_HEIGHT + 100;
  }
  for (const maintained of linaOutputBlock.nodes) {
    if (nodes.some(node => node.id === maintained.id)) continue;
    let x = Math.max(20, maintained.x + outputDx);
    const y = maintained.y + outputDy;
    while (overlaps(x, y)) x += LINA_NODE_WIDTH + 80;
    nodes.push({ ...maintained, x, y });
  }

  const customEdges = document.edges.filter(edge =>
    !edge.id.startsWith('lina-input-edge-') && !edge.id.startsWith('lina-execution-edge-')
    && !edge.id.startsWith('lina-context-edge-') && !edge.id.startsWith('lina-tools-edge-') && !edge.id.startsWith('lina-model-edge-') && !edge.id.startsWith('lina-safety-edge-') && !edge.id.startsWith('lina-state-edge-') && !edge.id.startsWith('lina-memory-edge-') && !edge.id.startsWith('lina-subagents-edge-') && !edge.id.startsWith('lina-planning-edge-') && !edge.id.startsWith('lina-environment-edge-') && !edge.id.startsWith('lina-output-edge-'));
  return { ...document, nodes, edges: [...linaArchitecture.edges, ...customEdges] };
}
