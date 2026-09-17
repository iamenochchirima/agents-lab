import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { RunManifest } from "../../../../control-plane/domain/types.js";
import type { ToolCall, ToolLifecycleKind, ToolLifecyclePayload } from "../../../../capabilities/tools/contracts.js";
import { calculatorTool } from "../../../../capabilities/tools/calculator.js";
import { ToolRegistry } from "../../../../capabilities/tools/registry.js";
import { MASTRA_AGENT_ID } from "./config/configuration.js";
import { defaultMastraModelFactory, type MastraModelFactory } from "./models/factory.js";

export const BASELINE_AGENT_INSTRUCTIONS =
  "You are the Agent Harness Lab Mastra baseline agent. Answer the user's prompt directly and concisely.";

export interface BaselineAgentOptions {
  readonly runId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  readonly maxToolCalls: number;
  readonly onToolEvent?: (kind: ToolLifecycleKind, payload: ToolLifecyclePayload) => void;
}

export function createBaselineAgent(
  manifest: RunManifest,
  modelFactory: MastraModelFactory = defaultMastraModelFactory,
  options?: BaselineAgentOptions,
): Agent {
  const enabledNames = manifest.capabilities?.tools.enabledNames ?? [calculatorTool.definition.name];
  const registry = new ToolRegistry({ enabledNames });
  registry.register(calculatorTool);

  return new Agent({
    id: MASTRA_AGENT_ID,
    name: "Mastra baseline agent",
    instructions: BASELINE_AGENT_INSTRUCTIONS,
    model: modelFactory(manifest),
    ...(options ? { tools: enabledNames.includes(calculatorTool.definition.name) ? { calculator: calculatorAgentTool(registry, options) } : {} } : {}),
    maxRetries: 0,
  });
}

const calculatorInputSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  left: z.number(),
  right: z.number(),
}).strict();

function calculatorAgentTool(registry: ToolRegistry, options: BaselineAgentOptions) {
  let toolCallCount = 0;
  return createTool({
    id: calculatorTool.definition.name,
    description: calculatorTool.definition.description,
    inputSchema: calculatorInputSchema,
    execute: async (input, context) => {
      toolCallCount += 1;
      const toolCallId = context.agent?.toolCallId ?? `mastra-tool-${toolCallCount}`;
      const call: ToolCall = {
        toolCallId,
        name: calculatorTool.definition.name,
        arguments: input,
        round: toolCallCount,
      };
      const payload = toolPayload(call);
      options.onToolEvent?.("ToolCallRequested", payload);

      if (toolCallCount > options.maxToolCalls) {
        const message = "The Mastra baseline reached its tool-call limit.";
        options.onToolEvent?.("ToolCallRejected", { ...payload, code: "TOOL_CALL_LIMIT_EXCEEDED", message });
        throw mastraToolError("MASTRA_TOOL_CALL_LIMIT_EXCEEDED", message);
      }

      const validation = registry.validateCall(call);
      if (!validation.accepted) {
        options.onToolEvent?.("ToolCallRejected", { ...payload, code: validation.code, message: validation.message });
        return JSON.stringify({ error: validation.message, code: validation.code });
      }
      options.onToolEvent?.("ToolCallValidated", toolPayload(validation.call));

      const policy = registry.authorize(validation.call);
      if (!policy.allowed) {
        options.onToolEvent?.("ToolPolicyDenied", { ...toolPayload(validation.call), code: policy.code, message: policy.message });
        return JSON.stringify({ error: policy.message, code: policy.code });
      }

      options.onToolEvent?.("ToolExecutionStarted", toolPayload(validation.call));
      const result = await registry.execute(validation, {
        runId: options.runId,
        turnId: options.turnId,
        signal: context.abortSignal ?? options.signal,
      });
      const resultPayload = {
        ...toolPayload(validation.call),
        status: result.status,
        durationMs: result.durationMs,
        resultBytes: new TextEncoder().encode(result.content).byteLength,
        ...(result.error ? { code: result.error.code, message: result.error.message } : {}),
      } satisfies ToolLifecyclePayload;
      options.onToolEvent?.(toolEventKind(result.status), resultPayload);
      if (result.status !== "completed") {
        if (result.status === "cancelled" || result.status === "timed_out") throw abortError();
        throw mastraToolError(result.error?.code ?? "TOOL_EXECUTION_FAILED", "The Mastra calculator tool failed.");
      }
      return result.content;
    },
  });
}

function toolPayload(call: ToolCall): ToolLifecyclePayload {
  return {
    toolCallId: call.toolCallId.slice(0, 128),
    toolName: call.name.slice(0, 64),
    round: call.round,
    attempt: 1,
    argumentBytes: new TextEncoder().encode(JSON.stringify(call.arguments)).byteLength,
  };
}

function toolEventKind(status: "completed" | "failed" | "cancelled" | "timed_out"): ToolLifecycleKind {
  if (status === "completed") return "ToolExecutionCompleted";
  if (status === "cancelled" || status === "timed_out") return "ToolExecutionCancelled";
  return "ToolExecutionFailed";
}

function mastraToolError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

function abortError(): Error {
  const error = new Error("The Mastra tool execution was aborted.");
  error.name = "AbortError";
  return error;
}
