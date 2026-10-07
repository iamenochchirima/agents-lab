import type { MastraModelConfig } from "@mastra/core/llm";
import type { RunManifest } from "../../../../../control-plane/domain/types.js";
import { FREE_PROVIDER_ROUTING, assertFreeModelRequest } from "../../../../../models/openrouter/free-model-policy.js";

/** Opt-in synthetic live eval transport. Mastra still owns its native multi-step agent loop. */
export function liveOpenRouterModel(manifest: RunManifest, observe: (receipt: Record<string, unknown>) => void,
  options: { apiKey?: string; baseUrl?: string; fetchImplementation?: typeof fetch } = {}): MastraModelConfig {
  let sequence = 0;
  return {
    specificationVersion: "v2", provider: "openrouter", modelId: manifest.model.model, supportedUrls: {},
    doGenerate: async (input: { prompt: unknown; tools?: { type: string; name: string; description?: string; inputSchema: unknown }[]; abortSignal?: AbortSignal }) => {
      const messages = mapMessages(input.prompt);
      const body = { model: manifest.model.model, messages, max_tokens: 512, provider: FREE_PROVIDER_ROUTING,
        ...(input.tools?.length ? { tools: input.tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), tool_choice: "auto" } : {}) };
      assertFreeModelRequest(body, manifest.model.model);
      const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey?.trim()) throw new Error("OPENROUTER_API_KEY is required for live evals.");
      const requestSequence = ++sequence;
      const receipt: Record<string, unknown> = { sequence: requestSequence, providerRequest: body,
        messages: normalizeMessages(messages), toolCalls: [], model: manifest.model.model };
      observe({ ...receipt, phase: "request" });
      let response: Response;
      try {
        response = await (options.fetchImplementation ?? fetch)(`${(options.baseUrl ?? process.env.AGENTLAB_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body), signal: input.abortSignal,
        });
      } catch {
        observe({ ...receipt, phase: "error", error: "OpenRouter dispatch outcome is unknown; this live trial will not retry." });
        throw new Error("OpenRouter dispatch outcome is unknown; this live trial will not retry.");
      }
      if (!response.ok) {
        observe({ ...receipt, phase: "error", providerStatus: response.status, error: `OpenRouter returned HTTP ${response.status}.` });
        throw new Error(`OpenRouter returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > 262_144) throw new Error("OpenRouter live response exceeded the evidence limit.");
      const data = JSON.parse(text);
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("OpenRouter returned no assistant message.");
      const toolCalls = (message.tool_calls ?? []).map((call: any) => ({ toolCallId: String(call.id), name: String(call.function.name), arguments: parseArguments(call.function.arguments) }));
      observe({ ...receipt, phase: "response", toolCalls, providerRequestId: data.id ?? null,
        providerModel: data.model ?? null, providerName: data.provider ?? null, output: message.content ?? null, usage: data.usage ?? null });
      const content: unknown[] = [];
      if (typeof message.content === "string" && message.content) content.push({ type: "text", text: message.content });
      for (const call of toolCalls) content.push({ type: "tool-call", toolCallId: call.toolCallId, toolName: call.name, input: JSON.stringify(call.arguments) });
      if (!content.length) throw new Error("OpenRouter returned an empty live response.");
      return { content, finishReason: toolCalls.length ? "tool-calls" : "stop", warnings: [],
        usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens },
        response: { id: data.id, modelId: data.model, timestamp: new Date() } };
    },
    doStream: async () => { throw new Error("Live evals use generate, not streaming."); },
  } as unknown as MastraModelConfig;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
function mapMessages(prompt: unknown): Record<string, any>[] {
  if (!Array.isArray(prompt)) throw new Error("Mastra did not supply mapped messages.");
  return prompt.flatMap((message: any) => {
    if (typeof message.content === "string") return [{ role: message.role, content: message.content }];
    if (!Array.isArray(message.content)) throw new Error("Unsupported Mastra message content.");
    if (message.role === "tool") return message.content.filter((part: any) => part.type === "tool-result").map((part: any) => {
      const value = part.output?.value ?? part.result ?? part.output;
      return { role: "tool", tool_call_id: part.toolCallId, content: typeof value === "string" ? value : JSON.stringify(value) };
    });
    const calls = message.content.filter((part: any) => part.type === "tool-call").map((part: any) => ({ id: part.toolCallId, type: "function", function: { name: part.toolName, arguments: JSON.stringify(part.input ?? part.args) } }));
    return [{ role: message.role, content: message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join(""), ...(calls.length ? { tool_calls: calls } : {}) }];
  });
}
function normalizeMessages(messages: Record<string, any>[]) {
  return messages.map(message => ({ role: message.role, content: message.content ?? "", ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
    ...(message.tool_calls ? { toolCalls: message.tool_calls.map((call: any) => ({ toolCallId: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments) })) } : {}) }));
}
