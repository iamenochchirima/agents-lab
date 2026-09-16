import type { ModelSelection, RunEvent, RunStatus, RunView } from "./platformApi";

export type ChatMessageStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: ChatMessageStatus;
  readonly runId?: string;
}

export function modelSelectionFromRun(run: Pick<RunView, "manifest">): ModelSelection | null {
  if (run.manifest.model.provider !== "openrouter") return null;
  return {
    provider: "openrouter",
    model: run.manifest.model.model,
    ...(run.manifest.model.contextWindowTokens === undefined ? {} : { contextWindowTokens: run.manifest.model.contextWindowTokens }),
  };
}

export function synchronizeModelSelection(current: ModelSelection | null, run: Pick<RunView, "manifest">): ModelSelection | null {
  const recorded = modelSelectionFromRun(run);
  if (!recorded || modelSelectionsAreEqual(current, recorded)) return current;
  return recorded;
}

export function isModelPickerDisabled(input: { readonly hasActiveRun: boolean; readonly preservesSession: boolean; readonly sessionId: string | null }): boolean {
  return input.hasActiveRun || input.preservesSession && input.sessionId !== null;
}

export function mergeEvents(current: readonly RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  const byId = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) byId.set(event.eventId, event);
  const next = [...byId.values()].sort((left, right) => left.recordedSequence - right.recordedSequence);
  return current.length === next.length && current.every((event, index) => eventsAreEqual(event, next[index]))
    ? current as RunEvent[]
    : next;
}

export function upsertRunMessages(current: readonly ChatMessage[], run: RunView, assistantMessageId?: string): ChatMessage[] {
  const userExists = current.some((message) => message.runId === run.runId && message.role === "user");
  const placeholderIndex = assistantMessageId === undefined ? -1 : current.findIndex((message) => message.id === assistantMessageId);
  const placeholderUserIndex = placeholderIndex > 0 && current[placeholderIndex - 1]?.role === "user" && current[placeholderIndex - 1]?.runId === undefined
    ? placeholderIndex - 1
    : -1;
  const withUser = userExists
    ? [...current]
    : placeholderUserIndex >= 0
      ? current.map((message, index) => index === placeholderUserIndex ? { ...message, runId: run.runId } : message)
      : [
          ...current,
          { id: `${run.runId}:user`, role: "user" as const, content: run.manifest.task.prompt, status: "completed" as const, runId: run.runId },
        ];
  const existingIndex = withUser.findIndex((message) => (
    message.role === "assistant" && (message.runId === run.runId || message.id === assistantMessageId)
  ));
  const nextMessage: ChatMessage = {
    id: assistantMessageId ?? (existingIndex >= 0 ? withUser[existingIndex].id : `${run.runId}:assistant`),
    role: "assistant",
    content: assistantContent(run),
    status: assistantStatus(run.status),
    runId: run.runId,
  };
  if (existingIndex >= 0) {
    withUser[existingIndex] = nextMessage;
    return retainMessages(current, deduplicateMessages(withUser));
  }
  return retainMessages(current, deduplicateMessages([...withUser, nextMessage]));
}

export function reuseRunView(current: RunView | null, next: RunView): RunView {
  return current && runViewsHaveSameVisibleState(current, next) ? current : next;
}

export function shouldActivateUrlRun(runIdFromUrl: string | null, activeRunId: string | null, loadedRun: RunView | null): boolean {
  if (!runIdFromUrl || runIdFromUrl === activeRunId) return false;
  return !(loadedRun?.runId === runIdFromUrl && terminalStatuses.has(loadedRun.status));
}

export function deduplicateMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()];
}

function retainMessages(current: readonly ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  return current.length === next.length && current.every((message, index) => chatMessagesAreEqual(message, next[index]))
    ? current as ChatMessage[]
    : next;
}

function eventsAreEqual(left: RunEvent, right: RunEvent): boolean {
  return left.eventId === right.eventId
    && left.recordedSequence === right.recordedSequence
    && left.source === right.source
    && left.sourceSequence === right.sourceSequence
    && left.kind === right.kind
    && left.runId === right.runId
    && left.occurredAt === right.occurredAt
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

function chatMessagesAreEqual(left: ChatMessage, right: ChatMessage): boolean {
  return left.id === right.id
    && left.role === right.role
    && left.content === right.content
    && left.status === right.status
    && left.runId === right.runId;
}

function modelSelectionsAreEqual(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left?.provider === right?.provider
    && left?.model === right?.model
    && left?.contextWindowTokens === right?.contextWindowTokens;
}

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "cancelled", "reconciliation_required"]);

function runViewsHaveSameVisibleState(left: RunView, right: RunView): boolean {
  return left.runId === right.runId
    && left.status === right.status
    && eventIdentity(left.events) === eventIdentity(right.events)
    && JSON.stringify(left.executionReference) === JSON.stringify(right.executionReference)
    && JSON.stringify(left.result) === JSON.stringify(right.result)
    && JSON.stringify(left.projection) === JSON.stringify(right.projection)
    && JSON.stringify(contextVisibleState(left.context)) === JSON.stringify(contextVisibleState(right.context));
}

function eventIdentity(events: readonly RunEvent[]): string {
  return events.map((event) => `${event.eventId}:${event.recordedSequence}`).join("|");
}

function contextVisibleState(context: RunView["context"]): unknown {
  if (!context) return null;
  const { updatedAt: _updatedAt, ...visibleState } = context;
  return visibleState;
}

function assistantStatus(status: RunStatus): ChatMessageStatus {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "reconciliation_required") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "queued") return "running";
  return "pending";
}

function assistantContent(run: RunView): string {
  if (run.result?.status === "completed") return run.result.output ?? "The agent returned no text.";
  if (run.result?.error) return run.result.error.message;
  return "";
}
