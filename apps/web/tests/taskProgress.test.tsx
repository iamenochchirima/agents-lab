import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isStopRequested, sustainedTaskOptions, taskProgress } from "../src/features/platforms/taskProgress";
import { InvocationReviewPanel } from "../src/features/platforms/InvocationReviewPanel";
import type { PlatformRunCapabilities, RunView, InvocationReviewView } from "../src/features/platforms/platformApi";

const DEFAULT_PLATFORM_CAPABILITIES: PlatformRunCapabilities = { profileId: "test", tools: { enabledNames: ["unfamiliar"], maxRounds: 6, maxCalls: 8 } };
const run: RunView = { runId: "r", status: "running", manifest: { platform: "temporal", variant: "baseline", task: { prompt: "task" }, model: { provider: "fake", model: "fake" }, execution: { schemaVersion: 1, mode: "sustained", deadlineAt: "2026-10-10T12:00:00Z", modelTimeoutMs: 60000 } }, events: [], result: null, context: null, executionReference: null, projection: { state: "current", observedAt: "2026-10-10T11:00:00Z", reason: null } };
const event = (kind: string, payload = {}, sequence = 1) => ({ eventId: `e${sequence}`, recordedSequence: sequence, sourceSequence: sequence, source: "native", runId: "r", occurredAt: "2026-10-10T11:00:00Z", kind, payload });
test("longer tasks are opt-in and retain tool grants while expanding admitted bounds", () => {
  assert.deepEqual(sustainedTaskOptions(false, DEFAULT_PLATFORM_CAPABILITIES), { capabilities: DEFAULT_PLATFORM_CAPABILITIES });
  const sustained = sustainedTaskOptions(true, DEFAULT_PLATFORM_CAPABILITIES);
  assert.equal(sustained.execution?.mode, "sustained");
  assert.equal(sustained.capabilities.tools.maxRounds, 24);
  assert.equal(sustained.capabilities.tools.maxCalls, 48);
  assert.deepEqual(sustained.capabilities.tools.enabledNames, DEFAULT_PLATFORM_CAPABILITIES.tools.enabledNames);
});
test("progress projects observed rounds and unique completions independently from a stop request", () => {
  const active = { ...run, events: [event("TaskProgress", { round: 3, phase: "model", completedToolCount: 99 }), event("ToolExecutionCompleted", { toolCallId: "a" }, 2), event("ToolExecutionCompleted", { toolCallId: "a" }, 3), event("RunCancellationUnconfirmed", {}, 4)] };
  assert.equal(isStopRequested(active), true);
  assert.deepEqual(taskProgress(active), { phase: "Stop requested", round: 3, completedTools: 1, modelCalls: null, toolAttempts: null, deadlineAt: run.manifest.execution!.deadlineAt });
  const nativeCounters = taskProgress({ ...run, events: [event("ExecutionProgress", { modelCallCount: 4, toolAttemptCount: 2, waitReason: "model" })] });
  assert.equal(nativeCounters.modelCalls, 4);
  assert.equal(nativeCounters.toolAttempts, 2);
  assert.equal(isStopRequested({ ...active, status: "cancelled" }), false);
  assert.equal(taskProgress({ ...active, status: "cancelled" }).phase, "cancelled");
});
test("saved review delivery is shown inline without implying tool completion", () => {
  const action: InvocationReviewView = { requestId: "q", revision: 1, runId: "r", turnId: "t", call: { toolCallId: "a", name: "unfamiliar", round: 1 }, argumentDigest: "digest", sourceDigest: "source", connectionIdentity: null, displayArguments: {}, createdAt: "2026-10-10T11:00:00Z", expiresAt: "2026-10-11T11:00:00Z", status: "approved", delivery: { status: "pending", attemptCount: 1 }, decision: { requestId: "q", revision: 1, argumentDigest: "digest", decisionId: "d", decision: "approved" } };
  const markup = renderToStaticMarkup(createElement(InvocationReviewPanel, { run: { ...run, status: "suspended" }, action, busy: false, now: Date.parse("2026-10-10T11:00:00Z"), evidenceUrl: "/evidence", onSubmit() {} }));
  assert.match(markup, /Decision saved · waiting to resume/);
  assert.match(markup, /Continue reviewed action/);
  assert.doesNotMatch(markup, />Completed</);
});


test("a retained approval wait survives running fallback inspection until a recorded resume or dispatch", () => {
  const waiting = { ...run, events: [event("TaskProgress", { phase: "model", round: 2 }), event("WorkflowSuspended", { reason: "invocation_review", toolCallId: "a", requestId: "q" }, 2)] };
  assert.equal(taskProgress(waiting).phase, "Waiting for approval");
  assert.equal(waiting.status, "running", "phase projection must preserve native status");
  for (const kind of ["WorkflowResumed", "ToolExecutionStarted"]) {
    assert.equal(taskProgress({ ...waiting, events: [...waiting.events, event(kind, { toolCallId: "a", requestId: "q" }, 3)] }).phase, "Model response");
  }
  assert.equal(taskProgress({ ...waiting, status: "failed" }).phase, "failed", "terminal evidence supersedes an earlier wait");
});


test("clarification wait is distinct from invocation approval", () => {
  const waiting = { ...run, status: "suspended" as const, events: [event("WorkflowSuspended", { reason: "clarification", questionId: "q" })] };
  assert.equal(taskProgress(waiting).phase, "Waiting for your input");
  assert.equal(taskProgress({ ...waiting, events: [...waiting.events, event("WorkflowSuspended", { reason: "invocation_review" }, 2)] }).phase, "Waiting for approval");
});
