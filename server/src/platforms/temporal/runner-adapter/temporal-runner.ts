import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  type WorkflowHandle,
  type WorkflowExecutionStatusName,
} from "@temporalio/client";

import type { ServerConfig } from "../../../control-plane/bootstrap/config.js";
import type { PlatformExecutionReference, RunManifest, RunResult } from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import { baselineCancelSignal, baselineSnapshotQuery, temporalBaselineWorkflow } from "../variants/baseline/workflow.js";
import type {
  TemporalEventIntent,
  TemporalWorkflowInput,
  TemporalWorkflowResult,
  TemporalWorkflowSnapshot,
} from "../variants/baseline/contracts.js";
import { BASELINE_WORKFLOW_TYPE } from "../variants/baseline/contracts.js";

const WORKFLOW_ID_PREFIX = "agentlab:";

export interface TemporalBaselineRunnerOptions {
  readonly client: Client | null;
  readonly connection?: Connection;
  readonly config: ServerConfig;
  readonly unavailableMessage?: string;
}

export class TemporalRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemporalRunnerUnavailableError";
  }
}

/**
 * Adapts the narrow server runner port to Temporal's client API. No
 * workflow implementation details are exposed to the HTTP layer.
 */
export class TemporalBaselineRunner implements PlatformRunner {
  readonly platform = "temporal" as const;
  readonly variant = "baseline" as const;

  private constructor(private readonly options: TemporalBaselineRunnerOptions) {}

  static async connect(config: ServerConfig): Promise<TemporalBaselineRunner> {
    const connection = await Connection.connect({ address: config.temporal.endpoint });
    const client = new Client({ connection, namespace: config.temporal.namespace });
    return new TemporalBaselineRunner({ client, connection, config });
  }

  static fromClient(options: TemporalBaselineRunnerOptions): TemporalBaselineRunner {
    return new TemporalBaselineRunner(options);
  }

  static unavailable(config: ServerConfig, message: string): TemporalBaselineRunner {
    return new TemporalBaselineRunner({ client: null, config, unavailableMessage: message });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    const { temporal } = this.options.config;
    return {
      endpoint: temporal.endpoint,
      namespace: temporal.namespace,
      taskQueue: temporal.taskQueue,
      contextRoot: this.options.config.contextRoot,
      activityTimeoutMs: temporal.activityTimeoutMs,
      preDispatchRetryLimit: temporal.preDispatchRetryLimit,
      preDispatchRetryBackoffMs: temporal.preDispatchRetryBackoffMs,
      tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 },
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Temporal baseline runner only accepts temporal/baseline manifests." };
    }
    try {
      const configuration = temporalConfigurationFromManifest(manifest);
      if (configuration.namespace !== this.options.config.temporal.namespace) {
        return { valid: false, reason: "The run namespace does not match the configured Temporal profile." };
      }
      if (configuration.taskQueue !== this.options.config.temporal.taskQueue) {
        return { valid: false, reason: "The run task queue does not match the configured Temporal profile." };
      }
    } catch (error) {
      return { valid: false, reason: safeMessage(error, "The Temporal platform configuration is invalid.") };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (!this.options.client) {
      return { reachable: false, message: this.options.unavailableMessage ?? "Temporal is unavailable." };
    }
    try {
      const executions = this.options.client.workflow.list({ pageSize: 1 });
      await executions[Symbol.asyncIterator]().next();
      return { reachable: true, message: `Temporal reachable at ${this.options.config.temporal.endpoint}.` };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "Temporal is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const client = this.requireClient();
    const validation = this.validate(manifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Temporal manifest validation failed.");
    }

    const configuration = temporalConfigurationFromManifest(manifest);
    const workflowId = workflowIdForRun(manifest.runId);
    try {
      const handle = await client.workflow.start(temporalBaselineWorkflow, {
        args: [toWorkflowInput(manifest)],
        taskQueue: configuration.taskQueue,
        workflowId,
        workflowIdReusePolicy: "REJECT_DUPLICATE",
      });
      return referenceFromHandle(handle, manifest);
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error;
      }

      // A lost start acknowledgement must be reconciled by the deterministic
      // business ID, never by starting a second workflow.
      const existing = client.workflow.getHandle(workflowId);
      const description = await existing.describe();
      return referenceFromExecution(workflowId, description.runId, description.type, manifest, configuration);
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const handle = this.handle(reference);
    const description = await handle.describe();
    if (isTerminalStatus(description.status.name)) {
      return { accepted: false, alreadyTerminal: true, message: `Workflow is already ${description.status.name.toLowerCase()}.` };
    }

    await handle.signal(baselineCancelSignal, reason || "Cancellation requested.");
    return { accepted: true, alreadyTerminal: false, message: reason || "Cancellation requested." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const handle = this.handle(reference);
    const description = await handle.describe();
    const status = mapStatus(description.status.name);

    if (status === "queued" || status === "running") {
      const snapshot = await queryWithTimeout(
        handle.query<TemporalWorkflowSnapshot>(baselineSnapshotQuery),
        this.options.config.temporal.queryTimeoutMs,
      );
      if (snapshot === null) {
        // A live workflow query needs a worker task. When the worker is down,
        // return the last Lab projection instead of making the API request hang.
        return inspectionFromReference(reference, status);
      }
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
        // Visibility can briefly report RUNNING after the workflow has already
        // recorded its terminal state. Fetch the durable result when the query
        // sees that state so reconciliation never returns a false in-flight run.
        const result = await handle.result();
        return inspectionFromResult(reference, result);
      }
      return inspectionFromSnapshot(reference, snapshot);
    }

    const result = await handle.result();
    return inspectionFromResult(reference, result);
  }

  async close(): Promise<void> {
    await this.options.connection?.close();
  }

  private handle(reference: PlatformExecutionReference): WorkflowHandle<typeof temporalBaselineWorkflow> {
    const temporalReference = temporalExecutionFromReference(reference);
    return this.requireClient().workflow.getHandle<typeof temporalBaselineWorkflow>(
      temporalReference.workflowId,
      temporalReference.workflowRunId,
    );
  }

  private requireClient(): Client {
    if (!this.options.client) {
      throw new TemporalRunnerUnavailableError(this.options.unavailableMessage ?? "Temporal is unavailable.");
    }
    return this.options.client;
  }
}

export function workflowIdForRun(runId: string): string {
  return `${WORKFLOW_ID_PREFIX}${runId}`;
}

function toWorkflowInput(manifest: RunManifest): TemporalWorkflowInput {
  const configuration = temporalConfigurationFromManifest(manifest);
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    activityTimeoutMs: configuration.activityTimeoutMs,
    preDispatchRetryLimit: configuration.preDispatchRetryLimit,
    preDispatchRetryBackoffMs: configuration.preDispatchRetryBackoffMs,
    tools: manifest.capabilities?.tools ?? configuration.tools,
    ...(manifest.context.sessionId && manifest.context.turnId ? {
      context: {
        rootDirectory: configuration.contextRoot,
        sessionId: manifest.context.sessionId,
        turnId: manifest.context.turnId,
      },
    } : {}),
  };
}

interface TemporalManifestConfiguration {
  readonly endpoint: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly contextRoot: string;
  readonly activityTimeoutMs: number;
  readonly preDispatchRetryLimit: number;
  readonly preDispatchRetryBackoffMs: number;
  readonly tools: {
    readonly enabledNames: readonly string[];
    readonly maxRounds: number;
    readonly maxCalls: number;
  };
}

interface TemporalExecutionReference {
  readonly namespace: string;
  readonly taskQueue: string;
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly workflowType: string;
  readonly activityTypes: readonly string[];
}

function referenceFromHandle(handle: { workflowId: string; firstExecutionRunId: string }, manifest: RunManifest): PlatformExecutionReference {
  return referenceFromExecution(
    handle.workflowId,
    handle.firstExecutionRunId,
    BASELINE_WORKFLOW_TYPE,
    manifest,
    temporalConfigurationFromManifest(manifest),
  );
}

function referenceFromExecution(
  workflowId: string,
  workflowRunId: string,
  workflowType: string,
  manifest: RunManifest,
  configuration: TemporalManifestConfiguration,
): PlatformExecutionReference {
  const native: TemporalExecutionReference = {
    namespace: configuration.namespace,
    taskQueue: configuration.taskQueue,
    workflowId,
    workflowRunId,
    workflowType,
    activityTypes: [
      ...(manifest.context.sessionId && manifest.context.turnId ? ["prepareContext"] : []),
      "requestModel",
      ...(manifest.capabilities?.tools.enabledNames.length ? ["executeTool"] : []),
    ],
  };
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: workflowId,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function inspectionFromSnapshot(reference: PlatformExecutionReference, snapshot: TemporalWorkflowSnapshot): RunnerInspection {
  return {
    status: snapshot.status,
    reference,
    eventIntents: snapshot.eventIntents as readonly TemporalEventIntent[],
    result: null,
    trajectory: null,
    metrics: null,
  };
}

function inspectionFromReference(
  reference: PlatformExecutionReference,
  status: "queued" | "running",
): RunnerInspection {
  return {
    status,
    reference,
    eventIntents: [],
    result: null,
    trajectory: null,
    metrics: null,
  };
}

function inspectionFromResult(reference: PlatformExecutionReference, result: TemporalWorkflowResult): RunnerInspection {
  const runResult: RunResult = {
    schemaVersion: 1,
    runId: result.runId,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt ?? new Date().toISOString(),
    output: result.output,
    error: result.error,
    attemptCount: result.attemptCount,
    usage: result.usage,
  };
  return {
    status: result.status,
    reference,
    eventIntents: result.eventIntents as readonly TemporalEventIntent[],
    result: runResult,
    trajectory: {
      schemaVersion: 1,
      runId: result.runId,
      phases: result.trajectory.phases,
    },
    metrics: null,
  };
}

function temporalConfigurationFromManifest(manifest: RunManifest): TemporalManifestConfiguration {
  const configuration = manifest.platformConfig;
  return {
    endpoint: readString(configuration, "endpoint"),
    namespace: readString(configuration, "namespace"),
    taskQueue: readString(configuration, "taskQueue"),
    contextRoot: readString(configuration, "contextRoot"),
    activityTimeoutMs: readPositiveInteger(configuration, "activityTimeoutMs"),
    preDispatchRetryLimit: readNonNegativeInteger(configuration, "preDispatchRetryLimit"),
    preDispatchRetryBackoffMs: readPositiveInteger(configuration, "preDispatchRetryBackoffMs"),
    tools: readToolConfiguration(configuration),
  };
}

function readToolConfiguration(value: Readonly<Record<string, unknown>>): TemporalWorkflowInput["tools"] & object {
  const candidate = value.tools;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 };
  }
  const record = candidate as Record<string, unknown>;
  return {
    enabledNames: Array.isArray(record.enabledNames)
      ? record.enabledNames.filter((name): name is string => typeof name === "string")
      : ["calculator"],
    maxRounds: readPositiveIntegerValue(record.maxRounds, 6),
    maxCalls: readPositiveIntegerValue(record.maxCalls, 8),
  };
}

function readPositiveIntegerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function temporalExecutionFromReference(reference: PlatformExecutionReference): TemporalExecutionReference {
  if (reference.platform !== "temporal" || reference.variant !== "baseline") {
    throw new Error("The execution reference does not belong to the Temporal baseline runner.");
  }
  const native = reference.native;
  const activityTypes = native.activityTypes;
  if (!Array.isArray(activityTypes) || activityTypes.some((value) => typeof value !== "string")) {
    throw new Error("The Temporal execution reference has invalid activity metadata.");
  }
  return {
    namespace: readString(native, "namespace"),
    taskQueue: readString(native, "taskQueue"),
    workflowId: readString(native, "workflowId"),
    workflowRunId: readString(native, "workflowRunId"),
    workflowType: readString(native, "workflowType"),
    activityTypes,
  };
}

function readString(configuration: Readonly<Record<string, unknown>>, key: string): string {
  const value = configuration[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Temporal platform configuration is missing ${key}.`);
  }
  return value;
}

function readPositiveInteger(configuration: Readonly<Record<string, unknown>>, key: string): number {
  const value = configuration[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Temporal platform configuration has an invalid ${key}.`);
  }
  return value;
}

function readNonNegativeInteger(configuration: Readonly<Record<string, unknown>>, key: string): number {
  const value = configuration[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Temporal platform configuration has an invalid ${key}.`);
  }
  return value;
}

function mapStatus(status: WorkflowExecutionStatusName): "queued" | "running" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "FAILED":
    case "TERMINATED":
    case "TIMED_OUT":
      return "failed";
    default:
      return "queued";
  }
}

function isTerminalStatus(status: WorkflowExecutionStatusName): boolean {
  return status !== "RUNNING" && status !== "UNSPECIFIED" && status !== "UNKNOWN" && status !== "PAUSED";
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function queryWithTimeout<T>(query: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([query, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
