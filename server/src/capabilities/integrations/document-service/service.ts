import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentRejectedError, workspaceContributions } from "./files.js";
import { capabilityWorkspaceRoot } from "../../extensions/runtime.js";

/** Optional external document provider. Its process owns storage and permissions.
 * Authentication identifies the trusted host. Session scope comes only from a
 * host-injected header, never from model arguments or arbitrary host paths.
 */
export async function createDocumentService(options: { port?: number; token: string; templateRoot?: string; stateRoot?: string }) {
  if (!options.token || options.token.length < 16) throw new Error("Document provider requires a configured token of at least 16 characters.");
  const root = capabilityWorkspaceRoot();
  const stateRoot = options.stateRoot ?? join(root, "lab/runs/.document-provider");
  const tools = await workspaceContributions({ id: "task-workspace", version: "2.0.0" }, options.templateRoot ?? join(root, "lab/scenarios/workspace-capabilities/fixtures"), ["artifacts"], { isolateSessions: true, stateRoot });
  const app = Fastify({ bodyLimit: 256 * 1024 });
  const expected = Buffer.from(`Bearer ${options.token}`);
  app.get("/health", async () => ({ service: "document-provider", status: "ready", storageOwner: "external-provider" }));
  app.post<{ Body: { id?: string | number; method?: string; params?: { name?: string; arguments?: unknown } } }>("/mcp", async (request, reply) => {
    const authorization = Buffer.from(request.headers.authorization ?? "");
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return reply.code(401).send({ error: "Document provider requires host authorization." });
    const body = request.body;
    const envelope = (result: unknown) => ({ jsonrpc: "2.0", id: body.id ?? null, result });
    if (body.method === "initialize") return envelope({ protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "agentlab-document-provider", version: "2.0.0" } });
    if (body.method === "notifications/initialized") return reply.code(202).send();
    if (body.method === "tools/list") return envelope({ tools: tools.map(({ descriptor: { definition } }) => ({ name: definition.name, description: definition.description, inputSchema: definition.inputSchema, annotations: { readOnlyHint: definition.riskClass === "read", destructiveHint: definition.riskClass === "write" } })) });
    if (body.method !== "tools/call") return reply.code(400).send({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "Document provider supports tools discovery and invocation only." } });
    const sessionId = request.headers["x-agentlab-session-id"];
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) return reply.code(403).send({ error: "A host-admitted session binding is required." });
    const tool = tools.find(value => value.descriptor.definition.name === body.params?.name);
    if (!tool) return envelope({ isError: true, content: [{ type: "text", text: "Unknown document operation." }] });
    const argumentsValue = body.params?.arguments ?? {};
    let validated: Readonly<Record<string, unknown>>;
    try { validated = tool.implementation.validateArguments(argumentsValue); } catch {
      const message = "Document arguments do not match the published schema.";
      return envelope({isError: true, content: [{type: "text", text: message}], structuredContent: {error: {code: "DOCUMENT_INVALID_ARGUMENTS", message}}});
    }
    const controller = new AbortController();
    const onDisconnect = () => { if (!request.raw.complete) controller.abort(); };
    request.raw.once("close", onDisconnect);
    try {
      const text = await tool.implementation.execute(validated, { runId: "provider-request", turnId: "provider-request", sessionId, signal: controller.signal });
      return envelope({ content: [{ type: "text", text }], structuredContent: JSON.parse(text) });
    } catch (error) {
      if (error instanceof DocumentRejectedError) return envelope({isError: true, content: [{type: "text", text: error.message}], structuredContent: {error: {code: error.code, message: error.message}}});
      return envelope({ isError: true, content: [{ type: "text", text: error && typeof error === "object" && "code" in error ? `Document operation failed (${String(error.code)}).` : error instanceof Error ? error.message : "Document operation failed." }] });
    } finally { request.raw.off("close", onDisconnect); }
  });
  await app.listen({ host: "127.0.0.1", port: options.port ?? 9197 });
  return { app, stateRoot, close: () => app.close() };
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.AGENTLAB_DOCUMENT_PROVIDER_TOKEN;
  if (!token) throw new Error("Set AGENTLAB_DOCUMENT_PROVIDER_TOKEN and matching host AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION=Bearer <token>.");
  const service = await createDocumentService({ token });
  console.log("Optional document provider listening at http://127.0.0.1:9197");
  process.once("SIGINT", () => { void service.close(); });
  process.once("SIGTERM", () => { void service.close(); });
}
