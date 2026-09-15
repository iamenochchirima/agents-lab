import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RunResult, RunUsage } from "../../../control-plane/domain/types.js";
import {
  loadVercelWorkflowsConfig,
  VERCEL_WORKFLOW_NAME,
  VERCEL_WORKFLOWS_PLATFORM,
  VERCEL_WORKFLOWS_VARIANT,
  type VercelWorkflowsConfig,
} from "../config.js";
import type { VercelWorkflowInput, VercelWorkflowResult } from "../variants/baseline/contracts.js";
import { AdmissionStore } from "../variants/baseline/state/admission-store.js";
import { buildVercelWorkflowBundle, type VercelWorkflowBundle } from "../variants/baseline/execution/bundle-builder.js";
import { createWorld, getRun, setWorld, start } from "../sdk.js";
import type { LocalWorld } from "../sdk.js";

const MAX_BODY_BYTES = 1_048_576;

export interface VercelWorkflowAdmissionResponse {
  readonly workflowId: string;
  readonly workflowRunId: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
  readonly status: string | null;
}

export interface VercelWorkflowPublicRunRecord {
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly workflowName: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly result: RunResult | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface VercelWorkflowServiceOptions {
  readonly config?: VercelWorkflowsConfig;
  readonly platformRoot?: string;
  readonly world?: LocalWorld;
  readonly admissionStore?: AdmissionStore;
}

/**
 * Owns the platform-local HTTP boundary and the local Workflow World.
 * Shared server registration is intentionally outside this class.
 */
export class VercelWorkflowsPlatformService {
  private readonly config: VercelWorkflowsConfig;
  private readonly platformRoot: string;
  private readonly world: LocalWorld;
  private readonly admissionStore: AdmissionStore;
  private bundle: VercelWorkflowBundle | null = null;
  private server: Server | null = null;
  private flowHandler: ((request: Request) => Promise<Response>) | null = null;

  constructor(options: VercelWorkflowServiceOptions = {}) {
    this.config = options.config ?? loadVercelWorkflowsConfig();
    this.platformRoot = options.platformRoot ?? sourcePlatformRoot();
    const dataDir = isAbsolute(this.config.dataDir) ? this.config.dataDir : resolve(this.platformRoot, this.config.dataDir);
    this.world = options.world ?? createWorld({
      dataDir,
      baseUrl: this.config.serviceUrl,
      port: this.config.port,
      recoverActiveRuns: true,
    });
    this.admissionStore = options.admissionStore ?? new AdmissionStore(join(dataDir, "agentlab-admissions.json"));
  }

  get address(): string {
    return this.config.serviceUrl;
  }

  get workflowId(): string {
    if (!this.bundle) throw new Error("Vercel Workflow service has not been initialized.");
    return this.bundle.workflowId;
  }

  async start(): Promise<void> {
    if (this.server) return;
    await this.admissionStore.load();
    await mkdir(this.platformRoot, { recursive: true });
    this.bundle = await buildVercelWorkflowBundle(this.platformRoot);
    const flowModule = await import(`${pathToFileURL(this.bundle.flowPath).href}?build=${Date.now()}`) as Record<string, unknown>;
    const handler = flowModule.POST;
    if (typeof handler !== "function") throw new Error("The Vercel Workflow build did not export a POST flow handler.");
    this.flowHandler = handler as (request: Request) => Promise<Response>;
    setWorld(this.world);

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    const server = this.server;
    await listen(server, this.config.host, this.config.port);
    try {
      // Recovery must run after the HTTP boundary is listening because the
      // local World re-enqueues persisted active runs through baseUrl.
      await this.world.start?.();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.flowHandler = null;
    if (server) {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise());
      });
    }
    await this.world.close?.();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", this.address);
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready")) {
        this.writeJson(response, 200, {
          status: "ready",
          platform: VERCEL_WORKFLOWS_PLATFORM,
          variant: VERCEL_WORKFLOWS_VARIANT,
          sdk: "workflow",
          workflowId: this.workflowId,
          world: "local",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs/admit") {
        await this.admit(request, response);
        return;
      }
      const runMatch = /^\/runs\/([^/]+)$/.exec(url.pathname);
      if (runMatch && request.method === "GET") {
        await this.inspect(decodeURIComponent(runMatch[1]), response);
        return;
      }
      if (runMatch && request.method === "POST" && url.searchParams.has("cancel")) {
        await this.cancel(decodeURIComponent(runMatch[1]), request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/.well-known/workflow/v1/flow") {
        await this.forwardFlow(request, response);
        return;
      }
      this.writeJson(response, 404, { error: "NOT_FOUND", message: "Vercel Workflow service route was not found." });
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : 500;
      this.writeJson(response, status, {
        error: status === 400 ? "INVALID_REQUEST" : "VERCEL_WORKFLOW_SERVICE_ERROR",
        message: safeErrorMessage(error),
      });
    }
  }

  private async admit(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = parseInput(await readJson(request));
    const requestHash = hashInput(input);
    const lookup = this.admissionStore.lookup(input.runId, requestHash);
    if (lookup.kind === "conflict") {
      this.writeJson(response, 409, { error: "RUN_ID_CONFLICT", message: "The run ID belongs to a different request." });
      return;
    }
    if (lookup.kind === "accepted") {
      this.writeJson(response, 202, {
        workflowId: this.workflowId,
        workflowRunId: lookup.record.workflowRunId,
        submissionOutcome: "already_accepted",
        acknowledgement: "confirmed",
        status: "accepted",
      } satisfies VercelWorkflowAdmissionResponse);
      return;
    }
    if (lookup.kind === "pending") {
      this.writeJson(response, 202, {
        workflowId: this.workflowId,
        workflowRunId: null,
        submissionOutcome: "unknown",
        acknowledgement: "unknown",
        status: "pending_admission_reconciliation",
      } satisfies VercelWorkflowAdmissionResponse);
      return;
    }

    const reserved = await this.admissionStore.reserve(input, requestHash);
    if (reserved.kind !== "pending") throw new Error("The admission reservation changed unexpectedly.");
    try {
      const run = await start({ workflowId: this.workflowId }, [input], { world: this.world });
      await this.admissionStore.markAccepted(input.runId, run.runId);
      const status = await run.status;
      this.writeJson(response, 202, {
        workflowId: this.workflowId,
        workflowRunId: run.runId,
        submissionOutcome: "accepted",
        acknowledgement: "confirmed",
        status,
      } satisfies VercelWorkflowAdmissionResponse);
    } catch (error) {
      // The durable reservation remains pending. The caller must not retry as
      // a new run because Workflow may have accepted the request already.
      this.writeJson(response, 503, {
        workflowId: this.workflowId,
        workflowRunId: null,
        submissionOutcome: "unknown",
        acknowledgement: "unknown",
        status: null,
        error: "WORKFLOW_ADMISSION_UNKNOWN",
        message: safeErrorMessage(error),
      });
    }
  }

  private async inspect(workflowRunId: string, response: ServerResponse): Promise<void> {
    const run = getRun(workflowRunId);
    if (!(await run.exists)) {
      this.writeJson(response, 404, { error: "WORKFLOW_RUN_NOT_FOUND", message: "The Workflow run was not found." });
      return;
    }
    const status = await run.status;
    const createdAt = await run.createdAt;
    const startedAt = await run.startedAt;
    const completedAt = await run.completedAt;
    const record = this.admissionStore.findByWorkflowRunId(workflowRunId);
    let result: RunResult | null = null;
    let error: { readonly code: string; readonly message: string } | null = null;
    if (status === "completed") {
      result = await run.returnValue as VercelWorkflowResult;
    } else if (status === "failed") {
      result = failedResult(record?.runId ?? workflowRunId, startedAt, completedAt ?? new Date());
      error = { code: "WORKFLOW_RUN_FAILED", message: "The Workflow run failed." };
    } else if (status === "cancelled") {
      result = cancelledResult(record?.runId ?? workflowRunId, startedAt, completedAt ?? new Date());
      error = { code: "WORKFLOW_RUN_CANCELLED", message: "The Workflow run was cancelled." };
    }
    this.writeJson(response, 200, {
      workflowId: this.workflowId,
      workflowRunId,
      workflowName: await run.workflowName,
      status,
      createdAt: createdAt.toISOString(),
      startedAt: startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      result,
      error,
    } satisfies VercelWorkflowPublicRunRecord);
  }

  private async cancel(workflowRunId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const run = getRun(workflowRunId);
    if (!(await run.exists)) {
      this.writeJson(response, 404, { error: "WORKFLOW_RUN_NOT_FOUND", message: "The Workflow run was not found." });
      return;
    }
    const status = await run.status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      this.writeJson(response, 200, { accepted: false, alreadyTerminal: true, status, message: `Workflow run is already ${status}.` });
      return;
    }
    const body = await readJson(request).catch(() => ({}));
    const reason = typeof (body as Record<string, unknown>).reason === "string" ? (body as Record<string, string>).reason.slice(0, 512) : "Cancelled by Agent Harness Lab.";
    await run.cancel({ cancelReason: reason });
    this.writeJson(response, 202, { accepted: true, alreadyTerminal: false, status: "cancelled", message: "Workflow cancellation accepted." });
  }

  private async forwardFlow(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.flowHandler) throw new Error("The Vercel Workflow flow handler is not ready.");
    const body = await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(","));
    }
    const flowRequest = new Request(`${this.address}${request.url ?? "/"}`, {
      method: request.method,
      headers,
      body: body as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    await writeResponse(response, await this.flowHandler(flowRequest));
  }

  private writeJson(response: ServerResponse, status: number, body: unknown): void {
    const encoded = JSON.stringify(body);
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(encoded) });
    response.end(encoded);
  }
}

function parseInput(value: unknown): VercelWorkflowInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const model = record.model && typeof record.model === "object" && !Array.isArray(record.model) ? record.model as Record<string, unknown> : {};
  if (
    typeof record.runId !== "string" || !record.runId.trim() ||
    typeof record.prompt !== "string" || !record.prompt.trim() ||
    typeof record.systemInstruction !== "string" ||
    (model.provider !== "fake" && model.provider !== "openrouter") ||
    typeof model.model !== "string" || !model.model.trim() ||
    typeof record.modelTimeoutMs !== "number" || !Number.isSafeInteger(record.modelTimeoutMs) || record.modelTimeoutMs < 1
  ) throw new RequestBodyError(400, "The Workflow admission body is invalid.");
  return {
    runId: record.runId,
    prompt: record.prompt,
    systemInstruction: record.systemInstruction,
    model: { provider: model.provider, model: model.model },
    modelTimeoutMs: record.modelTimeoutMs,
  };
}

function hashInput(input: VercelWorkflowInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function failedResult(runId: string, startedAt: Date | undefined, completedAt: Date): RunResult {
  return {
    schemaVersion: 1,
    runId,
    status: "failed",
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: completedAt.toISOString(),
    output: null,
    error: { code: "WORKFLOW_RUN_FAILED", message: "The Workflow run failed.", failureKind: "internal", retryable: false },
    attemptCount: 0,
    usage: emptyUsage(),
  };
}

function cancelledResult(runId: string, startedAt: Date | undefined, completedAt: Date): RunResult {
  return {
    ...failedResult(runId, startedAt, completedAt),
    status: "cancelled",
    error: { code: "WORKFLOW_RUN_CANCELLED", message: "The Workflow run was cancelled.", failureKind: "cancelled", retryable: false },
  };
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

async function listen(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error): void => { server.off("listening", onListening); reject(error); };
    const onListening = (): void => { server.off("error", onError); resolvePromise(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  if (!body.length) throw new RequestBodyError(400, "A JSON request body is required.");
  try { return JSON.parse(body.toString("utf8")) as unknown; }
  catch { throw new RequestBodyError(400, "The request body must be valid JSON."); }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new RequestBodyError(413, "The request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(response: ServerResponse, source: Response): Promise<void> {
  const body = Buffer.from(await source.arrayBuffer());
  const headers: Record<string, string> = {};
  source.headers.forEach((value, name) => { headers[name] = value; });
  response.writeHead(source.status, headers);
  response.end(body);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof RequestBodyError) return error.message;
  return error instanceof Error ? error.message : "The Vercel Workflow service failed.";
}

function sourcePlatformRoot(): string {
  const compiledOrSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return compiledOrSourceRoot.replace(/\/dist\/src(?=\/|$)/, "/src");
}

class RequestBodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}
