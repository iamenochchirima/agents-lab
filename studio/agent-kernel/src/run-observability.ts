import type { AgentEvent, JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type {
  ObservabilityModule,
  ObservationAppendReceipt,
  ObservationFlushReceipt,
} from "@agent-harness-lab/module-observability";
import type { PartialTextTurnEvidence, PlanningRunEvidence, TextTurnModuleIdentities, TextTurnResult } from "./text-turn.js";

export const AGENT_KERNEL_IDENTITY: ModuleIdentity = Object.freeze({ id: "studio-agent-kernel", version: "0.3.0" });

export interface TextTurnObservabilityResult {
  readonly status: "not-configured" | "durable" | "partial" | "failed" | "unknown";
  readonly recorder: ModuleIdentity | null;
  readonly eventsAttempted: number;
  readonly appendReceipts: readonly ObservationAppendReceipt[];
  readonly flushReceipt: ObservationFlushReceipt | null;
  readonly failure?: { readonly message: string };
}

export async function persistTextTurnEvidence(input: {
  readonly scope: RunScope;
  readonly recorder?: ObservabilityModule;
  readonly identities: {
    readonly input: ModuleIdentity;
    readonly context: ModuleIdentity;
    readonly planning: ModuleIdentity;
    readonly memory: ModuleIdentity;
    readonly control: ModuleIdentity;
    readonly model: ModuleIdentity;
  };
  readonly result?: TextTurnResult;
  readonly partial?: PartialTextTurnEvidence;
  readonly planning?: PlanningRunEvidence;
  readonly failure?: unknown;
}): Promise<TextTurnObservabilityResult> {
  if (!input.recorder) {
    return Object.freeze({ status: "not-configured", recorder: null, eventsAttempted: 0, appendReceipts: Object.freeze([]), flushReceipt: null });
  }

  const events = createEvents(input);
  const appendReceipts: ObservationAppendReceipt[] = [];
  let appendFailure: string | undefined;
  const cleanupSignal = new AbortController().signal;
  for (const event of events) {
    try {
      const receipt = await input.recorder.append(event, cleanupSignal);
      appendReceipts.push(receipt);
      if (receipt.status === "rejected" || receipt.status === "uncertain") break;
    } catch (error) {
      appendFailure = error instanceof Error ? error.message : "Observability append failed.";
      break;
    }
  }

  let flushReceipt: ObservationFlushReceipt | null = null;
  try {
    flushReceipt = await input.recorder.flush(input.scope, cleanupSignal);
  } catch (error) {
    appendFailure ??= error instanceof Error ? error.message : "Observability flush failed.";
  }

  const appendRejected = appendReceipts.some((receipt) => receipt.status === "rejected");
  const appendUnknown = appendReceipts.some((receipt) => receipt.status === "uncertain");
  const status = appendFailure
    ? "failed"
    : appendUnknown || flushReceipt?.status === "unknown"
      ? "unknown"
      : appendRejected || flushReceipt?.status === "partial" || flushReceipt?.status === "failed"
        ? "partial"
        : flushReceipt?.status === "durable" ? "durable" : "failed";
  return Object.freeze({
    status,
    recorder: input.recorder.identity,
    eventsAttempted: events.length,
    appendReceipts: Object.freeze(appendReceipts),
    flushReceipt,
    ...(appendFailure ? { failure: { message: appendFailure } } : {}),
  });
}

function createEvents(input: Parameters<typeof persistTextTurnEvidence>[0]): readonly { event: AgentEvent; moduleDetail?: { module: ModuleIdentity; schemaVersion: string; detail: JsonValue } }[] {
  const evidence = input.result ?? input.partial;
  const events: { event: AgentEvent; moduleDetail?: { module: ModuleIdentity; schemaVersion: string; detail: JsonValue } }[] = [];
  const push = (kind: string, payload: unknown, source: ModuleIdentity, detail?: unknown) => {
    const sequence = events.length;
    const event: AgentEvent = Object.freeze({
      eventId: `${input.scope.runId}:${sequence}`,
      sequence,
      runId: input.scope.runId,
      occurredAt: new Date().toISOString(),
      source,
      kind,
      payload: toJson(payload),
    });
    events.push({
      event,
      ...(detail === undefined ? {} : { moduleDetail: { module: source, schemaVersion: "studio-kernel-evidence.v1", detail: toJson(detail) } }),
    });
  };

  if (evidence?.normalizedInput) push("input.normalized", evidence.normalizedInput, input.identities.input);
  if (evidence?.memoryRecall) push("memory.recalled", evidence.memoryRecall, input.identities.memory);
  const planning = input.result?.planning ?? input.partial?.planning ?? input.planning;
  if (planning) push("planning.proposed", planning.proposal, planning.module, planning);
  const contexts = input.result?.contextRequests ?? input.partial?.contextRequests ?? [];
  contexts.forEach((context, index) => push("context.assembled", { index, sourceLedger: context.sourceLedger, messages: context.messages, tokenCount: context.tokenCount }, input.identities.context, context));
  const requests = input.result?.modelRequests ?? input.partial?.modelRequests ?? [];
  const responses = input.result?.modelResponses ?? input.partial?.modelResponses ?? [];
  requests.forEach((request, index) => push("model.request-response", { request, response: responses[index] ?? null }, input.identities.model));
  const observations = input.result?.observations ?? input.partial?.observations ?? [];
  observations.forEach((observation) => push("control.observation", observation, input.identities.control));
  const runEvidence = evidence?.runEvidence ?? [];
  const selectedIdentities = input.result?.moduleIdentities ?? input.partial?.moduleIdentities;
  runEvidence.forEach((record) => {
    const owner = evidenceOwner(record.kind, selectedIdentities);
    push(`effect.${record.kind}`, { kind: record.kind }, owner, record);
  });
  if (input.result?.memoryWrite) push("memory.write", input.result.memoryWrite, input.identities.memory);
  if (evidence && "control" in evidence && evidence.control) push("control.terminal", evidence.control, input.identities.control);
  push(input.failure === undefined ? "run.completed" : "run.failed", {
    status: input.failure === undefined ? "completed" : isAbortError(input.failure) ? "cancelled" : "failed",
    ...(input.failure === undefined ? {} : { error: safeError(input.failure) }),
    finalText: input.result?.finalText ?? null,
  }, AGENT_KERNEL_IDENTITY);
  return Object.freeze(events);
}

function evidenceOwner(kind: string, identities: TextTurnModuleIdentities | undefined): ModuleIdentity {
  if (!identities) return AGENT_KERNEL_IDENTITY;
  if (kind.startsWith("tool-")) return identities.toolUse ?? AGENT_KERNEL_IDENTITY;
  if (kind.startsWith("computer-action")) return identities.computerUse ?? AGENT_KERNEL_IDENTITY;
  if (kind.includes("safety")) return identities.safety;
  if (kind.startsWith("environment-") || kind.includes("environment-invocation")) {
    return identities.executionEnvironment ?? AGENT_KERNEL_IDENTITY;
  }
  if (kind.startsWith("output-action")) return identities.outputActions ?? AGENT_KERNEL_IDENTITY;
  if (kind.startsWith("memory-")) return identities.memory;
  return AGENT_KERNEL_IDENTITY;
}

function toJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? null : JSON.parse(serialized) as JsonValue;
}

function safeError(value: unknown): { readonly name: string; readonly message: string } {
  return {
    name: value instanceof Error ? value.name : "Error",
    message: value instanceof Error ? value.message : "The run failed with a non-Error value.",
  };
}

function isAbortError(value: unknown): boolean {
  if (value instanceof Error && value.name === "AbortError") return true;
  if (typeof value !== "object" || value === null || !("failure" in value)) return false;
  return isAbortError((value as { readonly failure?: unknown }).failure);
}
