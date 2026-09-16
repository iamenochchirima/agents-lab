export const RUN_STATUSES = [
  "created",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "reconciliation_required",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunEvent {
  readonly eventId: string;
  readonly recordedSequence: number;
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

export interface RunError {
  readonly code: string;
  readonly message: string;
  readonly failureKind: string;
  readonly retryable: boolean;
}

export interface RunResult {
  readonly runId: string;
  readonly status: Exclude<RunStatus, "created" | "queued" | "running">;
  readonly finishedAt: string;
  readonly output: string | null;
  readonly error: RunError | null;
  readonly attemptCount: number;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
  };
}

export interface RunView {
  readonly runId: string;
  readonly status: RunStatus;
  readonly manifest: {
    readonly platform: string;
    readonly variant: string;
    readonly task: { readonly prompt: string };
    readonly context?: { readonly sessionId?: string; readonly turnId?: string; readonly snapshotId?: string };
    readonly model: { readonly provider: string; readonly model: string; readonly contextWindowTokens?: number };
    readonly selection?: RunSelection;
  };
  readonly events: readonly RunEvent[];
  readonly executionReference: {
    readonly platform: string;
    readonly variant: string;
    readonly executionId: string;
    readonly native: Record<string, unknown>;
  } | null;
  readonly trajectory?: Record<string, unknown> | null;
  readonly metrics?: Record<string, unknown> | null;
  readonly result: RunResult | null;
  readonly context: ContextProjection | null;
  readonly projection: {
    readonly state: "current" | "stale";
    readonly observedAt: string;
    readonly reason: string | null;
  };
}

export interface RunSelection {
  readonly scenarioId?: string;
  readonly environmentId?: string;
  readonly backendProfileId?: string;
  readonly infrastructureId?: string;
  readonly experimentId?: string;
}

export interface RunEventsPage {
  readonly runId: string;
  readonly events: readonly RunEvent[];
  readonly nextSequence: number;
  readonly hasMore: boolean;
  readonly done: boolean;
}

export interface PlatformConnectivity {
  readonly platform: string;
  readonly variant: string;
  readonly reachable: boolean;
  readonly message: string;
}

export interface ModelSelection {
  readonly provider: "openrouter";
  readonly model: string;
  readonly contextWindowTokens?: number;
}

export interface ContextProjection {
  readonly scope?: "session" | "run";
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly compactionRevision: number;
  readonly budget: {
    readonly contextWindowTokens: number | null;
    readonly inputTokens: number | null;
    readonly reservedOutputTokens: number;
    readonly safetyMarginTokens: number;
    readonly remainingTokens: number | null;
    readonly remainingPercent: number | null;
    readonly quality: "exact" | "estimated" | "unknown";
    readonly tokenizerBasis: string;
    readonly pressure: "normal" | "compaction_due" | "compacting" | "exhausted" | "unknown";
  };
  readonly updatedAt: string;
}

export interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly contextLength: number | null;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly promptPriceUsdPerMillion: number | null;
  readonly completionPriceUsdPerMillion: number | null;
  readonly isFree: boolean;
  readonly supportsTools: boolean;
}

export interface ModelCatalog {
  readonly provider: "openrouter";
  readonly defaultModel: string | null;
  readonly models: readonly ModelOption[];
}

export interface PlatformRunRequest {
  readonly platform: string;
  readonly variant: string;
  readonly task: { readonly kind: "prompt"; readonly prompt: string };
  readonly model: { readonly provider: string; readonly model: string; readonly contextWindowTokens?: number };
  readonly sessionId?: string;
  /** Stable browser-generated identity for one submitted turn and its retries. */
  readonly clientTurnId?: string;
  readonly selection?: RunSelection;
}

export const RUN_EVIDENCE_FILES = [
  "config.json",
  "events.jsonl",
  "trajectory.json",
  "metrics.json",
  "context.json",
  "result.json",
] as const;

export type RunEvidenceFile = (typeof RUN_EVIDENCE_FILES)[number];

export class PlatformApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

const API_BASE_URL = (import.meta.env.VITE_AGENTLAB_API_URL || "http://127.0.0.1:4318").replace(/\/$/, "");

export function getPlatformApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function getPlatformConnectivity(platformId: string, signal?: AbortSignal): Promise<PlatformConnectivity> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/api/platforms/${encodeURIComponent(platformId)}/health`, {
      headers: { "content-type": "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new PlatformApiError("The server could not be reached.", 0, "CONTROL_PLANE_UNREACHABLE");
  }

  const body = await readJson(response);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new PlatformApiError(
      typeof error.message === "string" ? error.message : "The server could not check this platform.",
      response.status,
      typeof error.code === "string" ? error.code : "PLATFORM_HEALTH_ERROR",
    );
  }
  if (!isRecord(body) || typeof body.platform !== "string" || typeof body.variant !== "string" || typeof body.reachable !== "boolean" || typeof body.message !== "string") {
    throw new PlatformApiError("The server returned an invalid health response.", response.status, "INVALID_API_RESPONSE");
  }

  return {
    platform: body.platform,
    variant: body.variant,
    reachable: body.reachable,
    message: body.message,
  };
}

export async function getModels(query = "", signal?: AbortSignal): Promise<ModelCatalog> {
  const params = new URLSearchParams({ provider: "openrouter", limit: "40" });
  if (query.trim()) params.set("q", query.trim());
  return requestJson<ModelCatalog>(`/api/models?${params.toString()}`, { signal });
}

export async function createRun(request: PlatformRunRequest, signal?: AbortSignal): Promise<RunView> {
  return requestJson<RunView>("/api/runs", {
    body: JSON.stringify(request),
    method: "POST",
    signal,
  });
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<RunView> {
  return requestJson<RunView>(`/api/runs/${encodeURIComponent(runId)}`, { signal });
}

export async function getRunEvents(runId: string, after: number, signal?: AbortSignal): Promise<RunEventsPage> {
  return requestJson<RunEventsPage>(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}&limit=100`, { signal });
}

export function getRunEvidenceUrl(runId: string, fileName: RunEvidenceFile): string {
  return `${API_BASE_URL}/api/runs/${encodeURIComponent(runId)}/evidence/${fileName}`;
}

export async function cancelRun(runId: string, reason: string, signal?: AbortSignal): Promise<RunView> {
  return requestJson<RunView>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    body: JSON.stringify({ reason }),
    method: "POST",
    signal,
  });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new PlatformApiError("The server could not be reached.", 0, "CONTROL_PLANE_UNREACHABLE");
  }

  const body = await readJson(response);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new PlatformApiError(
      typeof error.message === "string" ? error.message : "The server rejected the request.",
      response.status,
      typeof error.code === "string" ? error.code : "API_ERROR",
    );
  }

  return body as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PlatformApiError("The server returned an invalid response.", response.status, "INVALID_API_RESPONSE");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
