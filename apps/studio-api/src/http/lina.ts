import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply } from "fastify";

export interface LinaNode {
  id: string;
  title: string;
  area: string;
  status: "proposed" | "studying" | "decided";
  x: number;
  y: number;
  purpose: string;
  inputs: string;
  outputs: string;
  decisions: string;
  references: string;
  experiments: string;
}

export interface LinaEdge { id: string; source: string; target: string; label: string }
export interface LinaDocument { version: 1; nodes: LinaNode[]; edges: LinaEdge[] }
interface LinaSnapshot { revision: number; document: LinaDocument | null }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

const nodeFields = ["id", "title", "area", "status", "x", "y", "purpose", "inputs", "outputs", "decisions", "references", "experiments"];
const detailFields = ["purpose", "inputs", "outputs", "decisions", "references", "experiments"];

function validNode(value: unknown): value is LinaNode {
  return record(value) && fields(value, nodeFields) && id(value.id)
    && text(value.title, 200) && value.title.trim().length > 0 && text(value.area, 100)
    && ["proposed", "studying", "decided"].includes(value.status as string)
    && typeof value.x === "number" && Number.isFinite(value.x) && Math.abs(value.x) <= 1_000_000
    && typeof value.y === "number" && Number.isFinite(value.y) && Math.abs(value.y) <= 1_000_000
    && detailFields.every(field => text(value[field], 20_000));
}

function validEdge(value: unknown): value is LinaEdge {
  return record(value) && fields(value, ["id", "source", "target", "label"])
    && id(value.id) && id(value.source) && id(value.target) && text(value.label, 500);
}

function validDocument(value: unknown): value is LinaDocument {
  if (!record(value) || !fields(value, ["version", "nodes", "edges"]) || value.version !== 1
    || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length > 500 || value.edges.length > 2_000
    || !value.nodes.every(validNode) || !value.edges.every(validEdge)) return false;
  const nodes = new Set(value.nodes.map(node => node.id));
  return nodes.size === value.nodes.length
    && new Set(value.edges.map(edge => edge.id)).size === value.edges.length
    && value.edges.every(edge => nodes.has(edge.source) && nodes.has(edge.target));
}

/** One workspace architecture draft, separate from agent execution and run evidence.
 * A revision check and replacement share the same transaction. A lost PUT receipt
 * requires a GET before retrying: blindly resending the old revision conflicts.
 */
class LinaStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    try {
      this.database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS lina_architecture (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          document TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO lina_architecture (singleton, revision, document, updated_at)
          VALUES (1, 0, NULL, CURRENT_TIMESTAMP);
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  get(): LinaSnapshot {
    const row = this.database.prepare("SELECT revision, document FROM lina_architecture WHERE singleton = 1").get();
    if (!row || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)) throw new Error("Invalid Lina revision");
    const document: unknown = row.document === null ? null : JSON.parse(String(row.document));
    if (document !== null && !validDocument(document)) throw new Error("Invalid stored Lina document");
    return { revision: row.revision, document };
  }

  put(revision: number, document: LinaDocument): { conflict: boolean; snapshot: LinaSnapshot } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get();
      if (current.revision !== revision) {
        this.database.exec("ROLLBACK");
        return { conflict: true, snapshot: current };
      }
      const next = revision + 1;
      this.database.prepare("UPDATE lina_architecture SET revision = ?, document = ?, updated_at = ? WHERE singleton = 1")
        .run(next, JSON.stringify(document), new Date().toISOString());
      this.database.exec("COMMIT");
      return { conflict: false, snapshot: { revision: next, document } };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void { this.database.close(); }
}

/** Local-only architecture authoring endpoints. No runtime agent is created. */
export function registerStudioLinaRoutes(app: FastifyInstance, databasePath: string): void {
  const store = new LinaStore(databasePath);
  app.addHook("onClose", async () => store.close());

  function operate<T>(reply: FastifyReply, operation: () => T): T | FastifyReply {
    try { return operation(); }
    catch (error) {
      app.log.error({ err: error }, "Lina database operation failed");
      return reply.code(503).send({ error: "LINA_STORAGE_FAILED", message: "The Lina database could not complete this operation. Your changes have not been confirmed saved." });
    }
  }

  app.get("/lina", async (_request, reply) => operate(reply, () => store.get()));
  app.put<{ Body: unknown }>("/lina", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const body = request.body;
    if (!record(body) || !fields(body, ["revision", "document"])
      || typeof body.revision !== "number" || !Number.isSafeInteger(body.revision)
      || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER || !validDocument(body.document)) {
      return reply.code(400).send({ error: "INVALID_LINA_DOCUMENT", message: "Provide a nonnegative revision and a version 1 document with valid nodes and edges. Node and edge IDs must be unique and edge endpoints must exist." });
    }
    return operate(reply, () => {
      const result = store.put(body.revision as number, body.document as LinaDocument);
      if (result.conflict) return reply.code(409).send({ error: "LINA_REVISION_CONFLICT", message: "Lina was changed elsewhere. Reload the saved architecture before deciding how to apply your draft.", ...result.snapshot });
      return result.snapshot;
    });
  });
}
