import type { FastifyInstance } from "fastify";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface SupportOrder {
  readonly orderId: "order-cedar";
  readonly customerId: "customer-avery";
  readonly totalCents: 5000;
  readonly deliveryStatus: "delivered_late";
  readonly adjustmentCents: number;
  readonly revision: number;
  readonly adjustments: readonly { amountCents: number; reason: "late_delivery"; operationId: string | null }[];
}
export const supportLookupSchema = { type: "object", properties: { namespace: { type: "string", pattern: "^cap-[a-z0-9-]{1,90}$" } }, required: ["namespace"], additionalProperties: false };
export const supportAdjustmentSchema = { type: "object", properties: { ...supportLookupSchema.properties, orderId: { type: "string", enum: ["order-cedar"] }, expectedRevision: { type: "integer", minimum: 1 }, amountCents: { type: "integer", minimum: 1, maximum: 1000 }, reason: { type: "string", enum: ["late_delivery"] } }, required: ["namespace", "orderId", "expectedRevision", "amountCents", "reason"], additionalProperties: false };
export const supportPolicy = { policyId: "late-delivery-v1", currency: "USD", maximumAdjustmentCents: 1000, requiredReason: "late_delivery", requiresEligibleCustomer: true, requiresDeliveryStatus: "delivered_late", requiresHumanApproval: true };
export const supportTools = [
  { name: "support.customer", description: "Read the customer eligibility for the assigned support namespace.", inputSchema: supportLookupSchema },
  { name: "support.order", description: "Read order-cedar and its current revision and saved adjustments.", inputSchema: supportLookupSchema },
  { name: "support.policy", description: "Read the late-delivery adjustment policy. The maximum is a ceiling, not the requested amount.", inputSchema: supportLookupSchema },
];

/** Fictional business service, separate from agent decisions and review policy.
 * Actual JSON records survive process restart; idempotency is provider-owned.
 */
export async function registerSupportService(app: FastifyInstance, root: string) {
  await mkdir(root, { recursive: true });
  let mutations = Promise.resolve();
  function path(namespace: string) { if (!/^cap-[a-z0-9-]{1,90}$/.test(namespace)) throw new Error("Invalid support namespace."); return join(root, `${namespace}.json`); }
  async function read(namespace: string): Promise<{ order: SupportOrder; receipts: Record<string, { digest: string; order: SupportOrder }> }> {
    try { return JSON.parse(await readFile(path(namespace), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { order: { orderId: "order-cedar", customerId: "customer-avery", totalCents: 5000, deliveryStatus: "delivered_late", adjustmentCents: 0, revision: 1, adjustments: [] }, receipts: {} };
    }
  }
  async function lookup(name: string, namespace: string): Promise<unknown> {
    if (name === "support.customer") { path(namespace); return { customerId: "customer-avery", name: "Avery", adjustmentEligible: true }; }
    if (name === "support.policy") { path(namespace); return supportPolicy; }
    if (name === "support.order") return (await read(namespace)).order;
    throw new Error("Unknown support operation.");
  }
  app.get<{ Querystring: { namespace: string } }>("/support/order", { schema: { querystring: supportLookupSchema } }, request => lookup("support.order", request.query.namespace));
  app.post<{ Body: { namespace: string; orderId: "order-cedar"; expectedRevision: number; amountCents: number; reason: "late_delivery" } }>("/support/adjustments", { schema: { body: supportAdjustmentSchema } }, async (request, reply) => {
    const previous = mutations; let release!: () => void; mutations = new Promise(resolve => { release = resolve; }); await previous;
    try {
      const current = await read(request.body.namespace);
      const operationId = request.headers["idempotency-key"];
      if (operationId !== undefined && (typeof operationId !== "string" || !/^[A-Za-z0-9._:-]{1,180}$/.test(operationId))) return reply.code(400).send({ error: "Invalid provider idempotency key.", effect: "rejected" });
      const fingerprint = createHash("sha256").update(JSON.stringify({ namespace: request.body.namespace, orderId: request.body.orderId, expectedRevision: request.body.expectedRevision, amountCents: request.body.amountCents, reason: request.body.reason })).digest("hex");
      if (typeof operationId === "string" && current.receipts[operationId]) {
        const receipt = current.receipts[operationId];
        if (receipt.digest !== fingerprint) return reply.code(409).send({ error: "An idempotency key cannot authorize changed arguments.", effect: "rejected" });
        return { effect: "confirmed", replayed: true, order: receipt.order };
      }
      if (current.order.revision !== request.body.expectedRevision) return reply.code(409).send({ error: "Order revision changed. Inspect current saved state.", effect: "rejected", revision: current.order.revision });
      if (current.order.adjustmentCents + request.body.amountCents > supportPolicy.maximumAdjustmentCents) return reply.code(422).send({ error: "Adjustment exceeds the policy ceiling.", effect: "rejected" });
      const order: SupportOrder = { ...current.order, adjustmentCents: current.order.adjustmentCents + request.body.amountCents, revision: current.order.revision + 1, adjustments: [...current.order.adjustments, { amountCents: request.body.amountCents, reason: request.body.reason, operationId: typeof operationId === "string" ? operationId : null }] };
      const receipts = { ...current.receipts, ...(typeof operationId === "string" ? { [operationId]: { digest: fingerprint, order } } : {}) };
      const target = path(request.body.namespace); await writeFile(`${target}.pending`, JSON.stringify({ order, receipts }) + "\n", { mode: 0o600 }); await rename(`${target}.pending`, target);
      return { effect: "confirmed", replayed: false, order };
    } finally { release(); }
  });
  return { lookup, order: async (namespace: string) => (await read(namespace)).order };
}
