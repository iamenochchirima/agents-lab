import type { ToolDefinition, ToolExecutionResult, ToolImplementation } from "../tools/contracts.js";

/** Frozen model declarations and routing identity. No endpoints, paths or credentials. */
export interface ResolvedToolDescriptor {
  readonly definition: ToolDefinition;
  readonly source: { readonly id: string; readonly version: string; readonly digest: string };
  readonly execution: { readonly kind: "builtin"; readonly id: string } | { readonly kind: "hosted"; readonly key: string };
  /** Only known failed operations can become feedback. Unknown effects always stop. */
  readonly failurePolicy: "feedback" | "terminal";
}
export interface ToolCatalogSnapshot {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly tools: readonly ResolvedToolDescriptor[];
}
export interface HostedToolContribution {
  readonly descriptor: ResolvedToolDescriptor;
  readonly implementation: ToolImplementation;
  /** Idempotent source cleanup, shared by every contribution from that source. */
  readonly close?: () => Promise<void>;
}
export interface CapabilityHostRequest {
  readonly runId: string;
  readonly turnId: string;
  readonly catalogRevision: string;
  readonly call: { readonly toolCallId: string; readonly name: string; readonly arguments: unknown; readonly round: number };
}
export type HostedToolResult = ToolExecutionResult;
