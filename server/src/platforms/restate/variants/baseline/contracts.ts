import type {
  ModelProvider,
  RunEventIntent,
  RunError,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";
import type { ToolCall, ToolDefinition, ToolExecutionResult } from "../../../../capabilities/tools/contracts.js";

export const RESTATE_WORKFLOW_NAME = "AgentLabRestateBaseline";
export const RESTATE_WORKFLOW_SOURCE = "restate-workflow";

export interface RestateWorkflowInput {
  readonly runId: string;
  readonly turnId?: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
    readonly contextWindowTokens?: number;
  };
  /** Maximum number of durable, pre-dispatch model attempts for each round. */
  readonly modelRetryAttempts?: number;
  readonly tools: {
    readonly enabledNames: readonly string[];
    readonly maxRounds: number;
    readonly maxCalls: number;
  };
  readonly context?: {
    readonly rootDirectory: string;
    readonly sessionId: string;
    readonly turnId: string;
  };
}

export interface RestateWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
}

export interface ModelRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly round: number;
  /** One-based durable attempt number for this model round. */
  readonly attempt: number;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
}

export type ModelMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: readonly ModelToolCall[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly name: string; readonly content: string };

export interface ModelToolCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ModelSuccess {
  readonly kind: "success";
  readonly output: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export interface ModelFailure {
  readonly kind: "failure";
  readonly code: string;
  readonly message: string;
  readonly failureKind: RunError["failureKind"];
  readonly retryable: boolean;
  readonly requestSent: boolean;
}

export type ModelCallResult = ModelSuccess | ModelFailure;

export interface ModelAdapter {
  complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult>;
}

export interface RestateToolCallResult extends ToolExecutionResult {
  readonly call: ToolCall;
}

export function workflowInputFromManifest(manifest: RunManifest): RestateWorkflowInput {
  const tools = manifest.capabilities?.tools ?? readToolConfiguration(manifest.platformConfig);
  const contextRoot = typeof manifest.platformConfig.contextRoot === "string" && manifest.platformConfig.contextRoot.trim().length > 0
    ? manifest.platformConfig.contextRoot
    : process.env.AGENTLAB_CONTEXT_ROOT?.trim() || "lab/sessions";
  return {
    runId: manifest.runId,
    turnId: manifest.context.turnId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    modelRetryAttempts: positiveIntegerFromConfig(manifest.platformConfig, "runMaxRetryAttempts", 3),
    tools,
    ...(manifest.context.sessionId && manifest.context.turnId ? {
      context: {
        rootDirectory: contextRoot,
        sessionId: manifest.context.sessionId,
        turnId: manifest.context.turnId,
      },
    } : {}),
  };
}

function positiveIntegerFromConfig(value: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : fallback;
}

function readToolConfiguration(value: Readonly<Record<string, unknown>>): RestateWorkflowInput["tools"] {
  const candidate = value.tools;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 };
  }
  const record = candidate as Record<string, unknown>;
  const enabledNames = Array.isArray(record.enabledNames)
    ? record.enabledNames.filter((name): name is string => typeof name === "string")
    : ["calculator"];
  const maxRounds = positiveInteger(record.maxRounds, 6);
  const maxCalls = positiveInteger(record.maxCalls, 8);
  return { enabledNames, maxRounds, maxCalls };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
