import { getPlatformApiBaseUrl } from "./platformApi";

export interface AgentIdentity {
  schemaVersion: 1; revision: number; updatedAt: string;
  name: string; purpose: string; style: string; initiative: string; behavior: string;
}
export interface AgentMemoryRecord {
  schemaVersion: 1; namespace: string; id: string; kind: "preference" | "fact";
  title: string; content: string; tags: readonly string[]; revision: number;
  createdAt: string; updatedAt: string;
  provenance: { source: string; runId?: string; turnId?: string; sourceId?: string };
}
export interface AgentStateView { identity: AgentIdentity; memory: readonly AgentMemoryRecord[] }
export class AgentStateApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "AgentStateApiError"; }
}
export async function agentStateRequest<T>(path = "", body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getPlatformApiBaseUrl()}/api/agent-state${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AgentStateApiError("The server could not be reached. Your changes remain in this form.", 0);
  }
  const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new AgentStateApiError(result?.error?.message ?? "This change could not be saved.", response.status);
  if (result === null) throw new AgentStateApiError("The server returned an unreadable response. Retry the same change.", response.status);
  return result as T;
}
