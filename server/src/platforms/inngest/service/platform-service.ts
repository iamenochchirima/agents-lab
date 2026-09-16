import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { Inngest } from "inngest";
import { serve } from "inngest/node";

import type { RunError, RunUsage } from "../../../control-plane/domain/types.js";
import {
  INNGEST_CANCEL_EVENT_NAME,
  INNGEST_DEFAULT_FUNCTION_TIMEOUT_MS,
  INNGEST_EVENT_NAME,
  INNGEST_FUNCTION_ID,
  loadInngestConfig,
  type InngestConfig,
} from "../config.js";
import {
  InngestPreDispatchRetryError,
  completeFakeModel,
} from "../variants/baseline/models/fake.js";
import { completeOpenRouterModel } from "../variants/baseline/models/openrouter.js";
import type {
  InngestModelResult,
  InngestPublicRunRecord,
  InngestRunInput,
  InngestServiceHealth,
} from "../variants/baseline/contracts.js";
import { InngestRunConflictError, InngestRunNotFoundError, InngestRunStore } from "../variants/baseline/store.js";

const APP_ID = "agent-harness-lab-inngest";
const CANCELLED_SYSTEM_EVENT = "inngest/function.cancelled";
const MAX_BODY_BYTES = 1_000_000;

type EventSender = (payload: {
  readonly id: string;
  readonly name: string;
  readonly data: Record<string, unknown>;
}) => Promise<{ readonly ids: readonly string[] }>;

export interface InngestPlatformServiceOptions {
  readonly config?: InngestConfig;
  readonly store?: InngestRunStore;
  readonly fetchImplementation?: typeof fetch;
  readonly eventSender?: EventSender;
  readonly now?: () => Date;
}

export interface InngestDispatchResponse {
  readonly runId: string;
  readonly eventId: string | null;
  readonly deduplicationId: string;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly dispatchErrorCode: string | null;
  readonly acknowledgement: "confirmed" | "unknown";
}

export interface InngestCancellationResponse {
  readonly accepted: boolean;
  readonly alreadyTerminal: boolean;
  readonly acknowledgement: "confirmed" | "unknown";
  readonly message: string;
}

/**
 * Owns the Inngest client, function definitions, and the small HTTP boundary
 * used by the Lab runner. The common server never imports the SDK directly.
 */
export class InngestPlatformService {
  readonly config: InngestConfig;
  readonly store: InngestRunStore;
  readonly client: Inngest;
  readonly functions: readonly unknown[];

  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly sendEvent: EventSender;
  private readonly inngestHandler: ReturnType<typeof serve>;

  constructor(options: InngestPlatformServiceOptions = {}) {
    this.config = options.config ?? loadInngestConfig();
    this.store = options.store ?? new InngestRunStore(this.config.dataDirectory, options.now);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.client = new Inngest({
      id: APP_ID,
      appVersion: "inngest-baseline-1",
      baseUrl: this.config.devServerUrl,
      eventKey: "agentlab-dev-event-key",
      isDev: true,
    });
    this.sendEvent = options.eventSender ?? (async (payload) => {
      const response = await this.client.send(payload);
      return { ids: response.ids };
    });
    const runFunction = this.createRunFunction();
    const cancellationFunction = this.createCancellationFunction();
    this.functions = [runFunction, cancellationFunction];
    this.inngestHandler = serve({ client: this.client, functions: this.functions as never[] });
  }

  async initialize(): Promise<void> {
    await this.store.load();
  }

  createHttpServer(): Server {
    return createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  async health(): Promise<InngestServiceHealth> {
    const devServer = await this.probeDevServer();
    return {
      status: devServer.reachable ? "ready" : "degraded",
      service: { reachable: true },
      devServer,
      functionEndpoint: `${this.config.serviceUrl}/api/inngest`,
    };
  }

  async admit(input: InngestRunInput): Promise<InngestPublicRunRecord> {
    validateRunInput(input);
    return this.store.toPublic(await this.store.admit(input));
  }

  async dispatch(input: InngestRunInput): Promise<InngestDispatchResponse> {
    validateRunInput(input);
    const admitted = await this.store.admit(input);
    if (admitted.eventId) {
      return {
        runId: input.runId,
        eventId: admitted.eventId,
        deduplicationId: admitted.deduplicationId,
        submissionOutcome: admitted.submissionOutcome === "already_accepted" || admitted.submissionOutcome === "accepted"
          ? admitted.submissionOutcome
          : "already_accepted",
        dispatchErrorCode: null,
        acknowledgement: "confirmed",
      };
    }

    const wasUnknown = admitted.submissionOutcome === "unknown";
    try {
      const response = await this.sendEvent({
        id: admitted.deduplicationId,
        name: INNGEST_EVENT_NAME,
        data: {
          runId: input.runId,
          prompt: input.prompt,
          systemInstruction: input.systemInstruction,
          provider: input.provider,
          model: input.model,
        },
      });
      const eventId = response.ids[0] ?? null;
      if (!eventId) {
        await this.store.markDispatched(input.runId, {
          eventId: null,
          outcome: "unknown",
          errorCode: "INNGEST_EVENT_ID_MISSING",
        });
        return {
          runId: input.runId,
          eventId: null,
          deduplicationId: admitted.deduplicationId,
          submissionOutcome: "unknown",
          dispatchErrorCode: "INNGEST_EVENT_ID_MISSING",
          acknowledgement: "unknown",
        };
      }
      await this.store.markDispatched(input.runId, {
        eventId,
        outcome: wasUnknown ? "already_accepted" : "accepted",
        errorCode: null,
      });
      return {
        runId: input.runId,
        eventId,
        deduplicationId: admitted.deduplicationId,
        submissionOutcome: wasUnknown ? "already_accepted" : "accepted",
        dispatchErrorCode: null,
        acknowledgement: "confirmed",
      };
    } catch {
      await this.store.markDispatched(input.runId, {
        eventId: null,
        outcome: "unknown",
        errorCode: "INNGEST_EVENT_SUBMISSION_UNKNOWN",
      });
      return {
        runId: input.runId,
        eventId: null,
        deduplicationId: admitted.deduplicationId,
        submissionOutcome: "unknown",
        dispatchErrorCode: "INNGEST_EVENT_SUBMISSION_UNKNOWN",
        acknowledgement: "unknown",
      };
    }
  }

  async cancel(runId: string, reason: string): Promise<InngestCancellationResponse> {
    const record = await this.store.get(runId);
    if (!record) throw new InngestRunNotFoundError(runId);
    if (record.result) {
      return {
        accepted: false,
        alreadyTerminal: true,
        acknowledgement: "confirmed",
        message: `Inngest run is already ${record.result.status}.`,
      };
    }

    const cancelEventId = record.cancelEventId ?? `agentlab:cancel:${runId}`;
    await this.store.requestCancellation(runId, cancelEventId);
    try {
      await this.sendEvent({
        id: cancelEventId,
        name: INNGEST_CANCEL_EVENT_NAME,
        data: { runId, reason: reason.slice(0, 500) },
      });
      return {
        accepted: true,
        alreadyTerminal: false,
        acknowledgement: "confirmed",
        message: "Inngest accepted the cancellation event; terminal state is asynchronous.",
      };
    } catch {
      return {
        accepted: true,
        alreadyTerminal: false,
        acknowledgement: "unknown",
        message: "Cancellation was recorded locally, but acknowledgement from Inngest was lost.",
      };
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", this.config.serviceUrl);
      if (url.pathname === "/api/inngest") {
        this.inngestHandler(request, response);
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        const health = await this.health();
        writeJson(response, health.status === "ready" ? 200 : 503, health);
        return;
      }
      if (method === "GET" && url.pathname === "/ready") {
        writeJson(response, 200, { status: "ready" });
        return;
      }
      if (method === "GET" && url.pathname.startsWith("/runs/")) {
        const runId = decodeRunId(url.pathname.slice("/runs/".length));
        const record = await this.store.get(runId);
        if (!record) {
          writeJson(response, 404, { error: "RUN_NOT_FOUND" });
          return;
        }
        writeJson(response, 200, this.store.toPublic(record));
        return;
      }
      if (method === "POST" && url.pathname === "/runs/admit") {
        const input = parseRunInput(await readJsonBody(request));
        writeJson(response, 200, await this.admit(input));
        return;
      }
      const dispatchMatch = url.pathname.match(/^\/runs\/([^/]+)\/dispatch$/);
      if (method === "POST" && dispatchMatch) {
        const input = parseRunInput(await readJsonBody(request));
        const runId = decodeRunId(dispatchMatch[1]);
        if (input.runId !== runId) throw new HttpError(400, "RUN_ID_MISMATCH", "The path and request run IDs differ.");
        const dispatch = await this.dispatch(input);
        writeJson(response, dispatch.acknowledgement === "confirmed" ? 202 : 202, dispatch);
        return;
      }
      const cancelMatch = url.pathname.match(/^\/runs\/([^/]+)\/cancel$/);
      if (method === "POST" && cancelMatch) {
        const runId = decodeRunId(cancelMatch[1]);
        const body = await readJsonBody(request);
        const reason = typeof body === "object" && body !== null && typeof (body as { reason?: unknown }).reason === "string"
          ? (body as { reason: string }).reason
          : "Cancellation requested by the Lab.";
        writeJson(response, 202, await this.cancel(runId, reason));
        return;
      }
      writeJson(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof InngestRunNotFoundError ? 404 : error instanceof InngestRunConflictError ? 409 : 400;
      writeJson(response, status, {
        error: error instanceof HttpError ? error.code : error instanceof Error ? error.name : "REQUEST_FAILED",
        message: error instanceof Error ? error.message : "Request failed.",
      });
    }
  }

  private createRunFunction() {
    return this.client.createFunction(
      {
        id: INNGEST_FUNCTION_ID,
        name: "Agent Lab baseline run",
        triggers: { event: INNGEST_EVENT_NAME },
        retries: this.config.functionRetries as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20,
        timeouts: { finish: `${Math.ceil(this.config.functionTimeoutMs / 1_000)}s` },
        cancelOn: [{ event: INNGEST_CANCEL_EVENT_NAME, if: "async.data.runId == event.data.runId" }],
        onFailure: async ({ event, error, step }) => {
          const input = parseRunInput(event.data);
          await step.run(`record-failure-after-retries-${input.runId}`, async () => {
            const failure: RunError = {
              code: "INNGEST_RETRIES_EXHAUSTED",
              message: error.message,
              failureKind: "provider",
              retryable: false,
            };
            await this.store.finish(input.runId, "failed", {
              output: null,
              error: failure,
              attemptCount: this.config.functionRetries + 1,
              usage: emptyUsage(),
              terminalCode: failure.code,
            });
            return null;
          });
        },
      },
      async ({ event, step, runId, attempt }) => {
        const input = parseRunInput(event.data);
        await step.run(`record-start-${input.runId}-${runId}`, async () => {
          await this.store.markStarted(input.runId, runId, attempt);
          return null;
        });

        const cancellationRequested = await step.run(`check-cancellation-${input.runId}`, async () => {
          return (await this.store.get(input.runId))?.cancellationRequested ?? false;
        });
        if (cancellationRequested) {
          await step.run(`record-cancelled-before-start-${input.runId}`, async () => {
            await this.store.finish(input.runId, "cancelled", {
              output: null,
              error: {
                code: "INNGEST_CANCELLED_BEFORE_START",
                message: "Cancellation was requested before the function reached its first model step.",
                failureKind: "cancelled",
                retryable: false,
              },
              attemptCount: (await this.store.get(input.runId))?.attemptCount ?? 0,
              usage: emptyUsage(),
              terminalCode: "INNGEST_CANCELLED_BEFORE_START",
            });
            return null;
          });
          return { status: "cancelled", output: null };
        }

        if (input.model === "fake-wait") {
          await step.sleep(`wait-before-model-${input.runId}`, "10s");
        }

        const modelResult = await step.run(`model-request-${input.runId}`, async () => {
          await this.store.markModelRequested(input.runId, attempt);
          try {
            return await this.completeModel({ ...input, attempt });
          } catch (error) {
            if (error instanceof InngestPreDispatchRetryError) throw error;
            return {
              kind: "failure",
              code: "MODEL_EXECUTION_UNKNOWN",
              message: "The model step failed without a confirmed provider outcome.",
              failureKind: "outcome_unknown",
              retryable: false,
              requestSent: true,
            } satisfies InngestModelResult;
          }
        });

        if (modelResult.kind === "success") {
          await step.run(`record-model-completed-${input.runId}-${attempt}`, async () => {
            await this.store.markModelCompleted(input.runId, attempt, modelResult.providerRequestId);
            return null;
          });
          await step.run(`record-completed-${input.runId}`, async () => {
            await this.store.finish(input.runId, "completed", {
              output: modelResult.output,
              error: null,
              attemptCount: attempt + 1,
              usage: modelResult.usage,
            });
            return null;
          });
          return { status: "completed", output: modelResult.output };
        }

        await step.run(`record-model-failed-${input.runId}-${attempt}`, async () => {
          await this.store.markModelFailed(input.runId, attempt, modelResult);
          return null;
        });
        await step.run(`record-failed-${input.runId}`, async () => {
          await this.store.finish(input.runId, "failed", {
            output: null,
            error: toRunError(modelResult),
            attemptCount: attempt + 1,
            usage: emptyUsage(),
            terminalCode: modelResult.code,
          });
          return null;
        });
        return { status: "failed", code: modelResult.code };
      },
    );
  }

  private createCancellationFunction() {
    return this.client.createFunction(
      {
        id: `${INNGEST_FUNCTION_ID}-cancelled`,
        name: "Agent Lab cancellation projection",
        triggers: { event: CANCELLED_SYSTEM_EVENT },
        retries: 1,
      },
      async ({ event, step }) => {
        const runId = readCancelledRunId(event.data);
        if (!runId) return { status: "ignored" };
        await step.run(`record-cancelled-${runId}`, async () => {
          await this.store.finish(runId, "cancelled", {
            output: null,
            error: {
              code: "INNGEST_FUNCTION_CANCELLED",
              message: "Inngest cancelled the function run before the next step boundary.",
              failureKind: "cancelled",
              retryable: false,
            },
            attemptCount: (await this.store.get(runId))?.attemptCount ?? 0,
            usage: emptyUsage(),
            terminalCode: "INNGEST_FUNCTION_CANCELLED",
          });
          return null;
        });
        return { status: "cancelled", runId };
      },
    );
  }

  private async completeModel(input: InngestRunInput & { readonly attempt: number }): Promise<InngestModelResult> {
    if (input.provider === "fake") return completeFakeModel(input);
    if (!this.config.openRouterApiKey) {
      return {
        kind: "failure",
        code: "OPENROUTER_API_KEY_MISSING",
        message: "OPENROUTER_API_KEY is required by the Inngest service for OpenRouter runs.",
        failureKind: "configuration",
        retryable: false,
        requestSent: false,
      };
    }
    return completeOpenRouterModel(input, {
      apiKey: this.config.openRouterApiKey,
      baseUrl: this.config.openRouterBaseUrl,
      fetchImplementation: this.fetchImplementation,
    });
  }

  private async probeDevServer(): Promise<{ readonly reachable: boolean; readonly message: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.requestTimeoutMs, 2_000));
    try {
      const response = await this.fetchImplementation(this.config.devServerUrl, { method: "GET", signal: controller.signal });
      return response.ok
        ? { reachable: true, message: `Inngest Dev Server responded at ${this.config.devServerUrl}.` }
        : { reachable: false, message: `Inngest Dev Server returned HTTP ${response.status}.` };
    } catch {
      return { reachable: false, message: `Inngest Dev Server is unavailable at ${this.config.devServerUrl}.` };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseRunInput(value: unknown): InngestRunInput {
  if (typeof value !== "object" || value === null) throw new HttpError(400, "INVALID_RUN_INPUT", "Run input must be an object.");
  const candidate = value as Record<string, unknown>;
  const input = {
    runId: candidate.runId,
    prompt: candidate.prompt,
    systemInstruction: candidate.systemInstruction,
    provider: candidate.provider,
    model: candidate.model,
  };
  if (typeof input.runId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.runId)) {
    throw new HttpError(400, "INVALID_RUN_ID", "runId must be a safe identifier.");
  }
  if (typeof input.prompt !== "string" || input.prompt.length === 0 || input.prompt.length > 20_000) {
    throw new HttpError(400, "INVALID_PROMPT", "prompt must contain between 1 and 20,000 characters.");
  }
  if (typeof input.systemInstruction !== "string" || input.systemInstruction.length > 20_000) {
    throw new HttpError(400, "INVALID_SYSTEM_INSTRUCTION", "systemInstruction must be a string of at most 20,000 characters.");
  }
  if (input.provider !== "fake" && input.provider !== "openrouter") {
    throw new HttpError(400, "INVALID_MODEL_PROVIDER", "provider must be fake or openrouter.");
  }
  if (typeof input.model !== "string" || input.model.length === 0 || input.model.length > 200) {
    throw new HttpError(400, "INVALID_MODEL", "model must contain between 1 and 200 characters.");
  }
  return input as InngestRunInput;
}

function validateRunInput(input: InngestRunInput): void {
  parseRunInput(input);
}

function readCancelledRunId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const originalEvent = (data as { event?: unknown }).event;
  if (typeof originalEvent !== "object" || originalEvent === null) return null;
  const originalData = (originalEvent as { data?: unknown }).data;
  if (typeof originalData !== "object" || originalData === null) return null;
  const runId = (originalData as { runId?: unknown }).runId;
  return typeof runId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId) ? runId : null;
}

function toRunError(result: Extract<InngestModelResult, { kind: "failure" }>): RunError {
  return {
    code: result.code,
    message: result.message,
    failureKind: result.failureKind,
    retryable: result.retryable,
  };
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function decodeRunId(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "INVALID_RUN_ID", "runId is not valid URL encoding.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(decoded)) throw new HttpError(400, "INVALID_RUN_ID", "runId must be a safe identifier.");
  return decoded;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
