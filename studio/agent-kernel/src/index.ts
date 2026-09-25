import type { JsonValue, ModuleIdentity } from "@agent-harness-lab/agent-protocol";

export const MODULE_AREAS = [
  "input",
  "context",
  "planning",
  "memory",
  "tool-use",
  "computer-use",
  "control",
  "execution-environment",
  "output-actions",
  "safety",
  "model-interface",
  "observability",
] as const;

export type ModuleArea = (typeof MODULE_AREAS)[number];

export interface ModuleSelection {
  readonly package: { readonly name: string; readonly version: string };
  readonly implementation: ModuleIdentity;
  readonly configuration: JsonValue;
}

/** Declarative only in this stage; the kernel does not yet load or execute it. */
export interface AgentAssemblyDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly modules: Readonly<Record<ModuleArea, ModuleSelection>>;
}
