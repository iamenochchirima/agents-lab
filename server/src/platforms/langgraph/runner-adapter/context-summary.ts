import type {
  ContextMessage,
  ContextSummaryGenerator,
  ContextSummaryRequest,
} from "../../../capabilities/context/index.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_SUMMARY_CHARS = 100_000;
const MAX_FAKE_SUMMARY_CHARS = 4_000;

export type LangGraphContextSummaryErrorCode =
  | "OPENROUTER_API_KEY_MISSING"
  | "OPENROUTER_SUMMARY_CANCELLED"
  | "OPENROUTER_SUMMARY_OUTCOME_UNKNOWN"
  | "OPENROUTER_SUMMARY_RESPONSE_TOO_LARGE"
  | "OPENROUTER_SUMMARY_HTTP_ERROR"
  | "OPENROUTER_SUMMARY_INVALID_RESPONSE"
  | "OPENROUTER_SUMMARY_EMPTY";

export class LangGraphContextSummaryError extends Error {
  constructor(
    readonly code: LangGraphContextSummaryErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LangGraphContextSummaryError";
  }
}

export interface LangGraphContextSummaryOptions {
  readonly provider: "fake" | "openrouter";
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Creates the summary call used before a LangGraph turn is dispatched.
 *
 * Fake models use a bounded extractive summary so compaction remains
 * deterministic in local tests. Real runs use the selected OpenRouter model
 * through the same server-owned credential boundary as the platform model
 * call. This request is intentionally not retried because a timed-out request
 * may already have been accepted by the provider.
 */
export function createLangGraphContextSummaryGenerator(
  options: LangGraphContextSummaryOptions,
): ContextSummaryGenerator {
  if (options.provider === "fake") {
    return { summarize: (request) => Promise.resolve(extractiveSummary(request)) };
  }

  return {
    summarize: (request) => summarizeWithOpenRouter(request, options),
  };
}

function extractiveSummary(request: ContextSummaryRequest): string {
  const rendered = request.messages
    .map((message) => `[${message.role}] ${message.content.trim()}`)
    .filter((message) => message.length > 0)
    .join("\n");
  if (!rendered) throw new LangGraphContextSummaryError("OPENROUTER_SUMMARY_EMPTY", "The context has no content to summarize.");
  if (rendered.length <= MAX_FAKE_SUMMARY_CHARS) return `Earlier context:\n${rendered}`;

  const headLength = Math.floor(MAX_FAKE_SUMMARY_CHARS * 0.65);
  const tailLength = MAX_FAKE_SUMMARY_CHARS - headLength;
  return `Earlier context:\n${rendered.slice(0, headLength)}\n[earlier content omitted]\n${rendered.slice(-tailLength)}`;
}

async function summarizeWithOpenRouter(
  request: ContextSummaryRequest,
  options: LangGraphContextSummaryOptions,
): Promise<string> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new LangGraphContextSummaryError(
      "OPENROUTER_API_KEY_MISSING",
      "OPENROUTER_API_KEY is required to compact LangGraph context.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await (options.fetchImplementation ?? fetch)(
        `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              {
                role: "system",
                content: "Summarize the earlier conversation for another model. Preserve facts, decisions, unresolved requests, and tool results. Return only the concise summary.",
              },
              { role: "user", content: renderSummaryInput(request.messages) },
            ],
            temperature: 0,
            max_tokens: 2_048,
          }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (request.signal?.aborted || controller.signal.aborted) {
        throw new LangGraphContextSummaryError("OPENROUTER_SUMMARY_CANCELLED", "The LangGraph context summary request was cancelled.");
      }
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_OUTCOME_UNKNOWN",
        "The LangGraph context summary request was sent but its outcome could not be confirmed.",
      );
    }

    const bodyText = await readResponseText(response);
    if (bodyText === null) {
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_RESPONSE_TOO_LARGE",
        "OpenRouter returned a context summary response larger than the configured safety limit.",
      );
    }
    if (!response.ok) {
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_HTTP_ERROR",
        `OpenRouter rejected the LangGraph context summary with HTTP ${response.status}.`,
        response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_INVALID_RESPONSE",
        "OpenRouter returned an invalid LangGraph context summary response.",
      );
    }
    const output = summaryText(body);
    if (!output) {
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_EMPTY",
        "OpenRouter returned no text for the LangGraph context summary.",
      );
    }
    if (output.length > MAX_SUMMARY_CHARS) {
      throw new LangGraphContextSummaryError(
        "OPENROUTER_SUMMARY_RESPONSE_TOO_LARGE",
        "OpenRouter returned a LangGraph context summary outside the configured safety limit.",
      );
    }
    return output;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

function renderSummaryInput(messages: readonly ContextMessage[]): string {
  return messages
    .map((message) => `[${message.role}]\n${message.content}`)
    .join("\n\n");
}

async function readResponseText(response: Response): Promise<string | null> {
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES ? null : text;
}

function summaryText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) return null;
  const message = value.choices[0].message;
  if (!isRecord(message)) return null;
  if (typeof message.content === "string") return message.content.trim() || null;
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter(isRecord)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
