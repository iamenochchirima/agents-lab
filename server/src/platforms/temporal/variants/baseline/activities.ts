import { cancellationSignal, heartbeat } from "@temporalio/activity";

import { ContextService, ContextSessionStore, CharacterTokenEstimator, type ContextSummaryGenerator } from "../../../../capabilities/context/index.js";
import { calculatorTool } from "../../../../capabilities/tools/calculator.js";
import { ToolRegistry } from "../../../../capabilities/tools/registry.js";
import type { ToolExecutionResult } from "../../../../capabilities/tools/contracts.js";

import type { ModelCallResult, ModelRequestInput, TemporalContextPreparationInput, TemporalContextPreparationResult, TemporalModelMessage, TemporalToolExecutionInput } from "./contracts.js";
import { createModelAdapter } from "./models/factory.js";

export async function prepareContext(input: TemporalContextPreparationInput): Promise<TemporalContextPreparationResult> {
  const store = new ContextSessionStore(input.rootDirectory);
  const session = await store.read(input.sessionId);
  if (session.model !== `${input.provider}/${input.model}`) {
    throw new Error("The context session model does not match the Temporal run model.");
  }
  const context = new ContextService(store, new CharacterTokenEstimator());
  const adapter = createModelAdapter(input.provider);
  const summarizer: ContextSummaryGenerator = {
    async summarize(request) {
      const response = await adapter.complete({
        runId: `${input.sessionId}:context:${request.sourceRevision}`,
        prompt: formatSummaryPrompt(request.messages),
        systemInstruction: "Summarize the earlier conversation for another model. Preserve facts, decisions, unresolved requests, and tool results. Return only the concise summary.",
        provider: input.provider,
        model: input.model,
        attemptId: `${input.sessionId}:context:${request.sourceRevision}`,
        attemptNumber: 1,
      }, cancellationSignal());
      if (response.kind !== "success" || response.output === null) throw new Error(response.kind === "failure" ? response.message : "The context summarizer returned no text.");
      return response.output;
    },
  };
  const prepared = await context.prepareTurn(input.sessionId, input.turnId, summarizer, {
    forceCompaction: input.forceCompaction,
    trigger: input.trigger,
  });
  return {
    snapshotId: prepared.snapshot.snapshotId,
    sessionRevision: prepared.snapshot.sessionRevision,
    compactionRevision: prepared.snapshot.compactionRevision,
    inputTokens: prepared.snapshot.budget.inputTokens,
    remainingTokens: prepared.snapshot.budget.remainingTokens,
    remainingPercent: prepared.snapshot.budget.remainingPercent,
    pressure: prepared.snapshot.budget.pressure,
    quality: prepared.snapshot.budget.quality,
    compacted: prepared.snapshot.compaction !== null,
    compaction: prepared.snapshot.compaction === null ? null : {
      compactionId: prepared.snapshot.compaction.compactionId,
      trigger: prepared.snapshot.compaction.trigger,
      sourceMessageCount: prepared.snapshot.compaction.sourceMessageIds.length,
      retainedMessageCount: prepared.snapshot.compaction.retainedMessageIds.length,
      beforeInputTokens: prepared.snapshot.compaction.before.inputTokens,
      afterInputTokens: prepared.snapshot.compaction.after.inputTokens,
    },
  };
}

/**
 * Network and provider I/O belongs in an Activity. The Workflow supplies a
 * stable attempt ID and owns the decision about whether a returned failure is
 * safe to retry.
 */
export async function requestModel(input: ModelRequestInput): Promise<ModelCallResult> {
  const heartbeatTimer = setInterval(() => heartbeat({ attemptId: input.attemptId }), 250);
  try {
    heartbeat({ attemptId: input.attemptId });
    const snapshotMessages = input.context
      ? (await loadContextMessages(input.context.rootDirectory, input.context.sessionId, input.context.snapshotId)).map(toModelMessage)
      : (input.messages ?? []);
    const messages = [...snapshotMessages, ...(input.continuationMessages ?? [])];
    const prompt = [...(messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? input.prompt;
    const systemInstruction = messages?.find((message) => message.role === "system")?.content ?? input.systemInstruction;
    return await createModelAdapter(input.provider).complete({ ...input, messages, prompt, systemInstruction }, cancellationSignal());
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function executeTool(input: TemporalToolExecutionInput): Promise<ToolExecutionResult> {
  const registry = new ToolRegistry({ enabledNames: input.enabledNames });
  registry.register(calculatorTool);
  const validation = registry.validateCall(input.call);
  if (!validation.accepted) {
    return failedToolExecution("TOOL_EXECUTION_FAILED", `Tool call was invalid at the execution boundary: ${validation.code}.`);
  }
  return registry.execute(validation, {
    runId: input.runId,
    turnId: input.turnId,
    signal: cancellationSignal(),
  });
}

export const baselineActivities = { prepareContext, requestModel, executeTool };

async function loadContextMessages(rootDirectory: string, sessionId: string, snapshotId: string): Promise<readonly import("../../../../capabilities/context/contracts.js").ContextMessage[]> {
  const store = new ContextSessionStore(rootDirectory);
  const snapshot = await store.readSnapshot(sessionId, snapshotId);
  return snapshot.messages;
}

function toModelMessage(message: import("../../../../capabilities/context/contracts.js").ContextMessage): TemporalModelMessage {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  if (message.role === "tool") return { role: "tool", toolCallId: message.metadata?.toolCallId ?? message.messageId, name: message.metadata?.toolName ?? "tool", content: message.content };
  return {
    role: message.role === "developer" ? "system" : message.role,
    content: message.content,
  };
}

function formatSummaryPrompt(messages: readonly import("../../../../capabilities/context/contracts.js").ContextMessage[]): string {
  return messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");
}

function failedToolExecution(code: "TOOL_EXECUTION_FAILED", message: string): ToolExecutionResult {
  const safeMessage = message.slice(0, 512);
  return {
    status: "failed",
    content: JSON.stringify({ error: safeMessage, code }),
    error: { code, message: safeMessage },
    durationMs: 0,
    attemptCount: 1,
  };
}
