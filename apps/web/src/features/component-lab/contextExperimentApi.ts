import {
  STUDIO_CONTEXT_EXPERIMENT_API_VERSION,
  isStudioContextExperimentError,
  isStudioContextExperimentRequest,
  isStudioContextExperimentResponse,
  type StudioContextExperimentError,
  type StudioContextExperimentRequest,
  type StudioContextExperimentResponse,
} from "@agent-harness-lab/studio-http-contract";

const STUDIO_API_BASE_URL = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || "http://127.0.0.1:4320").replace(/\/$/, "");

export class ContextExperimentApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ContextExperimentApiError";
  }
}

export function makeContextExperimentRequest(
  comparisonId: string,
  maxRecentMessages: number,
): StudioContextExperimentRequest {
  const request: StudioContextExperimentRequest = {
    apiVersion: STUDIO_CONTEXT_EXPERIMENT_API_VERSION,
    comparisonId,
    caseId: "old-important-fact-v1",
    maxRecentMessages,
  };
  if (!isStudioContextExperimentRequest(request)) {
    throw new ContextExperimentApiError("The Context comparison request is invalid.");
  }
  return request;
}

export async function runContextExperiment(
  request: StudioContextExperimentRequest,
  signal?: AbortSignal,
): Promise<StudioContextExperimentResponse> {
  if (!isStudioContextExperimentRequest(request)) {
    throw new ContextExperimentApiError("The Context comparison request is invalid.");
  }
  const response = await fetch(`${STUDIO_API_BASE_URL}/context-experiments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw contextErrorFrom(response, body, "Studio could not run this Context comparison.");
  if (!isStudioContextExperimentResponse(body)) {
    throw new ContextExperimentApiError("Studio API returned an invalid Context comparison response.", response.status);
  }
  return body;
}

export async function getContextExperiment(
  comparisonId: string,
  signal?: AbortSignal,
): Promise<StudioContextExperimentResponse> {
  const response = await fetch(`${STUDIO_API_BASE_URL}/context-experiments/${encodeURIComponent(comparisonId)}`, { signal });
  const body = await readJson(response);
  if (!response.ok) throw contextErrorFrom(response, body, "Studio could not load this Context comparison.");
  if (!isStudioContextExperimentResponse(body)) {
    throw new ContextExperimentApiError("Studio API returned an invalid saved Context comparison.", response.status);
  }
  return body;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function contextErrorFrom(response: Response, body: unknown, fallback: string): ContextExperimentApiError {
  if (isStudioContextExperimentError(body)) {
    const typedError: StudioContextExperimentError = body;
    return new ContextExperimentApiError(typedError.error.message, response.status, typedError.error.code);
  }
  return new ContextExperimentApiError(`${fallback} (HTTP ${response.status}).`, response.status);
}
