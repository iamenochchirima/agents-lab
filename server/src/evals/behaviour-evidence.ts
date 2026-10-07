import { isDeepStrictEqual } from "node:util";
import type { BaselineRequest, BaselineToolObservation } from "../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs";
import type { BehaviourObservation, IntegrityReceipt } from "../../../lab/scenarios/platform-agent-conformance/behaviour-evals.mjs";
import { EventOrderingError, RunEvidenceStore } from "../control-plane/application/evidence-store.js";
import type { RunView } from "../control-plane/application/run-service.js";

/** Eval-only mapped receipts. Native SDK details remain in the original events. */
export function normalizeBehaviourObservation(views: readonly RunView[], captures: {
  requests?: readonly BaselineRequest[]; tools?: readonly BaselineToolObservation[];
} = {}): BehaviourObservation {
  const requests: BaselineRequest[] = [], tools: BaselineToolObservation[] = [];
  for (const view of views) {
    const nativeRequests = view.events.filter(event => event.kind === "EvalModelObserved");
    for (const event of nativeRequests) {
      const receipt = event.payload.observation;
      if (!record(receipt) || ["request", "error"].includes(String(receipt.phase)) || !Array.isArray(receipt.messages)) continue;
      const call = (value: unknown) => {
        const item = record(value) ? value : {};
        return { callId: String(item.toolCallId ?? item.callId ?? ""), toolName: String(item.name ?? item.toolName ?? ""), input: item.arguments ?? item.input };
      };
      requests.push({ runId: view.runId, sequence: typeof receipt.sequence === "number" ? receipt.sequence : requests.filter(item => item.runId === view.runId).length + 1,
        messages: receipt.messages.filter(record).map(message => ({ role: String(message.role) as BaselineRequest["messages"][number]["role"], content: typeof message.content === "string" ? message.content : "",
          ...(typeof message.toolCallId === "string" ? { toolCallId: message.toolCallId } : {}), ...(Array.isArray(message.toolCalls) ? { toolCalls: message.toolCalls.map(call) } : {}) })),
        responseToolCalls: Array.isArray(receipt.toolCalls) ? receipt.toolCalls.map(call) : [] });
    }
    for (const event of view.events.filter(event => event.kind === "EvalToolObserved")) {
      tools.push({ runId: view.runId, callId: String(event.payload.toolCallId ?? event.payload.callId ?? ""), toolName: String(event.payload.name ?? event.payload.toolName ?? ""), input: event.payload.arguments ?? event.payload.input, output: event.payload.output, status: String(event.payload.status) });
    }
  }
  // Mastra captures are already normalized at the actual model/tool boundary.
  // Prefer one source per run so exporting native receipts never doubles actions.
  const capturedRequestRuns = new Set((captures.requests ?? []).map(item => item.runId));
  const capturedToolRuns = new Set((captures.tools ?? []).map(item => item.runId));
  return {
    runs: views.map(view => ({ runId: view.runId, sessionId: view.manifest.context.sessionId ?? "", turnId: view.manifest.context.turnId ?? "", status: view.status.replaceAll("_", "-"), output: view.result?.output ?? null, instructions: view.manifest.context.systemInstruction,
      maxCalls: view.manifest.capabilities?.tools.maxCalls ?? 0, maxRounds: view.manifest.capabilities?.tools.maxRounds ?? 0, error: view.result?.error ?? null, attemptCount: view.result?.attemptCount })),
    requests: [...requests.filter(item => !capturedRequestRuns.has(item.runId)), ...captures.requests ?? []],
    tools: [...tools.filter(item => !capturedToolRuns.has(item.runId)), ...captures.tools ?? []],
    events: views.flatMap(view => view.events.map(event => ({ runId: view.runId, sequence: event.recordedSequence, type: event.kind, at: event.occurredAt, data: event.payload }))),
    rejections: views.flatMap(view => view.events.filter(event => event.kind === "ToolCallRejected" || event.kind === "ToolPolicyDenied").map(event => ({ runId: view.runId, callId: String(event.payload.toolCallId ?? event.payload.callId ?? ""), toolName: String(event.payload.name ?? event.payload.toolName ?? ""),
      kind: /APPROVAL/i.test(String(event.payload.code)) ? "approval" as const : event.kind === "ToolPolicyDenied" || /DISABLED|NOT_ENABLED|NOT_ALLOWED|UNKNOWN_TOOL/i.test(String(event.payload.code)) ? "disabled" as const : "validation" as const,
      reason: String(event.payload.message ?? event.payload.code ?? event.kind) }))),
  };
}

/** Grade persisted artifacts, not the driver's prediction of what was written.
 * Reconciliation-required runs must have no invented terminal trajectory or metrics.
 * Known fake-model usage is a fixture value; absent provider usage stays null.
 */
export async function inspectBehaviourIntegrity(evidence: RunEvidenceStore, views: readonly RunView[], initialConfigs: ReadonlyMap<string, string>, credentialSentinels: readonly string[] = []): Promise<IntegrityReceipt[]> {
  return Promise.all(views.map(async view => {
    const snapshot = await evidence.readSnapshot(view.runId);
    const configuration = await evidence.readAllowlistedFile(view.runId, "config.json");
    const artifactValues = [configuration, JSON.stringify(snapshot)];
    const result = snapshot.result, metrics = snapshot.metrics;
    const provisional = result?.status === "reconciliation_required";
    const eventStreams = new Map<string, number>();
    let eventOrder = true;
    for (const [index, event] of snapshot.events.entries()) {
      const stream = `${event.platform ?? snapshot.manifest.platform}:${event.attemptId ?? "legacy"}:${event.source}`;
      const previous = eventStreams.get(stream) ?? 0;
      if (event.recordedSequence !== index + 1 || event.sourceSequence !== previous + 1) eventOrder = false;
      eventStreams.set(stream, event.sourceSequence);
    }
    const sameRun = (value: { runId: string } | null) => value === null || value.runId === view.runId;
    const reportedUsage = [...snapshot.events].reverse().filter(event => event.kind === "ModelCompleted").map(event => event.payload.usage).find(record);
    const knownFixtureUsage = snapshot.manifest.model.provider === "fake";
    const usageSourcePreserved = result !== null && (knownFixtureUsage || reportedUsage !== undefined && (["inputTokens", "outputTokens", "totalTokens"] as const).every(key => result.usage[key] === (reportedUsage[key] ?? null)) || reportedUsage === undefined && Object.values(result.usage).every(value => value === null));
    const usageUnknownCorrect = usageSourcePreserved && result !== null && (provisional ? result.usage.inputTokens === null && result.usage.outputTokens === null && result.usage.totalTokens === null : metrics !== null &&
      (["inputTokens", "outputTokens", "totalTokens"] as const).every(key => metrics[key] === result.usage[key] && (result.usage[key] === null || Number.isFinite(result.usage[key]) && result.usage[key]! >= 0)));
    return { runId: view.runId,
      configImmutable: initialConfigs.has(view.runId) && initialConfigs.get(view.runId) === configuration,
      eventIdentities: new Set(snapshot.events.map(event => event.eventId)).size === snapshot.events.length && snapshot.events.every(event => event.runId === view.runId),
      eventOrder,
      trajectoryConsistent: provisional ? snapshot.trajectory === null : snapshot.trajectory !== null && sameRun(snapshot.trajectory) && snapshot.trajectory.phases.every(phase => Number.isFinite(Date.parse(phase.startedAt)) && (phase.finishedAt === null || Date.parse(phase.finishedAt) >= Date.parse(phase.startedAt))),
      metricsConsistent: provisional ? metrics === null : metrics !== null && sameRun(metrics) && metrics.status === result?.status && metrics.modelCallCount === snapshot.events.filter(event => event.kind === "ModelRequested").length && metrics.modelAttemptCount === result?.attemptCount,
      resultConsistent: result !== null && sameRun(result) && result.status === view.result?.status && isDeepStrictEqual(result, view.result),
      referencesSafe: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(view.runId) && snapshot.manifest.runId === view.runId && [snapshot.trajectory, snapshot.metrics, snapshot.result].every(sameRun) && (snapshot.executionReference === null || snapshot.executionReference.platform === snapshot.manifest.platform && snapshot.executionReference.variant === snapshot.manifest.variant),
      credentialsAbsent: credentialSentinels.filter(Boolean).every(sentinel => artifactValues.every(value => !value.includes(sentinel))), usageUnknownCorrect };
  }));
}

/** Bounded duplicate and ordering control uses the real projection store on an
 * admitted native run. It never changes the platform's own event stream.
 */
export async function exerciseBehaviourProjection(evidence: RunEvidenceStore, runId: string): Promise<NonNullable<BehaviourObservation["projection"]>> {
  const source = "eval-behaviour-projection";
  const initial = await evidence.readEvents(runId);
  if (initial.some(event => event.source === source)) throw new Error("Projection control was already exercised for this run.");
  const occurredAt = new Date().toISOString();
  const intent = (sourceSequence: number) => ({ runId, source, sourceSequence, occurredAt, kind: "EvalProjectionControl", payload: { actionId: `projection-action-${sourceSequence}` } });
  const first = await evidence.appendEvent(intent(1));
  let duplicateCount = 0, outOfOrderCount = 0;
  const replay = await evidence.appendEvent(intent(1));
  if (replay.eventId === first.eventId && replay.recordedSequence === first.recordedSequence) duplicateCount++;
  try { await evidence.appendEvent(intent(3)); }
  catch (error) { if (error instanceof EventOrderingError) outOfOrderCount++; else throw error; }
  await evidence.appendEvent(intent(2));
  const actual = (await evidence.readEvents(runId)).filter(event => event.source === source);
  return { inputCount: 4, uniqueActions: new Set(actual.map(event => event.payload.actionId)).size, expectedActions: 2, duplicateCount, outOfOrderCount };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
