import type { ToolCatalogSnapshot, ResolvedToolDescriptor } from './contracts.js';
import type { ToolImplementation } from '../tools/contracts.js';
import { ToolRegistry } from '../tools/registry.js';
import { calculatorTool } from '../tools/calculator.js';
import { fixtureLookupTool, fixtureWriteTool } from '../tools/fixtures.js';
import { mcpFixtureLookupTool } from '../tools/mcp-fixture.js';
import { validateToolArguments } from './schema.js';

export type ToolConfiguration = { readonly enabledNames: readonly string[]; readonly approvedNames?: readonly string[] };
/** Pure projection for durable workflow code: declarations and validation only.
 * Actual execution belongs in Activities, durable actions, or the SDK tool callback.
 */
export function createProjectedToolRegistry(configuration: ToolConfiguration, snapshot?: ToolCatalogSnapshot): ToolRegistry {
  const registry = new ToolRegistry(configuration);
  if (!snapshot) { for (const implementation of legacyToolImplementations()) registry.register(implementation); return registry; }
  assertToolCatalogSnapshot(snapshot);
  for (const descriptor of snapshot.tools) registry.register({ definition: { ...descriptor.definition, failurePolicy: descriptor.failurePolicy },
    validateArguments: value => validateToolArguments(descriptor.definition.inputSchema, value),
    execute: async () => { throw new Error('Projected tools must execute through their native I/O adapter.'); },
  });
  for (const name of configuration.enabledNames) if (!registry.resolve(name)) throw new Error(`Selected tool has no catalog descriptor: ${name}`);
  return registry;
}
export function legacyToolImplementations(): readonly ToolImplementation[] { return [calculatorTool, fixtureLookupTool, fixtureWriteTool, mcpFixtureLookupTool]; }
export function assertToolCatalogSnapshot(snapshot: ToolCatalogSnapshot): void {
  if (snapshot.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(snapshot.revision) || !Array.isArray(snapshot.tools) || snapshot.tools.length > 128) throw new Error('Invalid tool catalog snapshot.');
  const names = new Set<string>();
  for (const tool of snapshot.tools) {
    if (!tool.definition || names.has(tool.definition.name) || !tool.source || !/^[a-f0-9]{64}$/.test(tool.source.digest) || !['builtin', 'hosted'].includes(tool.execution?.kind) || !['feedback', 'terminal'].includes(tool.failurePolicy)) throw new Error('Invalid or duplicate tool descriptor.');
    names.add(tool.definition.name);
    if (tool.execution.kind === 'builtin' && !legacyToolImplementations().some(value => value.definition.name === tool.execution.id)) throw new Error('Unregistered built-in implementation.');
  }
}
export function toolFailurePolicy(descriptor: ResolvedToolDescriptor): 'feedback' | 'terminal' { return descriptor.failurePolicy; }
