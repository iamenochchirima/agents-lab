import { ModelProviderError } from "../runtime/errors.js";
import type { DeterministicBehavior, ModelRequest, ModelStreamEvent, ModelUsage } from "../runtime/contracts.js";
import type { ModelProvider } from "./provider.js";

export interface DeterministicModelOptions {
  readonly behavior?: DeterministicBehavior;
  readonly delayMs?: number;
  readonly response?: string;
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
  readonly model: string;
  private readonly behavior: DeterministicBehavior;
  private readonly delayMs: number;
  private readonly response?: string;

  constructor(model: string, options: DeterministicModelOptions = {}) {
    this.model = model;
    this.behavior = options.behavior ?? "success";
    this.delayMs = options.delayMs ?? 0;
    this.response = options.response;
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
    const response = this.response ?? `Deterministic response to: ${prompt}`;
    const chunks = response.match(/.{1,12}/gu) ?? [response];
    for (const chunk of chunks) {
      await delay(this.delayMs, signal);
      yield { type: "text", text: chunk };
    }
    await delay(0, signal);
    yield { type: "completed", usage: usageFor(response) };
  }
}
