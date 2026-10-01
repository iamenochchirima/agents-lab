import type { JsonValue, ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import { parseModelInterfaceConfig, type ModelInterfaceConfig } from "./config.js";
import type {
  ModelCallResult,
  ModelFailure,
  ModelInterfaceModule,
  ModelMessage,
  ModelRequest,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "deterministic-replay-model", version: "0.1.0" });
const MESSAGE_ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);

/**
 * A local, deterministic model substitute for exercising an assembled harness.
 * It returns a deterministic summary of what reached the model boundary; it
 * does not infer, reason, or claim to provide an LLM response.
 */
class ReplayModelInterface implements ModelInterfaceModule {
  readonly identity = IDENTITY;

  constructor(private readonly config: ModelInterfaceConfig) {}

  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
    const invalidMessage = validateRequest(request);
    if (invalidMessage) return failed("invalid-request", invalidMessage, "not-sent", request);
    if (request.model.provider !== "replay") {
      return failed("invalid-request", 'Replay requires model.provider to be "replay".', "not-sent", request);
    }
    if (!isAbortSignal(signal)) return failed("invalid-request", "A valid AbortSignal is required.", "not-sent", request);
    if (signal.aborted) return failed("cancelled", "Replay model request was cancelled before completion.", "not-sent", request);

    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === "user");
    if (!lastUserMessage || lastUserMessage.content === null || lastUserMessage.content.trim().length === 0) {
      return failed("invalid-request", "Replay requires a user message with text content.", "not-sent", request);
    }

    const fullText = `Deterministic replay (not an LLM). Received ${request.messages.length} model messages; the latest user message contains ${estimateTokens(lastUserMessage.content)} estimated tokens.`;
    const text = truncateEstimatedOutput(fullText, this.config.maxOutputTokens);
    if (signal.aborted) return failed("cancelled", "Replay model request was cancelled before completion.", "not-sent", request);

    const inputTokens = estimateTokens(request.messages.map((message) => message.content ?? "").join("\n"));
    const outputTokens = estimateTokens(text);
    const response = Object.freeze({
      provider: Object.freeze({
        provider: request.model.provider,
        model: request.model.name,
        adapter: this.identity,
        requestId: `replay-${hashText(stableRequestText(request))}`,
      }),
      text,
      toolCalls: Object.freeze([]),
      finishReason: text === fullText ? "stop" : "length",
      usage: Object.freeze({
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        basis: "estimated" as const,
      }),
      providerDetail: Object.freeze({
        implementation: "deterministic-replay",
        behavior: "summarize-request-shape",
        toolCallsGenerated: false,
      }) satisfies JsonValue,
    });
    return Object.freeze({ outcome: "completed", response });
  }
}

/** Create a deterministic local implementation of the shared model interface. */
export function createReplayModelInterface(config: unknown = {}): ModelInterfaceModule {
  return new ReplayModelInterface(parseModelInterfaceConfig(config));
}

function validateRequest(value: unknown): string | undefined {
  if (!isRecord(value)) return "Model request must be an object.";
  if (!isRecord(value.scope) || !isIdentifier(value.scope.runId)) return "Model request scope requires a valid runId.";
  if (value.scope.sessionId !== undefined && !isIdentifier(value.scope.sessionId)) return "Model request sessionId must be a valid identifier.";
  if (value.scope.turnId !== undefined && !isIdentifier(value.scope.turnId)) return "Model request turnId must be a valid identifier.";
  if (!isRecord(value.model) || !isText(value.model.provider) || !isText(value.model.name)
    || (value.model.revision !== undefined && !isText(value.model.revision))) {
    return "Model selection requires provider and name text, with an optional non-empty revision.";
  }
  if (!Array.isArray(value.messages)) return "Model request messages must be an array.";
  for (const [index, item] of value.messages.entries()) {
    if (!isRecord(item) || typeof item.role !== "string" || !MESSAGE_ROLES.has(item.role)
      || (item.content !== null && typeof item.content !== "string")
      || (item.name !== undefined && !isText(item.name))
      || (item.toolCallId !== undefined && !isText(item.toolCallId))) {
      return `Model request message ${index} is invalid.`;
    }
  }
  if (!isRecord(value.parameters) || !isJsonValue(value.parameters)) return "Model request parameters must be a JSON object.";
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) return "Model request tools must be an array when provided.";
    for (const [index, tool] of value.tools.entries()) {
      if (!isRecord(tool) || !isText(tool.name) || !isText(tool.description) || !isJsonValue(tool.parameters)) {
        return `Model request tool ${index} is invalid.`;
      }
    }
  }
  if (value.idempotencyKey !== undefined && !isText(value.idempotencyKey)) return "Model request idempotencyKey must be non-empty text.";
  return undefined;
}

function failed(
  category: ModelFailure["category"],
  message: string,
  dispatchOutcome: ModelFailure["dispatchOutcome"],
  request: unknown,
): ModelCallResult {
  const provider = isRecord(request) && isRecord(request.model) && typeof request.model.provider === "string"
    ? request.model.provider
    : undefined;
  return Object.freeze({
    outcome: "failed",
    failure: Object.freeze({ category, message, retryable: false, dispatchOutcome, ...(provider ? { provider } : {}) }),
  });
}

function truncateEstimatedOutput(value: string, maximumTokens: number): string {
  const maxBytes = maximumTokens * 4;
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function estimateTokens(value: string): number {
  return Math.ceil(new TextEncoder().encode(value).byteLength / 4);
}

function stableRequestText(request: ModelRequest): string {
  return canonicalJson({
    scope: request.scope,
    model: request.model,
    messages: request.messages,
    tools: request.tools ?? [],
    parameters: request.parameters,
    idempotencyKey: request.idempotencyKey ?? null,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object" && value !== null && typeof (value as AbortSignal).aborted === "boolean";
}
