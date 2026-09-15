import * as clients from "@restatedev/restate-sdk-clients";
import { tableFromIPC } from "apache-arrow";

import type { PlatformExecutionReference, RunEventIntent, RunManifest, RunMetrics, RunResult, RunTrajectory } from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  RESTATE_SERVICE_NAME,
  RESTATE_WORKFLOW_HANDLER,
  loadRestateConfig,
  safeManifestConfiguration,
  type RestateConfig,
} from "../config.js";
import { restateServices } from "../service/baseline-service.js";
import type { RestateWorkflowInput, RestateWorkflowResult } from "../variants/baseline/contracts.js";
import { workflowInputFromManifest } from "../variants/baseline/contracts.js";

const WORKFLOW_KEY_PREFIX = "agentlab:";
const NATIVE_SCHEMA_VERSION = 1;
const DEFAULT_FETCH_TIMEOUT_MS = 2_000;

export interface RestateWorkflowSubmission {
  readonly invocationId: string;
  readonly status: "Accepted" | "PreviouslyAccepted";
  readonly attachable: boolean;
}

export interface RestateWorkflowClient {
  workflowSubmit(input: RestateWorkflowInput, options?: unknown): Promise<RestateWorkflowSubmission>;
  workflowOutput(): Promise<{ readonly ready: boolean; readonly result?: RestateWorkflowResult }>;
}

export interface RestateIngress {
  workflowClient(definition: { readonly name: string }, key: string): RestateWorkflowClient;
}

export interface RestateBaselineRunnerOptions {
  readonly config: RestateConfig;
  readonly ingress: RestateIngress | null;
  readonly fetchImplementation?: typeof fetch;
  readonly unavailableMessage?: string;
  readonly fetchTimeoutMs?: number;
}

interface NativeRestateReference {
  readonly schemaVersion: 1;
  readonly serviceName: string;
  readonly handlerName: string;
  readonly workflowKey: string;
  readonly invocationId: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly ingressUrl: string;
  readonly adminUrl: string;
  readonly retentionMs: number;
  readonly nativeStatus?: string;
  readonly retryCount?: number | null;
  readonly lastModifiedAt?: string | null;
  readonly errorCode?: string;
}

interface InvocationRecord {
  readonly id: string;
  readonly status: string;
  readonly completionResult: string | null;
  readonly retryCount: number | null;
  readonly modifiedAt: string | null;
}

export class RestateRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestateRunnerUnavailableError";
  }
}

/** Keeps Restate's ingress and Admin APIs behind the generic Lab runner port. */
export class RestateBaselineRunner implements PlatformRunner {
  readonly platform = "restate" as const;
  readonly variant = "baseline" as const;

  private readonly fetchImplementation: typeof fetch;
  private readonly fetchTimeoutMs: number;

  private constructor(private readonly options: RestateBaselineRunnerOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  static async connect(config: RestateConfig = loadRestateConfig()): Promise<RestateBaselineRunner> {
    const ingress = clients.connect({
      url: config.ingressUrl,
      retry: {
        maxAttempts: config.ingressRetryAttempts,
        maxDuration: Math.max(1_000, config.ingressRetryAttempts * 1_000),
        initialInterval: config.runRetryIntervalMs,
        maxInterval: config.runMaxRetryIntervalMs,
        exponentiationFactor: 2,
      },
    }) as unknown as RestateIngress;
    return new RestateBaselineRunner({ config, ingress });
  }

  static fromOptions(options: RestateBaselineRunnerOptions): RestateBaselineRunner {
    return new RestateBaselineRunner(options);
  }

  static unavailable(config: RestateConfig, message: string): RestateBaselineRunner {
    return new RestateBaselineRunner({ config, ingress: null, unavailableMessage: message });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.options.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Restate baseline runner only accepts restate/baseline manifests." };
    }
    if (manifest.platformConfig.serviceName !== this.options.config.serviceName) {
      return { valid: false, reason: "The run service name does not match the configured Restate profile." };
    }
    if (manifest.platformConfig.workflowHandler !== RESTATE_WORKFLOW_HANDLER) {
      return { valid: false, reason: "The run workflow handler is not supported by the Restate baseline." };
    }
    if (manifest.model.provider === "openrouter" && !this.options.config.openRouterApiKey) {
      return { valid: false, reason: "OpenRouter is not configured for the Restate service process." };
    }
    try {
      workflowKeyForRun(manifest.runId);
    } catch (error) {
      return { valid: false, reason: safeMessage(error, "The Restate workflow key is invalid.") };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (!this.options.ingress) return { reachable: false, message: this.options.unavailableMessage ?? "Restate is unavailable." };
    try {
      const health = await this.requestAdmin("/health", { method: "GET" });
      if (!health.ok) return { reachable: false, message: `Restate Admin API returned HTTP ${health.status}.` };
      const deployments = await this.requestAdminJson("/deployments");
      if (!deploymentContainsService(deployments, this.options.config.serviceName)) {
        return { reachable: false, message: `Restate is healthy, but ${this.options.config.serviceName} is not registered at ${this.options.config.serviceUrl}.` };
      }
      return { reachable: true, message: `Restate and ${this.options.config.serviceName} are reachable.` };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "Restate is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const ingress = this.requireIngress();
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "Restate manifest validation failed.");
    const workflowKey = workflowKeyForRun(manifest.runId);
    try {
      const submission = await ingress.workflowClient(restateServices[0], workflowKey).workflowSubmit(
        workflowInputFromManifest(manifest),
      );
      return referenceFromManifest(manifest, {
        workflowKey,
        invocationId: submission.invocationId,
        submissionOutcome: submission.status === "Accepted" ? "accepted" : "already_accepted",
      });
    } catch (error) {
      if (!isAmbiguousSubmissionError(error)) {
        throw new Error(`Restate rejected workflow submission: ${safeMessage(error, "unknown rejection")}`);
      }
      // A bounded ingress retry can end after Restate accepted the workflow.
      // Reconcile by key instead of creating a second execution.
      return referenceFromManifest(manifest, {
        workflowKey,
        invocationId: null,
        submissionOutcome: "unknown",
        errorCode: classifySubmissionError(error),
      });
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReferenceFromExecution(reference);
    const invocation = await this.findInvocation(native);
    if (!invocation) return { accepted: false, alreadyTerminal: false, message: "Restate did not confirm an invocation to cancel." };
    if (isNativeTerminal(invocation.status)) return { accepted: false, alreadyTerminal: true, message: `Restate invocation is already ${invocation.status}.` };
    const response = await this.requestAdmin(`/invocations/${encodeURIComponent(invocation.id)}/cancel`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-agentlab-reason": safeHeader(reason) },
    });
    if (!response.ok) return { accepted: false, alreadyTerminal: false, message: "Restate did not accept the cancellation request." };
    return { accepted: true, alreadyTerminal: false, message: "Restate accepted the cancellation request; terminal state is asynchronous." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReferenceFromExecution(reference);
    try {
      const output = await this.workflowClient(native.workflowKey).workflowOutput();
      if (output.ready && output.result) return inspectionFromResult(reference, output.result);
    } catch (error) {
      // A terminal workflow error is visible through introspection even when
      // the output endpoint rejects. Temporary ingress failures must remain
      // errors so the common server preserves its last projection.
      if (!isPlatformTerminalError(error)) throw error;
    }

    const invocation = await this.findInvocation(native);
    if (!invocation) {
      if (native.submissionOutcome === "unknown") return unknownSubmissionInspection(reference, native.errorCode);
      throw new Error(`Restate execution was not found for workflow key ${native.workflowKey}.`);
    }
    const updatedReference = updateReference(reference, {
      invocationId: invocation.id,
      nativeStatus: invocation.status,
      retryCount: invocation.retryCount,
      lastModifiedAt: invocation.modifiedAt,
    });
    return {
      status: mapNativeStatus(invocation.status, invocation.completionResult),
      reference: updatedReference,
      eventIntents: [],
      result: null,
      trajectory: null,
      metrics: null,
    };
  }

  private requireIngress(): RestateIngress {
    if (!this.options.ingress) throw new RestateRunnerUnavailableError(this.options.unavailableMessage ?? "Restate is unavailable.");
    return this.options.ingress;
  }

  private workflowClient(workflowKey: string): RestateWorkflowClient {
    return this.requireIngress().workflowClient(restateServices[0], workflowKey);
  }

  private async findInvocation(native: NativeRestateReference): Promise<InvocationRecord | null> {
    if (native.invocationId) {
      const byId = await this.queryInvocation(`select id, status, completion_result, retry_count, modified_at from sys_invocation where id = '${sqlString(native.invocationId)}'`);
      if (byId) return byId;
    }
    return this.queryInvocation(`select id, status, completion_result, retry_count, modified_at from sys_invocation where target_service_name = '${sqlString(native.serviceName)}' and target_service_key = '${sqlString(native.workflowKey)}'`);
  }

  private async queryInvocation(query: string): Promise<InvocationRecord | null> {
    const response = await this.requestAdmin("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new RestateRunnerUnavailableError("Restate introspection is unavailable.");
    const row = (await queryRowsFromResponse(response))[0];
    if (!row) return null;
    const id = stringValue(row, "id");
    const status = stringValue(row, "status");
    if (!id || !status) return null;
    return {
      id,
      status,
      completionResult: stringValue(row, "completion_result"),
      retryCount: numberValue(row, "retry_count"),
      modifiedAt: stringValue(row, "modified_at"),
    };
  }

  private async requestAdmin(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      return await this.fetchImplementation(`${this.options.config.adminUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      throw new RestateRunnerUnavailableError(safeMessage(error, "Restate Admin API is unavailable."));
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestAdminJson(path: string): Promise<unknown> {
    const response = await this.requestAdmin(path, { method: "GET" });
    if (!response.ok) throw new RestateRunnerUnavailableError(`Restate Admin API returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  }
}

export function workflowKeyForRun(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) throw new Error("The Restate workflow key cannot be derived from this run ID.");
  return `${WORKFLOW_KEY_PREFIX}${runId}`;
}

export function mapNativeStatus(status: string, completionResult?: string | null): "queued" | "running" | "completed" | "failed" | "cancelled" {
  switch (status.toLowerCase()) {
    case "pending":
    case "ready": return "queued";
    case "running":
    case "backing-off":
    case "suspended": return "running";
    case "completed": return completionResult?.toLowerCase() === "failure" ? "failed" : "completed";
    case "cancelled":
    case "canceled": return "cancelled";
    case "failed":
    case "killed":
    case "aborted":
    case "purged": return "failed";
    default: return "running";
  }
}

function referenceFromManifest(manifest: RunManifest, native: Pick<NativeRestateReference, "workflowKey" | "submissionOutcome"> & Partial<NativeRestateReference>): PlatformExecutionReference {
  const value: NativeRestateReference = {
    schemaVersion: NATIVE_SCHEMA_VERSION,
    serviceName: stringValue(manifest.platformConfig, "serviceName") ?? RESTATE_SERVICE_NAME,
    handlerName: stringValue(manifest.platformConfig, "workflowHandler") ?? RESTATE_WORKFLOW_HANDLER,
    workflowKey: native.workflowKey,
    invocationId: native.invocationId ?? null,
    submissionOutcome: native.submissionOutcome,
    ingressUrl: stringValue(manifest.platformConfig, "ingressUrl") ?? "",
    adminUrl: stringValue(manifest.platformConfig, "adminUrl") ?? "",
    retentionMs: numberValue(manifest.platformConfig, "workflowRetentionMs") ?? 1,
    nativeStatus: native.nativeStatus,
    retryCount: native.retryCount,
    lastModifiedAt: native.lastModifiedAt,
    errorCode: native.errorCode,
  };
  return { platform: manifest.platform, variant: manifest.variant, executionId: native.workflowKey, native: dropUndefined(value as unknown as Record<string, unknown>) };
}

function updateReference(reference: PlatformExecutionReference, update: Partial<NativeRestateReference>): PlatformExecutionReference {
  const native = nativeReferenceFromExecution(reference);
  return { ...reference, native: dropUndefined({ ...native, ...update }) };
}

function nativeReferenceFromExecution(reference: PlatformExecutionReference): NativeRestateReference {
  if (reference.platform !== "restate" || reference.variant !== "baseline") throw new Error("The execution reference does not belong to Restate.");
  const native = reference.native;
  const outcome = stringValue(native, "submissionOutcome");
  if (native.schemaVersion !== NATIVE_SCHEMA_VERSION || !outcome || !["accepted", "already_accepted", "unknown"].includes(outcome)) throw new Error("The Restate execution reference is invalid.");
  return {
    schemaVersion: 1,
    serviceName: stringValue(native, "serviceName") ?? RESTATE_SERVICE_NAME,
    handlerName: stringValue(native, "handlerName") ?? RESTATE_WORKFLOW_HANDLER,
    workflowKey: stringValue(native, "workflowKey") ?? reference.executionId,
    invocationId: stringValue(native, "invocationId"),
    submissionOutcome: outcome as NativeRestateReference["submissionOutcome"],
    ingressUrl: stringValue(native, "ingressUrl") ?? "",
    adminUrl: stringValue(native, "adminUrl") ?? "",
    retentionMs: numberValue(native, "retentionMs") ?? 1,
    nativeStatus: stringValue(native, "nativeStatus") ?? undefined,
    retryCount: numberValue(native, "retryCount"),
    lastModifiedAt: stringValue(native, "lastModifiedAt") ?? undefined,
    errorCode: stringValue(native, "errorCode") ?? undefined,
  };
}

function inspectionFromResult(reference: PlatformExecutionReference, result: RestateWorkflowResult): RunnerInspection {
  const normalized: RunResult = { schemaVersion: 1, runId: result.runId, status: result.status, startedAt: result.startedAt, finishedAt: result.finishedAt, output: result.output, error: result.error, attemptCount: result.attemptCount, usage: result.usage };
  return { status: result.status === "reconciliation_required" ? "failed" : result.status, reference, eventIntents: result.eventIntents, result: normalized, trajectory: result.trajectory, metrics: result.metrics };
}

function unknownSubmissionInspection(reference: PlatformExecutionReference, errorCode?: string): RunnerInspection {
  const runId = reference.executionId.replace(/^agentlab:/, "");
  const finishedAt = new Date().toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt,
    output: null,
    error: { code: "RESTATE_SUBMISSION_OUTCOME_UNKNOWN", message: "Restate did not confirm whether the workflow submission was accepted.", failureKind: "outcome_unknown", retryable: true },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  const event: RunEventIntent = { source: "restate-runner", sourceSequence: 1, kind: "RunSubmissionOutcomeUnknown", runId, occurredAt: finishedAt, payload: { code: errorCode ?? "RESTATE_INGRESS_UNKNOWN" } };
  const trajectory: RunTrajectory = { schemaVersion: 1, runId, phases: [] };
  const metrics: RunMetrics = { schemaVersion: 1, runId, status: "reconciliation_required", durationMs: null, modelCallCount: 0, modelAttemptCount: 0, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null };
  return { status: "failed", reference, eventIntents: [event], result, trajectory, metrics };
}

function queryRows(value: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) return [];
  if (value.rows.every(isRecord)) return value.rows as Record<string, unknown>[];
  if (!Array.isArray(value.columns)) return [];
  const columns = value.columns.filter((column): column is string => typeof column === "string");
  return value.rows.filter(Array.isArray).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

async function queryRowsFromResponse(response: Response): Promise<readonly Record<string, unknown>[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) return queryRows((await response.json()) as unknown);
  if (!response.body) return [];
  const table = await tableFromIPC(response.body);
  return table.toArray().map((row) => row as unknown as Record<string, unknown>);
}

function deploymentContainsService(value: unknown, serviceName: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.deployments)) return false;
  return value.deployments.some((deployment) => isRecord(deployment) && Array.isArray(deployment.services) && deployment.services.some((service) => isRecord(service) && service.name === serviceName));
}

function isNativeTerminal(status: string): boolean {
  return ["completed", "cancelled", "canceled", "failed", "killed", "aborted", "purged"].includes(status.toLowerCase());
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] as string : null;
}

function numberValue(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "bigint" && candidate <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(candidate);
  return null;
}

function dropUndefined(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function classifySubmissionError(error: unknown): string {
  if (isRecord(error) && typeof error.status === "number") return `RESTATE_HTTP_${error.status}`;
  return "RESTATE_INGRESS_UNKNOWN";
}

function isAmbiguousSubmissionError(error: unknown): boolean {
  if (!isRecord(error) || typeof error.status !== "number") return true;
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

function isPlatformTerminalError(error: unknown): boolean {
  if (!isRecord(error) || typeof error.status !== "number") return false;
  return error.status >= 400 && error.status < 500;
}

function sqlString(value: string): string { return value.replace(/'/g, "''"); }
function safeHeader(value: string): string { return value.replace(/[\r\n]/g, " ").slice(0, 200); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function safeMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
