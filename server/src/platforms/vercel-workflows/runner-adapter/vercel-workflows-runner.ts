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
  loadVercelWorkflowsConfig,
  VERCEL_WORKFLOW_LOCAL_WORLD_VERSION,
  VERCEL_WORKFLOW_SDK_VERSION,
  VERCEL_WORKFLOW_NAME,
  VERCEL_WORKFLOWS_PLATFORM,
  VERCEL_WORKFLOWS_VARIANT,
  safeManifestConfiguration,
  type VercelWorkflowsConfig,
} from "../config.js";
import type { VercelWorkflowPublicRunRecord, VercelWorkflowAdmissionResponse } from "../service/platform-service.js";
import { inputFromManifest } from "../variants/baseline/contracts.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

interface NativeVercelWorkflowReference {
  readonly schemaVersion: 1;
  readonly sdk: "workflow";
  readonly sdkVersion: string;
  readonly localWorldPackage: "@workflow/world-local";
  readonly localWorldVersion: string;
  readonly world: "local";
  readonly serviceUrl: string;
  readonly workflowName: string;
  readonly workflowId: string | null;
  readonly workflowRunId: string | null;
  readonly labRunId: string;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
  readonly nativeStatus: string | null;
}

export interface VercelWorkflowsRunnerOptions {
  readonly config?: VercelWorkflowsConfig;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly unavailableMessage?: string;
}

export class VercelWorkflowsRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelWorkflowsRunnerUnavailableError";
  }
}

/** Keeps Workflow's native run API behind the Lab runner port. */
export class VercelWorkflowsBaselineRunner implements PlatformRunner {
  readonly platform = VERCEL_WORKFLOWS_PLATFORM;
  readonly variant = VERCEL_WORKFLOWS_VARIANT;

  private readonly config: VercelWorkflowsConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly unavailableMessage: string | null;

  constructor(options: VercelWorkflowsRunnerOptions = {}) {
    this.config = options.config ?? loadVercelWorkflowsConfig();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.unavailableMessage = options.unavailableMessage ?? null;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new Error("Vercel Workflows requestTimeoutMs must be a positive integer.");
    }
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Vercel Workflows baseline runner only accepts vercel-workflows/baseline manifests." };
    }
    if (manifest.platformConfig.workflowName !== this.config.workflowName) {
      return { valid: false, reason: "The run workflow name does not match the configured Vercel Workflow baseline." };
    }
    if (!manifest.task.prompt.trim()) return { valid: false, reason: "The Vercel Workflows prompt must not be empty." };
    if (manifest.model.provider === "openrouter" && !this.config.openRouterApiKey) {
      return { valid: false, reason: "OpenRouter is not configured for the Workflow service process." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.unavailableMessage) return { reachable: false, message: this.unavailableMessage };
    try {
      const response = await this.request("/ready", { method: "GET" });
      const body = asRecord(response.body);
      if (!response.ok) return { reachable: false, message: `Vercel Workflows service returned HTTP ${response.status}.` };
      return body.status === "ready"
        ? { reachable: true, message: "Vercel Workflows local service and Workflow bundle are ready." }
        : { reachable: false, message: "Vercel Workflows service did not report ready." };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "Vercel Workflows service is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "Vercel Workflows manifest validation failed.");
    const base = baseReference(manifest.runId, this.config);
    try {
      const response = await this.request("/runs/admit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inputFromManifest(manifest)),
      });
      if (response.status === 409) throw new Error("The Vercel Workflow run ID belongs to a different request.");
      if (!response.ok && response.status < 500) throw new Error(`Vercel Workflows rejected admission with HTTP ${response.status}.`);
      const body = asRecord(response.body) as Partial<VercelWorkflowAdmissionResponse>;
      if (!response.ok || body.submissionOutcome === "unknown") {
        return updateReference(base, {
          workflowId: nullableString(body.workflowId),
          acknowledgement: "unknown",
          submissionOutcome: "unknown",
        });
      }
      const workflowRunId = nullableString(body.workflowRunId);
      if (!workflowRunId) throw new Error("Vercel Workflows accepted admission without a native run ID.");
      return updateReference(base, {
        workflowId: nullableString(body.workflowId),
        workflowRunId,
        submissionOutcome: body.submissionOutcome === "already_accepted" ? "already_accepted" : "accepted",
        acknowledgement: body.acknowledgement === "confirmed" ? "confirmed" : "unknown",
        nativeStatus: nullableString(body.status),
      });
    } catch (error) {
      if (error instanceof VercelWorkflowsRunnerUnavailableError) {
        return updateReference(base, { acknowledgement: "unknown", submissionOutcome: "unknown" });
      }
      throw error;
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReference(reference);
    if (!native.workflowRunId) return { accepted: false, alreadyTerminal: false, message: "The Workflow submission outcome is unknown; it cannot be cancelled safely." };
    const response = await this.request(`/runs/${encodeURIComponent(native.workflowRunId)}?cancel=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason.slice(0, 512) }),
    });
    if (response.status === 404) return { accepted: false, alreadyTerminal: false, message: "The Workflow run was not found." };
    if (!response.ok) throw new VercelWorkflowsRunnerUnavailableError(`Vercel Workflows rejected cancellation with HTTP ${response.status}.`);
    const body = asRecord(response.body);
    return {
      accepted: body.accepted === true,
      alreadyTerminal: body.alreadyTerminal === true,
      message: stringValue(body, "message") ?? "Workflow cancellation request completed.",
    };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReference(reference);
    if (!native.workflowRunId) return unknownSubmissionInspection(reference);
    const response = await this.request(`/runs/${encodeURIComponent(native.workflowRunId)}`, { method: "GET" });
    if (response.status === 404) throw new Error(`The Vercel Workflow run was not found: ${native.workflowRunId}.`);
    if (!response.ok) throw new VercelWorkflowsRunnerUnavailableError(`Vercel Workflows inspection returned HTTP ${response.status}.`);
    const record = response.body as VercelWorkflowPublicRunRecord;
    const updated = updateReference(reference, {
      workflowId: record.workflowId,
      workflowRunId: record.workflowRunId,
      nativeStatus: record.status,
      acknowledgement: native.submissionOutcome === "unknown" ? "unknown" : "confirmed",
    });
    const result = record.result as RunResult | null;
    return {
      status: mapStatus(record.status, result),
      reference: updated,
      eventIntents: isVercelResult(result) ? result.eventIntents : [],
      result,
      trajectory: isVercelResult(result) ? result.trajectory : null,
      metrics: isVercelResult(result) ? result.metrics : null,
    };
  }

  private async request(path: string, init: RequestInit): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(`${this.config.serviceUrl}${path}`, { ...init, signal: controller.signal });
      } catch (error) {
        throw new VercelWorkflowsRunnerUnavailableError(safeMessage(error, "Vercel Workflows service is unavailable."));
      }
      return { ok: response.ok, status: response.status, body: await readJson(response) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function baseReference(runId: string, config: VercelWorkflowsConfig): PlatformExecutionReference {
  const native: NativeVercelWorkflowReference = {
    schemaVersion: 1,
    sdk: "workflow",
    sdkVersion: VERCEL_WORKFLOW_SDK_VERSION,
    localWorldPackage: "@workflow/world-local",
    localWorldVersion: VERCEL_WORKFLOW_LOCAL_WORLD_VERSION,
    world: "local",
    serviceUrl: config.serviceUrl,
    workflowName: VERCEL_WORKFLOW_NAME,
    workflowId: null,
    workflowRunId: null,
    labRunId: runId,
    submissionOutcome: "unknown",
    acknowledgement: "unknown",
    nativeStatus: null,
  };
  return { platform: VERCEL_WORKFLOWS_PLATFORM, variant: VERCEL_WORKFLOWS_VARIANT, executionId: `vercel-workflows:${runId}`, native: native as unknown as Readonly<Record<string, unknown>> };
}

function updateReference(reference: PlatformExecutionReference, update: Partial<NativeVercelWorkflowReference>): PlatformExecutionReference {
  // `executionId` is the stable Lab identity. The Workflow run ID is a native
  // detail and must never replace it in the common evidence store.
  return { ...reference, native: { ...reference.native, ...update, schemaVersion: 1 } };
}

function nativeReference(reference: PlatformExecutionReference): NativeVercelWorkflowReference {
  if (reference.platform !== VERCEL_WORKFLOWS_PLATFORM || reference.variant !== VERCEL_WORKFLOWS_VARIANT) throw new Error("The execution reference does not belong to Vercel Workflows.");
  const native = reference.native as Partial<NativeVercelWorkflowReference>;
  if (native.schemaVersion !== 1 || native.sdk !== "workflow" || typeof native.labRunId !== "string") throw new Error("The Vercel Workflows execution reference is invalid.");
  return {
    schemaVersion: 1,
    sdk: "workflow",
    sdkVersion: stringValue(native, "sdkVersion") ?? VERCEL_WORKFLOW_SDK_VERSION,
    localWorldPackage: "@workflow/world-local",
    localWorldVersion: stringValue(native, "localWorldVersion") ?? VERCEL_WORKFLOW_LOCAL_WORLD_VERSION,
    world: "local",
    serviceUrl: stringValue(native, "serviceUrl") ?? "",
    workflowName: stringValue(native, "workflowName") ?? VERCEL_WORKFLOW_NAME,
    workflowId: nullableString(native.workflowId),
    workflowRunId: nullableString(native.workflowRunId),
    labRunId: native.labRunId,
    submissionOutcome: native.submissionOutcome as NativeVercelWorkflowReference["submissionOutcome"],
    acknowledgement: native.acknowledgement === "confirmed" ? "confirmed" : "unknown",
    nativeStatus: nullableString(native.nativeStatus),
  };
}

function unknownSubmissionInspection(reference: PlatformExecutionReference): RunnerInspection {
  const native = reference.native as Partial<NativeVercelWorkflowReference>;
  const runId = typeof native.labRunId === "string" ? native.labRunId : reference.executionId;
  const finishedAt = new Date().toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt,
    output: null,
    error: { code: "VERCEL_WORKFLOW_SUBMISSION_OUTCOME_UNKNOWN", message: "Workflow did not confirm whether the run was accepted.", failureKind: "outcome_unknown", retryable: true },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  const event: RunEventIntent = { source: "vercel-workflows-runner", sourceSequence: 1, kind: "RunSubmissionOutcomeUnknown", runId, occurredAt: finishedAt, payload: { platform: VERCEL_WORKFLOWS_PLATFORM } };
  const trajectory: RunTrajectory = { schemaVersion: 1, runId, phases: [] };
  const metrics: RunMetrics = { schemaVersion: 1, runId, status: "reconciliation_required", durationMs: null, modelCallCount: 0, modelAttemptCount: 0, inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null };
  // The shared runner port has no reconciliation_required execution status;
  // preserve that fact in the normalized result instead of fabricating a
  // terminal failure. The generic status is only the port-level fallback.
  return { status: "failed", reference, eventIntents: [event], result, trajectory, metrics };
}

function mapStatus(status: VercelWorkflowPublicRunRecord["status"], result: RunResult | null): "queued" | "running" | "completed" | "failed" | "cancelled" {
  if (result?.status === "reconciliation_required") return "failed";
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  return "completed";
}

function isVercelResult(result: RunResult | null): result is RunResult & { readonly eventIntents: readonly RunEventIntent[]; readonly trajectory: RunTrajectory; readonly metrics: RunMetrics } {
  return !!result && "eventIntents" in result && "trajectory" in result && "metrics" in result;
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function stringValue(value: Record<string, unknown>, key: string): string | null { return nullableString(value[key]); }
function safeMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
