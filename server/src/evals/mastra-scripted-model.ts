import type { MastraModelConfig } from "@mastra/core/llm";
import type { RunManifest } from "../control-plane/domain/types.js";

export interface CapturedMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: { callId: string; toolName: string; input: unknown }[];
}
export interface CapturedRequest {
  runId: string;
  sequence: number;
  messages: CapturedMessage[];
  responseToolCalls: { callId: string; toolName: string; input: unknown }[];
}

/** Captures only this evaluator's synthetic inputs at Mastra's actual SDK model boundary. */
export function scriptedMastraModel(manifest: RunManifest, captures: CapturedRequest[]): MastraModelConfig {
  let sequence = 0;
  return {
    specificationVersion: "v2", provider: "agentlab.eval", modelId: manifest.model.model, supportedUrls: {},
    doGenerate: async ({ prompt, abortSignal }: { prompt: unknown; abortSignal?: AbortSignal }) => {
      const messages = normalizeMastraPrompt(prompt);
      const request: CapturedRequest = { runId: manifest.runId, sequence: ++sequence, messages, responseToolCalls: [] };
      captures.push(request);
      if (manifest.model.model === "fake-eval-behaviour") {
        const match = manifest.task.prompt.match(/\[eval-behaviour:([A-Za-z0-9_-]+)\]/);
        if (!match) throw new Error("A behaviour eval requires a directive.");
        const directive = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as {
          action: string; toolName?: string; input?: unknown; text?: string; delayMs?: number; marker?: string;
        };
        if (directive.action === "provider-error") { const error = new Error("Controlled provider rejection."); error.name = "ProviderError"; throw error; }
        if (directive.action === "malformed") return { content: null, finishReason: "stop", usage: { inputTokens: undefined, outputTokens: undefined }, warnings: [] };
        if (directive.action === "slow") await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(done, Math.min(60_000, Math.max(1, directive.delayMs ?? 10_000)));
          function done() { abortSignal?.removeEventListener("abort", aborted); resolve(); }
          function aborted() { clearTimeout(timer); reject(abortSignal?.reason ?? new Error("Model cancelled.")); }
          if (abortSignal?.aborted) aborted(); else abortSignal?.addEventListener("abort", aborted, { once: true });
        });
        const feedback = [...messages].reverse().find(message => message.role === "tool" && message.toolCallId?.startsWith("eval-behaviour-call-"));
        if (directive.action === "tool" && !feedback) {
          const call = { callId: `eval-behaviour-call-${sequence}`, toolName: directive.toolName ?? "calculator", input: directive.input ?? {} };
          request.responseToolCalls.push(call);
          return response([{ type: "tool-call", toolCallId: call.callId, toolName: call.toolName, input: JSON.stringify(call.input) }], "tool-calls");
        }
        const retained = messages.filter(message => message.role === "user").map(message => message.content.replace(/\[eval-behaviour:[A-Za-z0-9_-]+\]/g, "")).join("\n");
        const text = directive.action === "context" ? directive.marker && retained.includes(directive.marker) ? directive.marker : "No retained marker."
          : directive.action === "tool" ? `Tool feedback: ${feedback?.content}` : directive.text ?? "Behaviour eval completed.";
        return { ...response([{ type: "text", text }], "stop"), usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined } };
      }
      const isTool = manifest.model.model === "fake-tool-call";
      const isLimit = manifest.task.prompt.includes("[baseline-limit:");
      const feedback = [...messages].reverse().find((message) => message.role === "tool");
      if (isTool && (!feedback || isLimit)) {
        const call = { callId: `eval-calculator-${sequence}`, toolName: "calculator", input: { operation: "add", left: 17, right: 25 } };
        request.responseToolCalls.push(call);
        return response([{ type: "tool-call", toolCallId: call.callId, toolName: call.toolName, input: JSON.stringify(call.input) }], "tool-calls");
      }
      let text = "Baseline eval completed.";
      if (isTool) text = feedback?.content.includes("42") ? "42" : "Calculator feedback missing.";
      if (manifest.model.model === "fake-context") {
        const hasRetainedTurn = messages.some((message) => message.role === "assistant" && message.content === "Stored the test value.");
        text = hasRetainedTurn && messages.some((message) => message.role === "user" && message.content.includes("conformance-4318"))
          ? "conformance-4318" : "Stored the test value.";
      }
      return response([{ type: "text", text }], "stop");
    },
    doStream: async () => { throw new Error("Baseline eval uses generate, not streaming."); },
  } as unknown as MastraModelConfig;
}

function response(content: unknown[], finishReason: string) {
  return { content, finishReason, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, warnings: [] };
}

/** Keep role/call identity while converting AI SDK content blocks to safe synthetic text. */
export function normalizeMastraPrompt(prompt: unknown): CapturedMessage[] {
  if (!Array.isArray(prompt)) throw new Error("Mastra did not supply a mapped message array.");
  const result: CapturedMessage[] = [];
  for (const value of prompt) {
    const message = value as { role: string; content: unknown };
    if (typeof message.content === "string") {
      result.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) throw new Error("Unsupported Mastra synthetic message content.");
    const parts = message.content as Record<string, unknown>[];
    if (message.role === "tool") {
      for (const part of parts) {
        if (part.type !== "tool-result") continue;
        const output = part.output as { value?: unknown } | undefined;
        const actual = output?.value ?? part.result ?? part.output;
        result.push({ role: "tool", content: typeof actual === "string" ? actual : JSON.stringify(actual), toolCallId: String(part.toolCallId) });
      }
    } else {
      const toolCalls = parts.filter((part) => part.type === "tool-call").map((part) => ({
        callId: String(part.toolCallId), toolName: String(part.toolName), input: part.input ?? part.args,
      }));
      result.push({ role: message.role, content: parts.filter((part) => part.type === "text").map((part) => String(part.text)).join(""), ...(toolCalls.length ? { toolCalls } : {}) });
    }
  }
  return result;
}
