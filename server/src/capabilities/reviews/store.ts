import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InvocationDecision, InvocationReview, InvocationReviewView } from "./contracts.js";

const safe = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export class InvocationReviewError extends Error {}

/** Durable action decisions. One run lock serializes approval, cancellation and
 * dispatch reservation in this single-host deployment. Native durability does
 * not replace this final policy check, and the lock is not a distributed lease.
 */
export class InvocationReviewStore {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly runsRoot: string, private readonly now: () => number = Date.now) {}

  async locked<T>(runId: string, action: () => Promise<T>): Promise<T> {
    assertId(runId);
    const previous = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(runId, current);
    await previous;
    try { return await action(); }
    finally { release(); if (this.locks.get(runId) === current) this.locks.delete(runId); }
  }

  async propose(input: Omit<InvocationReview, "schemaVersion" | "requestId" | "revision" | "status" | "decision" | "createdAt" | "expiresAt">, before?: () => Promise<void>): Promise<InvocationReview> {
    return this.locked(input.runId, async () => {
      await before?.();
      const records = await this.list(input.runId);
      const previous = records.find(item => item.call.toolCallId === input.call.toolCallId);
      if (previous) {
        if (previous.catalogRevision !== input.catalogRevision || previous.sourceDigest !== input.sourceDigest
          || previous.argumentDigest !== input.argumentDigest || previous.turnId !== input.turnId
          || previous.connectionIdentity !== input.connectionIdentity) throw new InvocationReviewError("Invocation identity changed. Propose a new call.");
        if (previous.status !== "expired") return previous;
      }
      const createdAt = new Date(this.now()).toISOString();
      const value: InvocationReview = { ...input, schemaVersion: 1, requestId: previous?.requestId ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1, status: "pending", decision: null, createdAt,
        ...(previous ? { renewalId: randomUUID() } : {}),
        expiresAt: new Date(this.now() + 24 * 60 * 60 * 1000).toISOString() };
      await this.write(value);
      return value;
    });
  }

  async list(runId: string): Promise<InvocationReview[]> {
    assertId(runId);
    let names: string[];
    try { names = await readdir(this.directory(runId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const records = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
      const value = JSON.parse(await readFile(join(this.directory(runId), name), "utf8")) as InvocationReview;
      if (value.schemaVersion !== 1 || value.runId !== runId || !safe.test(value.requestId)) throw new InvocationReviewError("Invalid retained invocation review.");
      return this.expire(value);
    }));
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(runId: string, requestId: string): Promise<InvocationReview> {
    assertId(requestId);
    const value = (await this.list(runId)).find(item => item.requestId === requestId);
    if (!value) throw new InvocationReviewError("Invocation review was not found.");
    return value;
  }

  /** Caller must already hold the run lock when deciding alongside run state. */
  async decide(runId: string, input: InvocationDecision): Promise<InvocationReview> {
    validateDecision(input);
    const value = await this.get(runId, input.requestId);
    if (value.argumentDigest !== input.argumentDigest || value.revision !== input.revision) throw new InvocationReviewError("Review revision or arguments changed.");
    if (value.status === "expired" || value.status === "cancelled") throw new InvocationReviewError(`Invocation review is ${value.status}.`);
    if (value.decision) {
      if (canonical(value.decision) !== canonical(input)) throw new InvocationReviewError("A conflicting decision already exists.");
      return value;
    }
    if (value.status !== "pending") throw new InvocationReviewError(`Invocation review is ${value.status}.`);
    const decided: InvocationReview = { ...value, status: input.decision, decision: input,
      expiresAt: new Date(this.now() + 15 * 60 * 1000).toISOString() };
    await this.write(decided);
    return decided;
  }

  /** Caller holds the same lock as cancellation. Reserve permission before I/O. */
  async claim(runId: string, callId: string, argumentDigest: string, sourceDigest: string, catalogRevision: string): Promise<void> {
    const value = (await this.list(runId)).find(item => item.call.toolCallId === callId);
    if (!value || value.argumentDigest !== argumentDigest || value.sourceDigest !== sourceDigest
      || value.catalogRevision !== catalogRevision || value.status !== "approved") throw new InvocationReviewError("This exact invocation has no current approval.");
    await this.write({ ...value, status: "dispatching" });
  }

  async finish(runId: string, callId: string): Promise<void> {
    await this.locked(runId, async () => {
      const value = (await this.list(runId)).find(item => item.call.toolCallId === callId);
      if (value?.status === "dispatching") await this.write({ ...value, status: "completed" });
    });
  }

  async cancel(runId: string): Promise<void> {
    await this.locked(runId, () => this.cancelLocked(runId));
  }

  async cancelLocked(runId: string): Promise<void> {
    for (const value of await this.list(runId)) {
      if (["pending", "approved", "expired"].includes(value.status)) await this.write({ ...value, status: "cancelled" });
    }
  }

  view(value: InvocationReview): InvocationReviewView {
    const { arguments: _private, ...call } = value.call;
    return { ...value, call };
  }

  private expire(value: InvocationReview): InvocationReview {
    return ["pending", "approved"].includes(value.status) && Date.parse(value.expiresAt) <= this.now()
      ? { ...value, status: "expired" } : value;
  }
  private directory(runId: string): string { return join(this.runsRoot, runId, "artifacts", "action-reviews"); }
  private async write(value: InvocationReview): Promise<void> {
    await mkdir(this.directory(value.runId), { recursive: true, mode: 0o700 });
    const path = join(this.directory(value.runId), `${digest(value.call.toolCallId)}.json`);
    const temporary = `${path}.${randomUUID()}.pending`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function argumentDigest(value: unknown): string { return digest(canonical(value)); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assertId(value: string) { if (!safe.test(value)) throw new InvocationReviewError("Invalid invocation review identity."); }
export function validateDecision(value: unknown): asserts value is InvocationDecision {
  if (!value || typeof value !== "object") throw new InvocationReviewError("A structured action decision is required.");
  const input = value as InvocationDecision;
  if (Object.keys(input).some(key => !["requestId", "revision", "argumentDigest", "decisionId", "decision", "reason"].includes(key))) throw new InvocationReviewError("Unknown action decision field.");
  if (!safe.test(input.requestId) || !safe.test(input.decisionId) || !Number.isSafeInteger(input.revision)
    || input.revision < 1 || !/^[a-f0-9]{64}$/.test(input.argumentDigest) || !["approved", "denied"].includes(input.decision)
    || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 1000))) throw new InvocationReviewError("Invalid action decision.");
}
