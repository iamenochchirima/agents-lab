import type { FastifyInstance, FastifyReply } from "fastify";

import { StudioCatalogError, studioCatalog } from "../catalog.js";
import {
  StudioComparisonNotFoundError,
  StudioComparisonService,
  StudioIdempotencyConflictError,
} from "../application/comparison-service.js";
import { InvalidStudioRequestError } from "../domain/manifest.js";
import type { StudioComparisonRequest, StudioStrategyVariant } from "../domain/types.js";
import {
  StudioCorruptEvidenceError,
  StudioEvidenceConflictError,
  StudioEvidenceNotFoundError,
} from "../adapters/evidence-store.js";
import { InvalidContextStrategyParametersError, UnknownContextStrategyError } from "../strategies/context-strategy.js";

export class InvalidStudioApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStudioApiRequestError";
  }
}

export function registerStudioRoutes(app: FastifyInstance, service: StudioComparisonService): void {
  app.get("/api/studio/catalog", async (_request, reply) => {
    return reply.send(studioCatalog);
  });

  app.get("/api/studio/health", async (_request, reply) => {
    return reply.send({
      system: "studio",
      status: "ready",
      executionProfile: "deterministic-replay",
    });
  });

  app.post<{ Body: unknown }>("/api/studio/comparisons", async (request, reply) => {
    try {
      const comparison = await service.run(parseComparisonRequest(request.body, headerValue(request.headers["x-idempotency-key"])));
      return reply.code(202).send(comparison);
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.get<{ Params: { comparisonId: string } }>("/api/studio/comparisons/:comparisonId", async (request, reply) => {
    try {
      return reply.send(await service.inspect(request.params.comparisonId));
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.get<{ Params: { comparisonId: string }; Querystring: { after?: string; limit?: string } }>("/api/studio/comparisons/:comparisonId/events", async (request, reply) => {
    try {
      const comparison = await service.inspect(request.params.comparisonId);
      const after = parseQueryInteger(request.query.after, "after", 0, Number.MAX_SAFE_INTEGER);
      const limit = parseQueryInteger(request.query.limit, "limit", 1, 500, 100);
      const pending = comparison.events.filter((event) => event.recordedSequence > after);
      const events = pending.slice(0, limit);
      return reply.send({
        comparisonId: comparison.manifest.comparisonId,
        events,
        nextSequence: events.at(-1)?.recordedSequence ?? after,
        hasMore: pending.length > limit,
        done: ["completed", "failed", "cancelled", "recovery_required"].includes(comparison.status),
      });
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.post<{ Params: { comparisonId: string }; Body: unknown }>("/api/studio/comparisons/:comparisonId/cancel", async (request, reply) => {
    try {
      const reason = parseCancelReason(request.body);
      return reply.send(await service.cancel(request.params.comparisonId, reason));
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });

  app.get<{ Params: { comparisonId: string; "*": string } }>("/api/studio/comparisons/:comparisonId/evidence/*", async (request, reply) => {
    try {
      const fileName = request.params["*"];
      const contents = await service.readEvidence(request.params.comparisonId, fileName);
      return reply.type(fileName.endsWith(".jsonl") ? "application/x-ndjson" : "application/json").send(contents);
    } catch (error) {
      return sendStudioError(reply, error);
    }
  });
}

function parseComparisonRequest(body: unknown, headerIdempotencyKey: string | undefined): StudioComparisonRequest {
  const root = record(body, "Request body must be an object.");
  const system = versionedReference(root.system, "system");
  const environment = versionedReference(root.environment, "environment");
  const experiment = record(root.experiment, "experiment must be an object.");
  const experimentReference = versionedReference(experiment, "experiment");
  const scenario = versionedReference(experiment.scenario, "experiment.scenario");
  const subject = record(experiment.subject, "experiment.subject must be an object.");
  const component = stringValue(subject.component, "experiment.subject.component");
  if (component !== "context-management") {
    throw new InvalidStudioApiRequestError("Only context-management is available in the first Studio slice.");
  }
  if (!Array.isArray(subject.strategies)) {
    throw new InvalidStudioApiRequestError("experiment.subject.strategies must be an array.");
  }
  const strategies = subject.strategies.map((value, index) => parseStrategy(value, index));
  const idempotencyKey = headerIdempotencyKey ?? stringValue(root.idempotencyKey, "idempotencyKey");
  const seed = stringValue(root.seed, "seed");
  return {
    system,
    environment,
    experiment: {
      ...experimentReference,
      scenario,
      subject: { component: "context-management", strategies },
    },
    seed,
    idempotencyKey,
  };
}

function parseStrategy(value: unknown, index: number): StudioStrategyVariant {
  const strategy = record(value, `experiment.subject.strategies[${index}] must be an object.`);
  const parameters = strategy.parameters === undefined ? {} : record(strategy.parameters, `strategy ${index} parameters must be an object.`);
  if (Object.values(parameters).some((entry) => typeof entry !== "string")) {
    throw new InvalidStudioApiRequestError(`strategy ${index} parameters must contain only strings.`);
  }
  return {
    id: stringValue(strategy.id, `strategy ${index}.id`),
    version: stringValue(strategy.version, `strategy ${index}.version`),
    parameters: parameters as Record<string, string>,
  };
}

function versionedReference(value: unknown, name: string): { id: string; version: string } {
  const reference = record(value, `${name} must be an object.`);
  return {
    id: stringValue(reference.id, `${name}.id`),
    version: stringValue(reference.version, `${name}.version`),
  };
}

function parseCancelReason(body: unknown): string {
  if (body === undefined || body === null) return "Cancellation requested by the user.";
  const recordBody = record(body, "Cancellation body must be an object.");
  const reason = recordBody.reason === undefined ? "Cancellation requested by the user." : stringValue(recordBody.reason, "reason");
  if (reason.length > 500) throw new InvalidStudioApiRequestError("reason must be 500 characters or fewer.");
  return reason;
}

function parseQueryInteger(value: string | undefined, name: string, minimum: number, maximum: number, fallback?: number): number {
  if (value === undefined) return fallback ?? minimum;
  if (!/^\d+$/.test(value)) throw new InvalidStudioApiRequestError(`${name} must be a non-negative integer.`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new InvalidStudioApiRequestError(`${name} is outside its allowed range.`);
  return parsed;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidStudioApiRequestError(message);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") throw new InvalidStudioApiRequestError(`${name} must be a string.`);
  return value;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendStudioError(reply: FastifyReply, error: unknown) {
  if (error instanceof InvalidStudioApiRequestError || error instanceof InvalidStudioRequestError || error instanceof StudioCatalogError || error instanceof UnknownContextStrategyError || error instanceof InvalidContextStrategyParametersError) {
    return reply.code(400).send({ error: { code: "INVALID_STUDIO_REQUEST", message: error.message } });
  }
  if (error instanceof StudioIdempotencyConflictError || error instanceof StudioEvidenceConflictError) {
    return reply.code(409).send({ error: { code: "STUDIO_CONFLICT", message: error.message } });
  }
  if (error instanceof StudioComparisonNotFoundError || error instanceof StudioEvidenceNotFoundError) {
    return reply.code(404).send({ error: { code: "STUDIO_NOT_FOUND", message: "Studio comparison or evidence was not found." } });
  }
  if (error instanceof StudioCorruptEvidenceError) {
    return reply.code(500).send({ error: { code: "STUDIO_CORRUPT_EVIDENCE", message: "Studio evidence is corrupt and cannot be read safely." } });
  }
  return reply.code(500).send({ error: { code: "STUDIO_INTERNAL_ERROR", message: "Studio encountered an unexpected error." } });
}
