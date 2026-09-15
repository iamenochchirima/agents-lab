import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { ServerConfig } from "../bootstrap/config.js";
import { EvidenceNotFoundError, type EvidenceFileName, RunEvidenceStore } from "../application/evidence-store.js";
import { RunNotFoundError, RunService, RunnerUnavailableError } from "../application/run-service.js";
import type { RunRequest } from "../domain/types.js";
import type { PlatformRunner } from "../ports/runner.js";

export interface ControlPlaneServerDependencies {
  readonly config: ServerConfig;
  readonly service: RunService;
  readonly evidence: RunEvidenceStore;
  readonly runner: PlatformRunner;
}

export class InvalidApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiRequestError";
  }
}

const ALLOWED_EVIDENCE_FILES = new Set<EvidenceFileName>([
  "config.json",
  "events.jsonl",
  "trajectory.json",
  "metrics.json",
  "result.json",
  "native/temporal.json",
]);

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
    const temporal = await dependencies.runner.checkConnection();
    return reply.code(temporal.reachable ? 200 : 503).send({
      status: temporal.reachable ? "ok" : "degraded",
      controlPlane: { ready: true },
      temporal: { reachable: temporal.reachable, message: temporal.message },
    });
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
      if (!ALLOWED_EVIDENCE_FILES.has(fileName as EvidenceFileName)) {
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
  if (!isRecord(body.task) || body.task.kind !== "prompt" || typeof body.task.prompt !== "string") {
    throw new InvalidApiRequestError("task must contain kind=prompt and a string prompt.");
  }
  if (!isRecord(body.model) || typeof body.model.provider !== "string" || typeof body.model.model !== "string") {
    throw new InvalidApiRequestError("model must contain provider and model strings.");
  }
  if ("experiment" in body && body.experiment !== undefined) {
    throw new InvalidApiRequestError("experiments are not supported by this run path yet.");
  }
  return {
    platform: body.platform,
    variant: body.variant,
    task: { kind: "prompt", prompt: body.task.prompt },
    model: { provider: body.model.provider, model: body.model.model },
  };
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
  if (error instanceof InvalidApiRequestError) {
    return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: error.message } });
  }
  if (error instanceof RunNotFoundError || error instanceof EvidenceNotFoundError) {
    return reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: "Run or evidence was not found." } });
  }
  if (error instanceof RunnerUnavailableError) {
    return reply.code(503).send({ error: { code: "RUNNER_UNAVAILABLE", message: error.message } });
  }
  return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The server encountered an unexpected error." } });
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}

function cryptoRandomRequestId(): string {
  return `req-${randomUUID()}`;
}
