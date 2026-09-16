import assert from "node:assert/strict";

import type { RunView } from "../../src/control-plane/application/run-service.js";
import type { RunEvent, RunRequest, RunResult } from "../../src/control-plane/domain/types.js";

export const CONFORMANCE_SCENARIO_ID = "platform-agent-conformance" as const;

export const PRIORITY_PLATFORMS = ["temporal", "restate", "langgraph", "mastra"] as const;
export type PriorityPlatform = (typeof PRIORITY_PLATFORMS)[number];

export const CONFORMANCE_CASES = [
  {
    id: "prompt-completion",
    title: "Prompt completion",
    purpose: "A single model-backed prompt turn through the selected native platform path.",
    turns: [{
      prompt: "Explain in one sentence why execution evidence matters in an agent system.",
      clientTurnId: "prompt-completion-turn-1",
    }],
    model: "fake-success",
    enabledTools: [],
    requiresContextContinuation: false,
    requiresTool: false,
  },
  {
    id: "calculator-tool",
    title: "Calculator tool turn",
    purpose: "A model turn that requests the provider-neutral pure calculator tool.",
    turns: [{
      prompt: "Use the calculator tool to add 17 and 25, then state the result.",
      clientTurnId: "calculator-tool-turn-1",
    }],
    model: "fake-tool-call",
    enabledTools: ["calculator"],
    requiresContextContinuation: false,
    requiresTool: true,
  },
  {
    id: "context-continuation",
    title: "Two-turn context continuation",
    purpose: "Two turns in one explicit session with separate request-local snapshots.",
    turns: [
      {
        prompt: "Remember this test value for the next turn: conformance-4318.",
        clientTurnId: "context-continuation-turn-1",
      },
      {
        prompt: "What test value did I ask you to remember? Answer with the value only.",
        clientTurnId: "context-continuation-turn-2",
      },
    ],
    model: "fake-context",
    enabledTools: [],
    requiresContextContinuation: true,
    requiresTool: false,
  },
] as const;

export type ConformanceCase = (typeof CONFORMANCE_CASES)[number];
export type ConformanceCaseId = ConformanceCase["id"];

export const REQUIRED_EVIDENCE_FILES = [
  "config.json",
  "events.jsonl",
  "trajectory.json",
  "metrics.json",
  "result.json",
] as const;

export const COMMON_LIFECYCLE_KINDS = [
  "RunCreated",
  "RunDispatched",
  "AgentStarted",
  "ContextPrepared",
  "ModelRequested",
  "ModelCompleted",
  "ToolCallRequested",
  "ToolCallValidated",
  "ToolExecutionStarted",
  "ToolExecutionCompleted",
  "ToolExecutionFailed",
  "AgentCompleted",
  "AgentFailed",
  "AgentCancelled",
  "RunCompleted",
  "RunFailed",
  "RunCancelled",
] as const;

export interface ConformanceRequestOptions {
  readonly sessionId?: string;
  readonly turnIndex?: number;
  readonly modelProvider?: "fake" | "openrouter";
  readonly model?: string;
  readonly contextWindowTokens?: number;
}

export function conformanceCase(id: ConformanceCaseId): ConformanceCase {
  const selected = CONFORMANCE_CASES.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Unknown conformance case: ${id}`);
  return selected;
}

/**
 * Builds the existing generic request shape for one workload turn. This is a
 * test fixture, not a production agent abstraction: platform adapters still
 * own the native loop and model/tool mapping.
 */
export function buildConformanceRequest(
  platform: PriorityPlatform,
  caseId: ConformanceCaseId,
  options: ConformanceRequestOptions = {},
): RunRequest {
  const workload = conformanceCase(caseId);
  const turnIndex = options.turnIndex ?? 0;
  const turn = workload.turns[turnIndex];
  if (!turn) throw new Error(`Conformance case ${caseId} has no turn at index ${turnIndex}.`);
  if (workload.requiresContextContinuation && !options.sessionId) {
    throw new Error(`Conformance case ${caseId} requires an explicit sessionId.`);
  }

  return {
    platform,
    variant: "baseline",
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    clientTurnId: turn.clientTurnId,
    task: { kind: "prompt", prompt: turn.prompt },
    model: {
      provider: options.modelProvider ?? "fake",
      model: options.model ?? workload.model,
      ...(options.contextWindowTokens === undefined ? {} : { contextWindowTokens: options.contextWindowTokens }),
    },
    capabilities: {
      tools: {
        enabledNames: workload.enabledTools,
        maxRounds: 6,
        maxCalls: 8,
      },
    },
    selection: {
      scenarioId: CONFORMANCE_SCENARIO_ID,
    },
  };
}

export function assertConformanceEvents(
  workload: ConformanceCase,
  events: readonly RunEvent[],
): void {
  const kinds = new Set(events.map((event) => event.kind));
  assert.ok(kinds.has("AgentStarted"), `${workload.id} must record AgentStarted.`);
  assert.ok(kinds.has("ModelRequested"), `${workload.id} must record ModelRequested.`);
  assert.ok(kinds.has("AgentCompleted") || kinds.has("AgentFailed") || kinds.has("AgentCancelled"), `${workload.id} must record an agent terminal event.`);

  if (workload.requiresTool) {
    assert.ok(kinds.has("ToolCallRequested"), `${workload.id} must record a tool request.`);
    assert.ok(kinds.has("ToolExecutionCompleted") || kinds.has("ToolExecutionFailed"), `${workload.id} must record the tool outcome.`);
  }

  const eventIds = new Set<string>();
  for (const event of events) {
    assert.equal(event.runId, events[0]?.runId, "All conformance events must belong to one run.");
    assert.equal(eventIds.has(event.eventId), false, `Duplicate event ID: ${event.eventId}`);
    eventIds.add(event.eventId);
  }
}

export function assertTerminalResult(result: RunResult | null): asserts result is RunResult {
  assert.ok(result, "A conformance run must expose a terminal result.");
  assert.ok(["completed", "failed", "cancelled", "reconciliation_required"].includes(result.status));
  assert.ok(result.finishedAt, "A terminal result must have finishedAt.");
  assert.equal(result.runId.length > 0, true);
}

export function assertConformanceRunView(view: RunView, workload: ConformanceCase): void {
  assert.equal(view.manifest.selection?.scenarioId, CONFORMANCE_SCENARIO_ID);
  assert.equal(view.manifest.variant, "baseline");
  assertTerminalResult(view.result);
  assertConformanceEvents(workload, view.events);
}
