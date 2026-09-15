import type {
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../control-plane/domain/types.js";

import { AWS_STEP_FUNCTIONS_EVENT_SOURCE } from "../variants/baseline/contracts.js";

export interface AwsHistoryEvent {
  readonly id?: number;
  readonly type?: string;
  readonly timestamp?: Date | string | number;
  readonly [key: string]: unknown;
}

export function historyToEventIntents(
  runId: string,
  history: readonly AwsHistoryEvent[],
): readonly RunEventIntent[] {
  return history.map((event, index) => ({
    source: AWS_STEP_FUNCTIONS_EVENT_SOURCE,
    sourceSequence: index + 1,
    kind: normalizedEventKind(event.type),
    runId,
    occurredAt: timestampToIso(event.timestamp),
    payload: {
      nativeEventId: numberOrNull(event.id),
      nativeType: event.type ?? "Unknown",
      stateName: stateNameFromEvent(event),
    },
  }));
}

export function deriveTrajectory(
  runId: string,
  history: readonly AwsHistoryEvent[],
): RunTrajectory {
  const phases: Array<{ name: string; startedAt: string; finishedAt: string | null }> = [];
  const executionStarted = history.find((event) => event.type === "ExecutionStarted");
  const terminal = [...history].reverse().find((event) => event.type?.startsWith("Execution"));
  if (executionStarted) {
    phases.push({
      name: "state-machine-execution",
      startedAt: timestampToIso(executionStarted.timestamp),
      finishedAt: terminal && terminal.type !== "ExecutionStarted" ? timestampToIso(terminal.timestamp) : null,
    });
  }

  let attempt = 0;
  for (const event of history) {
    if (event.type !== "ActivityStarted") continue;
    attempt += 1;
    const finishedEvent = history.find(
      (candidate, candidateIndex) =>
        candidateIndex > history.indexOf(event) &&
        (candidate.type === "ActivitySucceeded" || candidate.type === "ActivityFailed" || candidate.type === "ActivityTimedOut"),
    );
    phases.push({
      name: `model-attempt-${attempt}`,
      startedAt: timestampToIso(event.timestamp),
      finishedAt: finishedEvent ? timestampToIso(finishedEvent.timestamp) : null,
    });
  }

  return { schemaVersion: 1, runId, phases };
}

export function deriveMetrics(
  runId: string,
  status: RunResult["status"],
  history: readonly AwsHistoryEvent[],
  startedAt: string | null,
  finishedAt: string | null,
  usage: RunMetrics,
): RunMetrics {
  const modelAttempts = history.filter((event) => event.type === "ActivityStarted").length;
  const durationMs = startedAt && finishedAt
    ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    : null;
  return {
    schemaVersion: 1,
    runId,
    status,
    durationMs,
    modelCallCount: modelAttempts,
    modelAttemptCount: modelAttempts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
  };
}

export function timestampToIso(value: Date | string | number | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function normalizedEventKind(type: string | undefined): string {
  switch (type) {
    case "ExecutionStarted": return "RunStarted";
    case "ExecutionSucceeded": return "RunCompleted";
    case "ExecutionFailed": return "RunFailed";
    case "ExecutionTimedOut": return "RunTimedOut";
    case "ExecutionAborted": return "RunCancelled";
    case "ActivityScheduled": return "ActivityScheduled";
    case "ActivityStarted": return "ActivityStarted";
    case "ActivitySucceeded": return "ActivitySucceeded";
    case "ActivityFailed": return "ActivityFailed";
    case "ActivityTimedOut": return "ActivityTimedOut";
    case "TaskStateEntered": return "TaskStarted";
    case "TaskStateExited": return "TaskCompleted";
    default: return "StepFunctionsEvent";
  }
}

function stateNameFromEvent(event: AwsHistoryEvent): string | null {
  const candidates = [
    event.stateEnteredEventDetails,
    event.stateExitedEventDetails,
    event.taskStateEnteredEventDetails,
    event.taskStateExitedEventDetails,
    event.activityScheduledEventDetails,
    event.activityStartedEventDetails,
    event.activitySucceededEventDetails,
    event.activityFailedEventDetails,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const name = (candidate as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
