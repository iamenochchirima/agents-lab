import type { PlatformRunCapabilities, RunView } from "./platformApi";

const terminal = new Set(["completed", "failed", "cancelled", "reconciliation_required"]);
/** A stop request is not confirmation that native execution has stopped. */
export function isStopRequested(run: RunView): boolean {
  return !terminal.has(run.status) && run.events.some(event => event.kind === "RunCancellationRequested" || event.kind === "RunCancellationUnconfirmed");
}
export function sustainedTaskOptions(enabled: boolean, capabilities: PlatformRunCapabilities) {
  return enabled ? { execution: { mode: "sustained" as const }, capabilities: { ...capabilities,
    tools: { ...capabilities.tools, maxRounds: 24, maxCalls: 48 } } } : { capabilities };
}
/** Only recorded progress/call outcomes are projected; no elapsed-time percentage. */
export function taskProgress(run: RunView) {
  const observed = [...run.events].reverse().find(event => ["TaskProgress", "ExecutionProgress"].includes(event.kind));
  const phase = observed?.payload.phase ?? observed?.payload.waitReason;
  const phases: Record<string, string> = { model: "Model response", tools: "Tool execution", tool: "Tool execution", recovery: "Recovering", compacting: "Compacting context", initialization: "Preparing" };
  const completed = new Set(run.events.filter(event => event.kind === "ToolExecutionCompleted")
    .map(event => typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : event.eventId));
  const round = observed?.payload.round ?? [...run.events].reverse().find(event => event.kind === "ModelRequested")?.payload.round;
  // Native fallback inspection may report running while a worker is being replaced.
  // Retained wait events describe the last phase without changing native status.
  const waitBoundary = [...run.events].reverse().find(event => ["WorkflowSuspended", "WorkflowResumed", "ToolExecutionStarted"].includes(event.kind));
  const retainedApprovalWait = waitBoundary?.kind === "WorkflowSuspended" && waitBoundary.payload.reason === "invocation_review";
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    phase: isStopRequested(run) ? "Stop requested" : !terminal.has(run.status) && (run.status === "suspended" || retainedApprovalWait) ? "Waiting for approval"
      : terminal.has(run.status) ? run.status.replaceAll("_", " ") : typeof phase === "string" ? phases[phase] ?? "Running" : null,
    round: typeof round === "number" && Number.isSafeInteger(round) && round >= 0 ? round : null,
    completedTools: completed.size,
    modelCalls: count(observed?.payload.modelCallCount),
    toolAttempts: count(observed?.payload.toolAttemptCount),
    deadlineAt: run.manifest.execution?.deadlineAt ?? null,
  };
}
