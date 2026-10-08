import { environmentExecutionContracts, attachEnvironmentProducerHandoffs } from './environmentExecution';
import { planningTaskContracts, attachPlanningProducerHandoffs } from './planningTasks';
import { subagentOrchestrationContracts, attachSubagentProducerHandoffs } from './subagentOrchestration';
import { memoryKnowledgeContracts, attachMemoryProducerHandoffs } from './memoryKnowledge';
import type { LinaDocument } from '../linaModel';
import { linaArchitecture } from '../architectureDocument';
import { inputAdmissionContracts } from './inputAdmission';
import { inputFailureContracts } from './inputFailure';
import { inputExecutionContracts } from './inputExecution';
import { turnExecutionContracts } from './turnExecution';
import { contextAssemblyContracts } from './contextAssembly';
import { toolsConnectionContracts } from './toolsConnections';
import { toolsCapabilityContracts } from './toolsCapabilities';
import { toolsCallContracts } from './toolsCalls';
import { modelInterfaceContracts } from './modelInterface';
import { safetyPermissionContracts, attachSafetyProducerHandoffs } from './safetyPermissions';
import { statePersistenceContracts, attachStateProducerHandoffs } from './statePersistence';
import { object, type ContractDefinition, type ContractOutput, type Json, type Schema } from './schema';

export interface InputExample { label: string; source: string; edgeId?: string; value: Json }
export interface NodeContract extends ContractDefinition {
  version: 1;
  status: 'provisional';
  input: { schema: Schema; examples: InputExample[] };
}
export const contractDefinitions: ContractDefinition[] = [...inputAdmissionContracts, ...inputFailureContracts, ...inputExecutionContracts, ...turnExecutionContracts, ...contextAssemblyContracts, ...toolsConnectionContracts, ...toolsCapabilityContracts, ...toolsCallContracts, ...modelInterfaceContracts, ...safetyPermissionContracts, ...statePersistenceContracts, ...memoryKnowledgeContracts, ...subagentOrchestrationContracts, ...planningTaskContracts, ...environmentExecutionContracts];
attachEnvironmentProducerHandoffs(contractDefinitions);
attachPlanningProducerHandoffs(contractDefinitions);
attachMemoryProducerHandoffs(contractDefinitions);
attachSubagentProducerHandoffs(contractDefinitions);
attachSafetyProducerHandoffs(contractDefinitions);
attachStateProducerHandoffs(contractDefinitions);

/** Assemble incoming event variants from their producers. Coordinator-supplied
 * context is separate, so an edge never implies that a node returns all turn state.
 * Example inputs preserve the exact predecessor payload instead of renaming fields.
 */
export function buildNodeContracts(document: LinaDocument, definitions: ContractDefinition[]): NodeContract[] {
  return definitions.map(definition => {
    const incoming = document.edges.filter(edge => edge.target === definition.nodeId);
    const variants: Schema[] = [];
    const examples: InputExample[] = [];
    for (const edge of incoming) {
      const source = definitions.find(candidate => candidate.nodeId === edge.source);
      for (const result of source?.outputs.filter(result => result.edgeIds.includes(edge.id)) ?? []) {
        variants.push(result.schema);
        examples.push({ label: result.label, source: `${document.nodes.find(node => node.id === edge.source)?.title ?? edge.source} · ${edge.label}`, edgeId: edge.id,
          value: { event: result.example, context: definition.context.example } });
      }
    }
    for (const external of definition.external ?? []) {
      variants.push(external.value.schema);
      examples.push({ label: external.label, source: external.source, value: { event: external.value.example, context: definition.context.example } });
    }
    const firstEvent = examples[0] && (examples[0].value as Record<string, Json>).event;
    for (const snapshot of definition.contextExamples ?? []) {
      if (firstEvent !== undefined) examples.push({ label: snapshot.label, source: 'Alternative coordinator state', value: { event: firstEvent, context: snapshot.value.example } });
    }
    // Several branches may share a payload. anyOf permits those overlaps; each
    // example still names the exact connection or external source that supplies it.
    const unique = [...new Map(variants.map(schema => [JSON.stringify(schema), schema])).values()];
    const input = object({ event: { schema: { anyOf: unique }, example: null }, context: { schema: { anyOf: [definition.context.schema, ...(definition.contextExamples ?? []).map(snapshot => snapshot.value.schema)] }, example: definition.context.example } });
    return { ...definition, version: 1, status: 'provisional', input: { schema: { ...input.schema, description: 'Incoming event plus context loaded by the node owner. Provisional design contract.' }, examples } };
  });
}
export const nodeContracts = buildNodeContracts(linaArchitecture, contractDefinitions);
export const contractForNode = (id: string) => nodeContracts.find(contract => contract.nodeId === id);
export function outputsForEdge(edgeId: string): ContractOutput[] {
  return nodeContracts.flatMap(contract => contract.outputs.filter(output => output.edgeIds.includes(edgeId)));
}
/** Standalone JSON Schema document suitable for copying into a schema inspector. */
export function schemaDocument(schema: Schema) {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema };
}
