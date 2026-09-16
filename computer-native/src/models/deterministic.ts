import { ModelProviderError } from "../runtime/errors.js";
import type { DeterministicBehavior, ModelRequest, ModelStreamEvent, ModelUsage } from "../runtime/contracts.js";
import { DETERMINISTIC_CAPABILITIES, type ModelProvider } from "./provider.js";

export interface DeterministicModelOptions {
  readonly behavior?: DeterministicBehavior;
  readonly delayMs?: number;
  readonly response?: string;
  readonly toolCall?: { readonly name: string; readonly argumentsJson: string; readonly finalResponse?: string };
}
function abortError(): DOMException {
  return new DOMException("The model request was cancelled.", "AbortError");
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  if (ms === 0) {
    await Promise.resolve();
    if (signal.aborted) throw abortError();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function usageFor(text: string): ModelUsage {
  const outputTokens = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  return { outputTokens, totalTokens: outputTokens };
}

export class DeterministicModelProvider implements ModelProvider {
  readonly provider = "deterministic" as const;
  readonly capabilities = DETERMINISTIC_CAPABILITIES;
  readonly model: string;
  private readonly behavior: DeterministicBehavior;
  private readonly delayMs: number;
  private readonly response?: string;
  private readonly toolCall?: DeterministicModelOptions["toolCall"];

  constructor(model: string, options: DeterministicModelOptions = {}) {
    this.model = model;
    this.behavior = options.behavior ?? "success";
    this.delayMs = options.delayMs ?? 0;
    this.response = options.response;
    this.toolCall = options.toolCall;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (this.behavior === "failure") {
      throw new ModelProviderError("The deterministic local provider failed by request.");
    }
    if (this.behavior === "timeout") {
      await new Promise<void>((_, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return;
    }

    const prompt = request.messages.find((message) => message.role === "user")?.content ?? "";
    const hasToolResult = request.messages.some((message) => message.role === "tool");
    if (this.toolCall && !hasToolResult) {
      await delay(this.delayMs, signal);
      yield { type: "tool_call", call: { callId: "deterministic_call_1", name: this.toolCall.name, argumentsJson: this.toolCall.argumentsJson } };
      yield { type: "completed", usage: { outputTokens: 0, totalTokens: 0 } };
      return;
    }
    const response = hasToolResult && this.toolCall?.finalResponse
      ? this.toolCall.finalResponse
      : this.response ?? `Deterministic response to: ${prompt}`;
    const chunks = response.match(/[\s\S]{1,12}/gu) ?? [response];
    for (const chunk of chunks) {
      await delay(this.delayMs, signal);
      yield { type: "text", text: chunk };
    }
    await delay(0, signal);
    yield { type: "completed", usage: usageFor(response) };
  }
}
