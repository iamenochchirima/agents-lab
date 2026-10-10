import { sustainedTaskOptions, isStopRequested, taskProgress } from "./taskProgress";
import "./connected-tools.css";
import { ChatMarkdown } from "./ChatMarkdown";
import { Ban, CheckCircle2, CircleAlert, ChevronDown, LoaderCircle, MessageSquare, Plus, Send, Wrench, XCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";

import { experimentCatalog } from "../experiments/experimentCatalog";
import { ModelPicker } from "../models/ModelPicker";
import { ConnectedCapabilitiesSummary } from "./ConnectedCapabilitiesSummary";
import { useInvocationReviews } from "./useInvocationReviews";
import { InvocationReviewPanel } from "./InvocationReviewPanel";
import { RunFailureDetails } from "./RunFailureDetails";
import { defaultCapabilityProfile, requiresUpfrontApproval, toolOutcomeView } from "./connectedToolState";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import { appPaths } from "../../routes/paths";
import type { PlatformOutletContext } from "./PlatformWorkspaceLayout";
import { isRunnableVariant } from "./platformCatalog";
import {
  cancelRun,
  createRun,
  DEFAULT_PLATFORM_CAPABILITIES,
  getPlatformConnectivity,
  getRun,
  getSessionRuns,
  getRunEvents,
  getRunEvidenceUrl,
  getRunToolReceiptUrl,
  PlatformApiError,
  resumeRun,
  type CapabilityApproval,
  type CapabilityProfile,
  type ModelSelection,
  type PlatformConnectivity,
  type PlatformRunRequest,
  type RunEvidenceFile,
  type RunEvent,
  type RunStatus,
  type RunView,
} from "./platformApi";
import { ContextBudgetMeter } from "./RunStatusPanel";
import { createClientTurnId, deduplicateMessages, isModelPickerDisabled, isRunRetrying, mergeEvents, reuseRunView, runBelongsToPlatform, shouldActivateUrlRun, synchronizeModelSelection, upsertRunMessages, projectTurnActivity, mergeSessionHistory, type ChatMessage } from "./chatState";

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
  const [capabilityProfileId, setCapabilityProfileId] = useState(() => defaultCapabilityProfile(platform.id, platform.variants[0]?.id ?? "baseline"));
  const [connectedProfile, setConnectedProfile] = useState<CapabilityProfile | null>(null);
  const [capabilityApprovals, setCapabilityApprovals] = useState<readonly CapabilityApproval[]>([]);
  const [grantReviewOpen, setGrantReviewOpen] = useState(false);
  const [pendingGrantPrompt, setPendingGrantPrompt] = useState<string | null>(null);
  const [requestedSkillIds, setRequestedSkillIds] = useState<readonly string[]>([]);
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0].id);
  const [backendProfileId, setBackendProfileId] = useState(platform.backendProfiles[0]?.id ?? "");
  const [variantId, setVariantId] = useState(platform.variants[0]?.id ?? "baseline");
  const [infrastructureId, setInfrastructureId] = useState(platform.infrastructure[0]?.id ?? "none");
  const [experimentId, setExperimentId] = useState("none");
  const [allowLongerTasks, setAllowLongerTasks] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(() => searchParams.get("run"));
  const [runs, setRuns] = useState<Record<string, RunView>>({});
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [grantAssistantId, setGrantAssistantId] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<RunView | null>(null);
  const [latestEvents, setLatestEvents] = useState<RunEvent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
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

  const preservesSession = ["temporal", "restate", "langgraph", "mastra", "vercel-workflows"].includes(platform.id);
  const hasRunnableVariant = isRunnableVariant(platform, variantId);
  const isReady = hasRunnableVariant && connectivity?.reachable === true;
  const hasActiveRun = activeRunId !== null;
  const modelPickerDisabled = isModelPickerDisabled({ hasActiveRun, preservesSession, sessionId });
  const canSubmit = isReady && Boolean(selectedModel) && prompt.trim().length > 0 && !isSubmitting && !hasActiveRun && retryTurn === null && !grantReviewOpen;

  function acceptRun(run: RunView) {
    setRuns(current => ({ ...current, [run.runId]: reuseRunView(current[run.runId] ?? null, run) }));
    setMessages(current => upsertRunMessages(current, run));
    if (run.runId === latestRun?.runId) {
      setLatestRun(run); setLatestEvents(current => mergeEvents(current, run.events));
      setActiveRunId(terminalStatuses.has(run.status) ? null : run.runId);
    }
  }
  const reviews = useInvocationReviews(runs, `${platform.id}:${sessionId ?? "new"}:${conversationVersion.current}`, acceptRun);
  useEffect(() => {
    if (latestRun) setRuns(current => ({ ...current, [latestRun.runId]: reuseRunView(current[latestRun.runId] ?? null, latestRun) }));
  }, [latestRun]);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void getSessionRuns(sessionId, undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setHistoryCursor(page.nextBeforeTurnId);
      setRuns(current => ({ ...Object.fromEntries(page.runs.map(run => [run.runId, run])), ...current }));
      setMessages(current => mergeSessionHistory(current, page.runs));
    }).catch(cause => { if (!controller.signal.aborted) setError(toUserMessage(cause)); });
    return () => controller.abort();
  }, [sessionId]);
  async function loadEarlierTurns() {
    if (!sessionId || !historyCursor) return;
    const version = conversationVersion.current;
    try {
      const page = await getSessionRuns(sessionId, historyCursor);
      if (version !== conversationVersion.current) return;
      setHistoryCursor(page.nextBeforeTurnId);
      setRuns(current => ({ ...Object.fromEntries(page.runs.map(run => [run.runId, run])), ...current }));
      setMessages(current => mergeSessionHistory(current, page.runs));
    } catch (cause) { if (version === conversationVersion.current) setError(toUserMessage(cause)); }
  }

  useEffect(() => {
    // A reopened run must show its admitted profile, not the new-chat default.
    if (latestRun?.manifest.platform === platform.id && latestRun.manifest.variant === variantId) {
      setCapabilityProfileId(latestRun.manifest.capabilities?.profileId ?? defaultCapabilityProfile(platform.id, variantId));
      setRequestedSkillIds(latestRun.manifest.capabilities?.requestedSkillIds ?? []);
      setCapabilityApprovals(latestRun.manifest.capabilities?.approvals ?? []);
      return;
    }
    setCapabilityProfileId(defaultCapabilityProfile(platform.id, variantId));
    setRequestedSkillIds([]);
    setCapabilityApprovals([]);
  }, [platform.id, variantId, latestRun]);

  useEffect(() => {
    if (!latestRun || latestRun.manifest.platform !== platform.id) return;
    const manifest = latestRun.manifest;
    setVariantId(manifest.variant);
    setScenarioId(manifest.selection?.scenarioId ?? scenarioCatalog[0].id);
    setBackendProfileId(manifest.selection?.backendProfileId ?? platform.backendProfiles[0]?.id ?? "");
    setInfrastructureId(manifest.selection?.infrastructureId ?? platform.infrastructure[0]?.id ?? "none");
    setExperimentId(manifest.selection?.experimentId ?? "none");
  }, [latestRun, platform]);

  useEffect(() => { setAllowLongerTasks(latestRun?.manifest.execution?.mode === "sustained"); }, [latestRun?.runId, platform.id]);

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
    setAllowLongerTasks(false);
    setRuns({}); setHistoryCursor(null); setGrantAssistantId(null);
    setLatestEvents([]);
    setError(null);
    setRetryTurn(null);
    setBackendProfileId(platform.backendProfiles[0]?.id ?? "");
    setVariantId(platform.variants[0]?.id ?? "baseline");
    setCapabilityProfileId(defaultCapabilityProfile(platform.id, platform.variants[0]?.id ?? "baseline"));
    setRequestedSkillIds([]);
    setCapabilityApprovals([]);
    setGrantReviewOpen(false);
    setPendingGrantPrompt(null);
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

    if (!isRunnableVariant(platform, variantId)) {
      return () => controller.abort();
    }

    void getPlatformConnectivity(platform.id, variantId, controller.signal)
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
  }, [platform.id, variantId]);

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedModel) return;

    const text = prompt.trim();
    const requiredGrants = capabilityProfileId === "connected-agent"
      ? connectedProfile?.capabilities.filter(requiresUpfrontApproval) ?? []
      : [];
    const missingApproval = requiredGrants.some(capability => !hasCurrentApproval(capabilityApprovals, capability.id, capability.version));
    if (missingApproval) {
      const assistantId = createId("grant-assistant");
      setGrantAssistantId(assistantId);
      setMessages(current => [...current, { id: createId("grant-user"), role: "user", content: text, status: "completed" }, { id: assistantId, role: "assistant", content: "", status: "suspended" }]);
      setPendingGrantPrompt(text);
      setGrantReviewOpen(true);
      return;
    }
    void startPrompt(text, capabilityApprovals);
  }

  async function startPrompt(text: string, approvals: readonly CapabilityApproval[], existingAssistantId?: string): Promise<void> {
    if (!selectedModel) return;
    const currentConversationVersion = conversationVersion.current;
    const clientTurnId = preservesSession ? createClientTurnId() : undefined;
    const requestSessionId = preservesSession ? sessionId ?? createId("session") : undefined;
    const userMessageId = createId("user");
    const assistantMessageId = existingAssistantId ?? createId("assistant");
    const request: PlatformRunRequest = {
      platform: platform.id,
      variant: variantId,
      task: { kind: "prompt", prompt: text },
      model: selectedModel,
      ...sustainedTaskOptions(allowLongerTasks && variantId === "baseline" && ["temporal", "restate", "langgraph", "mastra", "vercel-workflows"].includes(platform.id), { ...DEFAULT_PLATFORM_CAPABILITIES, profileId: capabilityProfileId, requestedSkillIds, ...(approvals.length > 0 ? { approvals } : {}) }),
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
    setMessages((current) => existingAssistantId ? current : [
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

  function decideToolGrant(decision: CapabilityApproval["decision"]): void {
    const capabilities = connectedProfile?.capabilities.filter(requiresUpfrontApproval) ?? [];
    const decidedAt = new Date();
    const expiresAt = new Date(decidedAt.getTime() + 15 * 60 * 1000);
    const approvals = capabilities.map(capability => ({
      schemaVersion: 1 as const,
      decisionId: createId("approval"),
      capabilityId: capability.id,
      version: capability.version,
      allowedOperations: capability.operations,
      ...(capability.connectionRef ? { connectionRef: capability.connectionRef } : {}),
      decision,
      decidedAt: decidedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }));
    setCapabilityApprovals(approvals);
    setGrantReviewOpen(false);
    const approvedPrompt = pendingGrantPrompt;
    setPendingGrantPrompt(null);
    if (approvedPrompt) void startPrompt(approvedPrompt, approvals, grantAssistantId ?? undefined);
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

  async function resumeWorkflow(run: RunView, approved = true) {
    if (run.status !== "suspended" || isResuming) return;
    setIsResuming(true);
    try {
      const resumed = await resumeRun(run.runId, approved);
      setLatestRun(resumed);
      setLatestEvents(mergeEvents([], resumed.events));
      setMessages((current) => upsertRunMessages(current, resumed));
      setError(null);
    } catch (requestError) {
      setError(toUserMessage(requestError));
    } finally {
      setIsResuming(false);
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
    setAllowLongerTasks(false);
    setRuns({}); setHistoryCursor(null); setGrantAssistantId(null);
    setLatestEvents([]);
    setError(null);
    setRetryTurn(null);
    setCapabilityProfileId(defaultCapabilityProfile(platform.id, variantId));
    setRequestedSkillIds([]);
    setCapabilityApprovals([]);
    setGrantReviewOpen(false);
    setPendingGrantPrompt(null);
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
            {historyCursor && <button className="quiet-button" type="button" onClick={() => void loadEarlierTurns()}>Load earlier turns</button>}
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <MessageSquare aria-hidden="true" size={20} />
                <h2>Start a conversation</h2>
                <p>Ask the selected agent anything.</p>
              </div>
            ) : visibleMessages.map((message) => {
              const run = message.runId ? runs[message.runId] : undefined;
              return <ChatMessageBubble key={message.id} message={message} onRetry={retryTurn?.assistantMessageId === message.id ? () => retryFailedTurn(message.id) : undefined}>
                {message.role === "assistant" && run && <>
                  {run.manifest.capabilities?.approvals?.length ? <details className="invocation-review"><summary>Broader tool access recorded</summary><ul>{run.manifest.capabilities.approvals.map(approval => <li key={approval.decisionId}>{approval.capabilityId} · {approval.decision}</li>)}</ul></details> : null}
                  {/* Preserve the card across renewal; submissions below still bind the current revision. */}
                  {projectTurnActivity(run, reviews.actions[run.runId] ?? []).map(item => item.kind === "review" ? <InvocationReviewPanel key={`${run.runId}:${item.action.requestId}`} run={run} action={item.action} evidenceUrl={getRunToolReceiptUrl(run.runId, item.action.call.toolCallId)} now={reviews.now} busy={reviews.busy !== null} uncertain={reviews.uncertain[`${run.runId}:${item.action.requestId}:${item.action.revision}`]} onSubmit={(choice, renewal) => void reviews.submit(item.action, choice, renewal)} /> : <div className="chat-tool-activity" key={item.event.eventId}><ToolOutcomeDetails event={item.event} runId={run.runId} /></div>)}
                  {reviews.errors[run.runId] && <p role="alert">{reviews.errors[run.runId]}</p>}
                  <RunFailureDetails run={run} />
                  {run.status === "suspended" && reviews.actions[run.runId]?.length === 0 && run.manifest.platform === "mastra" && run.manifest.variant === "workflow" && <section className="invocation-review" aria-label="Workflow approval"><p>This workflow is paused. This decision resumes the workflow, without approving exact tool arguments.</p><button className="quiet-button" disabled={isResuming} onClick={() => void resumeWorkflow(run, false)} type="button">Deny workflow</button><button className="button button-primary" disabled={isResuming} onClick={() => void resumeWorkflow(run)} type="button">Approve and resume workflow</button></section>}
                </>}
                {message.id === grantAssistantId && grantReviewOpen && <section className="invocation-review" aria-label="Broader tool access"><strong>Allow broader tool access for this run?</strong><p>This grants access to tools. Individual actions can still require exact review.</p><ul>{connectedProfile?.capabilities.filter(requiresUpfrontApproval).map(capability => <li key={capability.id}>{capability.displayName} · {capability.operations.join(", ")}</li>)}</ul><button className="quiet-button" onClick={() => decideToolGrant("denied")} type="button">Deny tool access</button><button className="button button-primary" onClick={() => decideToolGrant("approved")} type="button">Approve tool access</button></section>}
              </ChatMessageBubble>;
            })}

          </div>

          <form className="chat-composer" onSubmit={(event) => void submit(event)}>
            <textarea
              aria-label="Message"
              disabled={!isReady}
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
              <span>{latestRun?.status === "suspended" || grantReviewOpen ? "Waiting for approval" : chatAvailabilityLabel({ connectivity, connectivityError, hasRunnableVariant, isReady, selectedModel, preservesSession })}</span>
              <div className="chat-composer-actions">
                {grantReviewOpen && <button className="quiet-button" type="button" onClick={() => { setGrantReviewOpen(false); setPendingGrantPrompt(null); setMessages(current => current.map(message => message.id === grantAssistantId ? { ...message, content: "Tool access request cancelled before starting the run.", status: "cancelled" } : message)); }}>Stop</button>}
                {hasActiveRun && <button className="quiet-button" disabled={isCancelling} onClick={() => void stopActiveRun()} type="button"><Ban aria-hidden="true" size={14} /> {isCancelling || latestRun && isStopRequested(latestRun) ? "Stop requested" : "Stop"}</button>}
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
            <ConnectedCapabilitiesSummary
              run={latestRun}
              onProfileLoaded={setConnectedProfile}
            />
            {latestRun?.manifest.capabilities?.inventory && <details className="chat-session-note capability-inventory">
              <summary>Capabilities given to the agent</summary>
              <small>{latestRun.manifest.capabilities.inventory.profile.name} · {latestRun.manifest.capabilities.inventory.profile.id} · catalog {latestRun.manifest.capabilities.inventory.toolCatalogRevision.slice(0, 12)}</small>
              {latestRun.manifest.capabilities.inventory.sources.length === 0 && <p>No tools were enabled for this run.</p>}
              {latestRun.manifest.capabilities.inventory.sources.map(source => <div key={`${source.id}@${source.version}`}>
                <strong>{source.id}</strong>
                <ul>{source.tools.map(tool => <li key={tool.name}>{tool.name} · {tool.risk}{tool.approvalMode === "invocation" ? " · approval for each action" : tool.approvalMode === "tool_grant" ? " · approved for this run" : ""}</li>)}</ul>
              </div>)}
              {latestRun.manifest.capabilities.inventory.skills.length > 0 && <div>
                <strong>Skills</strong>
                <ul>{latestRun.manifest.capabilities.inventory.skills.map(skill => <li key={`${skill.id}@${skill.version}`}>{skill.name} · {skill.activation}</li>)}</ul>
              </div>}
            </details>}
            <details className="chat-options">
              <summary>Run options <ChevronDown aria-hidden="true" size={14} /></summary>
              {variantId === "baseline" && ["temporal", "restate", "langgraph", "mastra", "vercel-workflows"].includes(platform.id) && <label className="chat-session-note"><input type="checkbox" checked={allowLongerTasks} disabled={hasActiveRun} onChange={event => setAllowLongerTasks(event.target.checked)} /> Allow longer tasks</label>}
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
            {preservesSession && sessionId && <p className="chat-session-note">Session active. Use New chat to change model.</p>}
            {!preservesSession && hasRunnableVariant && <p className="chat-session-note">Each turn starts a new platform run.</p>}
            {!isReady && <p className="chat-availability-error">{connectivityError ?? connectivity?.message ?? (!hasRunnableVariant ? "This platform is not available yet." : "Checking server availability…")}</p>}
          </section>

          {error && !latestRun && <p className="chat-availability-error" role="status">{error}</p>}
          {(latestRun?.context?.activeSkills?.length ?? 0) > 0 && <details className="chat-session-note"><summary>Loaded skills and references</summary><ul>{latestRun!.context!.activeSkills!.map(skill => <li key={skill.id}>{skill.id} · {skill.version}</li>)}</ul></details>}
          {latestRun?.context && <ContextBudgetMeter context={latestRun.context} />}
          {latestRun && <ChatRunDetails error={error} events={latestEvents} onNewChat={newConversation} run={latestRun} />}
        </aside>
      </main>
    </div>
  );
}

function ChatMessageBubble({ message, onRetry, children }: { message: ChatMessage; onRetry?: () => void; children?: ReactNode }) {
  const isAssistant = message.role === "assistant";
  const StatusIcon = message.status === "completed" ? CheckCircle2 : message.status === "failed" ? XCircle : message.status === "suspended" ? CircleAlert : LoaderCircle;
  const statusLabel = chatMessageStatusLabel(message.status);
  return (
    <article aria-label={`${isAssistant ? "Agent" : "You"} message, ${statusLabel}`} className={`chat-message chat-message-${message.role} chat-message-status-${message.status}`}>
      <div className="chat-message-label">{isAssistant ? "Agent" : "You"}</div>
      <div className="chat-message-content">
        {children}
        {message.content ? isAssistant ? <ChatMarkdown content={message.content} /> : <p>{message.content}</p> : <span className="chat-message-pending"><StatusIcon aria-hidden="true" className={message.status === "running" || message.status === "pending" ? "is-spinning" : undefined} size={14} /> {statusLabel}</span>}
        {message.status === "failed" && onRetry && <button className="chat-retry-button" disabled={!onRetry} onClick={onRetry} type="button">Retry</button>}
      </div>
    </article>
  );
}

function chatMessageStatusLabel(status: ChatMessage["status"]): string {
  switch (status) {
    case "pending": return "Starting…";
    case "running": return "Working…";
    case "suspended": return "Waiting for approval";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

function ChatRunDetails({ error, events, onNewChat, run }: { error: string | null; events: readonly RunEvent[]; onNewChat: () => void; run: RunView }) {
  const progress = taskProgress(run);
  const toolEvents = events.filter((event) => /tool|skill|mcp/i.test(event.kind));
  const evidenceFiles = availableEvidenceFiles(run);
  const nativePlatform = run.executionReference?.platform;
  const native = nativePlatform === "restate" || nativePlatform === "langgraph" || nativePlatform === "mastra"
    ? run.executionReference?.native ?? null
    : null;
  const retrying = isRunRetrying(run, events);
  return (
    <details className="chat-run-details" open={run.status === "running" || run.status === "queued" || run.status === "suspended" || run.status === "reconciliation_required"}>
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
          {getRunSessionId(run) && <div><dt>Session</dt><dd title={getRunSessionId(run) ?? undefined}>{getRunSessionId(run)}</dd></div>}
          <div><dt>Platform status</dt><dd>{isStopRequested(run) ? "Stop requested" : formatRunStatus(run.status)}</dd></div>
          {progress.phase && <div><dt>Last observed phase</dt><dd>{progress.phase}</dd></div>}
          {progress.round !== null && <div><dt>Model round</dt><dd>{progress.round}</dd></div>}
          <div><dt>Tools completed</dt><dd>{progress.completedTools}</dd></div>
          {progress.modelCalls !== null && <div><dt>Recorded model calls</dt><dd>{progress.modelCalls}</dd></div>}
          {progress.toolAttempts !== null && <div><dt>Recorded tool attempts</dt><dd>{progress.toolAttempts}</dd></div>}
          {progress.deadlineAt && <div><dt>Task deadline</dt><dd>{new Date(progress.deadlineAt).toLocaleString()}</dd></div>}
          <div><dt>Projection</dt><dd>{run.projection.state === "stale" ? "Stale" : "Current"}</dd></div>
          <div><dt>Events</dt><dd>{events.length}</dd></div>
          <div><dt>Tools</dt><dd>{toolEvents.length}</dd></div>
        </dl>
        {native && nativePlatform && <NativeRunDetails native={native} platform={nativePlatform} variant={run.manifest.variant} />}
        <McpConnectionDetails events={events} />
        {run.projection.state === "stale" && <p className="chat-availability-error"><CircleAlert aria-hidden="true" size={14} /> {run.projection.reason ?? "The latest platform state is unavailable."}</p>}
        <details className="chat-activity" open={toolEvents.length > 0}>
          <summary><Wrench aria-hidden="true" size={13} /> Tool activity <small>{toolEvents.length}</small></summary>
          {toolEvents.length === 0 ? <p>No tool activity recorded.</p> : <ol>{toolEvents.map((event) => <li key={event.eventId}><ToolOutcomeDetails event={event} runId={run.runId} /></li>)}</ol>}
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

function ToolOutcomeDetails({ event, runId }: { event: RunEvent; runId: string }) {
  const outcome = toolOutcomeView(event.payload, event.kind);
  const connection = isRecord(event.payload.connection) ? event.payload.connection : null;
  const callId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : null;
  const name = typeof event.payload.toolName === "string" ? event.payload.toolName : formatEventKind(event.kind);
  if (!outcome.label && !outcome.presentation && !connection) return <><strong>{name} · {event.kind === "ToolExecutionCompleted" ? "Completed" : event.kind === "ToolExecutionStarted" ? "Running" : formatEventKind(event.kind)}</strong><small>{event.source}</small></>;
  return <details className="tool-outcome-details">
    <summary><strong>{name}</strong><span>{outcome.label ?? formatEventKind(event.kind)}</span></summary>
    <dl>
      {outcome.presentation && <div><dt>Response</dt><dd>{outcome.presentation}</dd></div>}
      {outcome.evidence && <div><dt>Evidence</dt><dd>{outcome.evidence}</dd></div>}
      {connection && typeof connection.requestId === "string" && <div><dt>Request</dt><dd>{connection.requestId}</dd></div>}
      {connection && Array.isArray(connection.providerRequestIds) && connection.providerRequestIds.length > 0 && <div><dt>Provider receipt</dt><dd>{connection.providerRequestIds.filter(value => typeof value === "string").join(", ")}</dd></div>}
    </dl>
    {outcome.uncertain && <p>Inspect the provider state before repeating this action.</p>}
    {callId && connection && <a href={getRunToolReceiptUrl(runId, callId)} target="_blank" rel="noreferrer">Inspect source receipt</a>}
    {event.payload.structuredContent !== undefined && <details><summary>Returned data</summary><pre>{JSON.stringify(event.payload.structuredContent, null, 2)}</pre></details>}
  </details>;
}

function McpConnectionDetails({ events }: { events: readonly RunEvent[] }) {
  const evidence = [...events].reverse().map(readMcpEvidence).find((value): value is McpEvidence => value !== null);
  if (!evidence) return null;
  return (
    <details className="chat-activity">
      <summary><span>MCP connection</span><small>{evidence.phase}</small></summary>
      <dl className="chat-run-meta">
        <div><dt>Server</dt><dd title={evidence.serverName}>{evidence.serverName}</dd></div>
        <div><dt>Tool</dt><dd title={evidence.toolName}>{evidence.toolName}</dd></div>
        <div><dt>Protocol</dt><dd>{evidence.protocolVersion}</dd></div>
        <div><dt>Version</dt><dd>{evidence.toolVersion}</dd></div>
        {evidence.endpointRef && <div><dt>Endpoint</dt><dd>{evidence.endpointRef}</dd></div>}
      </dl>
    </details>
  );
}

interface McpEvidence {
  readonly endpointRef: string | null;
  readonly serverName: string;
  readonly protocolVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly phase: string;
}

function readMcpEvidence(event: RunEvent): McpEvidence | null {
  const connection = isRecord(event.payload.connection) ? event.payload.connection : null;
  const mcp = connection && isRecord(connection.mcp) ? connection.mcp : null;
  if (!mcp || typeof mcp.serverName !== "string" || typeof mcp.toolName !== "string" || typeof mcp.protocolVersion !== "string" || typeof mcp.toolVersion !== "string" || typeof mcp.phase !== "string") return null;
  return {
    endpointRef: typeof mcp.endpointRef === "string" ? mcp.endpointRef : null,
    serverName: mcp.serverName,
    protocolVersion: mcp.protocolVersion,
    toolName: mcp.toolName,
    toolVersion: mcp.toolVersion,
    phase: mcp.phase,
  };
}

function NativeRunDetails({ native, platform, variant }: { native: Record<string, unknown>; platform: string; variant: string }) {
  const fields = platform === "langgraph"
    ? [
        { label: "Thread", value: native.threadId },
        { label: "Graph", value: native.graph },
        { label: "Event source", value: native.eventSource },
        { label: "Protocol", value: native.protocolVersion },
      ]
    : platform === "mastra"
      ? [
        { label: "Operation", value: native.operation },
        { label: "Workflow", value: variant === "workflow" ? native.workflowId : undefined },
        { label: "Native status", value: native.nativeStatus },
        { label: "Model steps", value: native.modelStepCount },
        { label: "Model requests", value: native.modelRequestCount },
        { label: "Tool calls", value: native.toolCallCount },
        { label: "Context", value: native.contextPrepared === true ? "prepared" : undefined },
      ]
      : [
        { label: "Workflow", value: native.workflowKey },
        { label: "Invocation", value: native.invocationId },
        { label: "Native status", value: native.nativeStatus },
        { label: "Retries", value: native.retryCount },
        { label: "Last observed", value: native.lastModifiedAt },
      ];
  const visibleFields = fields.flatMap(({ label, value }) => typeof value === "string" || typeof value === "number" ? [[label, value] as const] : []);
  if (visibleFields.length === 0) return null;
  return (
    <details className="chat-activity">
      <summary><span>Native execution</span><small>{platform === "langgraph" ? "LangGraph" : platform === "mastra" ? "Mastra" : "Restate"}</small></summary>
      <dl className="chat-run-meta">
        {visibleFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{String(value)}</dd></div>)}
      </dl>
    </details>
  );
}

function availableEvidenceFiles(run: RunView): readonly RunEvidenceFile[] {
  const files: RunEvidenceFile[] = [];
  files.push("config.json", "capabilities.json", "events.jsonl");
  files.push("logs/operations.jsonl");
  if (run.executionReference?.platform === "mastra") files.push("native/mastra.json");
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

function chatAvailabilityLabel({ connectivity, connectivityError, hasRunnableVariant, isReady, preservesSession, selectedModel }: { connectivity: PlatformConnectivity | null; connectivityError: string | null; hasRunnableVariant: boolean; isReady: boolean; preservesSession: boolean; selectedModel: ModelSelection | null }): string {
  if (!hasRunnableVariant) return "Platform not available yet.";
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

function hasCurrentApproval(approvals: readonly CapabilityApproval[], capabilityId: string, version: string): boolean {
  return approvals.some(approval => approval.capabilityId === capabilityId
    && approval.version === version
    && Date.parse(approval.expiresAt) > Date.now());
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
