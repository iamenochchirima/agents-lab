import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { RunEvidenceStore } from "../../control-plane/application/evidence-store.js";
import type { ContextSessionStore } from "../context/session-store.js";
import type { ConnectionResult } from "../integrations/contracts.js";
import type { ToolExecutionResult } from "../tools/contracts.js";
import { ToolRegistry } from "../tools/registry.js";
import type { CapabilityHostRequest, HostedToolContribution } from "./contracts.js";
import { capabilityHostKeyPath } from "./runtime.js";
import { InvocationReviewStore, argumentDigest } from "../reviews/store.js";
import type { InvocationReviewView } from "../reviews/contracts.js";

const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type ValidatedCall = Extract<ReturnType<ToolRegistry["validateCall"]>, { accepted: true }>;
interface PendingReceipt {
  schemaVersion: 1;
  fingerprint: string;
  catalogRevision: string;
  toolName: string;
  toolCallId: string;
  status: "pending";
}
interface CompleteReceipt extends Omit<PendingReceipt, "status"> {
  status: "complete";
  result: ToolExecutionResult;
  /** Full sanitized source evidence stays durable even when native events use a summary. */
  connectionResults?: readonly ConnectionResult[];
}

/** Executes admitted capabilities while native workers retain their agent loops.
 * Each call reserves durable identity before effects. A pending receipt after
 * restart stays unknown; inspecting it never dispatches the operation again.
 */
export class CapabilityHost {
  // A catalog refresh must not substitute a new implementation for a run that
  // already admitted an older source. Historical bindings are reconstructed by
  // the management repository on restart; live authority checks still apply.
  private readonly contributions = new Map<string, HostedToolContribution>();
  private readonly inFlight = new Map<string, { fingerprint: string; promise: Promise<ToolExecutionResult> }>();

  constructor(
    private readonly evidence: RunEvidenceStore,
    tools: readonly HostedToolContribution[],
    private readonly key: string,
    private readonly sessions?: ContextSessionStore,
    private readonly reviews: InvocationReviewStore = new InvocationReviewStore(dirname(evidence.runDirectory("review-root"))),
  ) {
    this.retain(tools);
  }

  static async create(evidence: RunEvidenceStore, tools: readonly HostedToolContribution[], sessions?: ContextSessionStore, reviews?: InvocationReviewStore): Promise<CapabilityHost> {
    const path = capabilityHostKeyPath();
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 64 || (info.mode & 0o077) !== 0) {
      throw new Error("Capability host key must be a private regular file.");
    }
    const key = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid capability host key.");
    return new CapabilityHost(evidence, tools, key, sessions, reviews);
  }

  private readonly cleanups = new Set<() => Promise<void>>();

  private retain(tools: readonly HostedToolContribution[]): void {
    for (const tool of tools) {
      const identity = contributionIdentity(tool.descriptor);
      const retained = this.contributions.get(identity);
      if (retained && canonical(retained.descriptor) !== canonical(tool.descriptor)) {
        throw new Error("An admitted source identity cannot change its descriptor.");
      }
      this.contributions.set(identity, tool);
    }
  }

  /** Publish contributions for new admission while retaining old source bindings. */
  replace(tools: readonly HostedToolContribution[]): void {
    this.retain(tools);
    for (const tool of tools) if (tool.close) this.cleanups.add(tool.close);
  }

  register(app: FastifyInstance): void {
    this.replace([...this.contributions.values()]);
    app.addHook("onClose", async () => {
      await Promise.allSettled([...this.cleanups].map(close => close()));
    });
    app.post("/internal/capabilities/execute", { bodyLimit: 1_048_576 }, async (request, reply) => {
      const actual = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${this.key}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return reply.code(401).send({ error: "Runtime authentication required." });
      }
      const controller = new AbortController();
      const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);
      try {
        return reply.send(await this.execute(request.body as CapabilityHostRequest, controller.signal));
      } catch {
        return reply.code(400).send({ error: "Capability invocation rejected. Inspect the run capability selection and native configuration." });
      } finally {
        request.raw.removeListener("aborted", abort);
        reply.raw.removeListener("close", abort);
      }
    });
    app.post("/internal/capabilities/prepare", { bodyLimit: 1_048_576 }, async (request, reply) => {
      const actual = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${this.key}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: "Runtime authentication required." });
      try { return reply.send(await this.prepare(request.body as CapabilityHostRequest)); }
      catch { return reply.code(400).send({ error: "Invocation proposal rejected. Inspect admitted permissions and source identity." }); }
    });
  }

  /** Validate and retain a proposal without reserving or invoking external effects. */
  async prepare(input: CapabilityHostRequest): Promise<InvocationReviewView | null> {
    if (!input || !safeId.test(input.runId) || !safeId.test(input.turnId) || !input.call || !safeId.test(input.call.toolCallId)) throw new Error("Unsafe proposal identity.");
    const manifest = await this.evidence.readManifest(input.runId);
    const snapshot = manifest.capabilities?.toolCatalog;
    if (!snapshot || snapshot.revision !== input.catalogRevision || manifest.context.turnId !== input.turnId) throw new Error("Catalog or turn mismatch.");
    const descriptor = snapshot.tools.find(value => value.definition.name === input.call.name);
    const contribution = descriptor ? this.contributions.get(contributionIdentity(descriptor)) : undefined;
    if (!descriptor || !contribution || canonical(descriptor.source) !== canonical(contribution.descriptor.source)
      || descriptor.execution.kind !== "hosted") throw new Error("Frozen source unavailable.");
    if (descriptor.definition.approvalMode !== "invocation") return null;
    await contribution.checkAuthority?.(AbortSignal.timeout(30_000));
    const registry = new ToolRegistry(manifest.capabilities!.tools);
    registry.register({ ...contribution.implementation, definition: descriptor.definition });
    const validated = registry.validateCall(input.call);
    if (!validated.accepted || !registry.authorize(validated.call).allowed) throw new Error("Invocation is not permitted.");
    const state = await this.evidence.readSnapshot(input.runId);
    if (state.result || state.events.some(event => event.kind === "RunCancellationRequested")) throw new Error("Run cannot propose an action.");
    const args = validated.call.arguments as Record<string, unknown>;
    const value = await this.reviews.propose({ runId: input.runId, turnId: input.turnId, call: validated.call,
      catalogRevision: snapshot.revision, sourceDigest: descriptor.source.digest,
      connectionIdentity: descriptor.connection ? canonical(descriptor.connection) : null,
      argumentDigest: argumentDigest(args), displayArguments: redactArguments(args, descriptor.definition.inputSchema) }, async () => {
        const current = await this.evidence.readSnapshot(input.runId);
        if (current.result || current.events.some(event => event.kind === "RunCancellationRequested")) throw new Error("Run cannot propose an action.");
      });
    return this.reviews.view(value);
  }

  async execute(input: CapabilityHostRequest, signal: AbortSignal): Promise<ToolExecutionResult> {
    if (!input || !safeId.test(input.runId) || !safeId.test(input.turnId) || !input.call || !safeId.test(input.call.toolCallId)) {
      throw new Error("Unsafe capability invocation identity.");
    }
    const manifest = await this.evidence.readManifest(input.runId);
    const capabilities = manifest.capabilities;
    const snapshot = capabilities?.toolCatalog;
    if (!capabilities || !snapshot || snapshot.revision !== input.catalogRevision || manifest.context.turnId !== input.turnId) {
      throw new Error("Catalog or turn mismatch.");
    }
    const descriptor = snapshot.tools.find(tool => tool.definition.name === input.call.name);
    const contribution = descriptor ? this.contributions.get(contributionIdentity(descriptor)) : undefined;
    if (!descriptor || descriptor.execution.kind !== "hosted" || !contribution ||
        contribution.descriptor.execution.kind !== "hosted" ||
        canonical(descriptor.source) !== canonical(contribution.descriptor.source) ||
        descriptor.execution.key !== contribution.descriptor.execution.key ||
        canonical(descriptor.definition.inputSchema) !== canonical(contribution.descriptor.definition.inputSchema)) {
      throw new Error("Frozen source is unavailable or changed.");
    }
    if (!Number.isInteger(input.call.round) || input.call.round < 1 || input.call.round > capabilities.tools.maxCalls) {
      throw new Error("Invalid call round.");
    }
    // Reuse the same validation and permission owner as native built-in tools.
    const registry = new ToolRegistry(capabilities.tools);
    registry.register({ ...contribution.implementation, definition: descriptor.definition });
    const validated = registry.validateCall(input.call);
    if (!validated.accepted) return failure(validated.code, validated.message);
    const allowed = registry.authorize(validated.call);
    if (!allowed.allowed) return failure(allowed.code, allowed.message);
    if (descriptor.definition.approvalMode === "invocation") {
      const review = (await this.reviews.list(input.runId)).find(value => value.call.toolCallId === input.call.toolCallId);
      if (!review || !["approved", "dispatching", "completed"].includes(review.status)) return failure("TOOL_EXECUTION_FAILED", "Review this exact action before execution.");
    }

    const identity = `${input.runId}:${input.call.toolCallId}`;
    const fingerprint = hash({ revision: input.catalogRevision, turnId: input.turnId, call: input.call });
    const directory = join(this.evidence.runDirectory(input.runId), "artifacts/capability-calls");
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe capability receipt directory.");
    const path = join(directory, `${createHash("sha256").update(input.call.toolCallId).digest("hex")}.json`);
    const running = this.inFlight.get(identity);
    if (running) {
      if (running.fingerprint !== fingerprint) throw new Error("Conflicting call identity.");
      return running.promise;
    }
    const operation = this.reserveAndExecute(path, fingerprint, input, registry, validated, signal, capabilities.tools.maxCalls, manifest.context.sessionId);
    this.inFlight.set(identity, { fingerprint, promise: operation });
    try { return await operation; }
    finally { this.inFlight.delete(identity); }
  }

  private async reserveAndExecute(
    path: string,
    fingerprint: string,
    input: CapabilityHostRequest,
    registry: ToolRegistry,
    validated: ValidatedCall,
    signal: AbortSignal,
    maxCalls: number,
    sessionId?: string,
  ): Promise<ToolExecutionResult> {
    const pending: PendingReceipt = { schemaVersion: 1, fingerprint, catalogRevision: input.catalogRevision, toolName: input.call.name, toolCallId: input.call.toolCallId, status: "pending" };
    try {
      await writeFile(path, `${JSON.stringify(pending)}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const receipt = await this.readReceipt(path);
      if (receipt.fingerprint !== fingerprint) throw new Error("Conflicting call identity.");
      return receipt.status === "complete" ? receipt.result : failure("TOOL_UNKNOWN", "A prior capability dispatch has no confirmed result. Inspect the receipt before recovery.", "unknown");
    }

    // Completed calls and pending reservations both consume the admitted budget.
    if ((await readdir(dirname(path))).filter(name => name.endsWith(".json")).length > maxCalls) {
      const result = failure("TOOL_CALL_LIMIT_EXCEEDED", "The admitted tool-call budget is exhausted.");
      await this.finish(path, pending, result);
      return result;
    }
    const gate = await this.reviews.locked(input.runId, async () => {
      const snapshot = await this.evidence.readSnapshot(input.runId);
      if (snapshot.result || snapshot.events.some(event => event.kind === "RunCancellationRequested")) return failure("TOOL_CANCELLED", "The run is terminal or cancellation has been requested.", "cancelled");
      if (validated.definition.approvalMode === "invocation") {
        try {
          const descriptor = snapshot.manifest.capabilities!.toolCatalog!.tools.find(tool => tool.definition.name === input.call.name)!;
          await this.reviews.claim(input.runId, input.call.toolCallId, argumentDigest(validated.call.arguments), descriptor.source.digest, input.catalogRevision);
        } catch { return failure("TOOL_EXECUTION_FAILED", "This exact invocation requires current approval before execution."); }
      }
      return null;
    });
    if (gate) { await this.finish(path, pending, gate); return gate; }
    const connectionResults: ConnectionResult[] = [];
    const result = await registry.execute(validated, {
      runId: input.runId,
      turnId: input.turnId,
      sessionId,
      signal,
      onConnectionResult: connection => { connectionResults.push(connection); },
      ...(this.sessions && sessionId ? {
        onSkillActivated: async skill => { await this.sessions!.activateSkill(sessionId, input.turnId, skill); },
      } : {}),
    });
    try {
      await this.finish(path, pending, result, connectionResults);
      if (validated.definition.approvalMode === "invocation") await this.reviews.finish(input.runId, input.call.toolCallId);
      return result;
    } catch {
      // An effect can succeed while writing its receipt fails. Keep the pending
      // reservation and expose uncertainty rather than returning a retryable error.
      return failure("TOOL_UNKNOWN", "The capability completed without a durable acknowledgement. Inspect the pending receipt before recovery.", "unknown");
    }
  }

  private async readReceipt(path: string): Promise<PendingReceipt | CompleteReceipt> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("Oversized or unsafe capability receipt.");
      const receipt: unknown = JSON.parse(await handle.readFile("utf8"));
      if (!isReceipt(receipt)) throw new Error("Invalid capability receipt.");
      return receipt;
    } finally { await handle.close(); }
  }

  private async finish(path: string, pending: PendingReceipt, result: ToolExecutionResult, connectionResults: readonly ConnectionResult[] = []): Promise<void> {
    const temporary = `${path}.pending`;
    await writeFile(temporary, `${JSON.stringify({ ...pending, status: "complete", result, ...(connectionResults.length ? { connectionResults } : {}) })}\n`);
    await rename(temporary, path);
  }
}

function redactArguments(args: Record<string, unknown>, schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const redact = (value: unknown, key: string, property?: Record<string, unknown>): unknown => {
    if (/password|secret|token|authorization|api.?key|credential/i.test(key) || property?.["x-sensitive"] === true || property?.writeOnly === true) return "[REDACTED]";
    if (Array.isArray(value)) return value.map(item => redact(item, "", property?.items as Record<string, unknown>));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, redact(item, childKey, (property?.properties as Record<string, Record<string, unknown>> | undefined)?.[childKey])]));
    return value;
  };
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, redact(value, key, properties?.[key])]));
}

function failure(code: string, message: string, status: ToolExecutionResult["status"] = "failed"): ToolExecutionResult {
  return { status, content: JSON.stringify({ error: message, code }), error: { code: status === "unknown" ? "TOOL_UNKNOWN" : status === "cancelled" ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED", message }, durationMs: 0, attemptCount: 0 };
}
function isReceipt(value: unknown): value is PendingReceipt | CompleteReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<CompleteReceipt | PendingReceipt>;
  if (receipt.schemaVersion !== 1 || typeof receipt.fingerprint !== "string" || !["pending", "complete"].includes(String(receipt.status))) return false;
  if (receipt.status === "pending") return true;
  return receipt.status === "complete" && receipt.result !== undefined && typeof receipt.result.content === "string" && ["completed", "failed", "cancelled", "timed_out", "unknown"].includes(receipt.result.status);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contributionIdentity(descriptor: HostedToolContribution["descriptor"]): string {
  return canonical({ name: descriptor.definition.name, source: descriptor.source, execution: descriptor.execution });
}
