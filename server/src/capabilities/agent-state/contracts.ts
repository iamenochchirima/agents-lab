/** Shared backend agent state. Identity is operator instruction; memory is untrusted data. */
export const DEFAULT_AGENT_NAMESPACE = "workspace-local";
export interface AgentIdentityContent {
  readonly name: string;
  readonly purpose: string;
  readonly style: string;
  readonly initiative: string;
  readonly behavior: string;
}
export interface AgentIdentity extends AgentIdentityContent {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly updatedAt: string;
}
export interface MemoryProvenance {
  readonly source: "user" | "agent" | "import" | "fixture";
  readonly runId?: string;
  readonly turnId?: string;
  readonly sourceId?: string;
}
export interface AgentMemory {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly id: string;
  readonly kind: "preference" | "fact";
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly provenance: MemoryProvenance;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface MemoryMutation {
  readonly operationId: string;
  readonly expectedRevision?: number;
}
export interface SaveMemoryInput extends MemoryMutation {
  readonly id?: string;
  readonly kind: AgentMemory["kind"];
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly provenance: MemoryProvenance;
}
export interface MemoryProjection {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly enabled: boolean;
  readonly records: readonly AgentMemory[];
  readonly omitted: number;
  readonly bytes: number;
  readonly text: string;
  readonly digest: string;
}
export const DEFAULT_IDENTITY_CONTENT: AgentIdentityContent = {
  name: "Agent Harness Lab assistant",
  purpose: "Help the user complete tasks using the capabilities available in this conversation.",
  style: "Be clear, direct and helpful. Explain uncertainty and meaningful limitations.",
  initiative: "Work through authorized tasks. Ask for missing information when it affects the result.",
  behavior: "Use connected tools and relevant skills, verify results, and retain the user's stated constraints. Do not invent access, outcomes or personal history.",
};
