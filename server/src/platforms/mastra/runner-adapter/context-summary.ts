import { Agent } from "@mastra/core/agent";

import type {
  ContextMessage,
  ContextSummaryGenerator,
  ContextSummaryRequest,
} from "../../../capabilities/context/index.js";
import type { RunManifest } from "../../../control-plane/domain/types.js";
import type { MastraModelFactory } from "../variants/baseline/models/factory.js";

const MAX_FAKE_SUMMARY_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 100_000;

export type MastraContextSummaryErrorCode =
  | "SUMMARY_CANCELLED"
  | "SUMMARY_EMPTY"
  | "SUMMARY_TOO_LARGE"
  | "SUMMARY_FAILED";

export class MastraContextSummaryError extends Error {
  constructor(
    readonly code: MastraContextSummaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MastraContextSummaryError";
  }
}

export interface MastraContextSummaryOptions {
  readonly manifest: RunManifest;
  readonly modelFactory: MastraModelFactory;
  readonly signal: AbortSignal;
  readonly onRequest?: () => Promise<void>;
  readonly onUsage?: (usage: unknown) => Promise<void>;
}

/**
 * Creates the summary boundary used before a Mastra turn is dispatched.
 *
 * Fake profiles use a bounded extractive summary so local context tests stay
 * deterministic. Configured provider profiles use a separate Mastra Agent
 * call with the selected model and no tools. The summary call is part of the
 * platform runner lifecycle; it is never persisted as a second Lab run.
 */
export function createMastraContextSummaryGenerator(
  options: MastraContextSummaryOptions,
): ContextSummaryGenerator {
  if (options.manifest.model.provider === "fake") {
    return { summarize: async (request) => extractiveSummary(request) };
  }

  return {
    summarize: (request) => summarizeWithMastraAgent(request, options),
  };
}

function extractiveSummary(request: ContextSummaryRequest): string {
  const rendered = renderSummaryInput(request.messages);
  if (rendered.length === 0) {
    throw new MastraContextSummaryError("SUMMARY_EMPTY", "The context has no content to summarize.");
  }

  if (rendered.length <= MAX_FAKE_SUMMARY_CHARS) {
    return "Earlier context:\n" + rendered;
  }

  const headLength = Math.floor(MAX_FAKE_SUMMARY_CHARS * 0.65);
  const tailLength = MAX_FAKE_SUMMARY_CHARS - headLength;
  return "Earlier context:\n" + rendered.slice(0, headLength) + "\n[earlier content omitted]\n" + rendered.slice(-tailLength);
}

async function summarizeWithMastraAgent(
  request: ContextSummaryRequest,
  options: MastraContextSummaryOptions,
): Promise<string> {
  if (options.signal.aborted || request.signal?.aborted) {
    throw new MastraContextSummaryError("SUMMARY_CANCELLED", "The Mastra context summary request was cancelled.");
  }

  const agent = new Agent({
    id: "mastra-context-summary-agent",
    name: "Mastra context summary agent",
    instructions: "Summarize the earlier conversation for another model. Preserve facts, decisions, unresolved requests, and tool results. Return only the concise summary.",
    model: options.modelFactory(options.manifest),
    maxRetries: 0,
  });

  try {
    await options.onRequest?.();
    const output = await agent.generate(renderSummaryInput(request.messages), {
      runId: options.manifest.runId + ":context:" + request.sourceRevision,
      abortSignal: request.signal ?? options.signal,
      maxSteps: 1,
    });
    await options.onUsage?.(output.totalUsage ?? output.usage);
    const summary = output.text.trim();
    if (summary.length === 0) {
      throw new MastraContextSummaryError("SUMMARY_EMPTY", "The Mastra context summary agent returned no text.");
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
      throw new MastraContextSummaryError("SUMMARY_TOO_LARGE", "The Mastra context summary exceeded the configured safety limit.");
    }
    return summary;
  } catch (error) {
    if (error instanceof MastraContextSummaryError) throw error;
    if (options.signal.aborted || request.signal?.aborted || isAbortError(error)) {
      throw new MastraContextSummaryError("SUMMARY_CANCELLED", "The Mastra context summary request was cancelled.");
    }
    throw new MastraContextSummaryError("SUMMARY_FAILED", "The Mastra context summary request failed.");
  }
}

function renderSummaryInput(messages: readonly ContextMessage[]): string {
  return messages
    .map((message) => "[" + message.role + "]\n" + message.content.trim())
    .filter((message) => message.length > 0)
    .join("\n\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
