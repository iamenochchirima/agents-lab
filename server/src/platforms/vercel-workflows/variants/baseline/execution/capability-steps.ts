import { FatalError } from "workflow";
import { createRuntimeToolRegistry, prepareToolInvocation } from "../../../../../capabilities/extensions/runtime.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../../../../../capabilities/context/index.js";
import type { ToolCall } from "../../../../../capabilities/tools/contracts.js";
import type { VercelWorkflowInput, VercelWorkflowProgress, VercelModelMessage } from "../contracts.js";
import { capabilityInventoryContext } from "../../../../../capabilities/inventory.js";
import { ProgressStore } from "../state/progress-store.js";
import { completeOpenRouterModel } from "../models/openrouter.js";
import { completeFakeModel } from "../models/fake.js";
import { loadVercelWorkflowsConfig } from "../../../config.js";

export async function initializeCapabilityStep(input: VercelWorkflowInput) {
  "use step";
  const definitions = createRuntimeToolRegistry(input.tools ?? { enabledNames: [] }, input.toolCatalog).definitions();
  let messages: readonly VercelModelMessage[] = [{ role: "system", content: input.systemInstruction }, { role: "user", content: input.prompt }];
  let snapshotId: string | null = null;
  if (!input.context && input.inventory) messages = [messages[0], { role: "system", content: capabilityInventoryContext(input.inventory) }, ...messages.slice(1)];
  if (input.context) {
    const context = new ContextService(new ContextSessionStore(input.context.rootDirectory), new CharacterTokenEstimator());
    const prepared = await context.prepareTurn(input.context.sessionId, input.context.turnId, {
      async summarize(request) {
        const config = loadVercelWorkflowsConfig();
        const modelRequest = { ...input, prompt: request.messages.map(message => `[${message.role}]\n${message.content}`).join("\n\n"),
          systemInstruction: "Summarize the conversation. Preserve facts, decisions, open requests and tool results.", attempt: 1 };
        const result = input.model.provider === "fake" ? completeFakeModel(modelRequest) : await completeOpenRouterModel(modelRequest, { apiKey: config.openRouterApiKey, baseUrl: config.openRouterBaseUrl });
        if (result.kind !== "success" || !result.output) throw new FatalError("Context summary failed.");
        return result.output;
      },
    }, { ...(input.inventory ? { capabilityInventory: input.inventory } : {}) });
    snapshotId = prepared.snapshot.snapshotId;
    messages = prepared.snapshot.messages.map(message => {
      if (message.role === "tool") return { role: "tool" as const, toolCallId: message.metadata?.toolCallId ?? message.messageId, name: message.metadata?.toolName ?? "tool", content: message.content };
      return { role: message.role === "developer" ? "system" : message.role, content: message.content };
    });
  }
  return { definitions, messages, snapshotId, startedAt: new Date().toISOString() };
}

export async function prepareCapabilityStep(input: VercelWorkflowInput, call: ToolCall) {
  "use step";
  const registry = createRuntimeToolRegistry(input.tools ?? { enabledNames: [] }, input.toolCatalog);
  const validation = registry.validateCall(call);
  if (!validation.accepted) return { kind: "rejected" as const, code: validation.code, message: validation.message };
  const policy = registry.authorize(call);
  if (!policy.allowed) return { kind: "rejected" as const, code: policy.code, message: policy.message };
  let review;
  try {
    review = input.toolCatalog ? await prepareToolInvocation(input.toolCatalog, validation.call, {
      runId: input.runId, turnId: input.turnId ?? `${input.runId}:turn:1`, signal: AbortSignal.timeout(30_000),
    }) : null;
  } catch {
    return { kind: "failure" as const, error: { code: "ACTION_REVIEW_PREPARATION_FAILED",
      message: "Action review could not be prepared. This action was not dispatched. Check the capability host connection and review policy.",
      failureKind: "pre_dispatch" as const, retryable: false } };
  }
  return { kind: "prepared" as const, call: validation.call, definition: validation.definition, review };
}

export async function executeCapabilityStep(input: VercelWorkflowInput, call: ToolCall) {
  "use step";
  const registry = createRuntimeToolRegistry(input.tools ?? { enabledNames: [] }, input.toolCatalog);
  const validated = registry.validateCall(call);
  if (!validated.accepted) throw new FatalError("The admitted tool call changed before dispatch.");
  return registry.execute(validated, { runId: input.runId, turnId: input.turnId ?? `${input.runId}:turn:1`,
    toolCallId: call.toolCallId, connectionBindings: input.connections, signal: AbortSignal.timeout(validated.definition.limits.timeoutMs) });
}
// SDK retry defaults otherwise repeat steps. Host receipts retain the call
// identity across process recovery; unknown effects stop the native loop.
executeCapabilityStep.maxRetries = 0;
prepareCapabilityStep.maxRetries = 0;
initializeCapabilityStep.maxRetries = 0;

export async function publishProgressStep(input: VercelWorkflowInput, progress: VercelWorkflowProgress): Promise<string> {
  "use step";
  if (input.progressDirectory) await new ProgressStore(input.progressDirectory).write(input.runId, progress);
  return new Date().toISOString();
}
