import type { FastifyInstance } from "fastify";
import { AgentStateStore, AgentStateConflictError, AgentStateNotFoundError } from "../../capabilities/agent-state/store.js";
import type { AgentIdentityContent, SaveMemoryInput } from "../../capabilities/agent-state/contracts.js";
import type { RunService } from "../application/run-service.js";

/** Local workspace management. Native workers use separately authenticated boundaries. */
export function registerAgentState(app: FastifyInstance, store: AgentStateStore, service: RunService, origins: readonly string[]): void {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/agent-state") && !/^\/api\/runs\/[^/]+\/inputs/.test(request.url)) return;
    if (request.method === "POST" && request.headers.origin && !origins.includes(request.headers.origin)) return reply.code(403).send({ error: { code: "ORIGIN_REJECTED", message: "This workspace does not accept changes from that origin." } });
  });
  const failed = (error: unknown) => ({ error: { code: error instanceof AgentStateConflictError ? "REVISION_CONFLICT" : "AGENT_STATE_REJECTED", message: error instanceof Error ? error.message : "The operation was rejected." } });
  app.get("/api/agent-state", async () => ({ identity: await store.getIdentity(), memory: await store.listMemory() }));
  app.get("/api/agent-state/identity/markdown", async () => ({ markdown: await store.exportIdentityMarkdown() }));
  app.post("/api/agent-state/identity", { bodyLimit: 32768 }, async (request, reply) => {
    try {
      const body = request.body as AgentIdentityContent & { operationId: string; expectedRevision: number; markdown?: string };
      const mutation = { operationId: body.operationId, expectedRevision: body.expectedRevision };
      return { identity: body.markdown !== undefined ? await store.importIdentityMarkdown(body.markdown, mutation) : await store.updateIdentity({ name: body.name, purpose: body.purpose, style: body.style, initiative: body.initiative, behavior: body.behavior }, mutation) };
    } catch (error) { return reply.code(error instanceof AgentStateConflictError ? 409 : 400).send(failed(error)); }
  });
  app.post("/api/agent-state/memory", { bodyLimit: 16384 }, async (request, reply) => {
    try { const body = request.body as SaveMemoryInput; return { memory: await store.saveMemory("workspace-local", { ...body, expectedRevision: 0, provenance: { source: "user" } }) }; }
    catch (error) { return reply.code(error instanceof AgentStateConflictError ? 409 : 400).send(failed(error)); }
  });
  app.post<{ Params: { id: string } }>("/api/agent-state/memory/:id", { bodyLimit: 16384 }, async (request, reply) => {
    try {
      const body = request.body as SaveMemoryInput & { operation: "update" | "forget" };
      if (body.operation === "forget") return { forgotten: await store.forgetMemory("workspace-local", request.params.id, body) };
      if (body.operation !== "update") throw new Error("Choose update or forget.");
      return { memory: await store.updateMemory("workspace-local", request.params.id, { ...body, provenance: { source: "user" } }) };
    } catch (error) { return reply.code(error instanceof AgentStateNotFoundError ? 404 : error instanceof AgentStateConflictError ? 409 : 400).send(failed(error)); }
  });
  app.get<{ Params: { runId: string } }>("/api/runs/:runId/inputs", async (request, reply) => {
    try { return await service.taskInteraction(request.params.runId); }
    catch (error) { return reply.code(404).send(failed(error)); }
  });
  app.post<{ Params: { runId: string } }>("/api/runs/:runId/inputs", { bodyLimit: 32768 }, async (request, reply) => {
    try {
      const body = request.body as { inputId: string; kind: "steering" | "clarification_reply"; content: string; questionId?: string };
      return { input: await service.acceptTaskInput(request.params.runId, body) };
    } catch (error) { return reply.code(409).send(failed(error)); }
  });
}
