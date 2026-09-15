import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { VercelWorkflowInput } from "../contracts.js";

export type AdmissionState = "pending" | "accepted";

export interface AdmissionRecord {
  readonly runId: string;
  readonly requestHash: string;
  readonly state: AdmissionState;
  readonly workflowRunId: string | null;
  readonly input: VercelWorkflowInput;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AdmissionLookup =
  | { readonly kind: "new" }
  | { readonly kind: "accepted"; readonly record: AdmissionRecord }
  | { readonly kind: "pending"; readonly record: AdmissionRecord }
  | { readonly kind: "conflict" };

/**
 * A small durable admission ledger. The pending state is intentional: if the
 * process dies after Workflow accepts a run but before this file is updated,
 * a retry must surface an unknown outcome instead of creating a second run.
 */
export class AdmissionStore {
  private records = new Map<string, AdmissionRecord>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      if (Array.isArray(raw)) {
        for (const value of raw) {
          const record = parseRecord(value);
          if (record) this.records.set(record.runId, record);
        }
      }
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }

  lookup(runId: string, requestHash: string): AdmissionLookup {
    const record = this.records.get(runId);
    if (!record) return { kind: "new" };
    if (record.requestHash !== requestHash) return { kind: "conflict" };
    return record.state === "accepted" ? { kind: "accepted", record } : { kind: "pending", record };
  }

  async reserve(input: VercelWorkflowInput, requestHash: string): Promise<AdmissionLookup> {
    const existing = this.lookup(input.runId, requestHash);
    if (existing.kind !== "new") return existing;
    const now = new Date().toISOString();
    const record: AdmissionRecord = {
      runId: input.runId,
      requestHash,
      state: "pending",
      workflowRunId: null,
      input,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(input.runId, record);
    await this.persist();
    return { kind: "pending", record };
  }

  async markAccepted(runId: string, workflowRunId: string): Promise<AdmissionRecord> {
    const record = this.records.get(runId);
    if (!record) throw new Error(`Admission ${runId} does not exist.`);
    const updated: AdmissionRecord = {
      ...record,
      state: "accepted",
      workflowRunId,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(runId, updated);
    await this.persist();
    return updated;
  }

  findByWorkflowRunId(workflowRunId: string): AdmissionRecord | null {
    for (const record of this.records.values()) {
      if (record.workflowRunId === workflowRunId) return record;
    }
    return null;
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const temporaryPath = join(dirname(this.filePath), `.${process.pid}.admissions.tmp`);
      await writeFile(temporaryPath, JSON.stringify([...this.records.values()], null, 2), { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    return this.writeChain;
  }
}

function parseRecord(value: unknown): AdmissionRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AdmissionRecord>;
  if (
    typeof record.runId !== "string" ||
    typeof record.requestHash !== "string" ||
    (record.state !== "pending" && record.state !== "accepted") ||
    (record.workflowRunId !== null && typeof record.workflowRunId !== "string") ||
    !record.input ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) return null;
  return record as AdmissionRecord;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
