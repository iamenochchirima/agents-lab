import type { ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { ContextConfig } from "./config.js";

export type ContextRole = "system" | "developer" | "user" | "assistant" | "tool";
export type ContextMaterialKind = "instruction" | "turn" | "memory" | "tool-result";
export type ContextTrust = "trusted" | "untrusted";

/** Context-owned neutral input shape avoids a dependency on Memory or Tool Use packages. */
export interface ContextMaterial {
  readonly sourceId: string;
  readonly kind: ContextMaterialKind;
  readonly role: ContextRole;
  readonly content: string;
  readonly sequence: number;
  readonly trust: ContextTrust;
  readonly provenance: Readonly<Record<string, string>>;
}

export interface ModelMessage {
  readonly role: ContextRole;
  readonly content: string;
  readonly sourceIds: readonly string[];
}

export interface ContextTokenBudget {
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly tokenizer: string;
}

export interface ContextAssemblyInput {
  readonly scope: RunScope;
  readonly task: string;
  readonly instructions: readonly ContextMaterial[];
  readonly turns: readonly ContextMaterial[];
  readonly memoryCandidates: readonly ContextMaterial[];
  readonly toolResults: readonly ContextMaterial[];
  readonly budget: ContextTokenBudget;
}

export interface ContextOmission {
  readonly sourceId: string;
  readonly reason: "budget" | "policy" | "invalid-source";
}

export interface ContextAssemblyResult {
  /** The exact ordered messages passed to the model interface. */
  readonly messages: readonly ModelMessage[];
  readonly includedSourceIds: readonly string[];
  readonly omissions: readonly ContextOmission[];
  readonly tokenCount: { readonly value: number | null; readonly basis: string; readonly quality: "exact" | "estimated" | "unknown" };
}

export interface ContextTokenCounter {
  count(messages: readonly ModelMessage[]): { readonly value: number | null; readonly basis: string; readonly quality: "exact" | "estimated" | "unknown" };
}

export interface ContextDependencies {
  readonly tokenCounter: ContextTokenCounter;
}

export type ContextAssemblyErrorCode = "INVALID_CONTEXT_INPUT" | "BUDGET_EXHAUSTED" | "CONTEXT_ASSEMBLY_FAILED";

export class ContextAssemblyError extends Error {
  constructor(readonly code: ContextAssemblyErrorCode, message: string) {
    super(message);
    this.name = "ContextAssemblyError";
  }
}

/** Context selects model-visible material; it does not own durable Memory records. */
export interface ContextAssembler {
  readonly identity: ModuleIdentity;
  assemble(input: ContextAssemblyInput, signal: AbortSignal): Promise<ContextAssemblyResult>;
}

export type ContextAssemblerFactory = (config: ContextConfig, dependencies: ContextDependencies) => ContextAssembler;
