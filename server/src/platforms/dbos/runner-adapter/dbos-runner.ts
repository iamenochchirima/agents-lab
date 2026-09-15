import { createHash } from "node:crypto";

import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  DBOS_DEFAULT_MODEL_STEP_MAX_ATTEMPTS,
  DBOS_DEFAULT_MODEL_STEP_TIMEOUT_MS,
  DBOS_PLATFORM,
  DBOS_VARIANT,
  DBOS_WORKFLOW_NAME,
  loadDbosConfig,
  safeDatabaseProfile,
  safeManifestConfiguration,
  type DbosConfig,
} from "../config.js";
import type { DbosStartResponse, DbosStepSummary, DbosWorkflowInspection } from "../service/dbos-host.js";
import { workflowInputFromManifest } from "../variants/baseline/contracts.js";
import type { DbosWorkflowResult } from "../variants/baseline/contracts.js";

const EXECUTION_ID_PREFIX = "dbos:";
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

export interface DbosBaselineRunnerOptions {
  readonly config?: DbosConfig;
  readonly serviceUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly now?: () => Date;
}

interface NativeDbosReference {
  readonly schemaVersion: 1;
  readonly sdk: "@dbos-inc/dbos-sdk";
  readonly sdkVersion: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly database: Readonly<Record<string, unknown>>;
  readonly systemDatabaseSchema: string;
  readonly serviceUrl: string;
  readonly requestHash: string;
  readonly submissionOutcome: "accepted" | "already_exists" | "unknown";
  readonly nativeStatus: string | null;
  readonly terminalStatus?: string | null;
  readonly recoveryAttempts?: number | null;
  readonly steps?: readonly DbosStepSummary[];
}

/** Keeps DBOS's in-process/PostgreSQL workflow host behind the generic runner port. */
export class DbosBaselineRunner implements PlatformRunner {
  readonly platform = DBOS_PLATFORM;
  readonly variant = DBOS_VARIANT;

  private readonly config: DbosConfig;
  private readonly serviceUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: DbosBaselineRunnerOptions = {}) {
    this.config = options.config ?? loadDbosConfig();
    this.serviceUrl = (options.serviceUrl ?? `http://${this.config.host}:${this.config.port}`).replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return {
      ...safeManifestConfiguration(this.config),
      serviceUrl: this.serviceUrl,
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== DBOS_PLATFORM || manifest.variant !== DBOS_VARIANT) {
      return { valid: false, reason: "The DBOS baseline runner only accepts dbos/baseline manifests." };
    }
    if (manifest.platformConfig.workflowName !== DBOS_WORKFLOW_NAME) {
      return { valid: false, reason: "The run workflow name does not match the configured DBOS baseline." };
    }
    if (manifest.model.provider === "openrouter" && !this.config.openRouterApiKey) {
      return { valid: false, reason: "OpenRouter is not configured for the DBOS service process." };
    }
    if (!manifest.task.prompt.trim()) return { valid: false, reason: "The DBOS baseline prompt must not be empty." };
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    try {
      const response = await this.request("/health", { method: "GET" });
      if (!response.ok) return { reachable: false, message: `DBOS service returned HTTP ${response.status}.` };
      const body = await response.json() as { readonly status?: string };
      return body.status === "ready"
        ? { reachable: true, message: "DBOS workflow host and PostgreSQL are reachable." }
        : { reachable: false, message: "DBOS workflow host did not report ready." };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "DBOS service is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "DBOS manifest validation failed.");

    const workflowId = workflowIdForRun(manifest.runId);
    const requestHash = requestHashForManifest(manifest);
    const input = workflowInputFromManifest(
      manifest,
      requestHash,
      this.now().toISOString(),
      numberFromConfig(manifest.platformConfig.modelStepTimeoutMs, DBOS_DEFAULT_MODEL_STEP_TIMEOUT_MS),
      numberFromConfig(manifest.platformConfig.modelStepMaxAttempts, DBOS_DEFAULT_MODEL_STEP_MAX_ATTEMPTS),
    );

    try {
      const response = await this.request("/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowId, input }),
      });
      if (response.status === 409) throw new Error("The DBOS workflow ID belongs to a different request.");
      if (!response.ok) throw new Error(`DBOS service rejected workflow start with HTTP ${response.status}.`);
      const body = await response.json() as DbosStartResponse;
      return referenceFor(this.config, this.serviceUrl, workflowId, requestHash, body.submissionOutcome, body.status);
    } catch (error) {
      // A transport failure after DBOS accepted the workflow is ambiguous. The
      // stable workflow ID lets later inspection reconcile without resubmitting.
      if (isTransportError(error)) {
        return referenceFor(this.config, this.serviceUrl, workflowId, requestHash, "unknown", null);
      }
      throw error;
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReference(reference);
    const response = await this.request(`/workflows/${encodeURIComponent(native.workflowId)}?cancel=1`, {
      method: "POST",
      headers: { "x-agentlab-reason": safeHeader(reason) },
    });
    if (response.status === 404) return { accepted: false, alreadyTerminal: false, message: "DBOS workflow was not found." };
    if (!response.ok) return { accepted: false, alreadyTerminal: false, message: `DBOS cancellation returned HTTP ${response.status}.` };
    const body = await response.json() as { readonly accepted?: boolean; readonly alreadyTerminal?: boolean; readonly status?: string };
    return {
      accepted: body.accepted === true,
      alreadyTerminal: body.alreadyTerminal === true,
      message: body.accepted === true ? "DBOS accepted cancellation at the workflow boundary." : `DBOS workflow is already ${body.status ?? "terminal"}.`,
    };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReference(reference);
    const response = await this.request(`/workflows/${encodeURIComponent(native.workflowId)}`, { method: "GET" });
    if (response.status === 404) throw new Error(`DBOS workflow was not found: ${native.workflowId}.`);
    if (!response.ok) throw new Error(`DBOS inspection returned HTTP ${response.status}.`);

    const body = await response.json() as DbosWorkflowInspection;
    const updatedReference = updateReference(reference, body);
    const result = body.result ? sanitizeResult(body.result, reference.executionId) : null;
    return {
      status: mapStatus(body.status, result),
      reference: updatedReference,
      eventIntents: result?.eventIntents ?? [],
      result,
      trajectory: result?.trajectory ?? null,
      metrics: result?.metrics ?? null,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImplementation(`${this.serviceUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      throw new DbosTransportError(safeMessage(error, "DBOS request failed."));
    } finally {
      clearTimeout(timeout);
    }
  }
}

class DbosTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbosTransportError";
  }
}

function referenceFor(
  config: DbosConfig,
  serviceUrl: string,
  workflowId: string,
  requestHash: string,
  submissionOutcome: NativeDbosReference["submissionOutcome"],
  nativeStatus: string | null,
): PlatformExecutionReference {
  return {
    platform: DBOS_PLATFORM,
    variant: DBOS_VARIANT,
    executionId: workflowId,
    native: {
      schemaVersion: 1,
      sdk: "@dbos-inc/dbos-sdk",
      sdkVersion: "4.27.6",
      workflowId,
      workflowName: config.workflowName,
      applicationName: config.applicationName,
      applicationVersion: config.applicationVersion,
      database: safeDatabaseProfile(config),
      systemDatabaseSchema: config.systemDatabaseSchema,
      serviceUrl,
      requestHash,
      submissionOutcome,
      nativeStatus,
      terminalStatus: isNativeTerminal(nativeStatus) ? nativeStatus : null,
    } satisfies NativeDbosReference,
  };
}

function updateReference(reference: PlatformExecutionReference, inspection: DbosWorkflowInspection): PlatformExecutionReference {
  const native = nativeReference(reference);
  return {
    ...reference,
    native: {
      ...native,
      nativeStatus: inspection.status,
      terminalStatus: isNativeTerminal(inspection.status) ? inspection.status : null,
      steps: inspection.steps,
    },
  };
}

function sanitizeResult(result: DbosWorkflowInspection["result"], executionId: string): DbosWorkflowResult | null {
  if (!result) return null;
  if (result.runId === "unknown") {
    return { ...result, runId: executionId.slice(EXECUTION_ID_PREFIX.length) };
  }
  return result;
}

function nativeReference(reference: PlatformExecutionReference): NativeDbosReference {
  if (reference.platform !== DBOS_PLATFORM || reference.variant !== DBOS_VARIANT || typeof reference.native.workflowId !== "string") {
    throw new Error("The execution reference does not belong to the DBOS baseline runner.");
  }
  return reference.native as unknown as NativeDbosReference;
}

function mapStatus(status: string, result: RunResult | null): RunnerInspection["status"] {
  if (result) return result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : result.status === "reconciliation_required" ? "failed" : "failed";
  if (status === "ENQUEUED" || status === "DELAYED") return "queued";
  if (status === "SUCCESS") return "completed";
  if (status === "ERROR" || status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  return "running";
}

function workflowIdForRun(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) throw new Error("The DBOS workflow ID cannot be derived from an unsafe run ID.");
  return `${EXECUTION_ID_PREFIX}${runId}`;
}

export function requestHashForManifest(manifest: RunManifest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      runId: manifest.runId,
      platform: manifest.platform,
      variant: manifest.variant,
      task: manifest.task,
      context: manifest.context,
      model: manifest.model,
    }))
    .digest("hex");
}

function numberFromConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isNativeTerminal(status: string | null): boolean {
  return status === "SUCCESS" || status === "ERROR" || status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED" || status === "CANCELLED";
}

function isTransportError(error: unknown): boolean {
  return error instanceof DbosTransportError;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 256);
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
