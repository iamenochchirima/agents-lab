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
  HATCHET_PLATFORM,
  HATCHET_VARIANT,
  HATCHET_TASK_NAME,
  loadHatchetConfig,
  safeManifestConfiguration,
  type HatchetConfig,
} from "../config.js";
import type {
  HatchetPromptInput,
  HatchetRunDetails,
  HatchetTaskOutput,
} from "../variants/baseline/contracts.js";
import { isHatchetTaskOutput } from "../variants/baseline/contracts.js";
import { createHatchetBaselineTask } from "../variants/baseline/execution/task.js";
import { loadHatchetSdk } from "../sdk.js";

const EXECUTION_PREFIX = "hatchet:";
const NATIVE_SCHEMA_VERSION = 1;
const LAB_RUN_METADATA_KEY = "agentlabRunId";

export interface HatchetRunReferenceLike {
  readonly runId?: string | Promise<string>;
  getWorkflowRunId?: () => Promise<string>;
}

export interface HatchetTaskLike {
  runNoWait(
    input: HatchetPromptInput,
    options?: { readonly additionalMetadata?: Record<string, string> },
  ): Promise<HatchetRunReferenceLike>;
}

export interface HatchetRunnerClientLike {
  readonly runs: {
    get(runId: string): Promise<HatchetRunDetails>;
    get_status?(runId: string): Promise<string>;
    list(
      options?: Record<string, unknown>,
    ): Promise<{ readonly rows?: readonly HatchetRunListRow[] }>;
    cancel(options: { readonly ids: readonly string[] }): Promise<unknown>;
  };
  readonly workers: {
    list(): Promise<{ readonly rows?: readonly HatchetWorkerRow[] }>;
  };
  readonly tenant?: {
    get(): Promise<unknown>;
  };
}

interface HatchetRunListRow {
  readonly taskExternalId?: string;
  readonly workflowRunExternalId?: string;
  readonly status?: string;
  readonly additionalMetadata?: unknown;
}

interface HatchetWorkerRow {
  readonly name?: string;
  readonly status?: string;
  readonly actions?: readonly string[];
}

interface NativeHatchetReference {
  readonly schemaVersion: 1;
  readonly sdk: "@hatchet-dev/typescript-sdk";
  readonly sdkVersion: string;
  readonly serverVersion: string;
  readonly taskName: string;
  readonly workerName: string;
  readonly apiUrl: string;
  readonly hostPort: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly workflowRunId: string | null;
  readonly taskExternalId: string | null;
  readonly nativeRunId: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
  readonly nativeStatus: string | null;
  readonly workerId: string | null;
  readonly workerNameObserved: string | null;
  readonly attempt: number | null;
  readonly retryCount: number | null;
  readonly eventCount: number;
  readonly terminalStatus: string | null;
}

export interface HatchetBaselineRunnerOptions {
  readonly config?: HatchetConfig;
  readonly client?: HatchetRunnerClientLike | null;
  readonly task?: HatchetTaskLike | null;
  readonly unavailableMessage?: string;
}

export class HatchetRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HatchetRunnerUnavailableError";
  }
}

export class HatchetExecutionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HatchetExecutionNotFoundError";
  }
}

/** Keeps Hatchet's task, worker, retry, and run APIs behind the Lab runner port. */
export class HatchetBaselineRunner implements PlatformRunner {
  readonly platform = HATCHET_PLATFORM;
  readonly variant = HATCHET_VARIANT;

  private readonly config: HatchetConfig;
  private readonly client: HatchetRunnerClientLike | null;
  private readonly task: HatchetTaskLike | null;
  private readonly unavailableMessage: string | null;

  private constructor(options: HatchetBaselineRunnerOptions) {
    this.config = options.config ?? loadHatchetConfig();
    this.client = options.client ?? null;
    this.task = options.task ?? null;
    this.unavailableMessage = options.unavailableMessage ?? null;
  }

  static async connect(
    config: HatchetConfig = loadHatchetConfig(),
  ): Promise<HatchetBaselineRunner> {
    if (!config.clientToken) {
      return HatchetBaselineRunner.unavailable(
        config,
        "HATCHET_CLIENT_TOKEN is not configured.",
      );
    }

    try {
      const sdk = loadHatchetSdk();
      const client = sdk.HatchetClient.init({
        token: config.clientToken,
        host_port: config.hostPort,
        api_url: config.apiUrl,
        tenant_id: config.tenantId,
        tls_config: { tls_strategy: config.tlsStrategy },
      });
      const task = createHatchetBaselineTask(client, config);
      return HatchetBaselineRunner.fromClient({
        config,
        client: client as unknown as HatchetRunnerClientLike,
        task: task as unknown as HatchetTaskLike,
      });
    } catch (error) {
      return HatchetBaselineRunner.unavailable(
        config,
        safeMessage(error, "Hatchet SDK could not be initialized."),
      );
    }
  }

  static fromClient(
    options: HatchetBaselineRunnerOptions & {
      readonly client: HatchetRunnerClientLike;
      readonly task: HatchetTaskLike;
    },
  ): HatchetBaselineRunner {
    return new HatchetBaselineRunner(options);
  }

  static unavailable(
    config: HatchetConfig,
    message: string,
  ): HatchetBaselineRunner {
    return new HatchetBaselineRunner({
      config,
      client: null,
      task: null,
      unavailableMessage: message,
    });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (
      manifest.platform !== HATCHET_PLATFORM ||
      manifest.variant !== HATCHET_VARIANT
    ) {
      return {
        valid: false,
        reason:
          "The Hatchet baseline runner only accepts hatchet/baseline manifests.",
      };
    }
    if (manifest.platformConfig.taskName !== HATCHET_TASK_NAME) {
      return {
        valid: false,
        reason:
          "The run task name does not match the configured Hatchet baseline.",
      };
    }
    if (!manifest.task.prompt.trim())
      return {
        valid: false,
        reason: "The Hatchet baseline prompt must not be empty.",
      };
    if (
      manifest.model.provider === "openrouter" &&
      !this.config.openRouterApiKey
    ) {
      return {
        valid: false,
        reason: "OpenRouter is not configured for the Hatchet worker process.",
      };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (!this.client)
      return {
        reachable: false,
        message: this.unavailableMessage ?? "Hatchet is unavailable.",
      };

    try {
      await this.client.tenant?.get();
      const workers = await this.client.workers.list();
      const matchingWorker = (workers.rows ?? []).find(
        (worker) =>
          worker.status === "ACTIVE" &&
          (worker.actions ?? []).includes(this.config.taskName),
      );
      if (!matchingWorker) {
        return {
          reachable: false,
          message:
            "Hatchet API is reachable, but no active worker advertises the baseline task.",
        };
      }
      return {
        reachable: true,
        message: `Hatchet server and worker are reachable at ${this.config.apiUrl}.`,
      };
    } catch (error) {
      return {
        reachable: false,
        message: safeMessage(error, "Hatchet is unavailable."),
      };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid)
      throw new Error(
        validation.reason ?? "Hatchet manifest validation failed.",
      );
    const task = this.requireTask();
    const base = baseReference(this.config, manifest.runId);

    try {
      const runReference = await task.runNoWait(inputFromManifest(manifest), {
        additionalMetadata: { [LAB_RUN_METADATA_KEY]: manifest.runId },
      });
      const nativeRunId = await readRunReferenceId(runReference);
      return updateNativeReference(base, {
        nativeRunId,
        workflowRunId: nativeRunId,
        submissionOutcome: "accepted",
        acknowledgement: "confirmed",
      });
    } catch (error) {
      const existingRunId = existingRunIdFromError(error);
      if (existingRunId) {
        return updateNativeReference(base, {
          nativeRunId: existingRunId,
          workflowRunId: existingRunId,
          submissionOutcome: "already_accepted",
          acknowledgement: "confirmed",
        });
      }
      if (!isTransportError(error)) throw error;

      // If dispatch accepted the task before the response was lost, the Lab
      // metadata query recovers the existing identity without a second start.
      const existing = await this.findRun(manifest.runId);
      if (existing)
        return referenceFromListRow(
          base,
          existing,
          "already_accepted",
          "confirmed",
        );
      return updateNativeReference(base, {
        submissionOutcome: "unknown",
        acknowledgement: "unknown",
      });
    }
  }

  async cancel(
    reference: PlatformExecutionReference,
    reason: string,
  ): Promise<RunnerCancellationResult> {
    void reason;
    const native = nativeReference(reference);
    const nativeRunId = native.nativeRunId;
    if (!nativeRunId) {
      return {
        accepted: false,
        alreadyTerminal: false,
        message:
          "Hatchet start acknowledgement is unresolved; reconcile before cancelling.",
      };
    }
    const client = this.requireClient();

    if (client.runs.get_status) {
      const currentStatus = await client.runs.get_status(nativeRunId);
      if (isTerminalStatus(currentStatus)) {
        return {
          accepted: false,
          alreadyTerminal: true,
          message: `Hatchet run is already ${currentStatus.toLowerCase()}.`,
        };
      }
    }

    await client.runs.cancel({ ids: [nativeRunId] });
    return {
      accepted: true,
      alreadyTerminal: false,
      message: "Hatchet accepted the cancellation request.",
    };
  }

  async inspect(
    reference: PlatformExecutionReference,
  ): Promise<RunnerInspection> {
    let currentReference = reference;
    let native = nativeReference(currentReference);
    if (!native.nativeRunId) {
      const existing = await this.findRun(native.runId);
      if (!existing) return reconciliationInspection(currentReference);
      currentReference = referenceFromListRow(
        currentReference,
        existing,
        "already_accepted",
        "confirmed",
      );
      native = nativeReference(currentReference);
    }

    const nativeRunId = native.nativeRunId;
    if (!nativeRunId) return reconciliationInspection(currentReference);

    let details: HatchetRunDetails;
    try {
      details = await this.requireClient().runs.get(nativeRunId);
    } catch (error) {
      if (isNotFoundError(error))
        throw new HatchetExecutionNotFoundError(
          `Hatchet run was not found: ${nativeRunId}.`,
        );
      throw new HatchetRunnerUnavailableError(
        safeMessage(error, "Hatchet run inspection failed."),
      );
    }

    const output = taskOutputFromDetails(details, native.runId);
    const status = mapStatus(details.run.status, output?.result ?? null);
    const updated = updateReferenceFromDetails(currentReference, details);
    if (status === "queued" || status === "running") {
      return {
        status,
        reference: updated,
        eventIntents: nativeEventIntents(details, native.runId),
        result: null,
        trajectory: null,
        metrics: null,
      };
    }

    const result =
      output?.result ?? synthesizedResult(details, native.runId, status);
    return {
      status:
        result.status === "cancelled"
          ? "cancelled"
          : result.status === "completed"
            ? "completed"
            : "failed",
      reference: updated,
      eventIntents: [
        ...nativeEventIntents(details, native.runId),
        ...(output?.eventIntents ?? []),
      ],
      result,
      trajectory: output?.trajectory ?? emptyTrajectory(result),
      metrics: output?.metrics ?? emptyMetrics(result),
    };
  }

  private requireClient(): HatchetRunnerClientLike {
    if (!this.client)
      throw new HatchetRunnerUnavailableError(
        this.unavailableMessage ?? "Hatchet is unavailable.",
      );
    return this.client;
  }

  private requireTask(): HatchetTaskLike {
    if (!this.task)
      throw new HatchetRunnerUnavailableError(
        this.unavailableMessage ?? "Hatchet worker task is unavailable.",
      );
    return this.task;
  }

  private async findRun(runId: string): Promise<HatchetRunListRow | null> {
    const rows = await this.requireClient().runs.list({
      onlyTasks: true,
      limit: 20,
      workflowNames: [this.config.taskName],
      additionalMetadata: { [LAB_RUN_METADATA_KEY]: runId },
      includePayloads: false,
    });
    return (
      (rows.rows ?? []).find(
        (row) =>
          metadataString(row.additionalMetadata, LAB_RUN_METADATA_KEY) ===
          runId,
      ) ?? null
    );
  }
}

function inputFromManifest(manifest: RunManifest): HatchetPromptInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
  };
}

function baseReference(
  config: HatchetConfig,
  runId: string,
): PlatformExecutionReference {
  return {
    platform: HATCHET_PLATFORM,
    variant: HATCHET_VARIANT,
    // This is the Lab identity, not Hatchet's workflow or task identity. It
    // must not change when an unknown admission is later reconciled.
    executionId: `${EXECUTION_PREFIX}${runId}`,
    native: {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      sdk: "@hatchet-dev/typescript-sdk",
      sdkVersion: config.sdkVersion,
      serverVersion: config.serverVersion,
      taskName: config.taskName,
      workerName: config.workerName,
      apiUrl: config.apiUrl,
      hostPort: config.hostPort,
      tenantId: config.tenantId,
      runId,
      workflowRunId: null,
      taskExternalId: null,
      nativeRunId: null,
      submissionOutcome: "unknown",
      acknowledgement: "unknown",
      nativeStatus: null,
      workerId: null,
      workerNameObserved: null,
      attempt: null,
      retryCount: null,
      eventCount: 0,
      terminalStatus: null,
    } satisfies NativeHatchetReference,
  };
}

function updateNativeReference(
  reference: PlatformExecutionReference,
  update: Partial<
    Pick<
      NativeHatchetReference,
      | "nativeRunId"
      | "workflowRunId"
      | "taskExternalId"
      | "submissionOutcome"
      | "acknowledgement"
    >
  >,
): PlatformExecutionReference {
  const native = nativeReference(reference);
  return {
    ...reference,
    native: { ...native, ...update },
  };
}

function updateReferenceFromDetails(
  reference: PlatformExecutionReference,
  details: HatchetRunDetails,
): PlatformExecutionReference {
  const native = nativeReference(reference);
  const task = details.tasks[0];
  const workerId =
    lastValue(details.taskEvents, (event) => event.workerId !== undefined)
      ?.workerId ?? null;
  const retryCount =
    task?.retryCount ??
    lastValue(details.taskEvents, (event) => event.retryCount !== undefined)
      ?.retryCount ??
    null;
  const attempt =
    task?.attempt ??
    lastValue(details.taskEvents, (event) => event.attempt !== undefined)
      ?.attempt ??
    null;
  return {
    ...reference,
    native: {
      ...native,
      taskExternalId: task?.taskExternalId ?? native.taskExternalId,
      nativeStatus: details.run.status,
      workerId,
      workerNameObserved: native.workerNameObserved,
      attempt,
      retryCount,
      eventCount: details.taskEvents.length,
      terminalStatus: isTerminalStatus(details.run.status)
        ? details.run.status
        : null,
    } satisfies NativeHatchetReference,
  };
}

function nativeReference(
  reference: PlatformExecutionReference,
): NativeHatchetReference {
  if (
    reference.platform !== HATCHET_PLATFORM ||
    reference.variant !== HATCHET_VARIANT ||
    !isRecord(reference.native) ||
    typeof reference.native.runId !== "string"
  ) {
    throw new Error(
      "The execution reference does not belong to the Hatchet baseline runner.",
    );
  }
  return reference.native as unknown as NativeHatchetReference;
}

function referenceFromListRow(
  reference: PlatformExecutionReference,
  row: HatchetRunListRow,
  submissionOutcome: NativeHatchetReference["submissionOutcome"],
  acknowledgement: NativeHatchetReference["acknowledgement"],
): PlatformExecutionReference {
  const nativeRunId = row.workflowRunExternalId ?? row.taskExternalId ?? null;
  const updated = updateNativeReference(reference, {
    nativeRunId,
    workflowRunId: row.workflowRunExternalId ?? null,
    taskExternalId: row.taskExternalId ?? null,
    submissionOutcome,
    acknowledgement,
  });
  const native = nativeReference(updated);
  return {
    ...updated,
    native: {
      ...native,
      nativeStatus: row.status ?? null,
    } satisfies NativeHatchetReference,
  };
}

function taskOutputFromDetails(
  details: HatchetRunDetails,
  runId: string,
): HatchetTaskOutput | null {
  const value = details.tasks[0]?.output ?? details.run.output;
  if (!isHatchetTaskOutput(value) || value.runId !== runId) return null;
  return value;
}

function nativeEventIntents(
  details: HatchetRunDetails,
  runId: string,
): readonly RunEventIntent[] {
  return [...details.taskEvents]
    .sort((left, right) => left.id - right.id)
    .map((event, index) => ({
      source: "hatchet",
      sourceSequence: index + 1,
      kind: `Hatchet${event.eventType}`,
      runId,
      occurredAt: event.timestamp,
      payload: {
        eventType: event.eventType,
        workerId: event.workerId ?? null,
        retryCount: event.retryCount ?? null,
        attempt: event.attempt ?? null,
      },
    }));
}

function reconciliationInspection(
  reference: PlatformExecutionReference,
): RunnerInspection {
  const native = nativeReference(reference);
  const occurredAt = new Date().toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId: native.runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt: occurredAt,
    output: null,
    error: {
      code: "HATCHET_SUBMISSION_OUTCOME_UNKNOWN",
      message:
        "Hatchet did not confirm whether the task was admitted; reconcile it before retrying.",
      failureKind: "outcome_unknown",
      retryable: true,
    },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  const event: RunEventIntent = {
    source: "hatchet-reconciliation",
    sourceSequence: 1,
    kind: "HatchetSubmissionOutcomeUnknown",
    runId: native.runId,
    occurredAt,
    payload: { submissionOutcome: "unknown", acknowledgement: "unknown" },
  };
  return {
    status: "failed",
    reference,
    eventIntents: [event],
    result,
    trajectory: emptyTrajectory(result),
    metrics: emptyMetrics(result),
  };
}

function synthesizedResult(
  details: HatchetRunDetails,
  runId: string,
  status: RunnerInspection["status"],
): RunResult {
  const finishedAt = details.run.finishedAt ?? new Date().toISOString();
  const task = details.tasks[0];
  const errorMessage = safeNativeMessage(
    task?.errorMessage ?? details.run.errorMessage,
  );
  const failureKind =
    status === "cancelled"
      ? "cancelled"
      : hasTimeout(details)
        ? "timeout"
        : "internal";
  return {
    schemaVersion: 1,
    runId,
    status: status === "cancelled" ? "cancelled" : "failed",
    startedAt: details.run.startedAt ?? task?.startedAt ?? null,
    finishedAt,
    output: null,
    error: {
      code:
        status === "cancelled"
          ? "HATCHET_RUN_CANCELLED"
          : hasTimeout(details)
            ? "HATCHET_RUN_TIMED_OUT"
            : "HATCHET_TASK_FAILED",
      message:
        errorMessage ??
        (status === "cancelled"
          ? "Hatchet cancelled the task."
          : "Hatchet reported that the task failed."),
      failureKind,
      retryable: status !== "cancelled",
    },
    attemptCount: (task?.retryCount ?? 0) + 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function emptyTrajectory(result: RunResult): RunTrajectory {
  return { schemaVersion: 1, runId: result.runId, phases: [] };
}

function emptyMetrics(result: RunResult): RunMetrics {
  return {
    schemaVersion: 1,
    runId: result.runId,
    status: result.status,
    durationMs: result.startedAt
      ? Math.max(
          0,
          Date.parse(result.finishedAt) - Date.parse(result.startedAt),
        )
      : null,
    modelCallCount: 0,
    modelAttemptCount: result.attemptCount,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
}

function mapStatus(
  nativeStatus: string,
  result: RunResult | null,
): RunnerInspection["status"] {
  if (result)
    return result.status === "completed"
      ? "completed"
      : result.status === "cancelled"
        ? "cancelled"
        : "failed";
  switch (nativeStatus) {
    case "QUEUED":
    case "PENDING":
    case "BACKOFF":
      return "queued";
    case "RUNNING":
      return "running";
    case "COMPLETED":
    case "SUCCEEDED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "FAILED":
      return "failed";
    default:
      return "running";
  }
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELLED"
  );
}

function hasTimeout(details: HatchetRunDetails): boolean {
  return details.taskEvents.some(
    (event) =>
      event.eventType === "TIMED_OUT" ||
      event.eventType === "SCHEDULING_TIMED_OUT",
  );
}

async function readRunReferenceId(
  reference: HatchetRunReferenceLike,
): Promise<string> {
  if (reference.getWorkflowRunId) return reference.getWorkflowRunId();
  const value =
    typeof reference.runId === "string"
      ? reference.runId
      : await reference.runId;
  if (!value)
    throw new Error("Hatchet returned a run reference without a run ID.");
  return value;
}

function existingRunIdFromError(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.existingRunExternalId === "string")
    return error.existingRunExternalId;
  return error.name === "IdempotencyCollisionError" &&
    typeof error.message === "string"
    ? extractUuid(error.message)
    : null;
}

function extractUuid(value: string): string | null {
  const match =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.exec(
      value,
    );
  return match?.[0] ?? null;
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = errorCode(error);
  return (
    error.name === "TypeError" ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ERR_NETWORK",
      "UNAVAILABLE",
      "DEADLINE_EXCEEDED",
    ].includes(code)
  );
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = errorCode(error);
  return (
    code === "NOT_FOUND" || error.message.toLowerCase().includes("not found")
  );
}

function metadataString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function safeNativeMessage(value: string | undefined): string | null {
  return typeof value === "string" && value.trim()
    ? value.replace(/[\r\n]+/g, " ").slice(0, 512)
    : null;
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message.replace(/[\r\n]+/g, " ").slice(0, 512)
    : fallback;
}

function errorCode(error: Error): string {
  const value = error as Error & { readonly code?: unknown };
  return typeof value.code === "string" ? value.code : "";
}

function lastValue<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return values[index];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}
