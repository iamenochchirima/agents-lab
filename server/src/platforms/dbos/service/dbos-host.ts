import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import type { RunError } from "../../../control-plane/domain/types.js";
import { DBOS_SDK_VERSION, DBOS_WORKFLOW_NAME, type DbosConfig, safeDatabaseProfile } from "../config.js";
import { loadDbosSdk } from "../sdk.js";
import { type DbosWorkflowInput, type DbosWorkflowResult } from "../variants/baseline/contracts.js";
import { dbosBaselineWorkflow } from "../variants/baseline/workflow.js";

const dbos = loadDbosSdk();
const MAX_BODY_BYTES = 1_048_576;

export interface DbosStartRequest {
  readonly input: DbosWorkflowInput;
  readonly workflowId: string;
}

export interface DbosStartResponse {
  readonly workflowId: string;
  readonly submissionOutcome: "accepted" | "already_exists";
  readonly status: string | null;
  readonly workflowName: string;
}

export interface DbosWorkflowInspection {
  readonly workflowId: string;
  readonly status: string;
  readonly updatedAt: number | null;
  readonly result: DbosWorkflowResult | null;
  readonly input: DbosWorkflowInput | null;
  readonly steps: readonly DbosStepSummary[];
  readonly error: { readonly name: string; readonly message: string } | null;
}

export interface DbosStepSummary {
  readonly functionId: number;
  readonly name: string;
  readonly completed: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorName: string | null;
}

export interface DbosBaselineHostOptions {
  readonly config: DbosConfig;
  readonly dbosModule?: typeof dbos;
}

/**
 * Owns the DBOS process boundary. PostgreSQL is DBOS's system database; the
 * Lab's filesystem evidence is deliberately outside this host.
 */
export class DbosBaselineHost {
  private readonly dbosModule: typeof dbos;
  private server: Server | null = null;

  constructor(private readonly options: DbosBaselineHostOptions) {
    this.dbosModule = options.dbosModule ?? dbos;
  }

  get address(): string {
    return `http://${this.options.config.host}:${this.options.config.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;

    if (!this.dbosModule.DBOS.isInitialized()) {
      this.dbosModule.DBOS.setConfig({
        name: this.options.config.applicationName,
        applicationVersion: this.options.config.applicationVersion,
        systemDatabaseUrl: this.options.config.systemDatabaseUrl,
        systemDatabaseSchemaName: this.options.config.systemDatabaseSchema,
        runMigrations: true,
        logLevel: "error",
      });
      await this.dbosModule.DBOS.launch();
    }

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error("DBOS HTTP server was not created."));
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.config.port, this.options.config.host);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (this.dbosModule.DBOS.isInitialized()) {
      await this.dbosModule.DBOS.shutdown({ workflowCompletionTimeoutMS: 0 });
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", this.address);
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready")) {
        this.writeJson(response, 200, {
          status: "ready",
          dbos: {
            initialized: this.dbosModule.DBOS.isInitialized(),
            sdk: "@dbos-inc/dbos-sdk",
            sdkVersion: DBOS_SDK_VERSION,
            workflowName: DBOS_WORKFLOW_NAME,
            applicationName: this.options.config.applicationName,
            database: safeDatabaseProfile(this.options.config),
          },
        });
        return;
      }

      const workflowMatch = /^\/workflows\/([^/]+)$/.exec(url.pathname);
      if (request.method === "POST" && url.pathname === "/workflows") {
        await this.startWorkflow(request, response);
        return;
      }
      if (workflowMatch && request.method === "GET") {
        await this.inspectWorkflow(decodeURIComponent(workflowMatch[1]), response);
        return;
      }
      if (workflowMatch && request.method === "POST" && url.searchParams.has("cancel")) {
        await this.cancelWorkflow(decodeURIComponent(workflowMatch[1]), response);
        return;
      }

      this.writeJson(response, 404, { error: "NOT_FOUND", message: "DBOS host route was not found." });
    } catch (error) {
      this.writeJson(response, 500, { error: "DBOS_HOST_ERROR", message: safeErrorMessage(error) });
    }
  }

  private async startWorkflow(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request);
    const parsed = parseStartRequest(body);
    let submissionOutcome: DbosStartResponse["submissionOutcome"] = "accepted";
  let handle: {
    readonly workflowID: string;
    getStatus(): Promise<{ readonly status?: string; readonly workflowName?: string } | null>;
  };

    try {
      handle = await this.dbosModule.DBOS.startWorkflow(dbosBaselineWorkflow, {
        workflowID: parsed.workflowId,
        timeoutMS: this.options.config.workflowTimeoutMs,
        workflowAttributes: {
          agentLabRunId: parsed.input.runId,
          requestHash: parsed.input.requestHash,
        },
      })(parsed.input);
    } catch (error) {
      if (!isWorkflowConflict(error)) throw error;
      const existing = await this.existingWorkflow(parsed.workflowId, parsed.input.requestHash);
      if (!existing) {
        this.writeJson(response, 409, {
          error: "WORKFLOW_ID_CONFLICT",
          message: "The workflow ID is already owned by a different request.",
        });
        return;
      }
      submissionOutcome = "already_exists";
      handle = this.dbosModule.DBOS.retrieveWorkflow(parsed.workflowId);
    }

    const status = await handle.getStatus();
    this.writeJson(response, 202, {
      workflowId: handle.workflowID,
      submissionOutcome,
      status: status?.status ?? null,
      workflowName: status?.workflowName ?? DBOS_WORKFLOW_NAME,
    } satisfies DbosStartResponse);
  }

  private async inspectWorkflow(workflowId: string, response: ServerResponse): Promise<void> {
    const status = await this.dbosModule.DBOS.getWorkflowStatus(workflowId);
    if (!status) {
      this.writeJson(response, 404, { error: "WORKFLOW_NOT_FOUND", message: "The DBOS workflow was not found." });
      return;
    }

    const handle = this.dbosModule.DBOS.retrieveWorkflow<DbosWorkflowResult>(workflowId);
    const input = await safeWorkflowInput(handle);
    let result: DbosWorkflowResult | null = null;
    if (status.status === "SUCCESS") {
      result = await this.dbosModule.DBOS.getResult<DbosWorkflowResult>(workflowId, { timeoutSeconds: 1 });
    } else if (status.status === "ERROR" || status.status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
      result = failedResult(status.status, input, status.updatedAt ?? status.completedAt ?? Date.now(), status.error);
    } else if (status.status === "CANCELLED") {
      result = cancelledResult(input, status.updatedAt ?? status.completedAt ?? Date.now());
    }

    const steps = await this.dbosModule.DBOS.listWorkflowSteps(workflowId);
    const inspection: DbosWorkflowInspection = {
      workflowId,
      status: status.status,
      updatedAt: status.updatedAt ?? null,
      result,
      input,
      steps: (steps ?? []).map(toStepSummary),
      error: safeError(status.error),
    };
    this.writeJson(response, 200, inspection);
  }

  private async cancelWorkflow(workflowId: string, response: ServerResponse): Promise<void> {
    const status = await this.dbosModule.DBOS.getWorkflowStatus(workflowId);
    if (!status) {
      this.writeJson(response, 404, { error: "WORKFLOW_NOT_FOUND", message: "The DBOS workflow was not found." });
      return;
    }
    if (isTerminalDbosStatus(status.status)) {
      this.writeJson(response, 200, { accepted: false, alreadyTerminal: true, status: status.status });
      return;
    }
    await this.dbosModule.DBOS.cancelWorkflow(workflowId);
    this.writeJson(response, 202, { accepted: true, alreadyTerminal: false, status: "CANCELLED" });
  }

  private async existingWorkflow(workflowId: string, requestHash: string): Promise<boolean> {
    const status = await this.dbosModule.DBOS.getWorkflowStatus(workflowId);
    return status?.attributes?.requestHash === requestHash;
  }

  private writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }
}

function parseStartRequest(value: unknown): DbosStartRequest {
  if (!isRecord(value) || !isRecord(value.input) || typeof value.workflowId !== "string") {
    throw new Error("DBOS start request must contain workflowId and input.");
  }
  const input = value.input;
  if (
    typeof input.runId !== "string" ||
    typeof input.prompt !== "string" ||
    typeof input.systemInstruction !== "string" ||
    typeof input.requestHash !== "string" ||
    typeof input.startedAt !== "string" ||
    !isRecord(input.model) ||
    (input.model.provider !== "fake" && input.model.provider !== "openrouter") ||
    typeof input.model.model !== "string" ||
    typeof input.modelStepTimeoutMs !== "number" ||
    typeof input.modelStepMaxAttempts !== "number"
  ) {
    throw new Error("DBOS start request input is invalid.");
  }
  return { workflowId: value.workflowId, input: input as unknown as DbosWorkflowInput };
}

async function safeWorkflowInput(handle: { getWorkflowInputs<T extends unknown[]>(): Promise<T> }): Promise<DbosWorkflowInput | null> {
  try {
    const inputs = await handle.getWorkflowInputs<[DbosWorkflowInput]>();
    return inputs[0] ?? null;
  } catch {
    return null;
  }
}

function failedResult(status: string, input: DbosWorkflowInput | null, completedAt: number, nativeError: unknown): DbosWorkflowResult {
  const finishedAt = new Date(completedAt).toISOString();
  const runId = input?.runId ?? "unknown";
  const error: RunError = {
    code: status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED" ? "DBOS_MAX_RECOVERY_ATTEMPTS" : "DBOS_WORKFLOW_ERROR",
    message: safeErrorMessage(nativeError) || "The DBOS workflow failed.",
    failureKind: "internal",
    retryable: false,
  };
  return syntheticResult(runId, "failed", input?.startedAt ?? null, finishedAt, error, 0);
}

function cancelledResult(input: DbosWorkflowInput | null, completedAt: number): DbosWorkflowResult {
  const finishedAt = new Date(completedAt).toISOString();
  const error: RunError = {
    code: "DBOS_WORKFLOW_CANCELLED",
    message: "The DBOS workflow was cancelled at a durable operation boundary.",
    failureKind: "cancelled",
    retryable: false,
  };
  return syntheticResult(input?.runId ?? "unknown", "cancelled", input?.startedAt ?? null, finishedAt, error, 0);
}

function syntheticResult(
  runId: string,
  status: "failed" | "cancelled",
  startedAt: string | null,
  finishedAt: string,
  error: RunError,
  attemptCount: number,
): DbosWorkflowResult {
  const eventIntents: DbosWorkflowResult["eventIntents"] = [
    {
      source: "dbos-host",
      sourceSequence: 1,
      kind: status === "cancelled" ? "RunCancelled" : "RunFailed",
      runId,
      occurredAt: finishedAt,
      payload: { code: error.code, failureKind: error.failureKind },
    },
  ];
  const durationMs = startedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null;
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt,
    finishedAt,
    output: null,
    error,
    attemptCount,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    eventIntents,
    trajectory: { schemaVersion: 1, runId, phases: [] },
    metrics: {
      schemaVersion: 1,
      runId,
      status,
      durationMs,
      modelCallCount: 0,
      modelAttemptCount: attemptCount,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    },
  };
}

function toStepSummary(step: {
  readonly functionID: number;
  readonly name: string;
  readonly error: Error | null;
  readonly startedAtEpochMs?: number;
  readonly completedAtEpochMs?: number;
}): DbosStepSummary {
  return {
    functionId: step.functionID,
    name: step.name,
    completed: step.completedAtEpochMs !== undefined,
    startedAt: step.startedAtEpochMs === undefined ? null : new Date(step.startedAtEpochMs).toISOString(),
    completedAt: step.completedAtEpochMs === undefined ? null : new Date(step.completedAtEpochMs).toISOString(),
    errorName: step.error?.name ?? null,
  };
}

function isTerminalDbosStatus(status: string): boolean {
  return status === "SUCCESS" || status === "ERROR" || status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED" || status === "CANCELLED";
}

function isWorkflowConflict(error: unknown): boolean {
  return error instanceof Error && (error.name === "DBOSWorkflowConflictError" || error.message.includes("Conflicting WF ID"));
}

function safeError(error: unknown): { readonly name: string; readonly message: string } | null {
  if (error === undefined || error === null) return null;
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "DBOSWorkflowError", message: "The DBOS workflow returned a non-Error failure." };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The DBOS host request failed.";
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("DBOS request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
