import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { createRunId, createSessionId, createTurnId } from "@agent-harness-lab/agent-protocol";
import { ContextAssemblyError, type ContextMaterial } from "@agent-harness-lab/module-context";
import { ControlPortError } from "@agent-harness-lab/module-control";
import { InputNormalizationError } from "@agent-harness-lab/module-input";
import type { MemorySession } from "@agent-harness-lab/module-memory";
import type { OutputActionSink } from "@agent-harness-lab/module-output-actions";
import { createReferenceAgent, CALCULATOR_SCENARIO_TASK, COMPUTER_SCENARIO_TASK, type ReferenceAgent } from "@agent-harness-lab/reference-agent-assembly";
import { TextTurnExecutionError, type PlanningRunEvidence, type TextTurnObservabilityResult } from "@agent-harness-lab/agent-kernel";
import { createRunArtifactStore } from "./run-artifacts.js";
import { DEFAULT_STUDIO_RUNS_ROOT } from "../config.js";
import {
  STUDIO_CHAT_API_VERSION,
  isStudioChatTurnRequest,
  isStudioChatScenarioTurnRequest,
  type StudioChatApiError,
  type StudioChatAssemblyResponse,
  type StudioChatClearResponse,
  type StudioChatObservabilityEvidence,
  type StudioChatPlanningEvidence,
  type StudioChatTurnRequest,
  type StudioChatTurnResponse,
  type StudioJsonValue,
} from "@agent-harness-lab/studio-http-contract";

const MAX_SESSIONS = 32;
const MAX_HISTORY_MESSAGES = 80;
const MAX_CACHED_REQUESTS = 64;
const MEMORY_OWNER_ID = "local-studio-browser";

interface ChatSession {
  readonly conversationId: string;
  readonly memory: MemorySession;
  readonly turns: ContextMaterial[];
  readonly completedRequests: Map<string, { readonly fingerprint: string; readonly response: StudioChatTurnResponse }>;
  readonly inFlightRequests: Map<string, { readonly fingerprint: string; readonly promise: Promise<StudioChatTurnResponse> }>;
  lastUsedAt: number;
  nextSequence: number;
}

class ChatSessionError extends Error {
  constructor(readonly code: "SESSION_LIMIT" | "REQUEST_ID_REUSED" | "SESSION_BUSY", message: string) {
    super(message);
    this.name = "ChatSessionError";
  }
}

/** Register the local reference-assembly endpoints. Module execution stays server-side. */
export function registerStudioChatRoutes(
  app: FastifyInstance,
  agent: ReferenceAgent = createReferenceAgent(),
  runsRoot: string = DEFAULT_STUDIO_RUNS_ROOT,
): void {
  const sessions = new Map<string, ChatSession>();

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/chat/")) reply.header("cache-control", "no-store");
  });

  app.addHook("onClose", async () => {
    await Promise.all([...sessions.values()].map((session) => session.memory.close()));
    sessions.clear();
  });

  app.get<{ Reply: StudioChatAssemblyResponse }>("/chat/assembly", async () => ({
    apiVersion: STUDIO_CHAT_API_VERSION,
    assembly: agent.assembly,
  }));

  app.post<{ Body: unknown; Reply: StudioChatTurnResponse | StudioChatApiError }>("/chat/turns", async (request, reply) => {
    if (!isStudioChatTurnRequest(request.body)) {
      return reply.code(400).send(apiError("INVALID_REQUEST", "Expected conversationId, requestId, non-empty text (up to 16,000 UTF-8 bytes), and a boolean remember flag."));
    }

    let session: ChatSession;
    try {
      session = await getOrCreateSession(request.body.conversationId, sessions, agent);
    } catch (error) {
      if (error instanceof ChatSessionError) return reply.code(error.code === "SESSION_LIMIT" ? 503 : 409).send(apiError(error.code, error.message));
      throw error;
    }

    const fingerprint = requestFingerprint(request.body);
    const completed = session.completedRequests.get(request.body.requestId);
    if (completed) {
      if (completed.fingerprint !== fingerprint) return reply.code(409).send(apiError("REQUEST_ID_REUSED", "This requestId was already used for a different message."));
      session.lastUsedAt = Date.now();
      return completed.response;
    }

    const active = session.inFlightRequests.get(request.body.requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) return reply.code(409).send(apiError("REQUEST_ID_REUSED", "This requestId is already active for a different message."));
      return active.promise;
    }
    if (session.inFlightRequests.size > 0) {
      return reply.code(409).send(apiError("SESSION_BUSY", "Only one new turn may run in a conversation at a time."));
    }

    const cancellation = new AbortController();
    const abortOnDisconnect = () => {
      if (!reply.raw.writableEnded) cancellation.abort();
    };
    request.raw.once("aborted", abortOnDisconnect);
    reply.raw.once("close", abortOnDisconnect);
    const pending = executeTurn(agent, session, request.body, cancellation.signal, runsRoot);
    session.inFlightRequests.set(request.body.requestId, { fingerprint, promise: pending });
    try {
      const response = await pending;
      rememberCompletedRequest(session, request.body.requestId, fingerprint, response);
      return response;
    } catch (error) {
      return sendTurnError(reply, error, agent, (failure) => request.log.error({ err: failure }, "Studio reference assembly failed"));
    } finally {
      request.raw.off("aborted", abortOnDisconnect);
      reply.raw.off("close", abortOnDisconnect);
      session.inFlightRequests.delete(request.body.requestId);
      session.lastUsedAt = Date.now();
    }
  });

  for (const scenario of [
    { path: "/chat/scenarios/calculator/turns", id: "calculator-scenario", task: CALCULATOR_SCENARIO_TASK, label: "calculator" },
    { path: "/chat/scenarios/computer/turns", id: "computer-scenario", task: COMPUTER_SCENARIO_TASK, label: "computer" },
  ] as const) {
    registerScenarioRoute(app, sessions, agent, runsRoot, scenario);
  }

  app.delete<{ Params: { conversationId: string }; Reply: StudioChatClearResponse | StudioChatApiError }>("/chat/sessions/:conversationId", async (request, reply) => {
    const conversationId = request.params.conversationId;
    if (!isSafeIdentifier(conversationId)) return reply.code(400).send(apiError("INVALID_SESSION_ID", "conversationId is invalid."));
    const session = sessions.get(conversationId);
    if (!session) return { apiVersion: STUDIO_CHAT_API_VERSION, conversationId, status: "not-found" };
    if (session.inFlightRequests.size > 0) return reply.code(409).send(apiError("SESSION_BUSY", "Wait for the active turn to finish before clearing this session."));
    sessions.delete(conversationId);
    await session.memory.close();
    return { apiVersion: STUDIO_CHAT_API_VERSION, conversationId, status: "cleared" };
  });
}

function registerScenarioRoute(
  app: FastifyInstance,
  sessions: Map<string, ChatSession>,
  agent: ReferenceAgent,
  runsRoot: string,
  scenario: {
    readonly path: string;
    readonly id: "calculator-scenario" | "computer-scenario";
    readonly task: string;
    readonly label: string;
  },
): void {
  app.post<{ Body: unknown; Reply: StudioChatTurnResponse | StudioChatApiError }>(scenario.path, async (request, reply) => {
    if (!isStudioChatScenarioTurnRequest(request.body)) {
      return reply.code(400).send(apiError("INVALID_REQUEST", `Expected only a valid conversationId and requestId for the named ${scenario.label} scenario.`));
    }
    const scenarioRequest: StudioChatTurnRequest = { ...request.body, text: scenario.task, remember: false };
    let session: ChatSession;
    try {
      session = await getOrCreateSession(scenarioRequest.conversationId, sessions, agent);
    } catch (error) {
      if (error instanceof ChatSessionError) return reply.code(error.code === "SESSION_LIMIT" ? 503 : 409).send(apiError(error.code, error.message));
      throw error;
    }

    const fingerprint = requestFingerprint(scenarioRequest, scenario.id);
    const completed = session.completedRequests.get(scenarioRequest.requestId);
    if (completed) {
      if (completed.fingerprint !== fingerprint) return reply.code(409).send(apiError("REQUEST_ID_REUSED", "This requestId was already used for a different message."));
      session.lastUsedAt = Date.now();
      return completed.response;
    }
    const active = session.inFlightRequests.get(scenarioRequest.requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) return reply.code(409).send(apiError("REQUEST_ID_REUSED", "This requestId is already active for a different message."));
      return active.promise;
    }
    if (session.inFlightRequests.size > 0) return reply.code(409).send(apiError("SESSION_BUSY", "Only one new turn may run in a conversation at a time."));

    const cancellation = new AbortController();
    const abortOnDisconnect = () => { if (!reply.raw.writableEnded) cancellation.abort(); };
    request.raw.once("aborted", abortOnDisconnect);
    reply.raw.once("close", abortOnDisconnect);
    const pending = executeTurn(agent, session, scenarioRequest, cancellation.signal, runsRoot);
    session.inFlightRequests.set(scenarioRequest.requestId, { fingerprint, promise: pending });
    try {
      const response = await pending;
      rememberCompletedRequest(session, scenarioRequest.requestId, fingerprint, response);
      return response;
    } catch (error) {
      return sendTurnError(reply, error, agent, (failure) => request.log.error({ err: failure }, `Studio ${scenario.label} scenario failed`));
    } finally {
      request.raw.off("aborted", abortOnDisconnect);
      reply.raw.off("close", abortOnDisconnect);
      session.inFlightRequests.delete(scenarioRequest.requestId);
      session.lastUsedAt = Date.now();
    }
  });
}

async function executeTurn(agent: ReferenceAgent, session: ChatSession, request: StudioChatTurnRequest, signal: AbortSignal, runsRoot: string): Promise<StudioChatTurnResponse> {
  const receivedAt = new Date().toISOString();
  const runId = randomUUID();
  const turnId = randomUUID();
  const sourceId = `input:${turnId}`;
  const scope = {
    runId: createRunId(runId),
    sessionId: session.memory.scope.sessionId,
    turnId: createTurnId(turnId),
  };
  const artifacts = await createRunArtifactStore(runsRoot, runId);
  await artifacts.write("config.json", {
    schemaVersion: 1,
    runId,
    turnId,
    conversationId: request.conversationId,
    requestId: request.requestId,
    receivedAt,
    assembly: agent.assembly,
    input: { text: request.text, remember: request.remember, sourceId, trust: "untrusted" },
    model: agent.assembly.components.find((item) => item.area === "model-interface"),
    executionEnvironment: agent.assembly.components.find((item) => item.area === "execution-environment"),
  });
  const observability = agent.createObservability(scope, artifacts.rootDirectory);
  let capturedResponse: string | undefined;
  const outputSink: OutputActionSink = {
    async deliver({ proposal }) {
      const payload = proposal.payload;
      if (!isJsonObject(payload) || typeof payload.text !== "string") {
        return { actionId: proposal.actionId, status: "rejected", reason: "Studio API response sink requires a text payload." };
      }
      capturedResponse = payload.text;
      return {
        actionId: proposal.actionId,
        status: "committed",
        receipt: { sink: "studio-api-response-capture", capturedUtf8Bytes: new TextEncoder().encode(capturedResponse).byteLength },
      };
    },
  };
  let result;
  try {
    result = await agent.runTurn({
    scope,
    text: request.text,
    source: { sourceId, kind: "user", trust: "untrusted", receivedAt },
    memory: session.memory,
    priorTurns: Object.freeze([...session.turns]),
    rememberUserMessage: request.remember,
    outputSink,
    observability,
    signal,
    idempotencyKey: request.requestId,
  });
  } catch (error) {
    const partial = error instanceof TextTurnExecutionError ? error.evidence : undefined;
    const persistence = error instanceof TextTurnExecutionError ? error.observability : getObservabilityResult(error);
    try {
      await artifacts.write("result.json", {
        schemaVersion: 1,
        runId,
        turnId,
        status: isAbortError(error) ? "cancelled" : "failed",
        observability: persistence,
        error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "Run failed." },
        ...(partial ? { partialEvidence: partial } : {}),
      });
    } catch (artifactError) {
      if (typeof error === "object" && error !== null) {
        try { Object.defineProperty(error, "artifactPersistenceFailure", { value: safeErrorMessage(artifactError), configurable: true }); } catch { /* preserve original failure */ }
      }
    }
    throw error;
  }
  if (capturedResponse === undefined || capturedResponse !== result.finalText) {
    throw new Error("Output Actions did not commit the final text into the Studio API response sink.");
  }
  const assistantSourceId = `assistant:${turnId}`;
  const modelResponse = result.modelResponses.at(-1);
  if (!modelResponse) throw new Error("Control completed without a Model Interface response.");
  const modelCalls = result.modelRequests.map((modelRequest, index) => {
    const context = result.contextRequests[index];
    const response = result.modelResponses[index];
    if (!context || !response) throw new Error(`Model call ${index + 1} is missing its paired Context result or response.`);
    return Object.freeze({ context, request: modelRequest, response });
  });
  if (modelCalls.length !== result.modelResponses.length || modelCalls.length !== result.contextRequests.length) {
    throw new Error("The kernel returned unpaired Context, Model request, and response evidence.");
  }

  session.turns.push({
    sourceId,
    kind: "turn",
    role: "user",
    content: result.normalizedInput.task,
    sequence: session.nextSequence++,
    trust: "untrusted",
    provenance: { sourceKind: "user", receivedAt },
  }, {
    sourceId: assistantSourceId,
    kind: "turn",
    role: "assistant",
    content: result.finalText,
    sequence: session.nextSequence++,
    trust: "untrusted",
    provenance: { sourceKind: modelResponse.provider.adapter.id, receivedAt },
  });
  if (session.turns.length > MAX_HISTORY_MESSAGES) session.turns.splice(0, session.turns.length - MAX_HISTORY_MESSAGES);

  const response: StudioChatTurnResponse = Object.freeze({
    apiVersion: STUDIO_CHAT_API_VERSION,
    conversationId: request.conversationId,
    requestId: request.requestId,
    runId,
    turnId,
    receivedAt,
    assembly: agent.assembly,
    input: {
      task: result.normalizedInput.task,
      source: {
        sourceId: result.normalizedInput.source.sourceId,
        kind: "user" as const,
        trust: "untrusted" as const,
        receivedAt: result.normalizedInput.source.receivedAt,
      },
      parts: result.normalizedInput.parts.filter((part) => part.kind === "text"),
    },
    memory: {
      stateRevision: result.memoryRecall.stateRevision,
      candidates: result.memoryRecall.candidates,
      writeReceipt: result.memoryWrite,
    },
    context: result.context,
    planning: projectPlanningEvidence(result.planning),
    modelCalls,
    runEvidence: result.runEvidence.map(toJson),
    observability: projectObservability(result.observability),
    control: {
      termination: result.control.termination,
      modelCalls: result.control.modelCalls,
      toolCalls: result.control.toolCalls,
      observations: result.observations.map(toJson),
    },
    model: {
      provider: modelResponse.provider.provider,
      name: modelResponse.provider.model,
      adapter: modelResponse.provider.adapter,
      ...(modelResponse.provider.requestId ? { requestId: modelResponse.provider.requestId } : {}),
      finishReason: modelResponse.finishReason,
      usage: modelResponse.usage,
      ...(modelResponse.providerDetail === undefined ? {} : { detail: modelResponse.providerDetail as StudioJsonValue }),
    },
    assistantMessage: { sourceId: assistantSourceId, content: capturedResponse },
  });
  await artifacts.write("result.json", {
    schemaVersion: 1,
    runId,
    turnId,
    status: "completed",
    observability: response.observability,
    response,
  });
  return response;
}

async function getOrCreateSession(conversationId: string, sessions: Map<string, ChatSession>, agent: ReferenceAgent): Promise<ChatSession> {
  const existing = sessions.get(conversationId);
  if (existing) return existing;
  if (sessions.size >= MAX_SESSIONS) {
    const evictable = [...sessions.values()].filter((session) => session.inFlightRequests.size === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!evictable) throw new ChatSessionError("SESSION_LIMIT", "Studio has reached its local chat session limit; wait for an active turn or clear a chat.");
    sessions.delete(evictable.conversationId);
    void evictable.memory.close();
  }
  const sessionId = createSessionId(randomUUID());
  const session: ChatSession = {
    conversationId,
    memory: agent.createMemorySession({ ownerId: MEMORY_OWNER_ID, sessionId }),
    turns: [],
    completedRequests: new Map(),
    inFlightRequests: new Map(),
    lastUsedAt: Date.now(),
    nextSequence: 0,
  };
  sessions.set(conversationId, session);
  return session;
}

function rememberCompletedRequest(session: ChatSession, requestId: string, fingerprint: string, response: StudioChatTurnResponse): void {
  session.completedRequests.set(requestId, { fingerprint, response });
  while (session.completedRequests.size > MAX_CACHED_REQUESTS) {
    const oldest = session.completedRequests.keys().next().value;
    if (oldest === undefined) break;
    session.completedRequests.delete(oldest);
  }
}

function requestFingerprint(request: StudioChatTurnRequest, kind: "text" | "calculator-scenario" | "computer-scenario" = "text"): string {
  return JSON.stringify({ kind, text: request.text, remember: request.remember });
}

function sendTurnError(
  reply: FastifyReply,
  error: unknown,
  agent: ReferenceAgent,
  logError?: (failure: unknown) => void,
) {
  const failure = error instanceof TextTurnExecutionError ? error.failure : error;
  const partial = error instanceof TextTurnExecutionError ? error.evidence : undefined;
  const observability = error instanceof TextTurnExecutionError ? error.observability : getObservabilityResult(error);
  const evidence = partial || observability ? {
    assembly: agent.assembly,
    contextRequests: partial?.contextRequests ?? [],
    ...(partial?.planning === undefined ? {} : { planning: projectPlanningEvidence(partial.planning) }),
    modelRequests: partial?.modelRequests ?? [],
    modelResponses: partial?.modelResponses ?? [],
    observations: partial?.observations.map(toJson) ?? [],
    runEvidence: partial?.runEvidence.map(toJson) ?? [],
    ...(observability ? { observability: projectObservability(observability) } : {}),
  } : undefined;

  if (failure instanceof ChatSessionError) return reply.code(failure.code === "SESSION_LIMIT" ? 503 : 409).send(apiError(failure.code, failure.message, evidence));
  if (failure instanceof InputNormalizationError) return reply.code(422).send(apiError(failure.code, failure.message, evidence));
  if (failure instanceof ContextAssemblyError) return reply.code(422).send(apiError(failure.code, failure.message, evidence));
  if (failure instanceof ControlPortError) return reply.code(422).send(apiError(failure.kind, failure.message, evidence));
  if (isAbortError(failure)) return reply.code(503).send(apiError("TURN_CANCELLED", "The Studio turn was cancelled before it completed.", evidence));
  if (failure instanceof Error && "code" in failure && typeof (failure as Error & { readonly code?: unknown }).code === "string") {
    const code = (failure as Error & { readonly code: string }).code;
    const status = code === "TOOL_OUTCOME_UNKNOWN" || code === "TOOL_TIMEOUT" ? 503 : 422;
    return reply.code(status).send(apiError(code, failure.message, evidence));
  }
  logError?.(failure);
  return reply.code(500).send(apiError("ASSEMBLY_FAILED", "The Studio reference assembly could not complete this turn.", evidence));
}

function apiError(code: string, message: string, evidence?: StudioChatApiError["evidence"]): StudioChatApiError {
  return { apiVersion: STUDIO_CHAT_API_VERSION, error: { code, message }, ...(evidence ? { evidence } : {}) };
}

function toJson(value: unknown): StudioJsonValue {
  return JSON.parse(JSON.stringify(value)) as StudioJsonValue;
}

function isJsonObject(value: StudioJsonValue): value is { readonly [key: string]: StudioJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectPlanningEvidence(evidence: PlanningRunEvidence): StudioChatPlanningEvidence {
  return {
    module: evidence.module,
    input: {
      task: evidence.input.task,
      context: evidence.input.context,
      observations: evidence.input.observations,
    },
    proposal: evidence.proposal,
  };
}

function projectObservability(value: TextTurnObservabilityResult | null): StudioChatObservabilityEvidence {
  return {
    status: value?.status ?? "not-configured",
    recorder: value?.recorder ?? null,
    eventsAttempted: value?.eventsAttempted ?? 0,
    appendReceipts: value?.appendReceipts.map(toJson) ?? [],
    flushReceipt: value?.flushReceipt ? toJson(value.flushReceipt) : null,
    ...(value?.failure ? { failure: value.failure } : {}),
  };
}

function getObservabilityResult(value: unknown): TextTurnObservabilityResult | null {
  if (!isJsonObjectLike(value) || !isJsonObjectLike(value.observability)) return null;
  return value.observability as unknown as TextTurnObservabilityResult;
}

function isJsonObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeErrorMessage(value: unknown): string {
  return value instanceof Error && value.message ? value.message : "The run artifact could not be persisted.";
}

function isAbortError(value: unknown): boolean {
  if (value instanceof Error && value.name === "AbortError") return true;
  if (typeof value !== "object" || value === null || !("failure" in value)) return false;
  return isAbortError((value as { readonly failure?: unknown }).failure);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 128
    && value.trim() === value && /^[A-Za-z0-9._:-]+$/.test(value);
}
