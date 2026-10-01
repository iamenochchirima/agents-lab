import type { JsonValue, ModuleIdentity } from "@agent-harness-lab/agent-protocol";
export * from "./text-turn.js";
export * from "./run-observability.js";

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

/** Full-area assembly metadata; defining it does not instantiate or execute packages. */
export interface AgentAssemblyDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly modules: Readonly<Record<ModuleArea, ModuleSelection>>;
}
