import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { AgentExecutionOptionsBase } from "@mastra/core/agent";
import { z } from "zod";

import type { RunManifest } from "../../../../control-plane/domain/types.js";
import type { ToolLifecycleKind, ToolLifecyclePayload } from "../../../../capabilities/tools/contracts.js";
import { createBaselineAgent } from "../baseline/agent.js";
import type { MastraModelFactory } from "../baseline/models/factory.js";

export const MASTRA_WORKFLOW_ID = "mastra-agent-workflow" as const;

const workflowModelProvider = z.enum(["fake", "openrouter"]);
const workflowCapabilities = z.object({
  tools: z.object({
    enabledNames: z.array(z.string()),
    approvedNames: z.array(z.string()).optional(),
    maxRounds: z.number().int().min(1).max(32),
    maxCalls: z.number().int().min(1).max(64),
  }),
  connections: z.array(z.object({
    toolName: z.string().min(1).max(64),
    connectionRef: z.string().regex(/^conn_[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/),
    operations: z.array(z.string().min(1).max(128)),
    mcp: z.object({
      endpointRef: z.string().min(1).max(64),
      serverName: z.string().min(1).max(128),
      protocolVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toolName: z.string().min(1).max(128),
      toolVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    }).optional(),
  })).optional(),
});

export const mastraWorkflowInputSchema = z.object({
  prompt: z.string().min(1),
  modelProvider: workflowModelProvider,
  model: z.string().min(1),
  turnId: z.string().min(1),
  requiresApproval: z.boolean(),
  capabilities: workflowCapabilities,
  contextMessages: z.array(z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })),
});

export type MastraWorkflowInput = z.infer<typeof mastraWorkflowInputSchema>;

const approvalStep = createStep({
  id: "approval",
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: z.object({
    prompt: z.string(),
    approved: z.boolean(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({
    reason: z.string(),
    prompt: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.requiresApproval && resumeData === undefined) {
      return suspend({
        reason: "This Mastra workflow requires an explicit approval before the model step.",
        prompt: inputData.prompt,
      }, { resumeLabel: "approval" });
    }

    if (inputData.requiresApproval && resumeData?.approved !== true) {
      throw new Error("The Mastra workflow approval was not granted.");
    }

    return { prompt: inputData.prompt, approved: true };
  },
});

type MastraWorkflowEventKind = ToolLifecycleKind | "ModelRequested" | "ModelCompleted" | "AgentStepCompleted";

export interface MastraWorkflowEventSink {
  (runId: string, kind: MastraWorkflowEventKind, payload: ToolLifecyclePayload | Record<string, unknown>): void;
}

export interface MastraWorkflowOptions {
  readonly modelFactory: MastraModelFactory;
  readonly eventSink?: MastraWorkflowEventSink;
}

/**
 * Builds the native Mastra workflow once and leaves persistence to Mastra's
 * configured workflow storage. The approval step is intentionally explicit:
 * callers can exercise suspend/resume without making every normal prompt wait
 * for an artificial human action.
 */
export function createMastraWorkflow(options: MastraWorkflowOptions) {
  const modelStep = createStep({
    id: "model",
    inputSchema: z.object({ prompt: z.string(), approved: z.boolean() }),
    outputSchema: z.object({
      response: z.string(),
      usage: z.object({
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        totalTokens: z.number().nullable(),
      }),
    }),
    execute: async ({ inputData, runId, abortSignal, getInitData }) => {
      const initialInput = getInitData<z.infer<typeof mastraWorkflowInputSchema>>();
      const input = mastraWorkflowInputSchema.parse(initialInput);
      const manifest = workflowManifest(input, runId);
      let unknownToolOutcome = false;
      options.eventSink?.(runId, "ModelRequested", {
        model: input.model,
        provider: input.modelProvider,
      });

      const agent = createBaselineAgent(manifest, options.modelFactory, {
        runId,
        turnId: input.turnId,
        signal: abortSignal,
        maxToolCalls: input.capabilities.tools.maxCalls,
        connectionBindings: input.capabilities.connections,
        onToolEvent: (kind, payload) => {
          unknownToolOutcome ||= kind === "ToolExecutionUnknown";
          options.eventSink?.(runId, kind, payload);
        },
      });
      const output = await agent.generate(inputData.prompt, {
        runId,
        abortSignal,
        context: input.contextMessages.map(toAgentContextMessage),
        maxSteps: input.capabilities.tools.maxRounds,
        onStepFinish: (step) => options.eventSink?.(runId, "AgentStepCompleted", {
          finishReason: safeValue(step, "finishReason"),
          usage: safeUsage(safeValue(step, "usage")),
        }),
      });

      if (unknownToolOutcome) {
        const error = new Error("A Mastra tool may have been dispatched but its external outcome could not be confirmed.");
        error.name = "TOOL_UNKNOWN";
        throw error;
      }

      const usage = normalizeUsage(output.totalUsage ?? output.usage);
      options.eventSink?.(runId, "ModelCompleted", {
        finishReason: output.finishReason ?? null,
        usage,
      });
      return { response: output.text, usage };
    },
  });

  return createWorkflow({
    id: MASTRA_WORKFLOW_ID,
    description: "Agent Harness Lab native Mastra agent workflow.",
    inputSchema: mastraWorkflowInputSchema,
    outputSchema: z.object({
      response: z.string(),
      usage: z.object({
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        totalTokens: z.number().nullable(),
      }),
    }),
    options: {
      shouldPersistSnapshot: () => true,
    },
  }).then(approvalStep).then(modelStep).commit();
}

function workflowManifest(
  input: MastraWorkflowInput,
  runId: string,
): RunManifest {
  return {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    serverVersion: "mastra-workflow",
    platform: "mastra",
    variant: "workflow",
    task: { kind: "prompt", prompt: input.prompt },
    context: {
      systemInstruction: "You are the Agent Harness Lab Mastra workflow agent.",
      turnId: input.turnId,
    },
    platformConfig: {
      agentId: "mastra-workflow-agent",
      contextRoot: "workflow-native",
      executionTimeoutMs: 30_000,
      maxToolRounds: input.capabilities.tools.maxRounds,
      maxToolCalls: input.capabilities.tools.maxCalls,
    },
    capabilities: input.capabilities,
    model: {
      provider: input.modelProvider,
      model: input.model,
    },
  };
}

type MastraContextMessage = NonNullable<AgentExecutionOptionsBase<unknown>["context"]>[number];

function toAgentContextMessage(message: MastraWorkflowInput["contextMessages"][number]): MastraContextMessage {
  if (message.role !== "tool") return { role: message.role, content: message.content };
  return {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: message.toolCallId ?? message.content.slice(0, 64),
      toolName: message.toolName ?? "tool",
      output: { type: "text", value: message.content },
    }],
  };
}

function safeValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, unknown>)[key] ?? null;
}

function safeUsage(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: numberOrNull(usage.inputTokens ?? usage.promptTokens),
    outputTokens: numberOrNull(usage.outputTokens ?? usage.completionTokens),
    totalTokens: numberOrNull(usage.totalTokens),
  };
}

function normalizeUsage(value: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  return safeUsage(value) as {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
