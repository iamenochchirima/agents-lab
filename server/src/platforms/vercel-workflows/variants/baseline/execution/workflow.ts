import { createHook, sleep } from "workflow";
import type { RunError, RunEventIntent, RunUsage } from "../../../../../control-plane/domain/types.js";
import type { InvocationResumeInput, InvocationReviewView } from "../../../../../capabilities/reviews/contracts.js";
import { projectToolResult, toolResultEvidence } from "../../../../../capabilities/tools/result-projection.js";
import { VERCEL_WORKFLOW_NAME } from "../../../config.js";
import type { VercelWorkflowInput, VercelWorkflowResult, VercelModelMessage } from "../contracts.js";
import { VERCEL_WORKFLOW_SOURCE } from "../contracts.js";
import { executeModelStep } from "./model-step.js";
import { initializeCapabilityStep, prepareCapabilityStep, executeCapabilityStep, publishProgressStep } from "./capability-steps.js";

/** Native Workflow orchestration. All provider, host, context and file I/O is in steps. */
export async function agentLabPromptWorkflow(input: VercelWorkflowInput): Promise<VercelWorkflowResult> {
  "use workflow";
  if (input.model.model === "fake-wait") await sleep(10_000);
  const initialized = await initializeCapabilityStep(input);
  let messages: readonly VercelModelMessage[] = initialized.messages;
  const events: RunEventIntent[] = [];
  let pendingReview: InvocationReviewView | null = null;
  let at = initialized.startedAt;
  let modelCallCount = 0;
  let attemptCount = 0;
  let toolCallCount = 0;
  let toolAttemptCount = 0;
  let usage: RunUsage = { inputTokens: null, outputTokens: null, totalTokens: null };
  const stepNames: string[] = [];
  const phases: { name: string; startedAt: string; finishedAt: string }[] = [];
  const record = async (kind: string, payload: Record<string, unknown> = {}) => {
    events.push({ source: VERCEL_WORKFLOW_SOURCE, sourceSequence: events.length + 1, kind, runId: input.runId, occurredAt: at, payload });
    at = await publishProgressStep(input, { eventIntents: events, pendingReview });
  };
  const finish = async (status: VercelWorkflowResult["status"], output: string | null, error: RunError | null): Promise<VercelWorkflowResult> => {
    pendingReview = null;
    await record(status === "completed" ? "RunCompleted" : "RunFailed", { status, ...(error ? { code: error.code, failureKind: error.failureKind } : {}) });
    return { schemaVersion: 1, runId: input.runId, status, startedAt: initialized.startedAt, finishedAt: at,
      output, error, attemptCount, usage, eventIntents: events,
      trajectory: { schemaVersion: 1, runId: input.runId, phases },
      metrics: { schemaVersion: 1, runId: input.runId, status, durationMs: Math.max(0, Date.parse(at) - Date.parse(initialized.startedAt)),
        modelCallCount, modelAttemptCount: attemptCount, toolCallCount, toolAttemptCount,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, costUsd: null },
      native: { workflowName: VERCEL_WORKFLOW_NAME, stepNames } };
  };
  await record("ContextPrepared", { snapshotId: initialized.snapshotId, toolNames: initialized.definitions.map(tool => tool.name), contextStrategy: input.context ? "session_snapshot" : "prompt" });
  const seenIds = new Set<string>();
  for (let round = 1; round <= (input.tools?.maxRounds ?? 6); round++) {
    await record("ModelRequested", { provider: input.model.provider, model: input.model.model, round, attempt: 1 });
    const model = await executeModelStep({ ...input, round, messages, toolDefinitions: initialized.definitions });
    phases.push({ name: round === 1 ? "model" : `model_${round}`, startedAt: model.startedAt, finishedAt: model.finishedAt });
    at = model.finishedAt; modelCallCount++; attemptCount += model.attempt; stepNames.push(model.stepName);
    usage = { inputTokens: add(usage.inputTokens, model.usage.inputTokens), outputTokens: add(usage.outputTokens, model.usage.outputTokens), totalTokens: add(usage.totalTokens, model.usage.totalTokens) };
    await record("model_call_completed", { provider: input.model.provider, model: input.model.model, round, attempt: model.attempt, stepId: model.stepId, requestId: model.providerRequestId });
    const calls = model.toolCalls ?? [];
    if (!calls.length) return finish("completed", model.output, null);
    // Validate the entire batch identity before allowing any effect. Reusing a
    // call ID in a later round would reuse an unrelated receipt.
    if (calls.some(call => !call.toolCallId || seenIds.has(call.toolCallId)) || new Set(calls.map(call => call.toolCallId)).size !== calls.length) {
      return finish("failed", null, { code: "INVALID_TOOL_CALL_RESPONSE", message: "Tool call IDs cannot be paired safely.", failureKind: "validation", retryable: false });
    }
    calls.forEach(call => seenIds.add(call.toolCallId));
    messages = [...messages, { role: "assistant", content: model.output, toolCalls: calls }];
    for (const call of calls) {
      toolCallCount++;
      const payload = { toolCallId: call.toolCallId, toolName: call.name, round, attempt: 1 };
      const feedback = (code: string, message: string) => { messages = [...messages, { role: "tool", toolCallId: call.toolCallId, name: call.name, content: JSON.stringify({ error: { code, message } }) }]; };
      await record("ToolCallRequested", payload);
      if (toolAttemptCount >= (input.tools?.maxCalls ?? 8)) return finish("failed", null, { code: "TOOL_CALL_LIMIT_EXCEEDED", message: "The tool call limit was reached.", failureKind: "validation", retryable: false });
      const prepared = await prepareCapabilityStep(input, { ...call, round });
      if (prepared.kind === "failure") return finish("failed", null, prepared.error);
      if (prepared.kind === "rejected") {
        await record("ToolCallRejected", { ...payload, code: prepared.code, message: prepared.message });
        feedback(prepared.code, prepared.message); continue;
      }
      await record("ToolCallValidated", payload);
      let review = prepared.review;
      let decision = review?.decision?.decision;
      while (review && (review.status === "pending" || review.status === "expired")) {
        const hook = createHook<InvocationResumeInput>({ token: `agentlab-review:${input.runId}:${review.requestId}:${review.revision}` });
        // createHook alone is deferred. Commit registration before making the
        // pending review deliverable to HTTP inspection and the browser.
        if (await hook.getConflict()) throw new Error("Review waiter identity is already owned.");
        pendingReview = review;
        await record("WorkflowSuspended", { ...payload, reason: "invocation_review", requestId: review.requestId, revision: review.revision, argumentDigest: review.argumentDigest });
        // The common host can retain a reviewer decision before the native
        // projection is published. Re-read after publication, which closes the
        // early-decision window without making browser polling the waiter.
        const refreshed = await prepareCapabilityStep(input, prepared.call);
        if (refreshed.kind === "failure") { hook.dispose(); return finish("failed", null, refreshed.error); }
        if (refreshed.kind !== "prepared" || refreshed.review?.requestId !== review.requestId) throw new Error("Review refresh identity does not match.");
        if (refreshed.review.revision > review.revision) {
          hook.dispose(); review = refreshed.review;
          await record("InvocationReviewRenewed", { ...payload, requestId: review.requestId, revision: review.revision });
          continue;
        }
        if (refreshed.review.decision) {
          hook.dispose(); decision = refreshed.review.decision.decision; pendingReview = null;
          await record("WorkflowResumed", { ...payload, requestId: review.requestId, revision: review.revision, decision });
          break;
        }
        const resumed = await hook;
        hook.dispose();
        if (resumed.requestId !== review.requestId || resumed.toolCallId !== call.toolCallId ||
            resumed.revision !== review.revision + (resumed.decision === "renewed" ? 1 : 0)) throw new Error("Review delivery identity does not match the suspended call.");
        if (resumed.decision === "renewed") {
          const renewed = await prepareCapabilityStep(input, prepared.call);
          if (renewed.kind !== "prepared" || renewed.review?.requestId !== review.requestId || renewed.review.revision !== resumed.revision) throw new Error("Renewed review identity does not match.");
          review = renewed.review;
          await record("InvocationReviewRenewed", { ...payload, requestId: review.requestId, revision: review.revision });
          continue;
        }
        decision = resumed.decision;
        pendingReview = null;
        await record("WorkflowResumed", { ...payload, requestId: review.requestId, revision: review.revision, decision });
        break;
      }
      if (decision === "denied" || review?.status === "denied") {
        await record("ToolPolicyDenied", { ...payload, code: "TOOL_APPROVAL_DENIED" });
        feedback("TOOL_APPROVAL_DENIED", "The proposed action was declined."); continue;
      }
      if (review?.status === "cancelled") return finish("cancelled", null, { code: "TOOL_CANCELLED", message: "The review was cancelled.", failureKind: "cancelled", retryable: false });
      toolAttemptCount++;
      await record("ToolExecutionStarted", payload);
      const result = await executeCapabilityStep(input, prepared.call);
      await record(result.status === "completed" ? "ToolExecutionCompleted" : result.status === "unknown" ? "ToolExecutionUnknown" : "ToolExecutionFailed", { ...payload, status: result.status, durationMs: result.durationMs, ...toolResultEvidence(result) });
      messages = [...messages, { role: "tool", toolCallId: call.toolCallId, name: call.name, content: projectToolResult(result).content }];
      if (result.status === "unknown" || result.effect?.state === "unknown") return finish("reconciliation_required", null, { code: "TOOL_OUTCOME_UNKNOWN", message: "Inspect the existing receipt before any further mutation.", failureKind: "outcome_unknown", retryable: false });
      if (result.status !== "completed" && prepared.definition.failurePolicy !== "feedback") return finish("failed", null, { code: result.error?.code ?? "TOOL_EXECUTION_FAILED", message: result.error?.message ?? "Tool execution failed.", failureKind: "internal", retryable: false });
    }
  }
  return finish("failed", null, { code: "MODEL_ROUND_LIMIT_EXCEEDED", message: "The model round limit was reached.", failureKind: "validation", retryable: false });
}
function add(left: number | null, right: number | null): number | null { return right === null ? left : (left ?? 0) + right; }
