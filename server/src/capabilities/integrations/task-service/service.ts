import Fastify from "fastify";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityWorkspaceRoot } from "../../extensions/runtime.js";

export interface ReleaseRecord {
  readonly key: "cedar";
  readonly approvedDate: "2026-10-22";
  readonly dependency: "Integration documentation incomplete";
  readonly owner: string | null;
  readonly status: "blocked" | "in_progress";
  readonly revision: number;
}
export const recordLookupSchema = {
  type: "object", properties: { namespace: { type: "string", pattern: "^cap-[a-z0-9-]{1,90}$" }, key: { type: "string", enum: ["cedar"] } },
  required: ["namespace", "key"], additionalProperties: false,
};
export const recordUpdateSchema = {
  type: "object", properties: { ...recordLookupSchema.properties, expectedRevision: { type: "integer", minimum: 1 }, owner: { type: "string", minLength: 1, maxLength: 80 }, status: { type: "string", enum: ["in_progress"] } },
  required: ["namespace", "key", "expectedRevision", "owner", "status"], additionalProperties: false,
};

/** Controlled fictional application, reached through real HTTP and MCP.
 * Each acceptance session receives a namespace with durable record revisions.
 * This fixture has no external accounts and is not an authorization server.
 */
export async function createTaskService(options: { port?: number; stateRoot?: string } = {}) {
  const app = Fastify({ bodyLimit: 8192 });
  const root = options.stateRoot ?? join(capabilityWorkspaceRoot(), "lab/runs/.service-task");
  await mkdir(root, { recursive: true });
  let mutations = Promise.resolve();
  const namespacePath = (namespace: string) => {
    if (!/^cap-[a-z0-9-]{1,90}$/.test(namespace)) throw new Error("Invalid acceptance namespace.");
    return join(root, `${namespace}.json`);
  };
  async function lookup(namespace: string): Promise<ReleaseRecord> {
    try { return JSON.parse(await readFile(namespacePath(namespace), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { key: "cedar", approvedDate: "2026-10-22", dependency: "Integration documentation incomplete", owner: null, status: "blocked", revision: 1 };
    }
  }
  app.get("/health", async () => ({ service: "capability-task-service", schemaVersion: 1, status: "ready" }));
  app.get<{ Querystring: { namespace: string; key: string } }>("/records", { schema: { querystring: recordLookupSchema } }, request => lookup(request.query.namespace));
  app.put<{ Body: { namespace: string; key: string; expectedRevision: number; owner: string; status: "in_progress" } }>("/records", { schema: { body: recordUpdateSchema } }, async (request, reply) => {
    const previous = mutations;
    let release!: () => void;
    mutations = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const current = await lookup(request.body.namespace);
      if (current.revision !== request.body.expectedRevision) return reply.code(409).send({ error: "Revision changed; read the record before editing again.", revision: current.revision });
      const record = { ...current, owner: request.body.owner, status: request.body.status, revision: current.revision + 1 };
      const path = namespacePath(request.body.namespace);
      await writeFile(`${path}.pending`, JSON.stringify(record) + "\n");
      await rename(`${path}.pending`, path);
      return record;
    } finally { release(); }
  });
  app.post<{ Body: { id?: string | number; method?: string; params?: { name?: string; arguments?: { namespace?: string; key?: string } } } }>("/mcp", async (request, reply) => {
    const body = request.body;
    const envelope = (result: unknown) => ({ jsonrpc: "2.0", id: body.id ?? null, result });
    if (body.method === "tools/list") return envelope({ tools: [{ name: "release.lookup", description: "Read the Cedar release record, including its current revision, assigned owner and status.", inputSchema: recordLookupSchema }] });
    if (body.method === "tools/call" && body.params?.name === "release.lookup") {
      const input = body.params.arguments;
      if (!input || input.key !== "cedar" || typeof input.namespace !== "string" || !/^cap-[a-z0-9-]{1,90}$/.test(input.namespace)) return envelope({ isError: true, content: [{ type: "text", text: "Provide the assigned acceptance namespace and key cedar." }] });
      const record = await lookup(input.namespace);
      return envelope({ content: [{ type: "text", text: JSON.stringify(record) }], structuredContent: record });
    }
    return reply.code(400).send({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "This controlled fixture supports tools/list and tools/call only." } });
  });
  await app.listen({ host: "127.0.0.1", port: options.port ?? 9196 });
  return { app, lookup, stateRoot: root, close: () => app.close() };
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const service = await createTaskService();
  console.log("Capability task service listening at http://127.0.0.1:9196");
  process.once("SIGINT", () => { void service.close(); });
  process.once("SIGTERM", () => { void service.close(); });
}
