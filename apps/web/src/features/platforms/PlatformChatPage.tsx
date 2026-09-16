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
  getPlatformConnectivity,
  getRun,
  getRunEvents,
  PlatformApiError,
  type ModelSelection,
  type PlatformConnectivity,
  type RunEvent,
  type RunStatus,
  type RunView,
} from "./platformApi";
import { ContextBudgetMeter } from "./RunStatusPanel";
import { deduplicateMessages, isModelPickerDisabled, mergeEvents, reuseRunView, shouldActivateUrlRun, synchronizeModelSelection, upsertRunMessages, type ChatMessage } from "./chatState";

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "cancelled", "reconciliation_required"]);

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
  const [error, setError] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<PlatformConnectivity | null>(null);
  const [connectivityError, setConnectivityError] = useState<string | null>(null);
  const eventCursor = useRef(0);
  const previousPlatformId = useRef(platform.id);

  const preservesSession = platform.id === "temporal" && variantId === "baseline";
  const hasRunnableBaseline = isRunnableBaseline(platform) && variantId === "baseline";
  const isReady = hasRunnableBaseline && connectivity?.reachable === true;
  const hasActiveRun = activeRunId !== null;
  const modelPickerDisabled = isModelPickerDisabled({ hasActiveRun, preservesSession, sessionId });
  const canSubmit = isReady && Boolean(selectedModel) && prompt.trim().length > 0 && !isSubmitting && !hasActiveRun;

  useEffect(() => {
    setMessages((current) => {
      const next = deduplicateMessages(current);
      return next.length === current.length ? current : next;
    });
  }, []);

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
    setBackendProfileId(platform.backendProfiles[0]?.id ?? "");
    setVariantId(platform.variants[0]?.id ?? "baseline");
    setInfrastructureId(platform.infrastructure[0]?.id ?? "none");
    eventCursor.current = 0;
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
          setActiveRunId((current) => current === targetRunId ? null : current);
          setLatestRun((current) => current?.runId === targetRunId ? null : current);
          setLatestEvents([]);
          eventCursor.current = 0;
          setError("That run is no longer available. Start a new chat.");
          if (searchParams.get("run") === targetRunId) {
            const next = new URLSearchParams(searchParams);
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
  }, [activeRunId, preservesSession]);

  useEffect(() => {
    const runIdFromUrl = searchParams.get("run");
    if (shouldActivateUrlRun(runIdFromUrl, activeRunId, latestRun)) {
      setActiveRunId(runIdFromUrl);
    }
  }, [activeRunId, latestRun, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedModel) return;

    const text = prompt.trim();
    const userMessageId = createId("user");
    const assistantMessageId = createId("assistant");
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: "user", content: text, status: "completed" },
      { id: assistantMessageId, role: "assistant", content: "", status: "pending" },
    ]);
    setPrompt("");
    setIsSubmitting(true);
    setError(null);
    eventCursor.current = 0;

    try {
      const run = await createRun({
        platform: platform.id,
        variant: variantId,
        task: { kind: "prompt", prompt: text },
        model: selectedModel,
        ...(preservesSession && sessionId ? { sessionId } : {}),
        selection: {
          scenarioId,
          ...(backendProfileId ? { backendProfileId } : {}),
          ...(infrastructureId !== "none" ? { infrastructureId } : {}),
          ...(experimentId !== "none" ? { experimentId } : {}),
        },
      });
      setSelectedModel((current) => synchronizeModelSelection(current, run));
      setLatestRun(run);
      setLatestEvents(run.events.slice());
      eventCursor.current = run.events.at(-1)?.recordedSequence ?? 0;
      setActiveRunId(run.runId);
      if (preservesSession) setSessionId(getRunSessionId(run));
      setMessages((current) => upsertRunMessages(current, run, assistantMessageId));
      const next = new URLSearchParams(searchParams);
      next.set("run", run.runId);
      setSearchParams(next, { replace: true });
    } catch (requestError) {
      setMessages((current) => current.map((message) => message.id === assistantMessageId
        ? { ...message, content: toUserMessage(requestError), status: "failed" }
        : message));
      setError(toUserMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function stopActiveRun() {
    if (!latestRun || !hasActiveRun || isCancelling) return;
    setIsCancelling(true);
    try {
      const cancelled = await cancelRun(latestRun.runId, "Cancellation requested from Chat.");
      setLatestRun(cancelled);
      setLatestEvents(cancelled.events.slice());
      setMessages((current) => upsertRunMessages(current, cancelled));
    } catch (requestError) {
      setError(toUserMessage(requestError));
    } finally {
      setIsCancelling(false);
    }
  }

  function newConversation() {
    setPrompt("");
    setMessages([]);
    setSessionId(null);
    setActiveRunId(null);
    setLatestRun(null);
    setLatestEvents([]);
    setError(null);
    eventCursor.current = 0;
    const next = new URLSearchParams(searchParams);
    next.delete("run");
    setSearchParams(next, { replace: true });
  }

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
            ) : messages.map((message) => <ChatMessageBubble key={message.id} message={message} />)}
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
            {preservesSession && <p className="chat-session-note">Temporal session active. Use New chat to change model.</p>}
            {!preservesSession && hasRunnableBaseline && <p className="chat-session-note">Each turn is a separate platform run until this platform has a session adapter.</p>}
            {!isReady && <p className="chat-availability-error">{connectivityError ?? connectivity?.message ?? (!hasRunnableBaseline ? "This platform is not available yet." : "Checking server availability…")}</p>}
          </section>

          {error && !latestRun && <p className="chat-availability-error" role="status">{error}</p>}
          {latestRun?.context && <ContextBudgetMeter context={latestRun.context} />}
          {latestRun && <ChatRunDetails error={error} events={latestEvents} run={latestRun} />}
        </aside>
      </main>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";
  const StatusIcon = message.status === "completed" ? CheckCircle2 : message.status === "failed" ? XCircle : LoaderCircle;
  return (
    <article className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-label">{isAssistant ? "Agent" : "You"}</div>
      <div className="chat-message-content">
        {message.content ? <p>{message.content}</p> : <span className="chat-message-pending"><StatusIcon aria-hidden="true" className={message.status === "running" || message.status === "pending" ? "is-spinning" : undefined} size={14} /> {message.status === "pending" ? "Starting…" : "Working…"}</span>}
      </div>
    </article>
  );
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

function ChatRunDetails({ error, events, run }: { error: string | null; events: readonly RunEvent[]; run: RunView }) {
  const toolEvents = events.filter((event) => /tool|skill|mcp/i.test(event.kind));
  return (
    <details className="chat-run-details" open={run.status === "running" || run.status === "queued"}>
      <summary><span>Run details</span><small>{run.status.replaceAll("_", " ")}</small></summary>
      <div className="chat-run-details-body">
        {error && <p className="chat-availability-error"><CircleAlert aria-hidden="true" size={14} /> {error}</p>}
        <dl className="chat-run-meta">
          <div><dt>Run</dt><dd title={run.runId}>{run.runId}</dd></div>
          <div><dt>Events</dt><dd>{events.length}</dd></div>
          <div><dt>Tools</dt><dd>{toolEvents.length}</dd></div>
        </dl>
        {run.projection.state === "stale" && <p className="chat-availability-error"><CircleAlert aria-hidden="true" size={14} /> {run.projection.reason ?? "The latest platform state is unavailable."}</p>}
        <details className="chat-activity">
          <summary><Wrench aria-hidden="true" size={13} /> Activity</summary>
          {events.length === 0 ? <p>No activity recorded.</p> : <ol>{events.map((event) => <li key={event.eventId}><strong>{event.kind}</strong><small>{event.source}</small></li>)}</ol>}
        </details>
      </div>
    </details>
  );
}

function ChatSelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="chat-select"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
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
  return preservesSession ? "Messages continue in this Temporal session." : "Each message starts a platform run.";
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
