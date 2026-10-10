import type { LibSQLStore } from "@mastra/libsql";
import { Agent } from "@mastra/core/agent";
import { createDurableAgent, DurableAgent } from "@mastra/core/agent/durable";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";

import type { RunManifest } from "../../../../control-plane/domain/types.js";
import type { ConnectionBinding } from "../../../../capabilities/integrations/contracts.js";
import { getDefaultConnectionRuntime, type ConnectionRuntime } from "../../../../capabilities/integrations/runtime.js";
import type { ToolExecutionResult, ToolCall, ToolImplementation, ToolLifecycleKind, ToolLifecyclePayload } from "../../../../capabilities/tools/contracts.js";
import { calculatorTool } from "../../../../capabilities/tools/calculator.js";
import { ToolRegistry } from "../../../../capabilities/tools/registry.js";
import { projectToolResult, toolResultEvidence } from "../../../../capabilities/tools/result-projection.js";
import { createRuntimeToolRegistry } from "../../../../capabilities/extensions/runtime.js";
import { preserveDurableRecoveryInputs } from "./durability/recovery-snapshots.js";
import { sustainedModel } from "./models/sustained.js";
import { MASTRA_AGENT_ID } from "./config/configuration.js";
import { defaultMastraModelFactory, type MastraModelFactory } from "./models/factory.js";

export interface BaselineAgentOptions {
  readonly storage?: LibSQLStore;
  readonly sustained?: boolean;
  readonly onModelTimeout?: () => void;
  readonly beforeModelRequest?: (input: { prompt?: unknown; tools?: unknown; abortSignal?: AbortSignal }) => Promise<unknown>;
  /** Persist the dispatch boundary before the SDK allows a tool to escape. */
  readonly beforeToolDispatch?: (call: ToolCall) => Promise<void>;
  readonly afterToolDispatch?: (call: ToolCall, result: ToolExecutionResult) => Promise<void>;
  readonly runId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  readonly maxToolCalls: number;
  /** One-based native model step, shared by all tool calls from that step. */
  readonly currentRound?: () => number;
  readonly connectionRuntime?: ConnectionRuntime;
  readonly connectionBindings?: readonly ConnectionBinding[];
  /** Opt-in synthetic fixture observation, not persisted or enabled by default. */
  readonly onToolObservation?: (call: ToolCall, result: ToolExecutionResult) => void;
  readonly onToolEvent?: (kind: ToolLifecycleKind, payload: ToolLifecyclePayload) => void;
}

export interface BaselineAgentRuntime {
  readonly agent: Agent;
  readonly mastra: Mastra;
}

/**
 * Registers the baseline agent through Mastra's application container. The
 * runner keeps this object platform-local so common server code only sees the
 * PlatformRunner contract.
 */
export function createBaselineAgentRuntime(manifest: RunManifest, modelFactory?: MastraModelFactory, options?: BaselineAgentOptions & { sustained?: false }): BaselineAgentRuntime;
export function createBaselineAgentRuntime(manifest: RunManifest, modelFactory: MastraModelFactory | undefined, options: BaselineAgentOptions & { sustained: true }): { agent: DurableAgent; mastra: Mastra };
export function createBaselineAgentRuntime(manifest: RunManifest, modelFactory: MastraModelFactory | undefined, options: BaselineAgentOptions): { agent: Agent | DurableAgent; mastra: Mastra };
export function createBaselineAgentRuntime(
  manifest: RunManifest,
  modelFactory: MastraModelFactory = defaultMastraModelFactory,
  options?: BaselineAgentOptions,
): { agent: Agent | DurableAgent; mastra: Mastra } {
  const regular = createBaselineAgent(manifest, modelFactory, options);
  const agent = options?.sustained
    ? createDurableAgent({ agent: regular, maxSteps: manifest.capabilities?.tools.maxRounds, cleanupTimeoutMs: 0 })
    : regular;
  if (agent instanceof DurableAgent) preserveDurableRecoveryInputs(agent.getWorkflow());
  const mastra = new Mastra({
    agents: { [MASTRA_AGENT_ID]: agent },
    logger: false,
    ...(options?.storage ? { storage: options.storage } : {}),
  });

  return { mastra, agent };
}

export function createBaselineAgent(
  manifest: RunManifest,
  modelFactory: MastraModelFactory = defaultMastraModelFactory,
  options?: BaselineAgentOptions,
): Agent {
  const enabledNames = manifest.capabilities?.tools.enabledNames ?? [calculatorTool.definition.name];
  const registry = createRuntimeToolRegistry({ enabledNames, approvedNames: manifest.capabilities?.tools.approvedNames }, manifest.capabilities?.toolCatalog, options?.connectionRuntime ?? getDefaultConnectionRuntime());

  // Every wrapper shares this counter. Reserve synchronously before dispatch so
  // parallel SDK calls cannot each consume the same remaining allowance.
  let attemptedCalls = 0;
  const nextToolCall = () => ++attemptedCalls;

  return new Agent({
    id: MASTRA_AGENT_ID,
    name: "Mastra baseline agent",
    instructions: manifest.context.systemInstruction,
    model: options?.sustained ? sustainedModel(modelFactory(manifest), manifest, options.beforeModelRequest, options.onModelTimeout) : modelFactory(manifest),
    ...(manifest.selection?.experimentId === "agent-harness-live" ? { maxRetries: 0 } : {}),
    ...(options ? {
      tools: Object.fromEntries(registry.definitions().map((definition) => [definition.name, catalogAgentTool(registry, registry.resolve(definition.name)!, options, nextToolCall)])),
    } : {}),
    maxRetries: 0,
  });
}

function catalogAgentTool(
  registry: ToolRegistry,
  implementation: ToolImplementation,
  options: BaselineAgentOptions,
  nextToolCall: () => number,
) {
  return createTool({
    id: implementation.definition.name,
    description: implementation.definition.description,
    inputSchema: implementation.definition.inputSchema,
    requireApproval: implementation.definition.approvalMode === "invocation",
    execute: async (input, context) => {
      const toolCallCount = nextToolCall();
      const call: ToolCall = { toolCallId: context.agent?.toolCallId ?? `mastra-tool-${toolCallCount}`, name: implementation.definition.name, arguments: input, round: options.currentRound?.() ?? 1 };
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
        options.onToolEvent?.("ToolPolicyDenied", { ...payload, code: policy.code, message: policy.message });
        return JSON.stringify({ error: policy.message, code: policy.code });
      }
      options.onToolEvent?.("ToolExecutionStarted", payload);
      await options.beforeToolDispatch?.(validation.call);
      const result = await registry.execute(validation, {
        runId: options.runId,
        turnId: options.turnId,
        toolCallId: call.toolCallId,
        signal: context.abortSignal ?? options.signal,
        connectionRuntime: options.connectionRuntime ?? getDefaultConnectionRuntime(),
        connectionBindings: options.connectionBindings,
      });
      await options.afterToolDispatch?.(validation.call, result);
      options.onToolObservation?.(validation.call, result);
      options.onToolEvent?.(toolEventKind(result.status), {
        ...payload,
        status: result.status,
        durationMs: result.durationMs,
        resultBytes: new TextEncoder().encode(result.content).byteLength,
        ...toolResultEvidence(result),
        ...(result.connection ? { connection: result.connection } : {}),
        ...(result.error ? { code: result.error.code, message: result.error.message } : {}),
      });
      // Known failures become model feedback only through the frozen tool policy.
      // Unknown side effects remain terminal and never become automatic retries.
      if (result.status === "failed" && implementation.definition.failurePolicy === "feedback") return projectToolResult(result).content;
      if (result.status !== "completed") {
        if (result.status === "cancelled" || result.status === "timed_out") throw abortError();
        if (result.status === "unknown") {
          throw mastraToolError("TOOL_UNKNOWN", "The external tool outcome could not be confirmed.");
        }
        throw mastraToolError(result.error?.code ?? "TOOL_EXECUTION_FAILED", "The Mastra selected tool failed.");
      }
      return projectToolResult(result).content;
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

function toolEventKind(status: "completed" | "failed" | "cancelled" | "timed_out" | "unknown"): ToolLifecycleKind {
  if (status === "completed") return "ToolExecutionCompleted";
  if (status === "cancelled" || status === "timed_out") return "ToolExecutionCancelled";
  if (status === "unknown") return "ToolExecutionUnknown";
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
