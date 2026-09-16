import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { ServerConfig } from "../bootstrap/config.js";
import { EvidenceNotFoundError, isAllowlistedEvidenceFile, type EvidenceFileName, RunEvidenceStore } from "../application/evidence-store.js";
import { RunNotFoundError, RunService, RunnerUnavailableError } from "../application/run-service.js";
import { InvalidRunRequestError } from "../domain/manifest.js";
import { ContextSessionBusyError, ContextSessionConflictError, ContextSessionLimitError } from "../../capabilities/context/session-store.js";
import type { PlatformRegistry } from "../application/platform-registry.js";
import type { RunRequest, RunSelection } from "../domain/types.js";
import { OpenRouterCatalogError, OpenRouterModelCatalog, type OpenRouterCatalogClient } from "../../models/openrouter/catalog.js";

export interface ControlPlaneServerDependencies {
  readonly config: ServerConfig;
  readonly service: RunService;
  readonly evidence: RunEvidenceStore;
  readonly registry: PlatformRegistry;
  readonly modelCatalog?: OpenRouterCatalogClient;
}

export class InvalidApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiRequestError";
  }
}

export function buildControlPlaneServer(dependencies: ControlPlaneServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: (request) => request.headers["x-request-id"]?.toString() || cryptoRandomRequestId(),
  });

  app.register(cors, {
    origin: dependencies.config.api.origin,
    methods: ["GET", "POST", "OPTIONS"],
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health", async (_request, reply) => {
    const platforms = await dependencies.registry.checkConnections();
    const healthy = platforms.every((platform) => platform.connectivity.reachable);
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      controlPlane: { ready: true },
      platforms: platforms.map((platform) => ({
        platform: platform.platform,
        variant: platform.variant,
        reachable: platform.connectivity.reachable,
        message: platform.connectivity.message,
      })),
    });
  });

  app.get("/ready", async (_request, reply) => {
    return reply.send({ status: "ready", controlPlane: { ready: true } });
  });

  app.get<{ Params: { platformId: string }; Querystring: { variant?: string } }>("/api/platforms/:platformId/health", async (request, reply) => {
    const variant = request.query.variant?.trim() || "baseline";
    const platform = await dependencies.registry.checkConnection(request.params.platformId, variant);
    if (!platform) {
      return reply.code(404).send({ error: { code: "PLATFORM_NOT_FOUND", message: "Platform or variant is not registered." } });
    }
    return reply.send({
      platform: platform.platform,
      variant: platform.variant,
      reachable: platform.connectivity.reachable,
      message: platform.connectivity.message,
    });
  });

  const modelCatalog = dependencies.modelCatalog ?? new OpenRouterModelCatalog({
    apiKey: dependencies.config.openRouter.apiKey,
    baseUrl: dependencies.config.openRouter.baseUrl,
    timeoutMs: dependencies.config.openRouter.catalogTimeoutMs,
    cacheTtlMs: dependencies.config.openRouter.catalogCacheTtlMs,
    resultLimit: dependencies.config.openRouter.catalogLimit,
    defaultModel: dependencies.config.openRouter.defaultModel,
  });

  app.get<{ Querystring: { provider?: string; q?: string; limit?: string } }>("/api/models", async (request, reply) => {
    try {
      const query = parseModelCatalogQuery(request.query);
      if (query.provider !== "openrouter") {
        throw new InvalidApiRequestError("Only the openrouter model provider is available.");
      }
      const catalog = await modelCatalog.list(query.q);
      return reply.send({ ...catalog, models: catalog.models.slice(0, query.limit) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/runs", async (request, reply) => {
    try {
      const run = await dependencies.service.createRun(parseRunRequest(request.body));
      return reply.code(202).send(run);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request, reply) => {
    try {
      return reply.send(await dependencies.service.getRun(request.params.runId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { runId: string }; Querystring: { after?: string; limit?: string } }>("/api/runs/:runId/events", async (request, reply) => {
    try {
      const after = parseAfter(request.query.after);
      const limit = parseLimit(request.query.limit);
      const run = await dependencies.service.getRun(request.params.runId);
      const pending = run.events.filter((event) => event.recordedSequence > after);
      return reply.send({
        runId: run.runId,
        events: pending.slice(0, limit),
        nextSequence: pending.slice(0, limit).at(-1)?.recordedSequence ?? after,
        hasMore: pending.length > limit,
        done: run.result !== null,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { runId: string }; Body: unknown }>("/api/runs/:runId/cancel", async (request, reply) => {
    try {
      const body = request.body;
      const reason = body === undefined || body === null ? undefined : parseCancelBody(body);
      return reply.send(await dependencies.service.cancelRun(request.params.runId, reason));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { runId: string; "*": string } }>("/api/runs/:runId/evidence/*", async (request, reply) => {
    try {
      const fileName = request.params["*"];
      const manifest = await dependencies.evidence.readManifest(request.params.runId);
      if (!isAllowlistedEvidenceFile(fileName, manifest.platform)) {
        throw new InvalidApiRequestError("Evidence file is not allowlisted.");
      }
      const contents = await dependencies.evidence.readAllowlistedFile(request.params.runId, fileName as EvidenceFileName);
      return reply.type(fileName.endsWith(".jsonl") ? "application/x-ndjson" : "application/json").send(contents);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled server error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The server encountered an unexpected error.", requestId: request.id } });
  });

  return app;
}

function parseRunRequest(body: unknown): RunRequest {
  if (!isRecord(body)) {
    throw new InvalidApiRequestError("Request body must be an object.");
  }
  if (typeof body.platform !== "string" || typeof body.variant !== "string") {
    throw new InvalidApiRequestError("platform and variant are required strings.");
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
    throw new InvalidApiRequestError("sessionId must be a string when provided.");
  }
  if (body.clientTurnId !== undefined && typeof body.clientTurnId !== "string") {
    throw new InvalidApiRequestError("clientTurnId must be a string when provided.");
  }
  if (!isRecord(body.task) || body.task.kind !== "prompt" || typeof body.task.prompt !== "string") {
    throw new InvalidApiRequestError("task must contain kind=prompt and a string prompt.");
  }
  if (!isRecord(body.model) || typeof body.model.provider !== "string" || typeof body.model.model !== "string") {
    throw new InvalidApiRequestError("model must contain provider and model strings.");
  }
  if (body.model.contextWindowTokens !== undefined && typeof body.model.contextWindowTokens !== "number") {
    throw new InvalidApiRequestError("model.contextWindowTokens must be a number when provided.");
  }
  if ("experiment" in body && body.experiment !== undefined) {
    throw new InvalidApiRequestError("experiments are not supported by this run path yet.");
  }
  const selection = parseRunSelection(body.selection);
  return {
    platform: body.platform,
    variant: body.variant,
    sessionId: body.sessionId,
    clientTurnId: body.clientTurnId,
    task: { kind: "prompt", prompt: body.task.prompt },
    model: {
      provider: body.model.provider,
      model: body.model.model,
      ...(body.model.contextWindowTokens === undefined ? {} : { contextWindowTokens: body.model.contextWindowTokens }),
    },
    selection,
  };
}

function parseRunSelection(value: unknown): RunSelection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InvalidApiRequestError("selection must be an object.");

  const allowed = new Set(["scenarioId", "environmentId", "backendProfileId", "infrastructureId", "experimentId"]);
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key)) throw new InvalidApiRequestError(`Unknown run selection field: ${key}.`);
    if (entry !== undefined && typeof entry !== "string") {
      throw new InvalidApiRequestError(`Run selection field ${key} must be a string.`);
    }
  }

  return {
    scenarioId: stringOrUndefined(value.scenarioId),
    environmentId: stringOrUndefined(value.environmentId),
    backendProfileId: stringOrUndefined(value.backendProfileId),
    infrastructureId: stringOrUndefined(value.infrastructureId),
    experimentId: stringOrUndefined(value.experimentId),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseCancelBody(body: unknown): string {
  if (!isRecord(body) || body.reason !== undefined && typeof body.reason !== "string") {
    throw new InvalidApiRequestError("Cancellation body must contain an optional string reason.");
  }
  const reason = body.reason ?? "Cancellation requested by the user.";
  if (reason.length > 500) {
    throw new InvalidApiRequestError("Cancellation reason must be 500 characters or fewer.");
  }
  return reason;
}

function parseModelCatalogQuery(query: { provider?: string; q?: string; limit?: string }): { provider: string; q: string; limit: number } {
  const provider = query.provider?.trim() || "openrouter";
  const q = query.q?.trim() || "";
  if (q.length > 120) throw new InvalidApiRequestError("q must be 120 characters or fewer.");
  const limit = query.limit === undefined ? 40 : parseBoundedQueryInteger(query.limit, "limit", 1, 100);
  return { provider, q, limit };
}

function parseBoundedQueryInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new InvalidApiRequestError(`${name} must be an integer.`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new InvalidApiRequestError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseAfter(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) {
    throw new InvalidApiRequestError("after must be a non-negative integer.");
  }
  return Number(value);
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 100;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500) {
    throw new InvalidApiRequestError("limit must be an integer between 1 and 500.");
  }
  return Number(value);
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof InvalidApiRequestError || error instanceof InvalidRunRequestError) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: error.message } });
  }
  if (error instanceof RunNotFoundError || error instanceof EvidenceNotFoundError) {
    return reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: "Run or evidence was not found." } });
  }
  if (error instanceof RunnerUnavailableError) {
    return reply.code(503).send({ error: { code: "RUNNER_UNAVAILABLE", message: error.message } });
  }
  if (error instanceof ContextSessionLimitError) {
    return reply.code(413).send({ error: { code: "CONTEXT_LIMIT_EXCEEDED", message: error.message, kind: error.kind, limitBytes: error.limitBytes } });
  }
  if (error instanceof ContextSessionBusyError) {
    return reply.code(409).send({ error: { code: "CONTEXT_BUSY", message: error.message } });
  }
  if (error instanceof ContextSessionConflictError) {
    return reply.code(409).send({ error: { code: "CONTEXT_CONFLICT", message: error.message } });
  }
  if (error instanceof OpenRouterCatalogError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The server encountered an unexpected error." } });
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}

function cryptoRandomRequestId(): string {
  return `req-${randomUUID()}`;
}
