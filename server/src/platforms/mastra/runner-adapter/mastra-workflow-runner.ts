import { resolve } from "node:path";

import { LibSQLStore } from "@mastra/libsql";
import { Mastra } from "@mastra/core/mastra";
import type { WorkflowState } from "@mastra/core/workflows";

import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerResumeResult,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore, type ContextMessage } from "../../../capabilities/context/index.js";
import {
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  safeEnvironment,
  type MastraEnvironment,
} from "../variants/baseline/config/configuration.js";
import { defaultMastraModelFactory, type MastraModelFactory } from "../variants/baseline/models/factory.js";
import { createMastraWorkflow, MASTRA_WORKFLOW_ID, type MastraWorkflowEventSink, type MastraWorkflowInput } from "../variants/workflow/workflow.js";

const EXECUTION_ID_PREFIX = "mastra-workflow:";
const WORKFLOW_STORAGE_ENV = "AGENTLAB_MASTRA_WORKFLOW_STORAGE";

interface MastraWorkflowExecutionRecord {
  readonly reference: PlatformExecutionReference;
  readonly manifest: RunManifest;
  readonly startedAt: string;
  readonly events: RunEventIntent[];
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "cancelled";
  result: RunResult | null;
  trajectory: RunTrajectory | null;
  metrics: RunMetrics | null;
  nativeStatus: string;
  cancellationReason: string | null;
  contextMessages: MastraWorkflowInput["contextMessages"];
}

export interface MastraWorkflowRunnerOptions {
  readonly environment?: MastraEnvironment;
  readonly storagePath?: string;
  readonly contextRoot?: string;
  readonly modelFactory?: MastraModelFactory;
  readonly now?: () => Date;
}

/**
 * Runs a native Mastra workflow with file-backed LibSQL snapshots.
 *
 * The Lab projection is still authoritative for common evidence, while Mastra
 * owns the native workflow snapshot used for suspend/resume and restart
 * inspection. The local profile is single-process; the file is not presented
 * as a multi-process production database.
 */
export class MastraWorkflowRunner implements PlatformRunner {
  readonly platform = "mastra" as const;
  readonly variant = "workflow" as const;

  private readonly environment: MastraEnvironment;
  private readonly storagePath: string;
  private readonly contextRoot: string;
  private readonly modelFactory: MastraModelFactory;
  private readonly now: () => Date;
  private readonly executions = new Map<string, MastraWorkflowExecutionRecord>();
  private readonly storage: LibSQLStore | null;
  private readonly mastra: Mastra;
  private readonly workflow;
  private readonly ready: Promise<void>;
  private storageError: string | null;

  constructor(options: MastraWorkflowRunnerOptions = {}) {
    this.environment = options.environment ?? safeEnvironment();
    this.storagePath = resolve(options.storagePath ?? process.env[WORKFLOW_STORAGE_ENV] ?? "lab/mastra/mastra-workflows.db");
    this.contextRoot = resolve(options.contextRoot ?? process.env.AGENTLAB_CONTEXT_ROOT ?? "lab/sessions");
    this.modelFactory = options.modelFactory ?? defaultMastraModelFactory;
    this.now = options.now ?? (() => new Date());
    this.storageError = null;
    let storage: LibSQLStore | null = null;
    try {
      storage = new LibSQLStore({ id: "agentlab-mastra-workflows", url: `file:${this.storagePath}` });
    } catch (error) {
      this.storageError = errorMessage(error, "Mastra workflow storage could not be opened.");
    }
    this.storage = storage;
    this.workflow = createMastraWorkflow({
      modelFactory: this.modelFactory,
      eventSink: this.workflowEventSink(),
    });
    this.mastra = storage
      ? new Mastra({ storage, workflows: { agent: this.workflow }, logger: false })
      : new Mastra({ workflows: { agent: this.workflow }, logger: false });
    this.ready = storage
      ? storage.init().catch((error: unknown) => {
        this.storageError = errorMessage(error, "Mastra workflow storage is unavailable.");
      })
      : Promise.resolve();
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return {
      workflowId: MASTRA_WORKFLOW_ID,
      storage: "libsql-file",
      storagePath: this.storagePath,
      maxRetries: 0,
      maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      processScoped: false,
      localSingleProcess: true,
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== "mastra" || manifest.variant !== "workflow") {
      return { valid: false, reason: "The Mastra workflow runner only accepts mastra/workflow manifests." };
    }
    if (manifest.model.provider === "fake" && !["fake-success", "fake-slow", "fake-provider-failure", "fake-ambiguous", "fake-tool-call", "fake-context"].includes(manifest.model.model)) {
      return { valid: false, reason: `The Mastra fake model is unsupported: ${manifest.model.model}.` };
    }
    if (manifest.model.provider === "openrouter" && !this.environment.OPENROUTER_API_KEY?.trim()) {
      return { valid: false, reason: "OPENROUTER_API_KEY is required for the Mastra workflow OpenRouter profile." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    await this.ready;
    return this.storageError
      ? { reachable: false, message: `Mastra workflow storage is unavailable: ${this.storageError}` }
      : { reachable: true, message: "Mastra workflow runtime is ready with local LibSQL storage." };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "Mastra workflow manifest validation failed.");
    const existing = this.executions.get(manifest.runId);
    if (existing) return existing.reference;

    await this.ensureStorageReady();
    const reference = referenceFor(manifest, this.storagePath);
    // The in-memory map prevents duplicate starts within one process. The
    // native lookup closes the restart window: a retried admission must reuse
    // the persisted workflow identity instead of creating a second run with
    // the same Lab run ID.
    if (await this.nativeState(manifest.runId)) return reference;
    const record: MastraWorkflowExecutionRecord = {
      reference,
      manifest,
      startedAt: this.now().toISOString(),
      events: [],
      status: "queued",
      result: null,
      trajectory: null,
      metrics: null,
      nativeStatus: "pending",
      cancellationReason: null,
      contextMessages: [],
    };
    this.executions.set(manifest.runId, record);
    this.addEvent(record, "AgentStarted", { workflowId: MASTRA_WORKFLOW_ID });
    record.contextMessages = await this.prepareContext(record);
    this.addEvent(record, "WorkflowStarted", { workflowId: MASTRA_WORKFLOW_ID });

    const workflow = this.mastra.getWorkflowById(MASTRA_WORKFLOW_ID);
    const run = await workflow.createRun({ runId: manifest.runId });
    void this.execute(record, run, false);
    return reference;
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const runId = runIdFor(reference);
    const record = this.executions.get(runId);
    const state = await this.nativeState(runId);
    const nativeStatus = state?.status ?? record?.nativeStatus;
    if (nativeStatus === "success" || nativeStatus === "failed" || nativeStatus === "canceled") {
      return { accepted: false, alreadyTerminal: true, message: `Mastra workflow is already ${nativeStatus}.` };
    }
    const workflow = this.mastra.getWorkflowById(MASTRA_WORKFLOW_ID);
    const run = await workflow.createRun({ runId });
    if (record) record.cancellationReason = reason.trim() || "Cancellation requested.";
    await run.cancel();
    return { accepted: true, alreadyTerminal: false, message: reason.trim() || "Cancellation requested." };
  }

  async resume(reference: PlatformExecutionReference, input: unknown): Promise<RunnerResumeResult> {
    const runId = runIdFor(reference);
    const state = await this.nativeState(runId);
    if (!state) throw new Error(`Mastra workflow execution was not found: ${reference.executionId}.`);
    if (state.status !== "suspended") {
      const terminal = state.status === "success" || state.status === "failed" || state.status === "canceled";
      return { accepted: false, alreadyTerminal: terminal, message: `Mastra workflow is ${state.status}, not suspended.` };
    }
    const resumeData = parseResumeInput(input);
    const workflow = this.mastra.getWorkflowById(MASTRA_WORKFLOW_ID);
    const run = await workflow.createRun({ runId });
    const record = this.executions.get(runId);
    const resumedRecord = record ?? recordForNative(reference, runId, this.now);
    resumedRecord.status = "running";
    resumedRecord.nativeStatus = "running";
    this.executions.set(runId, resumedRecord);
    this.addEvent(resumedRecord, "WorkflowResumed", { approved: resumeData.approved });
    void this.execute(resumedRecord, run, true, resumeData);
    return { accepted: true, alreadyTerminal: false, message: "Mastra workflow resume accepted." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const runId = runIdFor(reference);
    const record = this.executions.get(runId);
    if (record?.result || record?.status === "suspended" || record?.status === "running" || record?.status === "queued") {
      const state = await this.nativeState(runId);
      if (!state || !record) return this.inspectionFromNative(reference, state);
      this.applyNativeStatus(record, state);
      return inspectionFromRecord(record);
    }
    const state = await this.nativeState(runId);
    return this.inspectionFromNative(reference, state);
  }

  async close(): Promise<void> {
    await this.ready;
    await this.storage?.close();
  }

  private async ensureStorageReady(): Promise<void> {
    await this.ready;
    if (this.storageError) throw new Error(`Mastra workflow storage is unavailable: ${this.storageError}`);
    if (!this.storage) throw new Error("Mastra workflow storage is unavailable.");
  }

  private async execute(record: MastraWorkflowExecutionRecord, run: Awaited<ReturnType<typeof this.workflow.createRun>>, resume: boolean, resumeData?: { approved: boolean }): Promise<void> {
    record.status = "running";
    record.nativeStatus = "running";
    try {
      const input = inputForManifest(record.manifest, record.contextMessages);
      const result = resume
        ? await run.resume({ label: "approval", resumeData })
        : await run.start({ inputData: input });
      record.nativeStatus = result.status;
      if (result.status === "suspended") {
        record.status = "suspended";
        this.addEvent(record, "WorkflowSuspended", { suspendPayload: safeRecord(result.suspendPayload) });
        return;
      }
      if (result.status !== "success") {
        const error = "error" in result && result.error instanceof Error ? result.error.message : "The Mastra workflow failed.";
        record.status = "failed";
        this.addEvent(record, "RunFailed", { nativeStatus: result.status });
        record.result = failureResult(record, "failed", error, "internal");
        record.trajectory = trajectoryFor(record);
        record.metrics = metricsFor(record);
        return;
      }
      record.status = "completed";
      this.addEvent(record, "WorkflowCompleted", { nativeStatus: result.status });
      this.addEvent(record, "RunCompleted", {});
      const output = safeRecord(result.result);
      record.result = {
        schemaVersion: 1,
        runId: record.manifest.runId,
        status: "completed",
        startedAt: record.startedAt,
        finishedAt: this.now().toISOString(),
        output: typeof output.response === "string" ? output.response : null,
        error: null,
        attemptCount: 1,
        usage: usageFrom(output.usage),
      };
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record);
    } catch (error) {
      record.status = record.cancellationReason ? "cancelled" : "failed";
      record.nativeStatus = record.status === "cancelled" ? "canceled" : "failed";
      this.addEvent(record, record.status === "cancelled" ? "RunCancelled" : "RunFailed", { message: errorMessage(error, "The Mastra workflow failed.") });
      record.result = failureResult(record, record.status, errorMessage(error, "The Mastra workflow failed."), record.status === "cancelled" ? "cancelled" : "internal");
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record);
    }
  }

  private async nativeState(runId: string): Promise<WorkflowState | null> {
    await this.ensureStorageReady();
    return this.mastra.getWorkflowById(MASTRA_WORKFLOW_ID).getWorkflowRunById(runId, {
      withNestedWorkflows: false,
      fields: ["result", "error", "steps", "suspendedPaths", "resumeLabels"],
    });
  }

  private inspectionFromNative(reference: PlatformExecutionReference, state: WorkflowState | null): RunnerInspection {
    if (!state) throw new Error(`Mastra workflow execution was not found: ${reference.executionId}.`);
    const record = recordForNative(reference, state.runId, this.now);
    record.nativeStatus = state.status;
    this.applyNativeStatus(record, state);
    return inspectionFromRecord(record);
  }

  private applyNativeStatus(record: MastraWorkflowExecutionRecord, state: WorkflowState): void {
    record.nativeStatus = state.status;
    if (state.status === "suspended") {
      record.status = "suspended";
      if (!record.events.some((event) => event.kind === "WorkflowSuspended")) {
        this.addEvent(record, "WorkflowSuspended", { suspendPayload: suspendPayloadFor(state.steps?.approval) });
      }
      return;
    }
    if (state.status === "success") {
      record.status = "completed";
      if (!record.result) {
        const output = safeRecord(state.result);
        record.result = {
          schemaVersion: 1,
          runId: record.manifest.runId,
          status: "completed",
          startedAt: record.startedAt,
          finishedAt: state.updatedAt.toISOString(),
          output: typeof output.response === "string" ? output.response : null,
          error: null,
          attemptCount: 1,
          usage: usageFrom(output.usage),
        };
        record.trajectory = trajectoryFor(record);
        record.metrics = metricsFor(record);
      }
      return;
    }
    if (state.status === "canceled") record.status = "cancelled";
    else if (state.status === "failed" || state.status === "tripwire" || state.status === "bailed") record.status = "failed";
    else if (state.status === "running" || state.status === "pending" || state.status === "waiting" || state.status === "paused") record.status = "running";
  }

  private async prepareContext(record: MastraWorkflowExecutionRecord): Promise<MastraWorkflowInput["contextMessages"]> {
    const { sessionId, turnId } = record.manifest.context;
    if (!sessionId || !turnId) return [];

    this.addEvent(record, "ContextPreparationStarted", { sessionId, turnId, trigger: "preflight" });
    const context = new ContextService(
      new ContextSessionStore(this.contextRoot),
      new CharacterTokenEstimator(),
    );
    const prepared = await context.prepareTurn(sessionId, turnId, {
      summarize: async () => {
        throw new Error("Mastra workflow context compaction is not enabled for this slice.");
      },
    });
    this.addEvent(record, "ContextPrepared", {
      sessionId,
      turnId,
      snapshotId: prepared.snapshot.snapshotId,
      inputTokens: prepared.snapshot.budget.inputTokens,
      remainingTokens: prepared.snapshot.budget.remainingTokens,
      remainingPercent: prepared.snapshot.budget.remainingPercent,
      pressure: prepared.snapshot.budget.pressure,
      compacted: prepared.snapshot.compaction !== null,
    });
    return prepared.snapshot.messages
      .filter((message) => message.role !== "system" && message.messageId !== prepared.turn.userMessageId)
      .map(toWorkflowContextMessage);
  }

  private workflowEventSink(): MastraWorkflowEventSink {
    return (runId, kind, payload) => {
      const record = this.executions.get(runId);
      if (record) this.addEvent(record, kind, payload as unknown as Record<string, unknown>);
    };
  }

  private addEvent(record: MastraWorkflowExecutionRecord, kind: string, payload: Record<string, unknown>): void {
    if (record.events.some((event) => event.kind === kind && JSON.stringify(event.payload) === JSON.stringify(payload))) return;
    record.events.push({
      source: "mastra-workflow",
      sourceSequence: record.events.length + 1,
      kind,
      runId: record.manifest.runId,
      occurredAt: this.now().toISOString(),
      payload,
    });
  }
}

function referenceFor(manifest: RunManifest, storagePath: string): PlatformExecutionReference {
  return {
    platform: "mastra",
    variant: "workflow",
    executionId: `${EXECUTION_ID_PREFIX}${manifest.runId}`,
    native: {
      schemaVersion: 2,
      evidenceSchema: "mastra.native.v2",
      workflowId: MASTRA_WORKFLOW_ID,
      workflowRunId: manifest.runId,
      storage: "libsql-file",
      storagePath: "configured-local-file",
      processScoped: false,
      localSingleProcess: true,
    },
  };
}

function runIdFor(reference: PlatformExecutionReference): string {
  if (reference.platform !== "mastra" || reference.variant !== "workflow" || !reference.executionId.startsWith(EXECUTION_ID_PREFIX)) {
    throw new Error("The execution reference does not belong to the Mastra workflow runner.");
  }
  return reference.executionId.slice(EXECUTION_ID_PREFIX.length);
}

function inputForManifest(manifest: RunManifest, contextMessages: MastraWorkflowInput["contextMessages"]) {
  return {
    prompt: manifest.task.prompt,
    modelProvider: manifest.model.provider,
    model: manifest.model.model,
    turnId: manifest.context.turnId ?? `${manifest.runId}:turn:1`,
    requiresApproval: manifest.task.prompt.trimStart().startsWith("[approval]"),
    capabilities: manifest.capabilities
      ? { tools: { ...manifest.capabilities.tools, enabledNames: [...manifest.capabilities.tools.enabledNames] } }
      : { tools: { enabledNames: ["calculator"], maxRounds: DEFAULT_MAX_TOOL_ROUNDS, maxCalls: DEFAULT_MAX_TOOL_CALLS } },
    contextMessages,
  };
}

function recordForNative(reference: PlatformExecutionReference, runId: string, now: () => Date): MastraWorkflowExecutionRecord {
  return {
    reference,
    manifest: manifestForNative(reference, runId, now),
    startedAt: now().toISOString(),
    events: [{ source: "mastra-workflow", sourceSequence: 1, kind: "AgentStarted", runId, occurredAt: now().toISOString(), payload: { workflowId: MASTRA_WORKFLOW_ID } }],
    status: "running",
    result: null,
    trajectory: null,
    metrics: null,
    nativeStatus: "pending",
    cancellationReason: null,
    contextMessages: [],
  };
}

function toWorkflowContextMessage(message: ContextMessage): MastraWorkflowInput["contextMessages"][number] {
  return {
    role: message.role === "developer" ? "system" : message.role,
    content: message.content,
    ...(message.metadata?.toolCallId ? { toolCallId: message.metadata.toolCallId } : {}),
    ...(message.metadata?.toolName ? { toolName: message.metadata.toolName } : {}),
  };
}

function manifestForNative(reference: PlatformExecutionReference, runId: string, now: () => Date): RunManifest {
  const native = reference.native;
  return {
    schemaVersion: 1,
    runId,
    createdAt: now().toISOString(),
    serverVersion: "mastra-workflow",
    platform: "mastra",
    variant: "workflow",
    task: { kind: "prompt", prompt: "Recovered Mastra workflow run" },
    context: { systemInstruction: "Recovered Mastra workflow run." },
    platformConfig: native,
    model: { provider: "fake", model: "unknown" },
  };
}

function inspectionFromRecord(record: MastraWorkflowExecutionRecord): RunnerInspection {
  return {
    status: record.status,
    reference: {
      ...record.reference,
      native: { ...record.reference.native, ...nativeSummaryFor(record) },
    },
    eventIntents: record.events,
    result: record.result,
    trajectory: record.trajectory,
    metrics: record.metrics,
  };
}

function nativeSummaryFor(record: MastraWorkflowExecutionRecord): Readonly<Record<string, unknown>> {
  return {
    evidenceSchema: "mastra.native.v2",
    nativeStatus: record.nativeStatus,
    eventCount: record.events.length,
    modelRequestCount: record.events.filter((event) => event.kind === "ModelRequested").length,
    toolCallCount: record.events.filter((event) => event.kind === "ToolCallRequested").length,
    toolAttemptCount: record.events.filter((event) => event.kind === "ToolExecutionStarted").length,
    contextPrepared: record.events.some((event) => event.kind === "ContextPrepared"),
    suspended: record.status === "suspended",
  };
}

function failureResult(record: MastraWorkflowExecutionRecord, status: "failed" | "cancelled", message: string, failureKind: "internal" | "cancelled"): RunResult {
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status,
    startedAt: record.startedAt,
    finishedAt: record.events.at(-1)?.occurredAt ?? record.startedAt,
    output: null,
    error: { code: status === "cancelled" ? "MASTRA_WORKFLOW_CANCELLED" : "MASTRA_WORKFLOW_FAILED", message, failureKind, retryable: false },
    attemptCount: 1,
    usage: emptyUsage(),
  };
}

function trajectoryFor(record: MastraWorkflowExecutionRecord): RunTrajectory {
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    phases: [{ name: "mastra.workflow", startedAt: record.startedAt, finishedAt: record.events.at(-1)?.occurredAt ?? null }],
  };
}

function metricsFor(record: MastraWorkflowExecutionRecord): RunMetrics {
  const usage = record.result?.usage ?? emptyUsage();
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status: record.status === "completed" || record.status === "cancelled" ? record.status : "failed",
    durationMs: record.events.at(-1) ? Math.max(0, Date.parse(record.events.at(-1)!.occurredAt) - Date.parse(record.startedAt)) : null,
    modelCallCount: record.events.filter((event) => event.kind === "ModelRequested").length,
    modelAttemptCount: record.events.filter((event) => event.kind === "ModelRequested").length,
    toolCallCount: record.events.filter((event) => event.kind === "ToolCallRequested").length,
    toolAttemptCount: record.events.filter((event) => event.kind === "ToolExecutionStarted").length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: null,
  };
}

function parseResumeInput(input: unknown): { approved: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as { approved?: unknown }).approved !== "boolean") {
    throw new Error("Mastra workflow resume input must contain an approved boolean.");
  }
  return { approved: (input as { approved: boolean }).approved };
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function suspendPayloadFor(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return suspendPayloadFor(value.at(-1));
  return safeRecord(value && typeof value === "object" ? (value as Record<string, unknown>).suspendPayload : undefined);
}

function usageFrom(value: unknown): RunUsage {
  const usage = safeRecord(value);
  return {
    inputTokens: numberOrNull(usage.inputTokens),
    outputTokens: numberOrNull(usage.outputTokens),
    totalTokens: numberOrNull(usage.totalTokens),
  };
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
