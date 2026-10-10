import { DurableAgent, type AgentSuspendedEventData } from "@mastra/core/agent/durable";
import { remainingExecutionMs, executionDeadlineReached } from "../../../capabilities/execution/policy.js";
import { prepareMastraRoundContext } from "./round-context.js";
import { acquireLocalOwner } from "./local-owner.js";
import { LibSQLStore } from "@mastra/libsql";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { InvocationResumeInput } from "../../../capabilities/reviews/contracts.js";
import { prepareToolInvocation } from "../../../capabilities/extensions/runtime.js";
import { getFreeEvalSettings, isFreeEval } from "../../../models/openrouter/free-model-policy.js";
import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../control-plane/domain/types.js";
import type { AgentExecutionOptionsBase } from "@mastra/core/agent";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerResumeResult,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  CharacterTokenEstimator,
  ContextService,
  ContextSessionStore,
  type ContextMessage,
} from "../../../capabilities/context/index.js";
import type { ToolCall, ToolExecutionResult, ToolLifecyclePayload } from "../../../capabilities/tools/contracts.js";
import {
  configurationFromManifest,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MASTRA_AGENT_ID,
  MASTRA_CORE_VERSION,
  MASTRA_OPERATION,
  MASTRA_STORAGE_MODE,
  safeEnvironment,
  validateConfiguration,
  type MastraEnvironment,
} from "../variants/baseline/config/configuration.js";
import { createBaselineAgentRuntime } from "../variants/baseline/agent.js";
import { liveOpenRouterModel } from "../variants/baseline/models/live-openrouter.js";
import { defaultMastraModelFactory, type MastraModelFactory } from "../variants/baseline/models/factory.js";
import { MASTRA_EVENT_SOURCE, type MastraExecutionRecord } from "../variants/baseline/contracts.js";
import { createMastraContextSummaryGenerator } from "./context-summary.js";
import { MASTRA_NATIVE_EVIDENCE_SCHEMA, validateMastraNativeEvidence } from "./native-evidence.js";

const EXECUTION_ID_PREFIX = "mastra:";

export interface MastraBaselineRunnerOptions {
  readonly environment?: MastraEnvironment;
  readonly executionTimeoutMs?: number;
  readonly modelFactory?: MastraModelFactory;
  /** Only synthetic evaluators opt in; default execution captures no tool content. */
  readonly onToolObservation?: (runId: string, call: ToolCall, result: ToolExecutionResult) => void;
  readonly now?: () => Date;
  readonly contextRoot?: string;
}

interface PreparedMastraContext {
  readonly currentMessageId: string;
  readonly messages: readonly ContextMessage[];
}

type MastraContextMessage = NonNullable<AgentExecutionOptionsBase<unknown>["context"]>[number];

/**
 * Runs default direct Agent execution or opt-in native durable sustained execution.
 *
 * Native suspended snapshots and the safe execution projection persist in
 * LibSQL/state storage. Waiting runs can be reconstructed without new inference;
 * sustained runs can recover native checkpoints under one local owner.
 */
export class MastraBaselineRunner implements PlatformRunner {
  readonly platform = "mastra" as const;
  readonly variant = "baseline" as const;
  readonly supportedExecutionModes = ["sustained"] as const;

  private readonly operations = new Map<string, Promise<void>>();
  private readonly persistence = new Map<string, Promise<void>>();
  private readonly executions = new Map<string, MastraExecutionRecord>();
  private readonly environment: MastraEnvironment;
  private readonly executionTimeoutMs: number;
  private readonly modelFactory?: MastraModelFactory;
  private readonly onToolObservation?: MastraBaselineRunnerOptions["onToolObservation"];
  private readonly now: () => Date;
  private readonly contextRoot: string;

  constructor(options: MastraBaselineRunnerOptions = {}) {
    this.environment = options.environment ?? safeEnvironment();
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    this.modelFactory = options.modelFactory;
    this.onToolObservation = options.onToolObservation;
    this.now = options.now ?? (() => new Date());
    this.contextRoot = options.contextRoot ?? process.env.AGENTLAB_CONTEXT_ROOT ?? "lab/sessions";
    if (!Number.isInteger(this.executionTimeoutMs) || this.executionTimeoutMs < 1) {
      throw new Error("Mastra executionTimeoutMs must be a positive integer.");
    }
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return {
      agentId: MASTRA_AGENT_ID,
      executionTimeoutMs: this.executionTimeoutMs,
      maxRetries: 0,
      maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      contextRoot: this.contextRoot,
      mastraVersion: MASTRA_CORE_VERSION,
      operation: MASTRA_OPERATION,
      storage: MASTRA_STORAGE_MODE,
      processScoped: true,
      waitingRecovery: "native-suspended-only",
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    try {
      const reason = validateConfiguration(manifest, this.environment);
      return reason === null ? { valid: true, reason: null } : { valid: false, reason };
    } catch (error) {
      return { valid: false, reason: safeErrorMessage(error, "The Mastra configuration is invalid.") };
    }
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.environment.OPENROUTER_API_KEY?.trim()) {
      return { reachable: true, message: "Mastra direct-agent runtime is ready; OpenRouter key is configured." };
    }

    return { reachable: true, message: "Mastra direct-agent runtime is ready for deterministic fake-model runs." };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Mastra manifest validation failed.");
    }

    const existing = this.executions.get(manifest.runId);
    if (existing) {
      return existing.reference;
    }

    const reference = referenceFor(manifest);
    if (manifest.execution) {
      try { await readFile(join(this.recordDirectory(manifest.runId), "state.json"), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const retained = await this.loadRetained(reference);
      if (retained) {
        if (retained.status === "running" || retained.status === "queued") this.launch(retained, undefined, true);
        return reference;
      }
    }
    const record: MastraExecutionRecord = {
      reference,
      manifest,
      controller: new AbortController(),
      events: [],
      startedAt: this.now().toISOString(),
      status: "queued",
      result: null,
      trajectory: null,
      metrics: null,
      cancellationReason: null,
      timeoutRequested: false,
    };
    let owner: (() => Promise<void>) | undefined;
    if (manifest.execution) {
      await mkdir(this.recordDirectory(manifest.runId), { recursive: true, mode: 0o700 });
      owner = await acquireLocalOwner(this.recordDirectory(manifest.runId)) ?? undefined;
      if (!owner) throw new Error("The Mastra sustained run already has a local owner.");
      // Recheck admission after claiming ownership, before publishing a new state.
      const retained = await this.loadRetained(reference);
      if (retained) { this.launch(retained, undefined, true, owner); return reference; }
    }
    this.executions.set(manifest.runId, record);
    try { await this.persist(record); } catch (error) { await owner?.(); throw error; }
    this.launch(record, undefined, false, owner);
    return reference;
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const record = await this.requireExecution(reference);
    if (isTerminal(record.status)) {
      return {
        accepted: false,
        alreadyTerminal: true,
        message: `Mastra execution is already ${record.status}.`,
      };
    }

    record.cancellationReason = reason.trim() || "Cancellation requested.";
    record.controller.abort(record.cancellationReason);
    if (record.status === "suspended") {
      this.addEvent(record, "AgentCancelled", { reason: record.cancellationReason });
      this.addEvent(record, "RunCancelled", {});
      record.status = "cancelled";
      record.pendingReview = null;
      record.result = resultFor(record, "cancelled", null, failureFor(record, abortError()), emptyUsage());
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, emptyUsage());
      await this.persist(record);
    }
    return { accepted: true, alreadyTerminal: false, message: record.cancellationReason };
  }

  async resume(reference: PlatformExecutionReference, input: unknown): Promise<RunnerResumeResult> {
    const decision = input as InvocationResumeInput;
    const record = await this.requireExecution(reference);
    if (isTerminal(record.status)) return { accepted: false, alreadyTerminal: true, message: "Mastra run is terminal." };
    const pending = record.pendingReview;
    if (decision?.kind === "invocation_review" && decision.decision === "renewed" && pending && record.status === "suspended" &&
        decision.requestId === pending.requestId && decision.toolCallId === pending.call.toolCallId && decision.revision === pending.revision + 1) {
      const fresh = await prepareToolInvocation(record.manifest.capabilities!.toolCatalog!, record.pendingCall!, {
        runId: record.manifest.runId, turnId: record.manifest.context.turnId!, signal: record.controller.signal });
      if (!fresh || fresh.revision !== decision.revision || fresh.status !== "pending") return { accepted: false, alreadyTerminal: false, message: "Renewed review is unavailable." };
      record.pendingReview = fresh;
      this.addEvent(record, "WorkflowSuspended", { reason: "invocation_review", requestId: fresh.requestId, revision: fresh.revision,
        toolCallId: fresh.call.toolCallId, toolName: fresh.call.name, argumentDigest: fresh.argumentDigest });
      await this.persist(record);
      return { accepted: true, alreadyTerminal: false, message: "Waiting on the renewed review without executing the tool." };
    }
    if (!decision || decision.kind !== "invocation_review" || !pending || record.status !== "suspended" ||
        decision.requestId !== pending.requestId || decision.revision !== pending.revision ||
        decision.toolCallId !== pending.call.toolCallId || typeof decision.decisionId !== "string" ||
        !["approved", "denied"].includes(decision.decision)) {
      return { accepted: false, alreadyTerminal: false, message: "Mastra is not awaiting this exact action decision." };
    }
    const owner = record.manifest.execution ? await acquireLocalOwner(this.recordDirectory(record.manifest.runId)) : undefined;
    if (owner === null) return { accepted: false, alreadyTerminal: false, message: "The Mastra sustained run already has a local owner." };
    record.status = "running";
    if (decision.decision === "denied") this.addEvent(record, "ToolPolicyDenied", {
      toolCallId: pending.call.toolCallId, toolName: pending.call.name, code: "TOOL_APPROVAL_DENIED" });
    this.addEvent(record, "WorkflowResumed", { reason: "invocation_review", requestId: pending.requestId,
      toolCallId: pending.call.toolCallId, decision: decision.decision });
    try { await this.persist(record); } catch (error) { await owner?.(); throw error; }
    this.launch(record, decision, false, owner);
    return { accepted: true, alreadyTerminal: false, message: "Continuing the existing Mastra suspended run." };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const record = await this.requireExecution(reference);
    if (record.status === "suspended" && executionDeadlineReached(record.manifest.execution, this.now().getTime())) await this.expireSuspended(record);
    const native = { ...record.reference.native, ...nativeSummaryFor(record) };
    validateMastraNativeEvidence(native, "baseline");
    return {
      status: record.status,
      reference: {
        ...record.reference,
        native,
      },
      eventIntents: record.events,
      result: record.result,
      trajectory: record.trajectory,
      metrics: record.metrics,
    };
  }

  async close(): Promise<void> {
    await Promise.all(this.operations.values());
  }

  private launch(record: MastraExecutionRecord, resume?: InvocationResumeInput, recover = false, owner?: () => Promise<void>): void {
    const operation = this.execute(record, resume, recover, owner);
    this.operations.set(record.manifest.runId, operation);
    void operation.finally(() => {
      if (this.operations.get(record.manifest.runId) === operation) this.operations.delete(record.manifest.runId);
    }).catch(() => undefined);
  }

  private async execute(record: MastraExecutionRecord, resume?: InvocationResumeInput, recover = false, owner?: () => Promise<void>): Promise<void> {
    const sustained = record.manifest.execution !== undefined;
    let release: (() => Promise<void>) | null = owner ?? null;
    let storage: LibSQLStore | null = null;
    let durable: DurableAgent | null = null;
    if (sustained && !release) {
      await mkdir(this.recordDirectory(record.manifest.runId), { recursive: true, mode: 0o700 });
      release = await acquireLocalOwner(this.recordDirectory(record.manifest.runId));
      if (!release) return;
    }
    const configuration = configurationFromManifest(record.manifest);
    record.status = "running";
    if (!resume && !recover) this.addEvent(record, "AgentStarted", { agentId: configuration.agentId });
    if (!resume && !recover) this.addEvent(record, "ModelRequested", {
      model: record.manifest.model.model,
      provider: record.manifest.model.provider,
    });

    const timeout = setTimeout(() => {
      record.timeoutRequested = true;
      record.controller.abort("Mastra execution timed out.");
    }, sustained ? Math.max(1, remainingExecutionMs(record.manifest.execution, this.now().getTime())) : configuration.executionTimeoutMs);

    try {
      if (recover && (record.pendingDispatches?.length || record.unsafeOutcome)) {
        this.addEvent(record, "RecoveryRefused", { reason: "external_dispatch_unresolved", toolCallIds: record.pendingDispatches ?? [] });
        const error = new Error("An external dispatch is unresolved. Inspect its receipt before recovery.");
        error.name = "MASTRA_RECOVERY_UNSAFE";
        throw error;
      }
      await this.persist(record);
      if (executionDeadlineReached(record.manifest.execution, this.now().getTime())) throw new Error("The sustained execution deadline has expired.");
      const context = resume || recover ? null : await this.prepareContext(record, configuration.contextRoot);
      const directory = this.recordDirectory(record.manifest.runId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      storage = new LibSQLStore({ id: `agentlab-mastra-${record.manifest.runId}`, url: `file:${join(directory, "snapshots.db")}` });
      await storage.init();
      const liveEval = isFreeEval(record.manifest.selection?.experimentId);
      const modelFactory = liveEval ? (manifest: RunManifest) => liveOpenRouterModel(manifest,
        (observation) => this.addEvent(record, "EvalModelObserved", { observation })) : this.modelFactory;
      const runtime = createBaselineAgentRuntime(record.manifest, modelFactory, {
        storage,
        sustained,
        onModelTimeout: sustained ? () => { record.timeoutRequested = true; record.controller.abort("Mastra model request timed out."); } : undefined,
        beforeModelRequest: sustained ? async input => {
          const summary = createMastraContextSummaryGenerator({ ...this.summaryObservationOptions(record), manifest: record.manifest, modelFactory: modelFactory ?? defaultMastraModelFactory,
            signal: AbortSignal.any([record.controller.signal, AbortSignal.timeout(Math.max(1, Math.min(record.manifest.execution!.modelTimeoutMs, remainingExecutionMs(record.manifest.execution, this.now().getTime()))))]) });
          const prepared = await prepareMastraRoundContext(record.manifest, this.contextRoot, directory,
            record.events.filter(event => event.kind === "DurableModelRequested").length + 1, input,
            { summarize: async request => {
              this.addEvent(record, "ContextCompactionStarted", { trigger: "native_round", sourceRevision: request.sourceRevision });
              await this.persist(record);
              const content = await summary.summarize(request);
              this.addEvent(record, "ContextCompactionCompleted", { trigger: "native_round", sourceRevision: request.sourceRevision });
              await this.persist(record);
              return content;
            } });
          if (prepared.budget) this.addEvent(record, "ContextRoundPrepared", { budget: prepared.budget, compaction: prepared.compaction });
          this.addEvent(record, "DurableModelRequested", { purpose: "agent", operation: recover ? "recovery" : "execution" });
          await this.persist(record);
          return prepared.prompt;
        } : undefined,
        beforeToolDispatch: sustained ? async call => {
          if (executionDeadlineReached(record.manifest.execution, this.now().getTime())) throw new Error("The sustained execution deadline has expired before tool dispatch.");
          const isExternal = (record.manifest.capabilities?.connections ?? []).some(binding => binding.toolName === call.name)
            || record.manifest.capabilities?.toolCatalog?.tools.some(tool => tool.definition.name === call.name && (tool.execution.kind === "hosted" || tool.definition.executionKind === "connection" || ["write", "external"].includes(tool.definition.riskClass)));
          if (isExternal) record.pendingDispatches = [...(record.pendingDispatches ?? []), call.toolCallId];
          await this.persist(record);
        } : undefined,
        afterToolDispatch: sustained ? async (_call, result) => {
          // An acknowledged tool result can precede its native checkpoint. Keep
          // the external barrier through the segment rather than authorize replay
          // in that window. Terminal native settlement clears it below.
          record.unsafeOutcome ||= result.status === "unknown" || result.effect?.state === "unknown";
          await this.persist(record);
        } : undefined,
        runId: record.manifest.runId,
        turnId: record.manifest.context.turnId ?? `${record.manifest.runId}:turn:1`,
        signal: record.controller.signal,
        maxToolCalls: configuration.maxToolCalls - record.events.filter(event => event.kind === "ToolExecutionStarted").length,
        currentRound: () => record.pendingReview?.call.round ?? record.events.filter(event => event.kind === "AgentStepCompleted").length + 1,
        connectionBindings: record.manifest.capabilities?.connections,
        onToolObservation: (call, result) => {
          this.onToolObservation?.(record.manifest.runId, call, result);
          if (liveEval) this.addEvent(record, "EvalToolObserved", { toolCallId: call.toolCallId, name: call.name, arguments: call.arguments, output: result.content, status: result.status });
        },
        onToolEvent: (kind, payload) => {
          if (kind !== "ToolCallRequested" || !record.events.some(event => event.kind === kind && event.payload.toolCallId === payload.toolCallId)) this.addEvent(record, kind, payload);
          if (kind === "ToolExecutionStarted" && payload.toolCallId === record.pendingReview?.call.toolCallId) record.pendingReview = null;
        },
      });
      durable = runtime.agent instanceof DurableAgent ? runtime.agent : null;
      const generationOptions = {
        runId: record.manifest.runId,
        abortSignal: record.controller.signal,
        ...(context ? {
          context: context.messages
            .filter((message) => !(message.role === "system" && message.source === "system") && message.messageId !== context.currentMessageId)
            .map(toMastraMessage),
        } : {}),
        maxSteps: Math.max(1, configuration.maxToolRounds - record.events.filter(event => event.kind === "AgentStepCompleted").length),
        stopWhen: () => record.controller.signal.aborted || record.events.some(event => event.kind === "ToolExecutionUnknown"),
        ...(liveEval ? { modelSettings: { maxOutputTokens: getFreeEvalSettings(record.manifest.selection?.experimentId)!.maxOutputTokens } } : {}),
        onStepFinish: (step: unknown) => {
          // Mastra can reject schema-invalid or absent tools before our execute
          // callback. Normalize those observed SDK calls without inventing dispatch.
          const sdk = step as unknown as { toolCalls?: readonly { payload?: { toolCallId?: string; toolName?: string; args?: unknown } }[];
            toolResults?: readonly { payload?: { toolCallId?: string; result?: { error?: boolean; message?: string; validationErrors?: unknown } } }[] };
          for (const entry of sdk.toolCalls ?? []) {
            const call = entry.payload;
            if (!call?.toolCallId || !call.toolName || record.events.some(event => event.kind === "ToolCallRequested" && event.payload.toolCallId === call.toolCallId)) continue;
            const nativeResult = sdk.toolResults?.find(result => result.payload?.toolCallId === call.toolCallId)?.payload?.result;
            const enabled = record.manifest.capabilities?.tools.enabledNames ?? ["calculator"];
            const disabled = !enabled.includes(call.toolName);
            if (!disabled && nativeResult?.error !== true) continue;
            const payload = { toolCallId: call.toolCallId, toolName: call.toolName, round: record.events.filter(event => event.kind === "AgentStepCompleted").length + 1,
              argumentBytes: new TextEncoder().encode(JSON.stringify(call.args ?? null)).byteLength, nativeBoundary: "mastra-sdk" };
            this.addEvent(record, "ToolCallRequested", payload);
            this.addEvent(record, "ToolCallRejected", { ...payload,
              code: disabled ? "TOOL_NOT_ENABLED" : nativeResult?.validationErrors ? "INVALID_ARGUMENTS" : "MASTRA_NATIVE_TOOL_REJECTED",
              message: disabled ? "The native SDK did not register the requested tool." : "The native SDK rejected the tool input before execution." });
          }
          this.addEvent(record, "AgentStepCompleted", {
            finishReason: safeValue(step, "finishReason"),
            usage: safeUsage((step as unknown as { usage?: unknown }).usage),
          });
        },
      } satisfies AgentExecutionOptionsBase<unknown>;
      if (recover && durable) {
        const snapshot = await durable.getWorkflow().getWorkflowRunById(record.manifest.runId, { withNestedWorkflows: true });
        await writeFile(join(directory, "recovery-snapshot.json"), JSON.stringify(snapshot), { mode: 0o600 });
      }
      let observeSuspension!: (data: AgentSuspendedEventData) => void;
      const suspension = new Promise<{ finishReason: "suspended"; suspendPayload: AgentSuspendedEventData;
        text: string; totalUsage: undefined; usage: undefined }>(resolve => {
        observeSuspension = data => resolve({ finishReason: "suspended", suspendPayload: data,
          text: "", totalUsage: undefined, usage: undefined });
      });
      const recovered = recover && runtime.agent instanceof DurableAgent
        ? await runtime.agent.recover(record.manifest.runId, { abortSignal: record.controller.signal,
          onStepFinish: generationOptions.onStepFinish, onSuspended: observeSuspension }) : null;
      // The public recover stream intentionally stays open at suspension. Observe
      // its native suspension callback so waiting releases the local owner/timer.
      const output = recovered
        ? await Promise.race([recovered.output.getFullOutput(), suspension])
        : resume
        ? resume.decision === "approved"
          ? await runtime.agent.approveToolCallGenerate({ ...generationOptions, runId: record.manifest.runId, toolCallId: resume.toolCallId })
          : await runtime.agent.declineToolCallGenerate({ ...generationOptions, runId: record.manifest.runId, toolCallId: resume.toolCallId, reason: JSON.stringify({ code: "TOOL_APPROVAL_DENIED", error: resume.reason ?? "The proposed action was declined." }) })
        : await runtime.agent.generate(record.manifest.task.prompt, generationOptions);
      if (recovered) {
        await waitForDurableSettlement(runtime.agent as DurableAgent, record.manifest.runId);
        recovered.cleanup();
      }
      if (output.finishReason === "suspended") {
        const payload = output.suspendPayload as { toolCallId?: string; toolName?: string; args?: unknown } | undefined;
        if (!payload?.toolCallId || !payload.toolName || !record.manifest.capabilities?.toolCatalog) throw new Error("Mastra suspended without an admitted tool identity.");
        const call = { toolCallId: payload.toolCallId, name: payload.toolName, arguments: payload.args,
          round: Math.max(1, record.events.filter(event => event.kind === "AgentStepCompleted").length) };
        const review = await prepareToolInvocation(record.manifest.capabilities.toolCatalog, call, {
          runId: record.manifest.runId, turnId: record.manifest.context.turnId!, signal: record.controller.signal });
        if (!review) throw new Error("Mastra suspension has no invocation review policy.");
        record.pendingReview = review;
        record.pendingCall = call;
        this.addEvent(record, "ToolCallRequested", { toolCallId: call.toolCallId, toolName: call.name, round: call.round });
        this.addEvent(record, "WorkflowSuspended", { reason: "invocation_review", requestId: review.requestId,
          revision: review.revision, toolCallId: call.toolCallId, toolName: call.name, argumentDigest: review.argumentDigest });
        record.status = "suspended";
        await this.persist(record);
        return;
      }
      record.pendingReview = null;
      record.pendingCall = null;
      // Mastra's generate() may resolve with an empty output after an abort
      // rather than reject. Treat that as a known cancellation. If a real
      // response survived the cancellation race, preserve the observed result.
      if (record.controller.signal.aborted && output.text.trim().length === 0) {
        throw abortError();
      }
      if (record.events.some((event) => event.kind === "ToolExecutionUnknown")) {
        const error = new Error("A Mastra tool may have been dispatched but its external outcome could not be confirmed.");
        error.name = "TOOL_UNKNOWN";
        throw error;
      }
      // The SDK can turn a tool exception into model feedback and return normally.
      // Preserve the limit outcome even when a later model step returns text.
      const callLimit = record.events.some((event) =>
        event.kind === "ToolCallRejected" && event.payload.code === "TOOL_CALL_LIMIT_EXCEEDED");
      const roundLimit = output.finishReason === "tool-calls"
        && record.events.filter((event) => event.kind === "AgentStepCompleted").length >= configuration.maxToolRounds;
      if (callLimit || roundLimit) {
        const error = new Error("The Mastra execution reached its configured limit.");
        error.name = callLimit ? "MASTRA_TOOL_CALL_LIMIT_EXCEEDED" : "MASTRA_MODEL_ROUND_LIMIT_EXCEEDED";
        throw error;
      }
      const usage = normalizeUsage(output.totalUsage ?? output.usage);
      this.addEvent(record, "ModelCompleted", { finishReason: output.finishReason ?? null, usage });
      this.addEvent(record, "AgentCompleted", { finishReason: output.finishReason ?? null });
      this.addEvent(record, "RunCompleted", {});
      record.status = "completed";
      record.result = resultFor(record, "completed", output.text, null, usage);
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, usage);
    } catch (error) {
      const failure = failureFor(record, error);
      if (failure.failureKind === "cancelled") {
        this.addEvent(record, "AgentCancelled", { reason: record.cancellationReason ?? "Cancellation requested." });
        this.addEvent(record, "RunCancelled", {});
        record.status = "cancelled";
      } else {
        this.addEvent(record, "ModelFailed", { code: failure.code, failureKind: failure.failureKind });
        this.addEvent(record, "AgentFailed", { code: failure.code, failureKind: failure.failureKind });
        this.addEvent(record, "RunFailed", { code: failure.code, failureKind: failure.failureKind });
        record.status = "failed";
      }
      const terminalStatus = record.status === "cancelled" ? "cancelled" : "failed";
      record.result = resultFor(record, terminalStatus, null, failure, emptyUsage());
      if (error instanceof Error && error.name === "MASTRA_RECOVERY_UNSAFE") {
        record.result = { ...record.result, status: "reconciliation_required", error: { code: error.name, message: error.message, failureKind: "outcome_unknown", retryable: false } };
      }
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, emptyUsage());
    } finally {
      // The pinned generate API emits its final output before native settlement.
      // Keep storage and local ownership until the workflow has finished writing.
      if (durable) await waitForDurableSettlement(durable, record.manifest.runId);
      clearTimeout(timeout);
      if (record.status === "completed") record.pendingDispatches = [];
      await this.persist(record);
      await storage?.close();
      await release?.();
    }
  }

  private async prepareContext(record: MastraExecutionRecord, contextRoot: string): Promise<PreparedMastraContext | null> {
    const { sessionId, turnId } = record.manifest.context;
    if (!sessionId || !turnId) return null;

    this.addEvent(record, "ContextPreparationStarted", { sessionId, turnId, trigger: "preflight" });
    const context = new ContextService(
      new ContextSessionStore(contextRoot),
      new CharacterTokenEstimator(),
    );
    const summarizer = isFreeEval(record.manifest.selection?.experimentId)
      ? { summarize: async () => { throw new Error("Live development probes do not permit context compaction."); } }
      : createMastraContextSummaryGenerator({
      ...this.summaryObservationOptions(record),
      manifest: record.manifest,
      modelFactory: this.modelFactory ?? defaultMastraModelFactory,
      signal: record.controller.signal,
    });
    const prepared = await context.prepareTurn(sessionId, turnId, summarizer, {
      capabilityInventory: record.manifest.capabilities?.inventory,
    });
    this.addEvent(record, "ContextPrepared", {
      sessionId,
      turnId,
      snapshotId: prepared.snapshot.snapshotId,
      inputTokens: prepared.snapshot.budget.inputTokens,
      remainingTokens: prepared.snapshot.budget.remainingTokens,
      remainingPercent: prepared.snapshot.budget.remainingPercent,
      pressure: prepared.snapshot.budget.pressure,
      quality: prepared.snapshot.budget.quality,
      compacted: prepared.snapshot.compaction !== null,
    });
    return {
      currentMessageId: prepared.turn.userMessageId,
      messages: prepared.snapshot.messages,
    };
  }

  private addEvent(record: MastraExecutionRecord, kind: string, payload: Record<string, unknown> | ToolLifecyclePayload): void {
    record.events.push({
      source: MASTRA_EVENT_SOURCE,
      sourceSequence: record.events.length + 1,
      kind,
      runId: record.manifest.runId,
      occurredAt: this.now().toISOString(),
      payload: payload as Record<string, unknown>,
    });
  }

  private recordDirectory(runId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) throw new Error("Unsafe Mastra run identity.");
    return join(this.contextRoot, ".mastra-baseline", runId);
  }

  private persist(record: MastraExecutionRecord): Promise<void> {
    const prior = this.persistence.get(record.manifest.runId) ?? Promise.resolve();
    const operation = prior.then(() => this.writeRecord(record));
    this.persistence.set(record.manifest.runId, operation.catch(() => undefined));
    return operation;
  }

  private async writeRecord(record: MastraExecutionRecord): Promise<void> {
    const directory = this.recordDirectory(record.manifest.runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const { controller: _controller, ...retained } = record;
    const temporary = join(directory, `state.${randomUUID()}.pending`);
    await writeFile(temporary, JSON.stringify(retained), { mode: 0o600 });
    await rename(temporary, join(directory, "state.json"));
  }

  /** Cancel the persisted native wait without approving or dispatching its tool. */
  private async expireSuspended(record: MastraExecutionRecord): Promise<void> {
    const directory = this.recordDirectory(record.manifest.runId);
    const owner = await acquireLocalOwner(directory);
    if (!owner) return;
    const storage = new LibSQLStore({ id: `agentlab-mastra-expiry-${record.manifest.runId}`, url: `file:${join(directory, "snapshots.db")}` });
    try {
      await storage.init();
      const runtime = createBaselineAgentRuntime(record.manifest, this.modelFactory, { storage, sustained: true,
        runId: record.manifest.runId, turnId: record.manifest.context.turnId ?? `${record.manifest.runId}:turn:1`,
        signal: record.controller.signal, maxToolCalls: 0 });
      const workflow = runtime.agent.getWorkflow();
      const nativeRun = await workflow.createRun({ runId: record.manifest.runId });
      await nativeRun.cancel();
      const observed = await workflow.getWorkflowRunById(record.manifest.runId);
      if (observed?.status !== "canceled") throw new Error("The Mastra persisted wait cancellation was not confirmed.");
      record.status = "failed";
      record.pendingReview = null;
      record.pendingCall = null;
      this.addEvent(record, "WorkflowCanceled", { reason: "task_deadline", nativeStatus: observed.status });
      this.addEvent(record, "RunFailed", { code: "RUN_DEADLINE_EXCEEDED", failureKind: "timeout" });
      record.result = resultFor(record, "failed", null, { code: "RUN_DEADLINE_EXCEEDED",
        message: "The admitted task deadline expired while waiting for approval.", failureKind: "timeout", retryable: false }, emptyUsage());
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, emptyUsage());
      await this.persist(record);
    } finally { await storage.close(); await owner(); }
  }

  private summaryObservationOptions(record: MastraExecutionRecord) {
    return {
      onRequest: async () => {
        this.addEvent(record, "SummaryModelRequested", { purpose: "summary" });
        await this.persist(record);
      },
      onUsage: async (usage: unknown) => {
        this.addEvent(record, "SummaryModelCompleted", { purpose: "summary", usage: safeUsage(usage) });
        await this.persist(record);
      },
    };
  }

  private async requireExecution(reference: PlatformExecutionReference): Promise<MastraExecutionRecord> {
    if (reference.platform !== this.platform || reference.variant !== this.variant) {
      throw new Error("The execution reference does not belong to the Mastra baseline runner.");
    }

    const runId = reference.executionId.slice(EXECUTION_ID_PREFIX.length);
    const current = this.executions.get(runId);
    if (current && (this.operations.has(runId) || !current.manifest.execution || current.status === "suspended" || isTerminal(current.status))) return current;
    const retained = await this.loadRetained(reference);
    if (!retained) throw new Error(`Mastra execution was not found or cannot be safely reconstructed: ${reference.executionId}.`);
    if (retained.manifest.execution && (retained.status === "running" || retained.status === "queued")) {
      this.launch(retained, undefined, true);
    }
    return retained;
  }

  private async loadRetained(reference: PlatformExecutionReference): Promise<MastraExecutionRecord | null> {
    const runId = reference.executionId.slice(EXECUTION_ID_PREFIX.length);
    try {
      const saved = JSON.parse(await readFile(join(this.recordDirectory(runId), "state.json"), "utf8")) as Omit<MastraExecutionRecord, "controller">;
      if (saved.manifest.runId !== runId || saved.reference.executionId !== reference.executionId ||
          (!saved.manifest.execution && saved.status !== "suspended" && !isTerminal(saved.status))) return null;
      const record = { ...saved, controller: new AbortController() };
      this.executions.set(runId, record);
      return record;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

}

/** Bound waiting for the SDK's trailing snapshot writes after final stream output. */
export async function waitForDurableSettlement(agent: DurableAgent, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await agent.getWorkflow().getWorkflowRunById(runId);
    if (!state || ["success", "failed", "canceled", "suspended", "bailed", "tripwire"].includes(state.status)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error("The Mastra durable workflow did not settle within five seconds.");
}

function referenceFor(manifest: RunManifest): PlatformExecutionReference {
  const native = {
    schemaVersion: 2,
    evidenceSchema: MASTRA_NATIVE_EVIDENCE_SCHEMA,
    mastraVersion: MASTRA_CORE_VERSION,
    agentId: MASTRA_AGENT_ID,
    operation: MASTRA_OPERATION,
    processScoped: !manifest.execution,
    ...(manifest.execution ? { executionMode: "sustained", nativeEngine: "durable-agentic-loop", localSingleProcess: true } : {}),
    storage: MASTRA_STORAGE_MODE,
    modelProvider: manifest.model.provider,
    model: manifest.model.model,
  };
  validateMastraNativeEvidence(native, "baseline");
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: `${EXECUTION_ID_PREFIX}${manifest.runId}`,
    native,
  };
}

function nativeSummaryFor(record: MastraExecutionRecord): Readonly<Record<string, unknown>> {
  return {
    evidenceSchema: MASTRA_NATIVE_EVIDENCE_SCHEMA,
    schemaVersion: 2,
    nativeStatus: record.status,
    eventCount: record.events.length,
    modelStepCount: record.events.filter((event) => event.kind === "AgentStepCompleted").length,
    toolCallCount: record.events.filter((event) => event.kind === "ToolCallRequested").length,
    toolAttemptCount: record.events.filter((event) => event.kind === "ToolExecutionStarted").length,
    contextPrepared: record.events.some((event) => event.kind === "ContextPrepared"),
  };
}

function resultFor(
  record: MastraExecutionRecord,
  status: "completed" | "failed" | "cancelled",
  output: string | null,
  error: RunResult["error"],
  usage: RunUsage,
): RunResult {
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status,
    startedAt: record.startedAt,
    finishedAt: record.events.at(-1)?.occurredAt ?? record.startedAt,
    output,
    error,
    attemptCount: 1,
    usage,
  };
}

function trajectoryFor(record: MastraExecutionRecord): RunTrajectory {
  const modelRequest = record.events.find((event) => event.kind === "ModelRequested");
  const terminal = record.events.at(-1)?.occurredAt ?? record.startedAt;
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    phases: [
      { name: "agent.generate", startedAt: record.startedAt, finishedAt: terminal },
      ...(modelRequest
        ? [{ name: "model.request", startedAt: modelRequest.occurredAt, finishedAt: terminal }]
        : []),
    ],
  };
}

function metricsFor(record: MastraExecutionRecord, usage: RunUsage): RunMetrics {
  const finishedAt = record.events.at(-1)?.occurredAt ?? record.startedAt;
  const modelCallCount = record.events.filter((event) => event.kind === (record.manifest.execution ? "DurableModelRequested" : "AgentStepCompleted")).length;
  const observedModelCallCount = modelCallCount > 0
    ? modelCallCount
    : !record.manifest.execution && record.events.some((event) => event.kind === "ModelRequested") ? 1 : 0;
  const summaryRequests = record.events.filter(event => event.kind === "SummaryModelRequested").length;
  const summaries = record.events.filter(event => event.kind === "SummaryModelCompleted").map(event => normalizeUsage(event.payload.usage));
  const sumTokens = (key: keyof RunUsage): number | null => {
    if (usage[key] === null || summaries.length !== summaryRequests || summaries.some(summary => summary[key] === null)) return null;
    return summaries.reduce((total, summary) => total + (summary[key] ?? 0), usage[key] ?? 0);
  };
  const toolCallCount = record.events.filter((event) => event.kind === "ToolCallRequested").length;
  const toolAttemptCount = record.events.filter((event) => event.kind === "ToolExecutionStarted").length;
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status: record.status === "completed" || record.status === "cancelled" ? record.status : "failed",
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)),
    modelCallCount: observedModelCallCount + summaryRequests,
    modelAttemptCount: observedModelCallCount + summaryRequests,
    toolCallCount,
    toolAttemptCount,
    inputTokens: sumTokens("inputTokens"),
    outputTokens: sumTokens("outputTokens"),
    totalTokens: sumTokens("totalTokens"),
    costUsd: null,
  };
}

function failureFor(record: MastraExecutionRecord, error: unknown): NonNullable<RunResult["error"]> {
  if (record.cancellationReason && !record.timeoutRequested) {
    return {
      code: "MASTRA_RUN_CANCELLED",
      message: "The Mastra generation was cancelled before a response was confirmed.",
      failureKind: "cancelled",
      retryable: false,
    };
  }

  if (record.timeoutRequested) {
    return {
      code: "MASTRA_OUTCOME_UNKNOWN",
      message: "The Mastra model request timed out after dispatch; its provider outcome is unknown.",
      failureKind: "outcome_unknown",
      retryable: false,
    };
  }

  const liveFailure = record.events.find(event => event.kind === "EvalModelObserved"
    && (event.payload.observation as { phase?: string } | undefined)?.phase === "error");
  if (liveFailure) {
    const receipt = liveFailure.payload.observation as { providerStatus?: number; error: string };
    return { code: receipt.providerStatus ? `OPENROUTER_HTTP_${receipt.providerStatus}` : "MASTRA_OUTCOME_UNKNOWN",
      message: receipt.error, failureKind: receipt.providerStatus ? "provider" : "outcome_unknown", retryable: false };
  }

  if (error instanceof Error && error.name === "TOOL_UNKNOWN") {
    return {
      code: "MASTRA_OUTCOME_UNKNOWN",
      message: "A Mastra tool may have been dispatched but its external outcome could not be confirmed.",
      failureKind: "outcome_unknown",
      retryable: false,
    };
  }

  if (error instanceof Error && ["MASTRA_TOOL_CALL_LIMIT_EXCEEDED", "MASTRA_MODEL_ROUND_LIMIT_EXCEEDED"].includes(error.name)) {
    return { code: error.name, message: error.message, failureKind: "internal", retryable: false };
  }

  if (error instanceof Error && error.name === "ProviderError") {
    return {
      code: "MASTRA_PROVIDER_FAILURE",
      message: "The Mastra model provider rejected the request.",
      failureKind: "provider",
      retryable: false,
    };
  }

  return {
    code: error instanceof Error && error.name === "AmbiguousProviderError" ? "MASTRA_OUTCOME_UNKNOWN" : "MASTRA_GENERATION_FAILED",
    message:
      error instanceof Error && error.name === "AmbiguousProviderError"
        ? "The Mastra model request was sent but its provider outcome could not be confirmed."
        : "The Mastra agent generation failed.",
    failureKind: error instanceof Error && error.name === "AmbiguousProviderError" ? "outcome_unknown" : "internal",
    retryable: false,
  };
}

function normalizeUsage(value: unknown): RunUsage {
  if (!value || typeof value !== "object") return emptyUsage();
  const usage = value as Record<string, unknown>;
  const raw = usage.raw && typeof usage.raw === "object" ? usage.raw as Record<string, unknown> : null;
  const inputTokens = raw?.inputTokens === null ? null : numberOrNull(usage.inputTokens);
  const outputTokens = raw?.outputTokens === null ? null : numberOrNull(usage.outputTokens);
  const totalTokens = raw?.totalTokens === null ? null : numberOrNull(usage.totalTokens);
  return {
    inputTokens,
    outputTokens,
    // Mastra aggregates absent native usage into total=0. Preserve absence
    // unless both components actually establish a measured zero total.
    totalTokens: totalTokens === 0 && (inputTokens === null || outputTokens === null) ? null : totalTokens,
  };
}

function safeUsage(value: unknown): RunUsage {
  const usage = normalizeUsage(value);
  return usage;
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" || typeof candidate === "number" || candidate === null ? candidate : null;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toMastraMessage(message: ContextMessage): MastraContextMessage {
  if (message.role === "system" || message.role === "developer") {
    return { role: "system", content: message.content };
  }
  if (message.role === "user" || message.role === "assistant") {
    return { role: message.role, content: message.content };
  }
  return {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: message.metadata?.toolCallId ?? message.messageId,
      toolName: message.metadata?.toolName ?? "tool",
      output: { type: "text", value: message.content },
    }],
  };
}

function isTerminal(status: MastraExecutionRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function abortError(): Error {
  const error = new Error("The Mastra generation was aborted.");
  error.name = "AbortError";
  return error;
}
