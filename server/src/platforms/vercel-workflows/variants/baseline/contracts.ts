import type { RunExecutionPolicy } from "../../../../capabilities/execution/policy.js";
import { getFreeEvalSettings, type FreeEvalExperiment } from "../../../../models/openrouter/free-model-policy.js";
import type { ToolCatalogSnapshot } from "../../../../capabilities/extensions/contracts.js";
import type { CapabilityInventorySnapshot } from "../../../../capabilities/contracts.js";
import type { ConnectionBinding } from "../../../../capabilities/integrations/contracts.js";
import type { ToolCall, ToolDefinition } from "../../../../capabilities/tools/contracts.js";
import type { InvocationReviewView } from "../../../../capabilities/reviews/contracts.js";
import type { RunManifest } from "../../../../control-plane/domain/types.js";

import type {
  ModelProvider,
  RunError,
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export type VercelModelMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly name: string; readonly content: string };
export interface VercelWorkflowProgress {
  readonly eventIntents: readonly RunEventIntent[];
  readonly pendingReview: InvocationReviewView | null;
}

export const VERCEL_WORKFLOW_SOURCE = "vercel-workflow";

export type VercelWorkflowModel = {
  readonly provider: ModelProvider;
  readonly model: string;
};

export interface VercelWorkflowInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: VercelWorkflowModel;
  readonly modelTimeoutMs: number;
  readonly execution?: RunExecutionPolicy;
  readonly liveEval?: boolean;
  readonly liveEvalExperiment?: FreeEvalExperiment;
  readonly turnId?: string;
  readonly tools?: { readonly enabledNames: readonly string[]; readonly approvedNames?: readonly string[]; readonly maxRounds: number; readonly maxCalls: number };
  readonly toolCatalog?: ToolCatalogSnapshot;
  readonly inventory?: CapabilityInventorySnapshot;
  readonly connections?: readonly ConnectionBinding[];
  readonly context?: { readonly rootDirectory: string; readonly sessionId: string; readonly turnId: string };
  /** Native step progress path, supplied by the local service, never model data. */
  readonly progressDirectory?: string;
}

export interface VercelWorkflowModelRequest extends VercelWorkflowInput {
  readonly attempt: number;
  readonly round?: number;
  readonly messages?: readonly VercelModelMessage[];
  readonly toolDefinitions?: readonly ToolDefinition[];
}

export interface VercelWorkflowModelSuccess {
  readonly kind: "success";
  readonly output: string | null;
  readonly toolCalls?: readonly ToolCall[];
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export interface VercelWorkflowModelFailure {
  readonly kind: "failure";
  readonly error: RunError;
  readonly requestSent: boolean;
}

export type VercelWorkflowModelResult = VercelWorkflowModelSuccess | VercelWorkflowModelFailure;

export interface VercelWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
  readonly native: {
    readonly workflowName: string;
    readonly stepNames: readonly string[];
  };
}

export type VercelWorkflowStepResult = VercelWorkflowModelResult & {
  readonly attempt: number;
  readonly stepId: string;
  readonly stepName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export function inputFromManifest(manifest: RunManifest): VercelWorkflowInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    modelTimeoutMs: manifest.execution?.modelTimeoutMs ?? positiveInteger(manifest.platformConfig.modelTimeoutMs, 30_000),
    execution: manifest.execution,
    ...(getFreeEvalSettings(manifest.selection?.experimentId) ? { liveEval: true, liveEvalExperiment: getFreeEvalSettings(manifest.selection?.experimentId)!.experimentId } : {}),
    turnId: manifest.context.turnId,
    tools: manifest.capabilities?.tools ?? { enabledNames: [], maxRounds: 6, maxCalls: 8 },
    toolCatalog: manifest.capabilities?.toolCatalog,
    inventory: manifest.capabilities?.inventory,
    connections: manifest.capabilities?.connections,
    ...(manifest.context.sessionId && manifest.context.turnId ? { context: {
      rootDirectory: typeof manifest.platformConfig.contextRoot === "string" ? manifest.platformConfig.contextRoot : process.env.AGENTLAB_CONTEXT_ROOT ?? "lab/sessions",
      sessionId: manifest.context.sessionId, turnId: manifest.context.turnId,
    } } : {}),
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
