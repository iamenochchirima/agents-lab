import { Ban, CheckCircle2, CircleAlert, ChevronDown, LoaderCircle, MessageSquare, Plus, Send, Wrench, XCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";

import { experimentCatalog } from "../experiments/experimentCatalog";
import { ModelPicker } from "../models/ModelPicker";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import { appPaths } from "../../routes/paths";
import type { PlatformOutletContext } from "./PlatformWorkspaceLayout";
import { isRunnableBaseline } from "./platformCatalog";
import {
  cancelRun,
  createRun,
  DEFAULT_PLATFORM_CAPABILITIES,
  getPlatformConnectivity,
  getRun,
  getRunEvents,
  getRunEvidenceUrl,
  PlatformApiError,
  type ModelSelection,
  type PlatformConnectivity,
  type PlatformRunRequest,
  type RunEvidenceFile,
  type RunEvent,
  type RunStatus,
  type RunView,
} from "./platformApi";
import { ContextBudgetMeter } from "./RunStatusPanel";
import { createClientTurnId, deduplicateMessages, isModelPickerDisabled, isRunRetrying, mergeEvents, reuseRunView, runBelongsToPlatform, shouldActivateUrlRun, synchronizeModelSelection, upsertRunMessages, type ChatMessage } from "./chatState";

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "cancelled", "reconciliation_required"]);
const pendingTurnStoragePrefix = "agentlab.platform-chat.pending-turn.";

interface PendingTurn {
  readonly request: PlatformRunRequest;
  readonly assistantMessageId: string;
  readonly conversationVersion: number;
}

export function PlatformChatPage() {
  const { platform } = useOutletContext<PlatformOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0].id);
  const [backendProfileId, setBackendProfileId] = useState(platform.backendProfiles[0]?.id ?? "");
  const [variantId, setVariantId] = useState(platform.variants[0]?.id ?? "baseline");
  const [infrastructureId, setInfrastructureId] = useState(platform.infrastructure[0]?.id ?? "none");
  const [experimentId, setExperimentId] = useState("none");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(() => searchParams.get("run"));
  const [latestRun, setLatestRun] = useState<RunView | null>(null);
  const [latestEvents, setLatestEvents] = useState<RunEvent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryTurn, setRetryTurn] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<PlatformConnectivity | null>(null);
  const [connectivityError, setConnectivityError] = useState<string | null>(null);
  const eventCursor = useRef(0);
  const previousPlatformId = useRef(platform.id);
  const conversationVersion = useRef(0);
  const searchParamsRef = useRef(searchParams);
  const ignoredUrlRunId = useRef<string | null>(null);
  searchParamsRef.current = searchParams;

  const preservesSession = ["temporal", "restate", "langgraph", "mastra"].includes(platform.id) && variantId === "baseline";
  const hasRunnableBaseline = isRunnableBaseline(platform) && variantId === "baseline";
  const isReady = hasRunnableBaseline && connectivity?.reachable === true;
  const hasActiveRun = activeRunId !== null;
  const modelPickerDisabled = isModelPickerDisabled({ hasActiveRun, preservesSession, sessionId });
  const canSubmit = isReady && Boolean(selectedModel) && prompt.trim().length > 0 && !isSubmitting && !hasActiveRun && retryTurn === null;

  useEffect(() => {
    setMessages((current) => {
      const next = deduplicateMessages(current);
      return next.length === current.length ? current : next;
    });
  }, []);

  useEffect(() => {
    const stored = readPendingTurn(platform.id);
    if (!stored) return;
    const assistantMessageId = createId("assistant-restored");
    setSelectedModel({
      provider: "openrouter",
      model: stored.request.model.model,
      ...(stored.request.model.contextWindowTokens === undefined ? {} : { contextWindowTokens: stored.request.model.contextWindowTokens }),
    });
    setVariantId(stored.request.variant);
    setSessionId(stored.request.sessionId ?? null);
    setMessages([
      {
        id: createId("user-restored"),
        role: "user",
        content: stored.request.task.prompt,
        status: "completed",
        clientTurnId: stored.request.clientTurnId,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Previous request was interrupted. Retry to continue.",
        status: "failed",
        clientTurnId: stored.request.clientTurnId,
      },
    ]);
    setRetryTurn({ request: stored.request, assistantMessageId, conversationVersion: conversationVersion.current });
    setError("Previous request was interrupted. Retry to continue.");
  }, [platform.id]);

  useEffect(() => {
    const changedPlatform = previousPlatformId.current !== platform.id;
    previousPlatformId.current = platform.id;
    if (!changedPlatform) return;

    setPrompt("");
    setMessages([]);
    setSessionId(null);
    setActiveRunId(null);
    setLatestRun(null);
    setLatestEvents([]);
    setError(null);
    setRetryTurn(null);
    setBackendProfileId(platform.backendProfiles[0]?.id ?? "");
    setVariantId(platform.variants[0]?.id ?? "baseline");
    setInfrastructureId(platform.infrastructure[0]?.id ?? "none");
    eventCursor.current = 0;
    conversationVersion.current += 1;
    ignoredUrlRunId.current = searchParams.get("run");
    if (searchParams.has("run")) {
      const next = new URLSearchParams(searchParams);
      next.delete("run");
      setSearchParams(next, { replace: true });
    }
  }, [platform, searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    setConnectivity(null);
    setConnectivityError(null);

    if (!isRunnableBaseline(platform)) {
      return () => controller.abort();
    }

    void getPlatformConnectivity(platform.id, controller.signal)
      .then((result) => {
        if (!stopped) setConnectivity(result);
      })
      .catch((requestError) => {
        if (stopped || isAbortError(requestError)) return;
        setConnectivityError(toUserMessage(requestError));
      });

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [platform.id]);

  useEffect(() => {
    if (!activeRunId) return;
    const targetRunId = activeRunId;
    let stopped = false;
    let timeout: number | undefined;
    const controller = new AbortController();

    async function refresh() {
      try {
        const [run, eventPage] = await Promise.all([
          getRun(targetRunId, controller.signal),
          getRunEvents(targetRunId, eventCursor.current, controller.signal),
        ]);
        if (stopped) return;

        if (!runBelongsToPlatform(run, platform.id)) {
          ignoredUrlRunId.current = targetRunId;
          setActiveRunId((current) => current === targetRunId ? null : current);
          setLatestRun((current) => current?.runId === targetRunId ? null : current);
          setLatestEvents([]);
          eventCursor.current = 0;
          setError("That run belongs to another platform. Start a new chat.");
          if (searchParamsRef.current.get("run") === targetRunId) {
            const next = new URLSearchParams(searchParamsRef.current);
            next.delete("run");
            setSearchParams(next, { replace: true });
          }
          return;
        }

        eventCursor.current = Math.max(eventCursor.current, eventPage.nextSequence);
        setLatestRun((current) => reuseRunView(current, run));
        setLatestEvents((current) => mergeEvents(mergeEvents(current, run.events), eventPage.events));
        setSelectedModel((current) => synchronizeModelSelection(current, run));
        if (preservesSession) setSessionId((current) => getRunSessionId(run) ?? current);
        setMessages((current) => upsertRunMessages(current, run));
        setError(null);

        if (!terminalStatuses.has(run.status) || eventPage.hasMore) {
          timeout = window.setTimeout(() => void refresh(), 850);
        } else {
          setActiveRunId(null);
        }
      } catch (requestError) {
        if (stopped || isAbortError(requestError)) return;
        setError(toUserMessage(requestError));
        if (requestError instanceof PlatformApiError && requestError.status === 404) {
          ignoredUrlRunId.current = targetRunId;
          setActiveRunId((current) => current === targetRunId ? null : current);
          setLatestRun((current) => current?.runId === targetRunId ? null : current);
          setLatestEvents([]);
          eventCursor.current = 0;
          setError("That run is no longer available. Start a new chat.");
          if (searchParamsRef.current.get("run") === targetRunId) {
            const next = new URLSearchParams(searchParamsRef.current);
            next.delete("run");
            setSearchParams(next, { replace: true });
          }
          return;
        }
        timeout = window.setTimeout(() => void refresh(), 1_500);
      }
    }

    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [activeRunId, platform.id, preservesSession, setSearchParams]);

  useEffect(() => {
    const runIdFromUrl = searchParams.get("run");
    if (!runIdFromUrl) {
      ignoredUrlRunId.current = null;
      return;
    }
    if (runIdFromUrl === ignoredUrlRunId.current) return;
    if (shouldActivateUrlRun(runIdFromUrl, activeRunId, latestRun)) {
      setActiveRunId(runIdFromUrl);
    }
  }, [activeRunId, latestRun, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedModel) return;

    const text = prompt.trim();
    const currentConversationVersion = conversationVersion.current;
    const clientTurnId = preservesSession ? createClientTurnId() : undefined;
    const requestSessionId = preservesSession ? sessionId ?? createId("session") : undefined;
    const userMessageId = createId("user");
    const assistantMessageId = createId("assistant");
    const request: PlatformRunRequest = {
      platform: platform.id,
      variant: variantId,
      task: { kind: "prompt", prompt: text },
      model: selectedModel,
      capabilities: DEFAULT_PLATFORM_CAPABILITIES,
      ...(preservesSession && requestSessionId ? { sessionId: requestSessionId } : {}),
      ...(clientTurnId ? { clientTurnId } : {}),
      selection: {
        scenarioId,
        ...(backendProfileId ? { backendProfileId } : {}),
        ...(infrastructureId !== "none" ? { infrastructureId } : {}),
        ...(experimentId !== "none" ? { experimentId } : {}),
      },
    };
    const pendingTurn: PendingTurn = { request, assistantMessageId, conversationVersion: currentConversationVersion };
    persistPendingTurn(platform.id, request);
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: "user",
        content: text,
        status: "completed",
        ...(clientTurnId ? { clientTurnId } : {}),
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "pending",
        ...(clientTurnId ? { clientTurnId } : {}),
      },
    ]);
    setPrompt("");
    if (requestSessionId && requestSessionId !== sessionId) setSessionId(requestSessionId);
    await dispatchTurn(pendingTurn);
  }

  async function dispatchTurn(pendingTurn: PendingTurn): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    eventCursor.current = 0;
    setMessages((current) => current.map((message) => message.id === pendingTurn.assistantMessageId
      ? { ...message, content: "", status: "pending", ...(pendingTurn.request.clientTurnId ? { clientTurnId: pendingTurn.request.clientTurnId } : {}) }
      : message));

    try {
      const run = await createRun(pendingTurn.request);
      if (conversationVersion.current !== pendingTurn.conversationVersion) return;

      clearPendingTurn(platform.id);
      setRetryTurn(null);
      setSelectedModel((current) => synchronizeModelSelection(current, run));
      setLatestRun(run);
      setLatestEvents(mergeEvents([], run.events));
      eventCursor.current = run.events.at(-1)?.recordedSequence ?? 0;
      setActiveRunId(run.runId);
      ignoredUrlRunId.current = null;
      if (preservesSession) setSessionId(getRunSessionId(run));
      setMessages((current) => upsertRunMessages(current, run, pendingTurn.assistantMessageId));
      const next = new URLSearchParams(searchParams);
      next.set("run", run.runId);
      setSearchParams(next, { replace: true });
    } catch (requestError) {
      if (conversationVersion.current !== pendingTurn.conversationVersion) return;

      const message = toUserMessage(requestError);
      setRetryTurn(pendingTurn);
      setMessages((current) => current.map((candidate) => candidate.id === pendingTurn.assistantMessageId
        ? { ...candidate, content: message, status: "failed" }
        : candidate));
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function retryFailedTurn(messageId: string): void {
    if (!retryTurn || retryTurn.assistantMessageId !== messageId || isSubmitting) return;
    void dispatchTurn(retryTurn);
  }

  async function stopActiveRun() {
    if (!latestRun || !hasActiveRun || isCancelling) return;
    setIsCancelling(true);
    try {
      const cancelled = await cancelRun(latestRun.runId, "Cancellation requested from Chat.");
      setLatestRun(cancelled);
      setLatestEvents(mergeEvents([], cancelled.events));
      setMessages((current) => upsertRunMessages(current, cancelled));
      if (terminalStatuses.has(cancelled.status)) setActiveRunId(null);
    } catch (requestError) {
      setError(toUserMessage(requestError));
    } finally {
      setIsCancelling(false);
    }
  }

  function newConversation() {
    conversationVersion.current += 1;
    ignoredUrlRunId.current = searchParams.get("run");
    setPrompt("");
    setMessages([]);
    setSessionId(null);
    setActiveRunId(null);
    setLatestRun(null);
    setLatestEvents([]);
    setError(null);
    setRetryTurn(null);
    clearPendingTurn(platform.id);
    eventCursor.current = 0;
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    setSearchParams(next, { replace: true });
  }

  const visibleMessages = deduplicateMessages(messages);

  return (
    <div className="chat-page">
      <header className="chat-heading">
        <div>
          <span className="eyebrow">{platform.name}</span>
          <h1>Chat</h1>
        </div>
        <div className="chat-heading-actions">
          <Link className="quiet-button" to={appPaths.platform(platform.id)}>Run setup</Link>
          <button className="quiet-button" onClick={newConversation} type="button"><Plus aria-hidden="true" size={14} /> New chat</button>
        </div>
      </header>

      <main className="chat-layout">
        <section className="chat-main" aria-label={`${platform.name} conversation`}>
          <div aria-live="polite" className="chat-thread">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <MessageSquare aria-hidden="true" size={20} />
                <h2>Start a conversation</h2>
                <p>Ask the selected agent anything.</p>
              </div>
            ) : visibleMessages.map((message) => <ChatMessageBubble key={message.id} message={message} onRetry={retryTurn?.assistantMessageId === message.id ? () => retryFailedTurn(message.id) : undefined} />)}
            <ChatToolActivity events={latestEvents} />
          </div>

          <form className="chat-composer" onSubmit={(event) => void submit(event)}>
            <textarea
              aria-label="Message"
              disabled={!isReady || hasActiveRun}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message the agent…"
              rows={3}
              value={prompt}
            />
            <div className="chat-composer-footer">
              <span>{chatAvailabilityLabel({ connectivity, connectivityError, hasRunnableBaseline, isReady, selectedModel, preservesSession })}</span>
              <div className="chat-composer-actions">
                {hasActiveRun && <button className="quiet-button" disabled={isCancelling} onClick={() => void stopActiveRun()} type="button"><Ban aria-hidden="true" size={14} /> {isCancelling ? "Cancelling" : "Stop"}</button>}
                <button className="button button-primary" disabled={!canSubmit} type="submit">
                  {isSubmitting ? <LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> : <Send aria-hidden="true" size={14} />}
                  {isSubmitting ? "Starting" : "Send"}
                </button>
              </div>
            </div>
          </form>
        </section>

        <aside className="chat-sidebar" aria-label="Chat configuration">
          <section className="chat-config panel">
            <div className="chat-config-heading">
              <div><span className="eyebrow">Configuration</span><h2>{platform.name}</h2></div>
              <span className={isReady ? "chat-ready" : "chat-unavailable"}>{isReady ? "Ready" : "Unavailable"}</span>
            </div>
            <ModelPicker disabled={modelPickerDisabled} onChange={setSelectedModel} value={selectedModel} />
            <details className="chat-options">
              <summary>Run options <ChevronDown aria-hidden="true" size={14} /></summary>
              <div className="chat-option-grid">
                <ChatSelect label="Scenario" onChange={setScenarioId} value={scenarioId}>
                  {scenarioCatalog.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </ChatSelect>
                <ChatSelect label="Variant" onChange={setVariantId} value={variantId}>
                  {platform.variants.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </ChatSelect>
                {platform.backendProfiles.length > 0 && <ChatSelect label="Server" onChange={setBackendProfileId} value={backendProfileId}>
                  {platform.backendProfiles.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </ChatSelect>}
                {platform.infrastructure.length > 0 && <ChatSelect label="Infrastructure" onChange={setInfrastructureId} value={infrastructureId}>
                  {platform.infrastructure.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </ChatSelect>}
                <ChatSelect label="Experiment" onChange={setExperimentId} value={experimentId}>
                  {experimentCatalog.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </ChatSelect>
              </div>
            </details>
            {preservesSession && <p className="chat-session-note">Session active. Use New chat to change model.</p>}
            {!preservesSession && hasRunnableBaseline && <p className="chat-session-note">Each turn starts a new platform run.</p>}
            {!isReady && <p className="chat-availability-error">{connectivityError ?? connectivity?.message ?? (!hasRunnableBaseline ? "This platform is not available yet." : "Checking server availability…")}</p>}
          </section>

          {error && !latestRun && <p className="chat-availability-error" role="status">{error}</p>}
          {latestRun?.context && <ContextBudgetMeter context={latestRun.context} />}
          {latestRun && <ChatRunDetails error={error} events={latestEvents} onNewChat={newConversation} run={latestRun} />}
        </aside>
      </main>
    </div>
  );
}

function ChatMessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const isAssistant = message.role === "assistant";
  const StatusIcon = message.status === "completed" ? CheckCircle2 : message.status === "failed" ? XCircle : LoaderCircle;
  const statusLabel = chatMessageStatusLabel(message.status);
  return (
    <article aria-label={`${isAssistant ? "Agent" : "You"} message, ${statusLabel}`} className={`chat-message chat-message-${message.role} chat-message-status-${message.status}`}>
      <div className="chat-message-label">{isAssistant ? "Agent" : "You"}</div>
      <div className="chat-message-content">
        {message.content ? <p>{message.content}</p> : <span className="chat-message-pending"><StatusIcon aria-hidden="true" className={message.status === "running" || message.status === "pending" ? "is-spinning" : undefined} size={14} /> {statusLabel}</span>}
        {message.status === "failed" && onRetry && <button className="chat-retry-button" disabled={!onRetry} onClick={onRetry} type="button">Retry</button>}
      </div>
    </article>
  );
}

function chatMessageStatusLabel(status: ChatMessage["status"]): string {
  switch (status) {
    case "pending": return "Starting…";
    case "running": return "Working…";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function ChatToolActivity({ events }: { events: readonly RunEvent[] }) {
  const event = [...events].reverse().find((candidate) => candidate.kind.startsWith("Tool"));
  if (!event) return null;
  const toolName = typeof event.payload.toolName === "string" && event.payload.toolName.trim()
    ? event.payload.toolName
    : "Tool";
  const state = event.kind === "ToolExecutionCompleted"
    ? "completed"
    : event.kind === "ToolExecutionFailed" || event.kind === "ToolExecutionCancelled" || event.kind === "ToolPolicyDenied" || event.kind === "ToolCallRejected"
      ? "failed"
      : "active";
  const label = state === "completed" ? `${toolName} · Completed` : state === "failed" ? `${toolName} · Stopped` : `${toolName} · Running`;
  return <div aria-live="polite" className={`chat-tool-activity chat-tool-${state}`} role="status"><Wrench aria-hidden="true" size={13} /> {label}</div>;
}

function ChatRunDetails({ error, events, onNewChat, run }: { error: string | null; events: readonly RunEvent[]; onNewChat: () => void; run: RunView }) {
  const toolEvents = events.filter((event) => /tool|skill|mcp/i.test(event.kind));
  const evidenceFiles = availableEvidenceFiles(run);
  const native = run.executionReference?.platform === "restate" ? run.executionReference.native : null;
  const retrying = isRunRetrying(run, events);
  return (
    <details className="chat-run-details" open={run.status === "running" || run.status === "queued" || run.status === "reconciliation_required"}>
      <summary><span>Run details</span><small>{retrying ? "retrying" : run.status.replaceAll("_", " ")}</small></summary>
      <div className="chat-run-details-body">
        {retrying && <p className="chat-run-retrying" role="status"><LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> Retrying model request…</p>}
        {error && <p className="chat-availability-error"><CircleAlert aria-hidden="true" size={14} /> {error}</p>}
        {run.status === "reconciliation_required" && (
          <div className="chat-availability-error" role="alert">
            <CircleAlert aria-hidden="true" size={14} />
            <span>Run outcome needs recovery. Start a new chat before sending another turn.</span>
            <button className="chat-retry-button" onClick={onNewChat} type="button">New chat</button>
          </div>
        )}
        <dl className="chat-run-meta">
          <div><dt>Run</dt><dd title={run.runId}>{run.runId}</dd></div>
          <div><dt>Platform status</dt><dd>{formatRunStatus(run.status)}</dd></div>
          <div><dt>Projection</dt><dd>{run.projection.state === "stale" ? "Stale" : "Current"}</dd></div>
          <div><dt>Events</dt><dd>{events.length}</dd></div>
          <div><dt>Tools</dt><dd>{toolEvents.length}</dd></div>
        </dl>
        {native && <NativeRunDetails native={native} />}
        {run.projection.state === "stale" && <p className="chat-availability-error"><CircleAlert aria-hidden="true" size={14} /> {run.projection.reason ?? "The latest platform state is unavailable."}</p>}
        <details className="chat-activity" open={toolEvents.length > 0}>
          <summary><Wrench aria-hidden="true" size={13} /> Tool activity <small>{toolEvents.length}</small></summary>
          {toolEvents.length === 0 ? <p>No tool activity recorded.</p> : <ol>{toolEvents.map((event) => <li key={event.eventId}><strong>{formatEventKind(event.kind)}</strong><small>{event.source}</small></li>)}</ol>}
        </details>
        <details className="chat-activity">
          <summary><span>Run timeline</span><small>{events.length}</small></summary>
          {events.length === 0 ? <p>No run events recorded.</p> : <ol>{events.map((event) => <li key={event.eventId}><strong>{formatEventKind(event.kind)}</strong><small>{event.source}</small></li>)}</ol>}
        </details>
        <details className="chat-activity chat-evidence">
          <summary><span>Evidence</span><small>Safe files</small></summary>
          <ul>{evidenceFiles.map((fileName) => <li key={fileName}><a href={getRunEvidenceUrl(run.runId, fileName)} rel="noreferrer" target="_blank">{fileName}</a></li>)}</ul>
        </details>
      </div>
    </details>
  );
}

function NativeRunDetails({ native }: { native: Record<string, unknown> }) {
  const fields = [
    { label: "Workflow", value: native.workflowKey },
    { label: "Invocation", value: native.invocationId },
    { label: "Native status", value: native.nativeStatus },
    { label: "Retries", value: native.retryCount },
    { label: "Last observed", value: native.lastModifiedAt },
  ].flatMap(({ label, value }) => typeof value === "string" || typeof value === "number" ? [[label, value] as const] : []);
  if (fields.length === 0) return null;
  return (
    <details className="chat-activity">
      <summary><span>Native execution</span><small>Restate</small></summary>
      <dl className="chat-run-meta">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{String(value)}</dd></div>)}
      </dl>
    </details>
  );
}

function availableEvidenceFiles(run: RunView): readonly RunEvidenceFile[] {
  const files: RunEvidenceFile[] = [];
  files.push("config.json", "events.jsonl");
  if (run.context) files.push("context.json");
  if (run.trajectory) files.push("trajectory.json");
  if (run.metrics) files.push("metrics.json");
  if (run.result) files.push("result.json");
  return files;
}

function ChatSelect({ children, disabled, label, onChange, value }: { children: ReactNode; disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className={`chat-select ${disabled ? "is-disabled" : ""}`}><span>{label}</span><select disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}

function formatRunStatus(status: RunStatus): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEventKind(kind: string): string {
  return kind.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function getRunSessionId(run: RunView): string | null {
  return run.context?.sessionId ?? run.manifest.context?.sessionId ?? null;
}

function chatAvailabilityLabel({ connectivity, connectivityError, hasRunnableBaseline, isReady, preservesSession, selectedModel }: { connectivity: PlatformConnectivity | null; connectivityError: string | null; hasRunnableBaseline: boolean; isReady: boolean; preservesSession: boolean; selectedModel: ModelSelection | null }): string {
  if (!hasRunnableBaseline) return "Platform not available yet.";
  if (connectivityError) return connectivityError;
  if (!connectivity) return "Checking server…";
  if (!isReady) return connectivity.message;
  if (!selectedModel) return "Select a model.";
  return preservesSession ? "Messages continue in this session." : "Each message starts a platform run.";
}

function persistPendingTurn(platformId: string, request: PlatformRunRequest): void {
  if (!request.sessionId || !request.clientTurnId || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(pendingTurnStorageKey(platformId), JSON.stringify({ request }));
  } catch {
    // Storage can be unavailable in private browsing or a restricted document.
    // The in-memory retry remains available for the current page.
  }
}

function readPendingTurn(platformId: string): { readonly request: PlatformRunRequest } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pendingTurnStorageKey(platformId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.request)) return null;
    const request = parsed.request;
    const task = request.task;
    const model = request.model;
    if (request.platform !== platformId
      || typeof request.variant !== "string"
      || !isRecord(task)
      || task.kind !== "prompt"
      || typeof task.prompt !== "string"
      || !isRecord(model)
      || model.provider !== "openrouter"
      || typeof model.model !== "string"
      || typeof request.sessionId !== "string"
      || typeof request.clientTurnId !== "string") return null;
    return { request: request as unknown as PlatformRunRequest };
  } catch {
    return null;
  }
}

function clearPendingTurn(platformId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(pendingTurnStorageKey(platformId));
  } catch {
    // Storage cleanup is best effort; the active component state is authoritative.
  }
}

function pendingTurnStorageKey(platformId: string): string {
  return `${pendingTurnStoragePrefix}${platformId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createId(prefix: string): string {
  return `${prefix}-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function toUserMessage(error: unknown): string {
  if (error instanceof PlatformApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The run could not be updated.";
}
