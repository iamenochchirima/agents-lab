import {
  isStudioApiHealth,
  isStudioChatApiError,
  isStudioChatAssemblyResponse,
  isStudioChatClearResponse,
  isStudioChatScenarioTurnRequest,
  isStudioChatTurnRequest,
  isStudioChatTurnResponse,
  type StudioApiHealth,
  type StudioChatApiError,
  type StudioChatAssemblyResponse,
  type StudioChatClearResponse,
  type StudioChatScenarioTurnRequest,
  type StudioChatTurnRequest,
  type StudioChatTurnResponse,
} from "@agent-harness-lab/studio-http-contract";

const STUDIO_API_BASE_URL = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || "http://127.0.0.1:4320").replace(/\/$/, "");

export async function getStudioApiHealth(signal?: AbortSignal): Promise<StudioApiHealth> {
  const response = await fetch(`${STUDIO_API_BASE_URL}/health`, { signal });
  if (!response.ok) {
    throw new Error(`Studio API health request failed with HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (!isStudioApiHealth(body)) {
    throw new Error("Studio API returned an invalid health response.");
  }
  return body;
}

export class StudioApiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly evidence?: StudioChatApiError["evidence"],
  ) {
    super(message);
    this.name = "StudioApiRequestError";
  }
}

export async function runStudioCalculatorScenario(
  request: StudioChatScenarioTurnRequest,
  signal?: AbortSignal,
): Promise<StudioChatTurnResponse> {
  if (!isStudioChatScenarioTurnRequest(request)) {
    throw new StudioApiRequestError("The calculator scenario request is invalid.");
  }
  const response = await fetch(`${STUDIO_API_BASE_URL}/chat/scenarios/calculator/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const body: unknown = await readJson(response);
  if (!response.ok) throw apiErrorFrom(response, body, "Studio could not run the calculator scenario.");
  if (!isStudioChatTurnResponse(body)) {
    throw new StudioApiRequestError("Studio API returned an invalid calculator scenario response.", response.status);
  }
  return body;
}

export async function runStudioComputerScenario(
  request: StudioChatScenarioTurnRequest,
  signal?: AbortSignal,
): Promise<StudioChatTurnResponse> {
  if (!isStudioChatScenarioTurnRequest(request)) {
    throw new StudioApiRequestError("The computer scenario request is invalid.");
  }
  const response = await fetch(`${STUDIO_API_BASE_URL}/chat/scenarios/computer/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const body: unknown = await readJson(response);
  if (!response.ok) throw apiErrorFrom(response, body, "Studio could not run the computer scenario.");
  if (!isStudioChatTurnResponse(body)) {
    throw new StudioApiRequestError("Studio API returned an invalid computer scenario response.", response.status);
  }
  return body;
}

export async function getStudioChatAssembly(signal?: AbortSignal): Promise<StudioChatAssemblyResponse> {
  const response = await fetch(`${STUDIO_API_BASE_URL}/chat/assembly`, { signal });
  const body: unknown = await readJson(response);
  if (!response.ok) throw apiErrorFrom(response, body, "Studio assembly request failed.");
  if (!isStudioChatAssemblyResponse(body)) {
    throw new StudioApiRequestError("Studio API returned an invalid assembly response.", response.status);
  }
  return body;
}

export async function submitStudioChatTurn(
  request: StudioChatTurnRequest,
  signal?: AbortSignal,
): Promise<StudioChatTurnResponse> {
  if (!isStudioChatTurnRequest(request)) {
    throw new StudioApiRequestError("The chat message is invalid or too large.");
  }
  const response = await fetch(`${STUDIO_API_BASE_URL}/chat/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const body: unknown = await readJson(response);
  if (!response.ok) throw apiErrorFrom(response, body, "Studio could not prepare this turn.");
  if (!isStudioChatTurnResponse(body)) {
    throw new StudioApiRequestError("Studio API returned an invalid turn response.", response.status);
  }
  return body;
}

export async function clearStudioChatSession(
  conversationId: string,
  signal?: AbortSignal,
): Promise<StudioChatClearResponse> {
  const response = await fetch(`${STUDIO_API_BASE_URL}/chat/sessions/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    signal,
  });
  const body: unknown = await readJson(response);
  if (!response.ok) throw apiErrorFrom(response, body, "Studio could not clear this session.");
  if (!isStudioChatClearResponse(body)) {
    throw new StudioApiRequestError("Studio API returned an invalid session response.", response.status);
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

function apiErrorFrom(response: Response, body: unknown, fallback: string): StudioApiRequestError {
  if (isStudioChatApiError(body)) {
    return new StudioApiRequestError(body.error.message, response.status, body.error.code, body.evidence);
  }
  return new StudioApiRequestError(`${fallback} (HTTP ${response.status}).`, response.status);
}
