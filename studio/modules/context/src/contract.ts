import type { AgentMessage, AgentToolCall, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { ContextConfig } from "./config.js";

export type ContextRole = "system" | "developer" | "user" | "assistant" | "tool";
export type ContextMaterialKind = "instruction" | "task" | "turn" | "memory" | "planning" | "tool-result";
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

/** One prior assistant request that asked the environment to run one or more tools. */
export type ContextToolCallMessage = Omit<ContextMaterial, "kind" | "role"> & {
  readonly kind: "turn";
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls: readonly AgentToolCall[];
};

/** One result returned by Tool Use and its scoped execution environment. */
export type ContextToolResultMessage = Omit<ContextMaterial, "kind" | "role"> & {
  readonly kind: "tool-result";
  readonly role: "tool";
  readonly name: string;
  readonly toolCallId: string;
};

/** An assistant call and every corresponding result must travel together into Context. */
export interface ContextToolExchange {
  readonly assistant: ContextToolCallMessage;
  readonly results: readonly ContextToolResultMessage[];
}

/** Current request material carries the normalized input's source and trust. */
export type ContextTaskMaterial = Omit<ContextMaterial, "kind" | "role"> & {
  readonly kind: "task";
  readonly role: "user";
};

/** An advisory Planner proposal remains untrusted, user-level data in the model request. */
export type ContextPlanningMaterial = Omit<ContextMaterial, "kind" | "role" | "trust"> & {
  readonly kind: "planning";
  readonly role: "user";
  readonly trust: "untrusted";
};

export interface ModelMessage extends AgentMessage {
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
  readonly task: ContextTaskMaterial;
  /** When supplied, this required material appears after the task and before tool exchanges. */
  readonly planningProposal?: ContextPlanningMaterial;
  readonly instructions: readonly ContextMaterial[];
  readonly turns: readonly ContextMaterial[];
  readonly memoryCandidates: readonly ContextMaterial[];
  readonly toolExchanges: readonly ContextToolExchange[];
  readonly budget: ContextTokenBudget;
}

export interface ContextOmission {
  readonly sourceId: string;
  readonly reason: "budget" | "invalid-source" | "window";
}

export interface ContextSourceEvidence {
  readonly sourceId: string;
  readonly kind: ContextMaterialKind;
  readonly role: ContextRole;
  readonly trust: ContextTrust;
  readonly provenance: Readonly<Record<string, string>>;
  readonly disposition: { readonly status: "included" } | { readonly status: "omitted"; readonly reason: ContextOmission["reason"] };
}

export interface ContextTokenCount {
  readonly value: number;
  readonly basis: string;
  readonly quality: "exact" | "estimated";
}

export interface ContextAssemblyResult {
  /** The exact ordered messages passed to the model interface. */
  readonly messages: readonly ModelMessage[];
  readonly includedSourceIds: readonly string[];
  readonly omissions: readonly ContextOmission[];
  /** Records source metadata, trust, and whether each supplied item reached the model. */
  readonly sourceLedger: readonly ContextSourceEvidence[];
  readonly tokenCount: ContextTokenCount;
}

export interface ContextTokenCounter {
  /** Count the complete ordered message list; unavailable or unknown counts are errors. */
  count(messages: readonly ModelMessage[]): ContextTokenCount;
}

export interface ContextDependencies {
  readonly tokenCounter: ContextTokenCounter;
}

export type ContextAssemblyErrorCode = "INVALID_CONTEXT_INPUT" | "UNSUPPORTED_CONTEXT_MATERIAL" | "BUDGET_EXHAUSTED" | "TOKEN_COUNT_UNAVAILABLE";

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
