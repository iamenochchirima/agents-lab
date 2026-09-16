import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/config.js";
import { buildInitialContext } from "../context/context.js";
import { isRetryableModelFailure, type ModelProvider } from "../models/provider.js";
import { ToolRegistry, type ToolExecutionContext, type ToolExecutionResult } from "../tools/registry.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest, ProcessExecutionRecord } from "../process/process.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserActionRecord, BrowserApprovalDecision, BrowserApprovalRequest, BrowserToolErrorCode, BrowserToolEvent } from "../browser/index.js";
import { LocalProcessRunner } from "../process/local-runner.js";
import { ProcessSecurityPolicy } from "../security/process-policy.js";
import { Workspace } from "../workspace/workspace.js";
import type { MutationApproval, MutationEvent, WorkspaceMutationRecord } from "../workspace/mutation.js";
import type { SessionStore } from "../persistence/session-store.js";
import type { MemoryActionRecord, MemoryApproval, MemoryEvent, MemorySearchEvidence } from "../memory/contracts.js";
import type { MemoryStore } from "../memory/store.js";
import { ComputerNativeError, isRuntimeInterruptionError, ModelProviderError, redactSecrets, RuntimeInterruptionError, safeErrorMessage } from "./errors.js";
import type {
  ModelMessage,
  ModelToolCall,
  TurnMetrics,
  ModelUsage,
  RuntimeCheckpoint,
  RuntimeDiagnostics,
  TerminalTurnStatus,
  LifecycleEventType,
  TurnError,
  TurnEvent,
  TurnResult,
} from "./contracts.js";

function bounded(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const marker = "\n[diagnostic truncated]";
  const bytes = Buffer.from(value, "utf8");
  return `${bytes.subarray(0, Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"))).toString("utf8")}${marker}`;
}

export interface RunTurnOptions {
  readonly session: SessionStore;
  readonly provider: ModelProvider;
  readonly tools?: ToolRegistry;
  readonly config: Pick<AppConfig, "timeoutMs" | "firstEventTimeoutMs" | "approvalTimeoutMs" | "modelRetryAttempts" | "modelRetryBackoffMs" | "maxModelToolRounds" | "maxToolDurationMs" | "initialInstruction" | "workspaceRoot" | "maxFileBytes" | "maxDirectoryEntries" | "maxTreeEntries" | "maxTreeBytes" | "maxTreeDepth" | "maxToolOutputBytes" | "maxModelRequestBytes" | "maxModelOutputBytes" | "processMode" | "processDurationMs" | "processTerminationGraceMs" | "processOutputBytes" | "processArgumentCount" | "processArgumentBytes" | "processCallsPerTurn" | "openRouterApiKey" | "memoryBootstrapMaxChars" | "memoryUserMaxChars" | "memoryWorkspaceMaxChars" | "memoryDailyMaxChars" | "memoryMaxResults" | "memoryDailyRetentionDays">;
  readonly memory?: MemoryStore;
  readonly userPrompt: string;
  readonly signal?: AbortSignal;
  readonly diagnostics?: RuntimeDiagnostics;
  readonly onText?: (text: string) => void;
  readonly onEvent?: (event: TurnEvent) => void;
  readonly approveMutation?: MutationApproval;
  readonly onMutation?: (event: MutationEvent) => void | Promise<void>;
  readonly approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>;
  readonly onProcess?: (event: ProcessToolEvent) => void | Promise<void>;
  readonly approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>;
  readonly onBrowser?: (event: BrowserToolEvent) => void | Promise<void>;
  readonly approveMemory?: MemoryApproval;
  readonly onMemory?: (event: MemoryEvent) => void | Promise<void>;
  readonly onMemorySearch?: (evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">) => void | Promise<void>;
}

async function checkpoint(diagnostics: RuntimeDiagnostics | undefined, value: RuntimeCheckpoint): Promise<void> {
  await diagnostics?.onCheckpoint?.(value);
}

interface AbortContext {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly didFirstEventTimeout: () => boolean;
  readonly didCancel: () => boolean;
  readonly pauseTotalDeadline: () => void;
  readonly resumeTotalDeadline: () => void;
  readonly clearFirstEventTimer: () => void;
  beginModelRound(): void;
  markFirstEvent(): void;
  dispose(): void;
}

function combinedSignal(external: AbortSignal | undefined, timeoutMs: number, firstEventTimeoutMs: number): AbortContext {
  const controller = new AbortController();
  let timeout = false;
  let firstEventTimeout = false;
  let cancelled = false;
  let firstEventTimer: NodeJS.Timeout | undefined;
  let totalTimer: NodeJS.Timeout | undefined;
  let totalRemainingMs = timeoutMs;
  let totalTimerStartedAt = Date.now();
  let totalPaused = false;
  let totalExpired = false;
  const expireTotal = () => {
    if (totalExpired) return;
    totalExpired = true;
    if (totalTimer) clearTimeout(totalTimer);
    totalTimer = undefined;
    timeout = true;
    controller.abort("timeout");
  };
  const scheduleTotal = () => {
    if (totalPaused || totalExpired) return;
    totalTimerStartedAt = Date.now();
    totalTimer = setTimeout(expireTotal, totalRemainingMs);
  };
  scheduleTotal();
  const pauseTotalDeadline = () => {
    if (totalPaused || totalExpired) return;
    totalPaused = true;
    if (totalTimer) {
      clearTimeout(totalTimer);
      totalTimer = undefined;
      totalRemainingMs = Math.max(0, totalRemainingMs - (Date.now() - totalTimerStartedAt));
    }
  };
  const resumeTotalDeadline = () => {
    if (!totalPaused || totalExpired) return;
    totalPaused = false;
    if (totalRemainingMs === 0) expireTotal();
    else scheduleTotal();
  };
  const onExternalAbort = () => {
    cancelled = true;
    controller.abort("cancelled");
  };
  const beginModelRound = () => {
    if (firstEventTimer) clearTimeout(firstEventTimer);
    firstEventTimer = setTimeout(() => {
      firstEventTimeout = true;
      controller.abort("first-event-timeout");
    }, firstEventTimeoutMs);
  };
  const markFirstEvent = () => {
    if (firstEventTimer) {
      clearTimeout(firstEventTimer);
      firstEventTimer = undefined;
    }
  };
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener("abort", onExternalAbort, { once: true });
  return {
    signal: controller.signal,
    didTimeout: () => timeout,
    didFirstEventTimeout: () => firstEventTimeout,
    didCancel: () => cancelled,
    pauseTotalDeadline,
    resumeTotalDeadline,
    clearFirstEventTimer: markFirstEvent,
    beginModelRound,
    markFirstEvent,
    dispose: () => {
      if (totalTimer) clearTimeout(totalTimer);
      if (firstEventTimer) clearTimeout(firstEventTimer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function failureStatus(error: unknown, abort: AbortContext): {
  status: Exclude<TerminalTurnStatus, "completed">;
  code: TurnError["code"];
  message: string;
} {
  if (abort.didFirstEventTimeout()) return { status: "failed", code: "first-event-timeout", message: "The provider produced no first event before the configured deadline." };
  if (abort.didTimeout()) return { status: "failed", code: "timeout", message: "The model request exceeded the configured turn deadline." };
  if (abort.didCancel()) return { status: "cancelled", code: "cancelled", message: "The model request was cancelled." };
  if (error instanceof ComputerNativeError) {
    return { status: "failed", code: error.code as TurnError["code"], message: error.safeMessage };
  }
  return { status: "failed", code: "provider", message: safeErrorMessage(error) };
}

function statusEvent(status: Exclude<TerminalTurnStatus, "completed">): "TurnFailed" | "TurnCancelled" | "TurnInterrupted" {
  if (status === "cancelled") return "TurnCancelled";
  if (status === "interrupted") return "TurnInterrupted";
  return "TurnFailed";
}

function modelMessageForAssistant(content: string, toolCalls: readonly ModelToolCall[]): ModelMessage {
  return { role: "assistant", content: content.length > 0 ? content : null, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

function cancellationError(): DOMException {
  return new DOMException("The tool execution was cancelled.", "AbortError");
}

const SIDE_EFFECTING_TOOLS = new Set([
  "write_file",
  "mkdir",
  "delete_directory",
  "delete_directory_tree",
  "delete",
  "restore",
  "restore_directory",
  "purge_quarantine",
  "copy",
  "move",
  "rename",
  "apply_patch",
  "apply_patch_set",
  "run_command",
  "browser_start",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_upload",
  "browser_download",
  "browser_close",
  "memory",
  "memory_forget",
]);

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw cancellationError();
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancellationError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function metrics(startedAt: string, modelRequestCount: number, toolCallCount: number, roundCount: number): TurnMetrics {
  return {
    modelRequestCount,
    toolCallCount,
    roundCount,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    cost: null,
  };
}

async function executeToolWithDeadline(
  registry: ToolRegistry,
  call: ModelToolCall,
  durationMs: number,
  signal: AbortSignal,
  context: Omit<ToolExecutionContext, "signal">,
): Promise<ToolExecutionResult> {
  const toolController = new AbortController();
  const onParentAbort = () => toolController.abort(signal.reason);
  if (signal.aborted) toolController.abort(signal.reason);
  else signal.addEventListener("abort", onParentAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  let onCancelled: (() => void) | undefined;
  let remainingMs = durationMs;
  let timerStartedAt = 0;
  let paused = false;
  let timedOut = false;
  let resolveTimeout: (() => void) | undefined;
  const expire = (): void => {
    if (timedOut) return;
    timedOut = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    toolController.abort("tool-timeout");
    resolveTimeout?.();
  };
  const schedule = (): void => {
    if (paused || timedOut) return;
    timerStartedAt = Date.now();
    timer = setTimeout(expire, remainingMs);
  };
  const pauseDeadline = (): void => {
    if (paused || timedOut) return;
    paused = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      remainingMs = Math.max(0, remainingMs - (Date.now() - timerStartedAt));
    }
  };
  const resumeDeadline = (): void => {
    if (!paused || timedOut) return;
    paused = false;
    if (remainingMs === 0) expire();
    else schedule();
  };
  const timeout = new Promise<ToolExecutionResult>((resolve) => {
    resolveTimeout = () => resolve({
        callId: call.callId,
        name: call.name,
        ok: false,
        content: `Tool error: '${call.name}' exceeded the ${durationMs}ms tool deadline.`,
        summary: `Timed out after ${durationMs}ms.`,
      });
    schedule();
  });
  const cancellation = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(cancellationError());
      return;
    }
    onCancelled = () => reject(cancellationError());
    signal.addEventListener("abort", onCancelled, { once: true });
  });
  const execution = registry.execute(call, {
    ...context,
    signal: toolController.signal,
    pauseDeadline,
    resumeDeadline,
  });
  try {
    const result = await Promise.race([execution, timeout, cancellation]);
    if (call.name === "run_command" && timedOut) return await execution;
    return result;
  } catch (error) {
    // A cancellation is allowed to end the turn promptly for read-only work, but
    // side-effecting tools must settle before the turn record becomes terminal.
    // Otherwise a patch, process, browser action, or memory write could continue
    // after the caller has already observed cancellation and its durable evidence
    // could be written out of order.
    if (signal.aborted && SIDE_EFFECTING_TOOLS.has(call.name)) await execution.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onCancelled) signal.removeEventListener("abort", onCancelled);
    signal.removeEventListener("abort", onParentAbort);
  }
}

export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const startedAt = new Date().toISOString();
  const history = await options.session.readTranscript();
  let tools: ToolRegistry;
  if (options.tools) {
    tools = options.tools;
  } else {
    const workspace = await Workspace.open(options.config.workspaceRoot, {
      maxFileBytes: options.config.maxFileBytes,
      maxDirectoryEntries: options.config.maxDirectoryEntries,
      maxTreeEntries: options.config.maxTreeEntries,
      maxTreeBytes: options.config.maxTreeBytes,
      maxTreeDepth: options.config.maxTreeDepth,
    });
    const processPolicy = options.config.processMode === "approval"
      ? new ProcessSecurityPolicy({
          workspace: workspace.policy,
          limits: {
            timeoutMs: options.config.processDurationMs,
            terminationGraceMs: options.config.processTerminationGraceMs,
            maxOutputBytes: options.config.processOutputBytes,
            maxArgumentCount: options.config.processArgumentCount,
            maxArgumentBytes: options.config.processArgumentBytes,
          },
        })
      : undefined;
    tools = new ToolRegistry(
      workspace,
      options.config.maxToolOutputBytes,
      processPolicy ? { policy: processPolicy, runner: new LocalProcessRunner((prepared) => processPolicy.verify(prepared)), redactionSecrets: options.config.openRouterApiKey ? [options.config.openRouterApiKey] : [] } : undefined,
      undefined,
      options.memory ? { store: options.memory, maxResults: options.config.memoryMaxResults } : undefined,
    );
  }
  const turn = await options.session.admitTurn(options.userPrompt, options.provider.provider, options.provider.model);
  const recordMutation = async (event: MutationEvent): Promise<void> => {
    const request = event.request;
    const decision = event.type === "approval_decided" ? event.decision.decision : undefined;
    const reason = event.type === "approval_decided" && "reason" in event.decision
      ? event.decision.reason
      : event.type === "failed" ? event.reason : undefined;
    const errorCode = event.type === "failed"
      ? event.code
      : event.type === "approval_decided"
        ? event.decision.decision === "deny"
          ? "approval-denied"
          : event.decision.decision === "unavailable"
            ? "approval-unavailable"
            : undefined
        : undefined;
    const journal = event.type === "applying" || event.type === "progress" || event.type === "failed" || event.type === "committed" ? event.journal : request.journal;
    const record: WorkspaceMutationRecord = {
      schemaVersion: 1,
      mutationId: request.mutationId,
      ...(request.callId ? { callId: request.callId } : {}),
      operation: request.operation,
      risk: request.risk,
      ...(request.kind ? { kind: request.kind } : {}),
      approvalTimeoutMs: request.approvalTimeoutMs,
      ...(request.paths ? { paths: request.paths } : {}),
      ...(request.members ? { members: request.members } : {}),
      ...(journal ? { journal } : {}),
      path: request.path,
      ...(request.beforeHash ? { beforeHash: request.beforeHash } : {}),
      ...(request.afterHash ? { afterHash: request.afterHash } : {}),
      ...(request.quarantinePath ? { quarantinePath: request.quarantinePath } : {}),
      ...(request.sourceMutationId ? { sourceMutationId: request.sourceMutationId } : {}),
      ...(request.sourcePath ? { sourcePath: request.sourcePath } : {}),
      ...(request.sourceHash ? { sourceHash: request.sourceHash } : {}),
      ...(request.manifestHash ? { manifestHash: request.manifestHash } : {}),
      ...(request.entryCount !== undefined ? { entryCount: request.entryCount } : {}),
      ...(request.totalBytes !== undefined ? { totalBytes: request.totalBytes } : {}),
      ...(request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {}),
      addedLines: request.addedLines,
      removedLines: request.removedLines,
      diff: request.diff,
      status: event.type === "proposed"
        ? "proposed"
        : event.type === "applying" || event.type === "progress"
          ? "applying"
          : event.type === "committed"
            ? "committed"
            : event.type === "failed"
              ? event.code === "reconciliation-required" ? "reconciliation_required" : "failed"
              : decision === "allow-once"
                ? "approved"
                : "denied",
      ...(decision ? { decision } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(reason ? { reason } : {}),
      ...(event.type === "committed" && event.bytesWritten !== undefined ? { bytesWritten: event.bytesWritten } : {}),
      recordedAt: new Date().toISOString(),
    };
    await turn.writeMutation(record);
    const lifecycleType: LifecycleEventType = event.type === "proposed"
      ? "WorkspaceMutationProposed"
      : event.type === "approval_decided"
        ? "WorkspaceMutationApprovalDecided"
        : event.type === "applying"
          ? "WorkspaceMutationApplying"
          : event.type === "progress"
            ? "WorkspaceMutationProgress"
            : event.type === "committed"
              ? "WorkspaceMutationCommitted"
              : "WorkspaceMutationFailed";
    const lifecyclePayload: Record<string, unknown> = {
      mutationId: request.mutationId,
      ...(request.callId ? { callId: request.callId } : {}),
      operation: request.operation,
      risk: request.risk,
      path: request.path,
      ...(request.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: request.approvalTimeoutMs } : {}),
      ...(request.paths ? { paths: request.paths } : {}),
      ...(request.members ? {
        members: request.members.map((member) => ({
          path: member.path,
          operation: member.operation,
          beforeHash: member.beforeHash,
          afterHash: member.afterHash,
        })),
      } : {}),
      ...(request.beforeHash ? { beforeHash: request.beforeHash } : {}),
      ...(request.afterHash ? { afterHash: request.afterHash } : {}),
      ...(request.sourcePath ? { sourcePath: request.sourcePath } : {}),
      ...(request.sourceHash ? { sourceHash: request.sourceHash } : {}),
      ...(request.manifestHash ? { manifestHash: request.manifestHash } : {}),
      ...(request.entryCount !== undefined ? { entryCount: request.entryCount } : {}),
      ...(request.totalBytes !== undefined ? { totalBytes: request.totalBytes } : {}),
      ...(request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {}),
      ...(event.type === "approval_decided" ? {
        decision: event.decision.decision,
        ...("reason" in event.decision && event.decision.reason ? { reason: event.decision.reason } : {}),
      } : {}),
      ...(event.type === "applying" ? { decision: "allow-once" } : {}),
      ...(event.type === "applying" || event.type === "progress" || event.type === "failed" || event.type === "committed"
        ? { journal: event.journal ?? null }
        : {}),
      ...(event.type === "failed" ? {
        ...(event.code ? { errorCode: event.code } : {}),
        reason: event.reason,
      } : {}),
      ...(event.type === "committed" ? {
        ...(event.afterHash ? { committedAfterHash: event.afterHash } : {}),
        ...(event.bytesWritten !== undefined ? { bytesWritten: event.bytesWritten } : {}),
      } : {}),
    };
    await turn.appendEvent(lifecycleType, lifecyclePayload);
    if (event.type === "approval_decided" && event.decision.decision !== "allow-once") {
      await turn.appendEvent("WorkspaceMutationFailed", {
        mutationId: request.mutationId,
        operation: request.operation,
        path: request.path,
        status: "denied",
        ...(errorCode ? { errorCode } : {}),
        ...(reason ? { reason } : {}),
      });
    }
    if (event.type === "approval_decided") {
      await checkpoint(options.diagnostics, {
        type: "after-approval",
        actionKind: "workspace",
        toolName: request.operation,
        callId: request.callId ?? "",
        identity: request.mutationId,
        decision: event.decision.decision,
      });
    }
    if (event.type === "progress" && request.operation === "patch-set" && event.journal) {
      const committedMember = event.journal.members.find((member) =>
        member.state === "committed"
        && event.journal!.members
          .filter((candidate) => candidate.commitOrder > member.commitOrder)
          .every((candidate) => candidate.state === "pending"),
      );
      if (committedMember) {
        await checkpoint(options.diagnostics, {
          type: "after-mutation-member",
          callId: request.callId ?? "",
          mutationId: request.mutationId,
          path: committedMember.path,
          commitOrder: committedMember.commitOrder,
        });
      }
    }
    await options.onMutation?.(event);
  };
  const recordProcess = async (event: ProcessToolEvent): Promise<void> => {
    const request = event.request;
    const base = {
      schemaVersion: 1 as const,
      executionId: request.executionId,
      callId: request.callId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      command: request.command,
      displayArgs: request.displayArgs,
      cwd: request.cwd,
      executablePath: request.executablePath,
      environmentProfile: request.environmentProfile,
      environmentKeys: request.environmentKeys,
      limits: request.limits,
      argvHash: request.argvHash,
      ...(request.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: request.approvalTimeoutMs } : {}),
    };
    let record: ProcessExecutionRecord | undefined;
    if (event.type === "prepared") {
      record = { ...base, status: "prepared", recordedAt: new Date().toISOString() };
    } else if (event.type === "approval_decided") {
      const denied = event.decision.decision !== "allow-once";
      record = {
        ...base,
        status: denied ? "failed" : "approved",
        decision: event.decision.decision,
        ...(denied ? {
          errorCode: event.decision.decision === "deny" ? "process-approval-denied" as const : "process-approval-unavailable" as const,
          errorMessage: event.decision.reason ?? "The process was not approved.",
          finishedAt: new Date().toISOString(),
        } : {}),
        recordedAt: new Date().toISOString(),
      };
    } else if (event.type === "started") {
      record = {
        ...base,
        status: "running",
        decision: "allow-once",
        pid: event.pid,
        ...(event.processIdentity ? { processIdentity: event.processIdentity } : {}),
        startedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };
    } else if (event.type === "completed") {
      const result = event.result;
      record = {
        ...base,
        status: result.state,
        decision: "allow-once",
        ...(result.pid !== undefined ? { pid: result.pid } : {}),
        ...(result.processIdentity ? { processIdentity: result.processIdentity } : {}),
        stdout: redactSecrets(result.stdout, [options.config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""]),
        stderr: redactSecrets(result.stderr, [options.config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""]),
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
        outputTruncated: result.outputTruncated,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        terminationConfirmed: result.terminationConfirmed,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        startedAt: new Date(Date.now() - result.durationMs).toISOString(),
        finishedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };
    }
    if (record) {
      await turn.writeProcess(record);
      if (event.type !== "output") {
        const lifecycleType = event.type === "prepared"
          ? "ProcessPrepared"
          : event.type === "approval_decided"
            ? "ProcessApprovalDecided"
            : event.type === "started"
              ? "ProcessStarted"
              : event.type === "terminating"
                ? "ProcessTerminating"
                : "ProcessCompleted";
        const payload = event.type === "approval_decided"
          ? { executionId: request.executionId, callId: request.callId, decision: event.decision.decision }
          : event.type === "started"
            ? { executionId: request.executionId, callId: request.callId, pid: event.pid }
            : event.type === "terminating"
              ? { executionId: request.executionId, callId: request.callId, reason: event.reason }
              : event.type === "completed"
                ? { executionId: request.executionId, callId: request.callId, status: event.result.state, errorCode: event.result.errorCode ?? null, stdoutBytes: event.result.stdoutBytes, stderrBytes: event.result.stderrBytes }
                : { executionId: request.executionId, callId: request.callId, cwd: request.cwd, command: request.command };
        await turn.appendEvent(lifecycleType, payload);
        if (event.type === "approval_decided" && event.decision.decision !== "allow-once") {
          await turn.appendEvent("ProcessCompleted", {
            executionId: request.executionId,
            callId: request.callId,
            status: record.status,
            errorCode: record.errorCode ?? null,
          });
        }
      }
      if (event.type === "started") {
        try {
          await checkpoint(options.diagnostics, {
            type: "after-process-start",
            callId: request.callId,
            executionId: request.executionId,
            pid: event.pid,
          });
        } catch (error) {
          if (isRuntimeInterruptionError(error)) {
            throw new RuntimeInterruptionError(error.message, { preserveSideEffect: true });
          }
          throw error;
        }
      }
      if (event.type === "approval_decided") {
        await checkpoint(options.diagnostics, {
          type: "after-approval",
          actionKind: "process",
          toolName: "run_command",
          callId: request.callId,
          identity: request.executionId,
          decision: event.decision.decision,
        });
      }
    }
    await options.onProcess?.(event);
  };
  const recordBrowser = async (event: BrowserToolEvent): Promise<void> => {
    if (event.type === "artifact") {
      await turn.appendEvent("BrowserArtifactCreated", {
        artifactId: event.artifact.artifactId,
        kind: event.artifact.kind,
        sessionId: event.artifact.sessionId,
        tabId: event.artifact.tabId,
        path: event.artifact.path,
        mimeType: event.artifact.mimeType,
        byteSize: event.artifact.byteSize,
        createdAt: event.artifact.createdAt,
        ...(event.artifact.width !== undefined ? { width: event.artifact.width } : {}),
        ...(event.artifact.height !== undefined ? { height: event.artifact.height } : {}),
        fileName: event.artifact.fileName ?? null,
      });
      await options.onBrowser?.(event);
      return;
    }
    const request = event.request;
    const secrets = [options.config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""];
    const base = {
      schemaVersion: 1 as const,
      actionId: request.actionId,
      callId: request.callId,
      sessionId: request.sessionId,
      turnId: turn.turnId,
      tabId: request.tabId,
      action: request.action,
      reference: request.reference,
      documentId: request.documentId,
      ...(request.text !== undefined ? { text: redactSecrets(request.text, secrets) } : {}),
      ...(request.key !== undefined ? { key: redactSecrets(request.key, secrets) } : {}),
      ...(request.path !== undefined ? { path: redactSecrets(request.path, secrets) } : {}),
      ...(request.maxBytes !== undefined ? { maxBytes: request.maxBytes } : {}),
      ...(request.dialog ? { dialog: {
        type: request.dialog.type,
        message: bounded(redactSecrets(request.dialog.message, secrets), 2_000),
      } } : {}),
      actionHash: request.actionHash,
      ...(request.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: request.approvalTimeoutMs } : {}),
    };
    const dialog = event.type === "completed" && event.dialog ? {
      type: event.dialog.type,
      message: redactSecrets(event.dialog.message, secrets),
    } : undefined;
    let record: BrowserActionRecord | undefined;
    if (event.type === "prepared") {
      record = { ...base, status: "prepared", recordedAt: new Date().toISOString() };
    } else if (event.type === "approval_decided") {
      const denied = event.decision.decision !== "allow-once";
      record = {
        ...base,
        status: denied ? "failed" : "approved",
        decision: event.decision.decision,
        ...(denied ? {
          errorCode: event.decision.decision === "deny" ? "browser-approval-denied" as const : "browser-approval-unavailable" as const,
          errorMessage: redactSecrets(event.decision.reason ?? "The browser action was not approved.", secrets),
          finishedAt: new Date().toISOString(),
        } : {}),
        recordedAt: new Date().toISOString(),
      };
    } else if (event.type === "started") {
      record = {
        ...base,
        status: "running",
        decision: "allow-once",
        startedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };
    } else if (event.type === "completed") {
      const errorCode = event.errorCode as BrowserToolErrorCode | undefined;
      const status = event.ok
        ? "completed" as const
        : errorCode === "browser-cancelled"
          ? "cancelled" as const
          : errorCode === "browser-ambiguous"
            ? "ambiguous" as const
          : "failed" as const;
      record = {
        ...base,
        status,
        decision: "allow-once",
        summary: redactSecrets(event.summary, secrets),
        ...(errorCode ? { errorCode } : {}),
        ...(event.underlyingErrorCode ? { underlyingErrorCode: event.underlyingErrorCode } : {}),
        ...(dialog ? { dialog } : {}),
        ...(event.dialogDecision ? { dialogDecision: event.dialogDecision } : {}),
        ...(event.cancellationConfirmed !== undefined ? { cancellationConfirmed: event.cancellationConfirmed } : {}),
        ...(event.diagnostic ? { diagnostic: {
          name: bounded(redactSecrets(event.diagnostic.name, secrets), 128),
          message: bounded(redactSecrets(event.diagnostic.message, secrets), 2_000),
        } } : {}),
        ...(!event.ok ? { errorMessage: redactSecrets(event.summary, secrets) } : {}),
        finishedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };
    }
    if (record) {
      await turn.writeBrowserAction(record);
      const lifecycleType = event.type === "prepared"
        ? "BrowserPrepared"
        : event.type === "approval_decided"
          ? "BrowserApprovalDecided"
          : event.type === "started"
            ? "BrowserStarted"
            : "BrowserCompleted";
      const payload = event.type === "approval_decided"
        ? { actionId: request.actionId, callId: request.callId, decision: event.decision.decision }
        : event.type === "completed"
          ? { actionId: request.actionId, callId: request.callId, status: record.status, errorCode: event.errorCode ?? null, underlyingErrorCode: event.underlyingErrorCode ?? null, ...(dialog ? { dialog } : {}), ...(event.dialogDecision ? { dialogDecision: event.dialogDecision } : {}), ...(event.cancellationConfirmed !== undefined ? { cancellationConfirmed: event.cancellationConfirmed } : {}), ...(event.diagnostic ? { diagnostic: {
            name: bounded(redactSecrets(event.diagnostic.name, secrets), 128),
            message: bounded(redactSecrets(event.diagnostic.message, secrets), 2_000),
          } } : {}) }
          : { actionId: request.actionId, callId: request.callId, sessionId: request.sessionId, tabId: request.tabId, action: request.action };
      await turn.appendEvent(lifecycleType, payload);
      if (event.type === "approval_decided") {
        await checkpoint(options.diagnostics, {
          type: "after-approval",
          actionKind: "browser",
          toolName: request.action,
          callId: request.callId,
          identity: request.actionId,
          decision: event.decision.decision,
        });
      }
    }
    await options.onBrowser?.(event);
  };
  const recordMemory = async (event: MemoryEvent): Promise<void> => {
    const request = event.request;
    const base = {
      operationId: request.operationId,
      callId: request.callId,
      operation: request.operation,
      recordId: request.recordId ?? null,
      scope: request.scope,
      sourcePath: request.sourcePath,
      beforeContentHash: request.beforeContentHash ?? null,
      afterContentHash: request.afterContentHash ?? null,
      risk: request.risk,
    };
    const action: MemoryActionRecord = {
      schemaVersion: 1,
      operationId: request.operationId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      callId: request.callId,
      operation: request.operation,
      ...(request.recordId ? { recordId: request.recordId } : {}),
      scope: request.scope,
      sourcePath: request.sourcePath,
      ...(request.beforeContentHash ? { beforeContentHash: request.beforeContentHash } : {}),
      ...(request.afterContentHash ? { afterContentHash: request.afterContentHash } : {}),
      inputHash: request.afterContentHash ?? request.beforeContentHash ?? "unknown",
      ...(request.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: request.approvalTimeoutMs } : {}),
      ...(request.batch ? {
        batch: request.batch.map((item) => ({
          operation: item.operation,
          scope: item.scope,
          ...(item.recordId ? { recordId: item.recordId } : {}),
          sourcePath: item.sourcePath,
          ...(item.beforeContentHash ? { beforeContentHash: item.beforeContentHash } : {}),
          ...(item.afterContentHash ? { afterContentHash: item.afterContentHash } : {}),
        })),
      } : {}),
      status: event.type === "prepared"
        ? "proposed"
        : event.type === "approval_decided"
          ? event.decision.decision === "allow-once" ? "approved" : "denied"
          : event.type === "committed" || event.type === "forgotten"
            ? "committed"
            : event.type === "batch_committed"
              ? "committed"
            : "failed",
      ...(event.type === "approval_decided" ? { decision: event.decision.decision } : {}),
      ...(event.type === "approval_decided" && "reason" in event.decision && event.decision.reason ? { reason: event.decision.reason } : {}),
      ...(event.type === "failed" ? { reason: event.reason } : {}),
      recordedAt: new Date().toISOString(),
    };
    await turn.writeMemoryAction(action);
    if (event.type === "prepared") {
      await turn.appendEvent("MemoryPrepared", { ...base, contentPreview: bounded(redactSecrets(request.contentPreview, [options.config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""]), 2_000) });
    } else if (event.type === "approval_decided") {
      await turn.appendEvent("MemoryApprovalDecided", { ...base, decision: event.decision.decision });
      if (event.decision.decision !== "allow-once") {
        await turn.appendEvent("MemoryFailed", {
          ...base,
          status: "denied",
          ...(event.decision.reason ? { reason: event.decision.reason } : {}),
        });
      }
      await checkpoint(options.diagnostics, {
        type: "after-approval",
        actionKind: "memory",
        toolName: "memory",
        callId: request.callId,
        identity: request.operationId,
        decision: event.decision.decision,
      });
    } else if (event.type === "committed") {
      await turn.appendEvent("MemoryCommitted", { ...base, recordId: event.record.id, contentHash: event.record.contentHash });
    } else if (event.type === "forgotten") {
      await turn.appendEvent("MemoryForgotten", base);
    } else if (event.type === "batch_committed") {
      await turn.appendEvent("MemoryCommitted", {
        ...base,
        memberResults: event.results.map((result) => ({
          operation: result.operation,
          recordId: result.record?.id ?? result.recordId ?? null,
          contentHash: result.record?.contentHash ?? null,
        })),
      });
    } else {
      await turn.appendEvent("MemoryFailed", { ...base, reason: event.reason });
    }
    await options.onMemory?.(event);
  };
  const recordMemorySearch = async (evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">): Promise<void> => {
    const record: MemorySearchEvidence = {
      ...evidence,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      recordedAt: new Date().toISOString(),
    };
    await turn.writeMemorySearch(record);
    await turn.appendEvent("MemorySearched", {
      searchId: record.searchId,
      callId: record.callId,
      queryHash: record.queryHash,
      scopes: record.scopes ?? null,
      resultCount: record.resultCount,
      resultIds: record.resultIds,
      truncated: record.truncated,
    });
    await options.onMemorySearch?.(evidence);
  };
  const memory = options.memory ? await options.memory.bootstrap() : [];
  if (options.memory) {
    await turn.appendEvent("MemoryBootstrapLoaded", {
      selectedIds: memory.map((record) => record.id),
      selectedCount: memory.length,
      scopes: [...new Set(memory.map((record) => record.scope))],
      maxChars: options.config.memoryBootstrapMaxChars,
    });
  }
  const request = buildInitialContext({
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    provider: options.provider.provider,
    model: options.provider.model,
    initialInstruction: options.config.initialInstruction,
    userPrompt: options.userPrompt,
    history,
    tools: tools.definitions,
    memory,
    memoryMaxChars: options.config.memoryBootstrapMaxChars,
  });
  await turn.appendEvent("TurnStarted", { provider: request.provider, model: request.model });
  await turn.updateState("streaming");
  options.onEvent?.({ type: "status", status: "streaming", round: 0 });

  const abort = combinedSignal(options.signal, options.config.timeoutMs, options.config.firstEventTimeoutMs);
  const messages: ModelMessage[] = [...request.messages];
  let processCalls = 0;
  let response = "";
  let usage: ModelUsage | undefined;
  let modelRequestCount = 0;
  let toolCallCount = 0;
  let roundCount = 0;
  let modelOutputBytes = 0;
  try {
    for (let round = 1; round <= options.config.maxModelToolRounds; round += 1) {
      roundCount = round;
      await turn.appendRound({
        schemaVersion: 1,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        round,
        phase: "model_requested",
        recordedAt: new Date().toISOString(),
        payload: { provider: request.provider, model: request.model, messageCount: messages.length, maxAttempts: options.config.modelRetryAttempts },
      });

      const roundText: string[] = [];
      const toolCalls: ModelToolCall[] = [];
      const callIds = new Set<string>();
      const roundRequest = { ...request, messages, tools: tools.definitions };
      const requestBytes = Buffer.byteLength(JSON.stringify(roundRequest), "utf8");
      if (requestBytes > options.config.maxModelRequestBytes) {
        await turn.appendEvent("ModelRequestRejected", {
          round,
          reason: "request-size",
          requestBytes,
          maxRequestBytes: options.config.maxModelRequestBytes,
        });
        throw new ComputerNativeError("resource-limit", `The model request is ${requestBytes} bytes, above the ${options.config.maxModelRequestBytes}-byte limit.`);
      }
      let attempt = 0;
      while (true) {
        attempt += 1;
        const attemptId = `attempt_${randomUUID().replaceAll("-", "")}`;
        modelRequestCount += 1;
        abort.beginModelRound();
        options.onEvent?.({ type: "waiting", round });
        await turn.appendEvent("ModelRequested", { provider: request.provider, model: request.model, round, attempt, attemptId });
        let emittedEvent = false;
        try {
          await checkpoint(options.diagnostics, { type: "before-model-send", round, attempt, attemptId });
          for await (const event of options.provider.stream(roundRequest, abort.signal)) {
            emittedEvent = true;
            abort.markFirstEvent();
            if (event.type === "text") {
              const chunkBytes = Buffer.byteLength(event.text, "utf8");
              if (modelOutputBytes + chunkBytes > options.config.maxModelOutputBytes) {
                throw new ComputerNativeError("resource-limit", `The model response exceeded the ${options.config.maxModelOutputBytes}-byte limit.`);
              }
              modelOutputBytes += chunkBytes;
              roundText.push(event.text);
              response += event.text;
              options.onText?.(event.text);
              options.onEvent?.({ type: "text", text: event.text, round });
            } else if (event.type === "tool_call") {
              const callBytes = Buffer.byteLength(JSON.stringify(event.call), "utf8");
              if (modelOutputBytes + callBytes > options.config.maxModelOutputBytes) {
                throw new ComputerNativeError("resource-limit", `The model response exceeded the ${options.config.maxModelOutputBytes}-byte limit.`);
              }
              modelOutputBytes += callBytes;
              if (callIds.has(event.call.callId)) {
                throw new ModelProviderError(`The provider returned duplicate tool call ID '${event.call.callId}'.`, { code: "provider-incomplete" });
              }
              callIds.add(event.call.callId);
              toolCalls.push(event.call);
            } else {
              usage = event.usage ?? usage;
            }
          }
          await checkpoint(options.diagnostics, { type: "after-model-response", round, attempt, attemptId, emittedEvent });
          await turn.appendEvent("ModelAttemptCompleted", { round, attempt, attemptId, status: "completed", emittedEvent, usage: usage ?? null });
          break;
        } catch (error) {
          if (isRuntimeInterruptionError(error)) throw error;
          const canRetry = !abort.signal.aborted && attempt < options.config.modelRetryAttempts && isRetryableModelFailure(error, emittedEvent);
          const reason = bounded(safeErrorMessage(error), 1_000);
          await turn.appendEvent("ModelAttemptCompleted", {
            round,
            attempt,
            attemptId,
            status: canRetry ? "retryable-failure" : "failed",
            emittedEvent,
            retryScheduled: canRetry,
            errorCode: error instanceof ComputerNativeError ? error.code : "provider",
            reason,
          });
          if (!canRetry) throw error;
          const delayMs = Math.min(options.config.modelRetryBackoffMs * (2 ** (attempt - 1)), 30_000);
          abort.clearFirstEventTimer();
          await turn.appendEvent("ModelRetryScheduled", { round, attempt, attemptId, nextAttempt: attempt + 1, delayMs, reason });
          options.onEvent?.({ type: "retry", round, attempt, delayMs, reason });
          await waitForRetry(delayMs, abort.signal);
        }
      }
      await turn.appendRound({
        schemaVersion: 1,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        round,
        phase: "model_completed",
        recordedAt: new Date().toISOString(),
        payload: { textBytes: Buffer.byteLength(roundText.join(""), "utf8"), toolCallCount: toolCalls.length, usage: usage ?? null },
      });
      if (toolCalls.length === 0) {
        if (response.trim().length === 0) throw new ModelProviderError("The provider completed without text or a tool call.", { code: "provider-empty" });
        break;
      }

      messages.push(modelMessageForAssistant(roundText.join(""), toolCalls));
      for (const call of toolCalls) {
        toolCallCount += 1;
        const processCallLimitReached = call.name === "run_command" && processCalls >= options.config.processCallsPerTurn;
        if (call.name === "run_command") processCalls += 1;
        options.onEvent?.({ type: "tool_started", round, call });
        await turn.appendRound({
          schemaVersion: 1,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          round,
          phase: "tool_requested",
          recordedAt: new Date().toISOString(),
          callId: call.callId,
          toolName: call.name,
          payload: { argumentsJson: call.argumentsJson },
        });
        const toolDeadline = call.name === "run_command"
          ? Math.max(options.config.maxToolDurationMs, options.config.processDurationMs + options.config.processTerminationGraceMs + 1_000)
          : options.config.maxToolDurationMs;
        await checkpoint(options.diagnostics, { type: "before-tool-execution", round, toolName: call.name, callId: call.callId });
        const result = await executeToolWithDeadline(tools, call, toolDeadline, abort.signal, {
          approvalTimeoutMs: options.config.approvalTimeoutMs,
          pauseTurnDeadline: abort.pauseTotalDeadline,
          resumeTurnDeadline: abort.resumeTotalDeadline,
          approveMutation: options.approveMutation
            ? async (approvalRequest, signal) => {
                await checkpoint(options.diagnostics, { type: "before-approval", actionKind: "workspace", toolName: call.name, callId: call.callId, identity: approvalRequest.mutationId });
                return options.approveMutation!(approvalRequest, signal);
              }
            : undefined,
          onMutation: recordMutation,
          approveProcess: options.approveProcess
            ? async (approvalRequest, signal) => {
                await checkpoint(options.diagnostics, { type: "before-approval", actionKind: "process", toolName: call.name, callId: call.callId, identity: approvalRequest.executionId });
                return options.approveProcess!(approvalRequest, signal);
              }
            : undefined,
          onProcess: recordProcess,
          approveBrowser: options.approveBrowser
            ? async (approvalRequest, signal) => {
                await checkpoint(options.diagnostics, { type: "before-approval", actionKind: "browser", toolName: call.name, callId: call.callId, identity: approvalRequest.actionId });
                return options.approveBrowser!(approvalRequest, signal);
              }
            : undefined,
          onBrowser: recordBrowser,
          approveMemory: options.approveMemory
            ? async (approvalRequest, signal) => {
                await checkpoint(options.diagnostics, { type: "before-approval", actionKind: "memory", toolName: call.name, callId: call.callId, identity: approvalRequest.operationId });
                return options.approveMemory!(approvalRequest, signal);
              }
            : undefined,
          onMemory: recordMemory,
          onMemorySearch: recordMemorySearch,
          processCallLimitReached,
        });
        await checkpoint(options.diagnostics, { type: "after-tool-execution", round, toolName: call.name, callId: call.callId, ok: result.ok, ...(result.errorCode ? { errorCode: result.errorCode } : {}) });
        await turn.appendRound({
          schemaVersion: 1,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          round,
          phase: "tool_completed",
          recordedAt: new Date().toISOString(),
          callId: call.callId,
          toolName: call.name,
          payload: { ok: result.ok, summary: result.summary, contentBytes: Buffer.byteLength(result.content, "utf8"), mutationId: result.mutationId ?? null, errorCode: result.errorCode ?? null },
        });
        options.onEvent?.({ type: "tool_completed", round, callId: call.callId, name: call.name, ok: result.ok, summary: result.summary });
        messages.push({ role: "tool", content: result.content, toolCallId: call.callId, name: call.name });
      }
      if (round === options.config.maxModelToolRounds) {
        throw new ComputerNativeError("round-limit", `The model/tool loop reached the ${options.config.maxModelToolRounds}-round limit.`);
      }
    }

    const assistantMessageId = await turn.appendAssistantMessage(response);
    const result: TurnResult = {
      schemaVersion: 1,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      status: "completed",
      provider: request.provider,
      model: request.model,
      startedAt,
      finishedAt: new Date().toISOString(),
      assistantMessageId,
      assistantText: response,
      usage,
      metrics: metrics(startedAt, modelRequestCount, toolCallCount, roundCount),
    };
    await turn.appendEvent("ModelCompleted", { usage: usage ?? null });
    await checkpoint(options.diagnostics, { type: "before-terminal-commit", status: result.status, turnId: turn.turnId });
    await turn.commitTerminal(result, "TurnCompleted", { assistantMessageId });
    options.onEvent?.({ type: "status", status: "completed", round: 0 });
    return result;
  } catch (error) {
    if (isRuntimeInterruptionError(error)) throw error;
    const failure = failureStatus(error, abort);
    const result: TurnResult = {
      schemaVersion: 1,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      status: failure.status,
      provider: request.provider,
      model: request.model,
      startedAt,
      finishedAt: new Date().toISOString(),
      metrics: metrics(startedAt, modelRequestCount, toolCallCount, roundCount),
      error: { code: failure.code, message: failure.message },
    };
    await checkpoint(options.diagnostics, { type: "before-terminal-commit", status: result.status, turnId: turn.turnId });
    await turn.commitTerminal(result, statusEvent(failure.status), { error: result.error });
    options.onEvent?.({ type: "status", status: failure.status, round: 0 });
    return result;
  } finally {
    abort.dispose();
  }
}
