import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  type WorkflowHandle,
  type WorkflowExecutionStatusName,
} from "@temporalio/client";

import type { ServerConfig } from "../../../control-plane/bootstrap/config.js";
import type { RunManifest, RunResult, WorkflowExecutionReference } from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import { baselineSnapshotQuery, temporalBaselineWorkflow } from "../variants/baseline/workflow.js";
import type {
  TemporalEventIntent,
  TemporalWorkflowInput,
  TemporalWorkflowResult,
  TemporalWorkflowSnapshot,
} from "../variants/baseline/contracts.js";
import { BASELINE_WORKFLOW_TYPE } from "../variants/baseline/contracts.js";

const WORKFLOW_ID_PREFIX = "agentlab:";

export interface TemporalBaselineRunnerOptions {
  readonly client: Client;
  readonly connection?: Connection;
  readonly config: ServerConfig;
}

/**
 * Adapts the narrow control-plane runner port to Temporal's client API. No
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

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Temporal baseline runner only accepts temporal/baseline manifests." };
    }
    if (manifest.temporal.namespace !== this.options.config.temporal.namespace) {
      return { valid: false, reason: "The run namespace does not match the configured Temporal profile." };
    }
    if (manifest.temporal.taskQueue !== this.options.config.temporal.taskQueue) {
      return { valid: false, reason: "The run task queue does not match the configured Temporal profile." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    try {
      const executions = this.options.client.workflow.list({ pageSize: 1 });
      await executions[Symbol.asyncIterator]().next();
      return { reachable: true, message: `Temporal reachable at ${this.options.config.temporal.endpoint}.` };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "Temporal is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<WorkflowExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Temporal manifest validation failed.");
    }

    const workflowId = workflowIdForRun(manifest.runId);
    try {
      const handle = await this.options.client.workflow.start(temporalBaselineWorkflow, {
        args: [toWorkflowInput(manifest)],
        taskQueue: manifest.temporal.taskQueue,
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
      const existing = this.options.client.workflow.getHandle(workflowId);
      const description = await existing.describe();
      return {
        platform: "temporal",
        namespace: manifest.temporal.namespace,
        taskQueue: manifest.temporal.taskQueue,
        workflowId,
        workflowRunId: description.runId,
        workflowType: description.type,
      };
    }
  }

  async cancel(reference: WorkflowExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const handle = this.handle(reference);
    const description = await handle.describe();
    if (isTerminalStatus(description.status.name)) {
      return { accepted: false, alreadyTerminal: true, message: `Workflow is already ${description.status.name.toLowerCase()}.` };
    }

    await handle.cancel();
    return { accepted: true, alreadyTerminal: false, message: reason || "Cancellation requested." };
  }

  async inspect(reference: WorkflowExecutionReference): Promise<RunnerInspection> {
    const handle = this.handle(reference);
    const description = await handle.describe();
    const status = mapStatus(description.status.name);

    if (status === "queued" || status === "running") {
      const snapshot = await handle.query<TemporalWorkflowSnapshot>(baselineSnapshotQuery);
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

  private handle(reference: WorkflowExecutionReference): WorkflowHandle<typeof temporalBaselineWorkflow> {
    return this.options.client.workflow.getHandle<typeof temporalBaselineWorkflow>(reference.workflowId, reference.workflowRunId);
  }
}

export function workflowIdForRun(runId: string): string {
  return `${WORKFLOW_ID_PREFIX}${runId}`;
}

function toWorkflowInput(manifest: RunManifest): TemporalWorkflowInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    activityTimeoutMs: manifest.temporal.activityTimeoutMs,
    preDispatchRetryLimit: manifest.temporal.preDispatchRetryLimit,
    preDispatchRetryBackoffMs: manifest.temporal.preDispatchRetryBackoffMs,
  };
}

function referenceFromHandle(handle: { workflowId: string; firstExecutionRunId: string }, manifest: RunManifest): WorkflowExecutionReference {
  return {
    platform: "temporal",
    namespace: manifest.temporal.namespace,
    taskQueue: manifest.temporal.taskQueue,
    workflowId: handle.workflowId,
    workflowRunId: handle.firstExecutionRunId,
    workflowType: BASELINE_WORKFLOW_TYPE,
  };
}

function inspectionFromSnapshot(reference: WorkflowExecutionReference, snapshot: TemporalWorkflowSnapshot): RunnerInspection {
  return {
    status: snapshot.status,
    reference,
    eventIntents: snapshot.eventIntents as readonly TemporalEventIntent[],
    result: null,
    trajectory: null,
    metrics: null,
  };
}

function inspectionFromResult(reference: WorkflowExecutionReference, result: TemporalWorkflowResult): RunnerInspection {
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
