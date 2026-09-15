import type { AppConfig } from "../config/config.js";
import { buildInitialContext } from "../context/context.js";
import type { ModelProvider } from "../models/provider.js";
import { ToolRegistry, type ToolExecutionResult } from "../tools/registry.js";
import { Workspace } from "../workspace/workspace.js";
import type { SessionStore } from "../persistence/session-store.js";
import { ComputerNativeError, ModelProviderError, safeErrorMessage } from "./errors.js";
import type {
  ModelMessage,
  ModelToolCall,
  TurnMetrics,
  ModelUsage,
  TerminalTurnStatus,
  TurnError,
  TurnEvent,
  TurnResult,
} from "./contracts.js";

export interface RunTurnOptions {
  readonly session: SessionStore;
  readonly provider: ModelProvider;
  readonly tools?: ToolRegistry;
  readonly config: Pick<AppConfig, "timeoutMs" | "firstEventTimeoutMs" | "maxModelToolRounds" | "maxToolDurationMs" | "initialInstruction" | "workspaceRoot" | "maxFileBytes" | "maxDirectoryEntries" | "maxToolOutputBytes">;
  readonly userPrompt: string;
  readonly signal?: AbortSignal;
  readonly onText?: (text: string) => void;
  readonly onEvent?: (event: TurnEvent) => void;
}

interface AbortContext {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly didFirstEventTimeout: () => boolean;
  readonly didCancel: () => boolean;
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
  const totalTimer = setTimeout(() => {
    timeout = true;
    controller.abort("timeout");
  }, timeoutMs);
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
    beginModelRound,
    markFirstEvent,
    dispose: () => {
      clearTimeout(totalTimer);
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

function metrics(startedAt: string, modelRequestCount: number, toolCallCount: number, roundCount: number): TurnMetrics {
  return {
    modelRequestCount,
    toolCallCount,
    roundCount,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    cost: null,
  };
}

async function executeToolWithDeadline(registry: ToolRegistry, call: ModelToolCall, durationMs: number, signal: AbortSignal): Promise<ToolExecutionResult> {
  let timer: NodeJS.Timeout | undefined;
  let onCancelled: (() => void) | undefined;
  const timeout = new Promise<ToolExecutionResult>((resolve) => {
    timer = setTimeout(() => resolve({
      callId: call.callId,
      name: call.name,
      ok: false,
      content: `Tool error: '${call.name}' exceeded the ${durationMs}ms tool deadline.`,
      summary: `Timed out after ${durationMs}ms.`,
    }), durationMs);
  });
  const cancellation = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(cancellationError());
      return;
    }
    onCancelled = () => reject(cancellationError());
    signal.addEventListener("abort", onCancelled, { once: true });
  });
  try {
    return await Promise.race([registry.execute(call), timeout, cancellation]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onCancelled) signal.removeEventListener("abort", onCancelled);
  }
}

export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const startedAt = new Date().toISOString();
  const history = await options.session.readTranscript();
  const tools = options.tools ?? new ToolRegistry(
    await Workspace.open(options.config.workspaceRoot, {
      maxFileBytes: options.config.maxFileBytes,
      maxDirectoryEntries: options.config.maxDirectoryEntries,
    }),
    options.config.maxToolOutputBytes,
  );
  const turn = await options.session.admitTurn(options.userPrompt, options.provider.provider, options.provider.model);
  const request = buildInitialContext({
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    provider: options.provider.provider,
    model: options.provider.model,
    initialInstruction: options.config.initialInstruction,
    userPrompt: options.userPrompt,
    history,
    tools: tools.definitions,
  });
  await turn.appendEvent("TurnStarted", { provider: request.provider, model: request.model });
  await turn.updateState("streaming");
  options.onEvent?.({ type: "status", status: "streaming", round: 0 });

  const abort = combinedSignal(options.signal, options.config.timeoutMs, options.config.firstEventTimeoutMs);
  const messages: ModelMessage[] = [...request.messages];
  let response = "";
  let usage: ModelUsage | undefined;
  let modelRequestCount = 0;
  let toolCallCount = 0;
  let roundCount = 0;
  try {
    for (let round = 1; round <= options.config.maxModelToolRounds; round += 1) {
      roundCount = round;
      modelRequestCount += 1;
      abort.beginModelRound();
      options.onEvent?.({ type: "waiting", round });
      await turn.appendEvent("ModelRequested", { provider: request.provider, model: request.model, round });
      await turn.appendRound({
        schemaVersion: 1,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        round,
        phase: "model_requested",
        recordedAt: new Date().toISOString(),
        payload: { provider: request.provider, model: request.model, messageCount: messages.length },
      });

      const roundText: string[] = [];
      const toolCalls: ModelToolCall[] = [];
      const callIds = new Set<string>();
      const roundRequest = { ...request, messages, tools: tools.definitions };
      for await (const event of options.provider.stream(roundRequest, abort.signal)) {
        abort.markFirstEvent();
        if (event.type === "text") {
          roundText.push(event.text);
          response += event.text;
          options.onText?.(event.text);
          options.onEvent?.({ type: "text", text: event.text, round });
        } else if (event.type === "tool_call") {
          if (callIds.has(event.call.callId)) {
            throw new ModelProviderError(`The provider returned duplicate tool call ID '${event.call.callId}'.`, { code: "provider-incomplete" });
          }
          callIds.add(event.call.callId);
          toolCalls.push(event.call);
        } else {
          usage = event.usage ?? usage;
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
        const result = await executeToolWithDeadline(tools, call, options.config.maxToolDurationMs, abort.signal);
        await turn.appendRound({
          schemaVersion: 1,
          sessionId: turn.sessionId,
          turnId: turn.turnId,
          round,
          phase: "tool_completed",
          recordedAt: new Date().toISOString(),
          callId: call.callId,
          toolName: call.name,
          payload: { ok: result.ok, summary: result.summary, contentBytes: Buffer.byteLength(result.content, "utf8") },
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
    await turn.commitTerminal(result, "TurnCompleted", { assistantMessageId });
    options.onEvent?.({ type: "status", status: "completed", round: 0 });
    return result;
  } catch (error) {
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
    await turn.commitTerminal(result, statusEvent(failure.status), { error: result.error });
    options.onEvent?.({ type: "status", status: failure.status, round: 0 });
    return result;
  } finally {
    abort.dispose();
  }
}
