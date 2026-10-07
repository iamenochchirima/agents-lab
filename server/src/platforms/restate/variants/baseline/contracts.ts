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
import type { ConnectionBinding } from "../../../../capabilities/integrations/contracts.js";

export const RESTATE_WORKFLOW_NAME = "AgentLabRestateBaseline";
export const RESTATE_WORKFLOW_SOURCE = "restate-workflow";

export interface RestateWorkflowInput {
  /** Synthetic live evals alone may retain mapped provider requests. */
  readonly liveEval?: boolean;
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
    readonly approvedNames?: readonly string[];
    readonly maxRounds: number;
    readonly maxCalls: number;
  };
  readonly connections?: readonly ConnectionBinding[];
  readonly context?: {
    readonly rootDirectory: string;
    readonly sessionId: string;
    readonly turnId: string;
  };
}

/** Bounded native events visible while the workflow is still executing. */
export interface RestateWorkflowProgress {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly startedAt: string;
  readonly truncated: boolean;
  readonly eventIntents: readonly RunEventIntent[];
}

export interface RestateWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
}

export interface ModelRequest {
  readonly liveEval?: boolean;
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

/** Bounded synthetic eval evidence, never authentication headers. */
export interface ModelEvalObservation {
  readonly faultKind?: "provider" | "malformed";
  readonly messages: readonly ModelMessage[];
  readonly systemInstruction: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly tools?: readonly ToolDefinition[];
  readonly providerRequest?: Readonly<Record<string, unknown>>;
  readonly providerRequestId?: string | null;
  readonly providerModel?: string | null;
  readonly providerName?: string | null;
  readonly output?: string | null;
  readonly errorCode?: string;
}

export interface ModelSuccess {
  readonly evalObservation?: ModelEvalObservation;
  readonly kind: "success";
  readonly output: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export interface ModelFailure {
  readonly evalObservation?: ModelEvalObservation;
  readonly kind: "failure";
  readonly code: string;
  readonly message: string;
  readonly failureKind: RunError["failureKind"];
  readonly retryable: boolean;
  readonly requestSent: boolean;
  /** The provider rejected the request before model generation because the input was too large. */
  readonly contextOverflow?: boolean;
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
    ...(manifest.selection?.experimentId === "agent-harness-live" ? { liveEval: true } : {}),
    turnId: manifest.context.turnId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    modelRetryAttempts: positiveIntegerFromConfig(manifest.platformConfig, "runMaxRetryAttempts", 3),
    tools,
    ...(manifest.capabilities?.connections ? { connections: manifest.capabilities.connections } : {}),
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
  const approvedNames = Array.isArray(record.approvedNames)
    ? record.approvedNames.filter((name): name is string => typeof name === "string")
    : undefined;
  return { enabledNames, ...(approvedNames ? { approvedNames } : {}), maxRounds, maxCalls };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
