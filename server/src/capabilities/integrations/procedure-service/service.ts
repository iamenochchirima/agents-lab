import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityWorkspaceRoot } from "../../extensions/runtime.js";
import { validateToolArguments } from "../../extensions/schema.js";

export const procedureInputSchema = {type: "object", additionalProperties: false,
  properties: {namespace: {type: "string", pattern: "^cap-[a-z0-9-]{1,90}$"}, script: {type: "string", minLength: 1, maxLength: 8192}, scriptDigest: {type: "string", pattern: "^[a-f0-9]{64}$"}},
  required: ["namespace", "script", "scriptDigest"]};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Optional connected execution fixture. A separate process executes a pinned
 * declarative procedure against a configured business API. It never evaluates
 * JavaScript/Python, launches a shell or opens model-selected host paths.
 */
export async function createProcedureService(options: {port?: number; token: string; businessUrl?: string; scriptPath?: string}) {
  if (!options.token || options.token.length < 16) throw new Error("Procedure provider requires a configured token of at least 16 characters.");
  const business = new URL(options.businessUrl ?? "http://127.0.0.1:9196");
  if (!["http:", "https:"].includes(business.protocol) || business.username || business.password) throw new Error("Procedure business endpoint must be configured HTTP(S).");
  const source = await readFile(options.scriptPath ?? join(capabilityWorkspaceRoot(), "server/capability-packages/execution-skills/adjustment-summary/scripts/summary.json"), "utf8");
  const script = JSON.parse(source) as {schemaVersion: number; scriptId: string; version: string; steps: Record<string, unknown>[]};
  if (script.schemaVersion !== 1 || script.scriptId !== "support-adjustment-summary" || script.version !== "1.0.0" || !Array.isArray(script.steps) || script.steps.length > 16) throw new Error("Configured procedure is not supported.");
  const digest = sha256(source), expected = Buffer.from(`Bearer ${options.token}`);
  const app = Fastify({bodyLimit: 16 * 1024});
  app.get("/health", async () => ({service: "connected-procedure-service", status: "ready", execution: "bounded-declarative", scriptId: script.scriptId, scriptDigest: digest}));
  async function execute(argumentsValue: unknown) {
    const input = validateToolArguments(procedureInputSchema, argumentsValue);
    if (input.scriptDigest !== digest || sha256(String(input.script)) !== digest) throw new Error("Only the configured exact script and digest may execute.");
    let state: Record<string, unknown> = {}, report: Record<string, unknown> | null = null;
    for (const step of script.steps) {
      if (step.operation === "read_order") {
        const target = new URL("/support/order", business); target.searchParams.set("namespace", String(input.namespace));
        const response = await fetch(target, {signal: AbortSignal.timeout(5000)});
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Configured business read failed with HTTP ${response.status}.`); }
        if (!response.body) throw new Error("Business read returned no body.");
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        try {
          while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 32 * 1024) { await reader.cancel(); throw new Error("Business read exceeds the procedure limit."); } chunks.push(chunk.value); }
        } finally { reader.releaseLock(); }
        const content = Buffer.concat(chunks).toString("utf8");
        const value: unknown = JSON.parse(content); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Business read did not return a record.");
        state = value as Record<string, unknown>;
      } else if (step.operation === "subtract") {
        const left = state[String(step.left)], right = state[String(step.right)];
        if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error("Procedure arithmetic requires safe integer business values.");
        const value = Number(left) - Number(right); if (!Number.isSafeInteger(value)) throw new Error("Procedure arithmetic overflow.");
        state[String(step.target)] = value;
      } else if (step.operation === "report" && Array.isArray(step.fields)) {
        report = Object.fromEntries(step.fields.map(field => [String(field), state[String(field)] ?? null]));
      } else throw new Error("Configured procedure step is unsupported.");
    }
    if (!report) throw new Error("Configured procedure did not produce a report.");
    return {summary: report, execution: {provider: "connected-procedure-service", scriptId: script.scriptId, version: script.version, digest, namespace: input.namespace, stepCount: script.steps.length}};
  }
  app.post<{Body: {id?: string | number; method?: string; params?: {name?: string; arguments?: unknown}}}>("/mcp", async (request, reply) => {
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({error: "Procedure provider requires host authorization."});
    const body = request.body; const envelope = (result: unknown) => ({jsonrpc: "2.0", id: body.id ?? null, result});
    if (body.method === "initialize") return envelope({protocolVersion: "2026-07-28", capabilities: {tools: {}}, serverInfo: {name: "connected-procedure-service", version: "1.0.0"}});
    if (body.method === "notifications/initialized") return reply.code(202).send();
    if (body.method === "tools/list") return envelope({tools: [{name: "procedures.execute", description: "Execute the exact adjustment-summary skill script in this connected service. The configured script reads saved order state and computes its net amount. Reading the script alone is not execution.", inputSchema: procedureInputSchema, annotations: {readOnlyHint: true}}]});
    if (body.method !== "tools/call" || body.params?.name !== "procedures.execute") return reply.code(400).send({jsonrpc: "2.0", id: body.id ?? null, error: {code: -32601, message: "Only connected procedure tools are supported."}});
    try { const result = await execute(body.params.arguments); return envelope({content: [{type: "text", text: JSON.stringify(result)}], structuredContent: result}); }
    catch (error) { return envelope({isError: true, content: [{type: "text", text: error instanceof Error ? error.message : "Procedure failed."}]}); }
  });
  await app.listen({host: "127.0.0.1", port: options.port ?? 9198});
  return {app, scriptDigest: digest, close: () => app.close()};
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.AGENTLAB_PROCEDURE_PROVIDER_TOKEN;
  if (!token) throw new Error("Set AGENTLAB_PROCEDURE_PROVIDER_TOKEN and matching host Authorization environment value.");
  const service = await createProcedureService({token});
  console.log("Optional procedure provider listening at http://127.0.0.1:9198");
  process.once("SIGINT", () => { void service.close(); }); process.once("SIGTERM", () => { void service.close(); });
}
