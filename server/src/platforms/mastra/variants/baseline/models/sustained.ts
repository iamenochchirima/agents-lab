import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RunManifest } from "../../../../../control-plane/domain/types.js";
import { remainingExecutionMs } from "../../../../../capabilities/execution/policy.js";

interface ModelInput { prompt?: unknown; tools?: unknown; abortSignal?: AbortSignal }
/** Keep request deadlines on rebuilt native models, including recovery segments. */
export function sustainedModel(config: MastraModelConfig, manifest: RunManifest, beforeRequest?: (input: ModelInput) => Promise<unknown>, onTimeout?: () => void, onError?: (error: unknown) => Promise<void>) {
  const resolver = new Agent({ id: "mastra-model-resolver", name: "Model resolver", instructions: "", model: config });
  return async (): Promise<MastraModelConfig> => {
    const model = await resolver.getModel();
    return new Proxy(model, {
      get(target, property) {
        if (property !== "doGenerate" && property !== "doStream") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (input: ModelInput) => {
          const prompt = await beforeRequest?.(input);
          const remaining = remainingExecutionMs(manifest.execution, Date.now());
          if (remaining <= 0) throw new Error("The sustained execution deadline has expired before model dispatch.");
          const timeout = new AbortController();
          const timer = setTimeout(() => { timeout.abort("Mastra model request timed out."); onTimeout?.(); }, Math.max(1, Math.min(manifest.execution!.modelTimeoutMs, remaining)));
          const abortSignal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeout.signal]) : timeout.signal;
          const method = Reflect.get(target, property, target) as (input: unknown) => Promise<unknown>;
          try {
            const result = await method.call(target, { ...input, ...(prompt ? { prompt } : {}), abortSignal });
            if (property !== "doStream") { clearTimeout(timer); return result; }
            const streamed = result as { stream: ReadableStream<unknown> };
            const reader = streamed.stream.getReader();
            // The request deadline includes consuming the provider's response body.
            // Clear it on completion so an old round cannot abort later work.
            const stream = new ReadableStream<unknown>({
              async pull(controller) {
                try { const next = await reader.read(); if (next.done) { clearTimeout(timer); controller.close(); } else {
                  const chunk = next.value as { type?: string; error?: unknown };
                  if (chunk?.type === "error") await onError?.(chunk.error);
                  controller.enqueue(next.value);
                } }
                catch (error) { clearTimeout(timer); await onError?.(error); controller.error(error); }
              },
              async cancel(reason) { clearTimeout(timer); await reader.cancel(reason); },
            });
            return { ...streamed, stream };
          } catch (error) { clearTimeout(timer); await onError?.(error); throw error; }
        };
      },
    }) as MastraModelConfig;
  };
}
