import type { AppConfig } from "../config/config.js";
import { buildInitialContext } from "../context/context.js";
import type { ModelProvider } from "../models/provider.js";
import type { SessionStore } from "../persistence/session-store.js";
import { ComputerNativeError, safeErrorMessage } from "./errors.js";
import type { ModelUsage, TerminalTurnStatus, TurnError, TurnResult } from "./contracts.js";

export interface RunTurnOptions {
  readonly session: SessionStore;
  readonly provider: ModelProvider;
  readonly config: Pick<AppConfig, "timeoutMs" | "initialInstruction">;
  readonly userPrompt: string;
  readonly signal?: AbortSignal;
  readonly onText?: (text: string) => void;
}

interface AbortContext {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly didCancel: () => boolean;
  dispose(): void;
}

function combinedSignal(external: AbortSignal | undefined, timeoutMs: number): AbortContext {
  const controller = new AbortController();
  let timeout = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort("timeout");
  }, timeoutMs);
  const onExternalAbort = () => {
    cancelled = true;
    controller.abort("cancelled");
  };
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener("abort", onExternalAbort, { once: true });
  return {
    signal: controller.signal,
    didTimeout: () => timeout,
    didCancel: () => cancelled,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function failureStatus(error: unknown, abort: AbortContext): {
  status: Exclude<TerminalTurnStatus, "completed">;
  code: TurnError["code"];
  message: string;
} {
  if (abort.didTimeout()) return { status: "failed", code: "timeout", message: "Provider timeout after the configured deadline." };
  if (abort.didCancel()) return { status: "cancelled", code: "cancelled", message: "The model request was cancelled." };
  if (error instanceof ComputerNativeError && error.code === "provider") {
    return { status: "failed", code: "provider", message: error.safeMessage };
  }
  return { status: "failed", code: "provider", message: safeErrorMessage(error) };
}

function statusEvent(status: Exclude<TerminalTurnStatus, "completed">): "TurnFailed" | "TurnCancelled" | "TurnInterrupted" {
  if (status === "cancelled") return "TurnCancelled";
  if (status === "interrupted") return "TurnInterrupted";
  return "TurnFailed";
}

export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const startedAt = new Date().toISOString();
  const turn = await options.session.admitTurn(options.userPrompt, options.provider.provider, options.provider.model);
  const request = buildInitialContext({
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    provider: options.provider.provider,
    model: options.provider.model,
    initialInstruction: options.config.initialInstruction,
    userPrompt: options.userPrompt,
  });
  await turn.appendEvent("TurnStarted", { provider: request.provider, model: request.model });
  await turn.appendEvent("ModelRequested", { provider: request.provider, model: request.model });
  await turn.updateState("streaming");

  const abort = combinedSignal(options.signal, options.config.timeoutMs);
  let response = "";
  let usage: ModelUsage | undefined;
  try {
    for await (const event of options.provider.stream(request, abort.signal)) {
      if (event.type === "text") {
        response += event.text;
        options.onText?.(event.text);
      } else {
        usage = event.usage;
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
    };
    await turn.appendEvent("ModelCompleted", { usage: usage ?? null });
    await turn.commitTerminal(result, "TurnCompleted", { assistantMessageId });
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
      error: { code: failure.code, message: failure.message },
    };
    await turn.commitTerminal(result, statusEvent(failure.status), { error: result.error });
    return result;
  } finally {
    abort.dispose();
  }
}
