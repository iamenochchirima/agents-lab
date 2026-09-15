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
    readonly model: { readonly provider: string; readonly model: string };
  };
  readonly events: readonly RunEvent[];
  readonly executionReference: {
    readonly platform: string;
    readonly variant: string;
    readonly executionId: string;
    readonly native: Record<string, unknown>;
  } | null;
  readonly result: RunResult | null;
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

export interface PlatformRunRequest {
  readonly platform: string;
  readonly variant: string;
  readonly task: { readonly kind: "prompt"; readonly prompt: string };
  readonly model: { readonly provider: string; readonly model: string };
}

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
    response = await fetch(`${API_BASE_URL}/health`, {
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
  if (!isRecord(body) || !Array.isArray(body.platforms)) {
    throw new PlatformApiError("The server returned an invalid health response.", response.status, "INVALID_API_RESPONSE");
  }

  const platform = body.platforms.find((candidate): candidate is Record<string, unknown> => (
    isRecord(candidate) && candidate.platform === platformId && typeof candidate.variant === "string"
  ));
  const variant = typeof platform?.variant === "string" ? platform.variant : null;
  const reachable = typeof platform?.reachable === "boolean" ? platform.reachable : null;
  const message = typeof platform?.message === "string" ? platform.message : null;
  if (variant === null || reachable === null || message === null) {
    throw new PlatformApiError("This platform is not registered with the server.", response.status, "PLATFORM_NOT_REGISTERED");
  }

  return {
    platform: platformId,
    variant,
    reachable,
    message,
  };
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
