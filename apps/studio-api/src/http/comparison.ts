import type { FastifyInstance, FastifyReply } from "fastify";
import { COMPARISON_CATEGORIES, ComparisonStore, type ComparisonItem } from "./comparison-store.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validItem(value: unknown): value is ComparisonItem {
  return record(value) && Object.keys(value).length === 4 && validId(value.id)
    && typeof value.category === "string" && COMPARISON_CATEGORIES.some(category => category === value.category)
    && typeof value.agent === "string" && ["hermes", "openclaw", "pi", "waku"].includes(value.agent)
    && typeof value.text === "string" && value.text.length <= 20_000;
}

function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: "INVALID_COMPARISON_ITEM", message });
}

/** Local workspace notes API. SQL failures return errors rather than a save receipt;
 * no agent execution, inference, or generated comparison content is involved.
 */
export function registerStudioComparisonRoutes(app: FastifyInstance, databasePath: string): void {
  const store = new ComparisonStore(databasePath);
  app.addHook("onClose", async () => store.close());

  // Keep filesystem paths and raw SQLite details out of browser errors.
  function operate<T>(reply: FastifyReply, operation: () => T): T | FastifyReply {
    try {
      return operation();
    } catch (error) {
      app.log.error({ err: error }, "Comparison database operation failed");
      return reply.code(503).send({ error: "COMPARISON_STORAGE_FAILED", message: "The comparison database could not complete this operation. Your changes have not been confirmed saved." });
    }
  }

  app.get("/comparison", async (_request, reply) => operate(reply, () => ({ items: store.list() })));

  app.put<{ Params: { id: string }; Body: unknown }>("/comparison/items/:id", { bodyLimit: 128 * 1024 }, async (request, reply) => {
    if (!validId(request.params.id) || !record(request.body)
      || Object.keys(request.body).length !== 3 || "id" in request.body) {
      return invalid(reply, "Provide a valid item ID and exactly category, agent, and text.");
    }
    const item = { ...request.body, id: request.params.id };
    if (!validItem(item)) return invalid(reply, "Use a known category and agent, and text of at most 20,000 characters.");
    return operate(reply, () => { store.put(item); return { item }; });
  });

  app.delete<{ Params: { id: string } }>("/comparison/items/:id", async (request, reply) => {
    if (!validId(request.params.id)) return invalid(reply, "Provide an item ID of 1–200 characters without control characters.");
    return operate(reply, () => { store.delete(request.params.id); return reply.code(204).send(); });
  });

  app.post<{ Body: unknown }>("/comparison/import", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).length !== 1 || !Array.isArray(body.items)
      || body.items.length > 5_000 || !body.items.every(validItem)) {
      return invalid(reply, "Provide only items: an array of at most 5,000 valid comparison items.");
    }
    const items = body.items as ComparisonItem[];
    if (new Set(items.map(item => item.id)).size !== items.length) return invalid(reply, "Import item IDs must be unique.");
    return operate(reply, () => ({ imported: store.import(items) }));
  });
}
