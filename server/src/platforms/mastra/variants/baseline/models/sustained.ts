import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RunManifest } from "../../../../../control-plane/domain/types.js";
import { remainingExecutionMs } from "../../../../../capabilities/execution/policy.js";

interface ModelInput { prompt?: unknown; tools?: unknown; abortSignal?: AbortSignal }
/** Keep deadlines and input supersession inside the native durable model step. */
export function sustainedModel(config: MastraModelConfig, manifest: RunManifest, beforeRequest?: (input: ModelInput) => Promise<unknown>, onTimeout?: () => void, onError?: (error: unknown) => Promise<void>, afterResponse?: () => Promise<boolean>) {
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
          // Mastra 1.66's durable output processor abort/retry returns an empty final
          // result. Consume completed responses here before exposing any proposal
          // to the SDK. Re-inference requires retained steering, never an I/O error.
          for (let attempt = 0; attempt < (manifest.capabilities?.tools.maxRounds ?? 6); attempt++) {
            const prompt = await beforeRequest?.(input);
            const remaining = remainingExecutionMs(manifest.execution, Date.now());
            if (remaining <= 0) throw new Error("The sustained execution deadline has expired before model dispatch.");
            const timeout = new AbortController();
            const timer = setTimeout(() => { timeout.abort("Mastra model request timed out."); onTimeout?.(); }, Math.max(1, Math.min(manifest.execution!.modelTimeoutMs, remaining)));
            const abortSignal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeout.signal]) : timeout.signal;
            const method = Reflect.get(target, property, target) as (input: unknown) => Promise<unknown>;
            try {
              const result = await method.call(target, { ...input, ...(prompt ? { prompt } : {}), abortSignal });
              if (property !== "doStream") {
                if (await afterResponse?.()) continue;
                return result;
              }
              const streamed = result as { stream: ReadableStream<unknown> };
              const reader = streamed.stream.getReader();
              const chunks: unknown[] = [];
              let bytes = 0;
              try {
                for (;;) {
                  const next = await reader.read();
                  if (next.done) break;
                  const chunk = next.value as { type?: string; error?: unknown };
                  if (chunk?.type === "error") { await onError?.(chunk.error); throw new Error("The native model stream failed before its response boundary."); }
                  bytes += Buffer.byteLength(JSON.stringify(next.value));
                  if (bytes > 1_048_576) throw new Error("The native model response exceeds the 1 MiB boundary limit.");
                  chunks.push(next.value);
                }
              } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
              if (await afterResponse?.()) continue;
              return { ...streamed, stream: new ReadableStream<unknown>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) };
            } catch (error) { await onError?.(error); throw error; }
            finally { clearTimeout(timer); }
          }
          throw new Error("The native model round limit has been reached while processing task input.");
        };
      },
    }) as MastraModelConfig;
  };
}
