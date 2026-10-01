import { ArrowDown, Calculator, Check, CircleAlert, LoaderCircle, MessageSquareText, MousePointer2, RotateCw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import type { StudioChatApiError, StudioChatAssembly, StudioChatMessage, StudioChatTurnResponse } from "@agent-harness-lab/studio-http-contract";
import { clearStudioChatSession, getStudioChatAssembly, runStudioCalculatorScenario, runStudioComputerScenario, StudioApiRequestError, submitStudioChatTurn } from "./studioApi";
import "./studio-chat.css";

interface StudioChatEntry {
  readonly requestId: string;
  readonly text: string;
  readonly remember: boolean;
  readonly kind: "replay" | "calculator" | "computer";
  readonly response?: StudioChatTurnResponse;
  readonly error?: string;
  readonly errorCode?: string;
  readonly failureEvidence?: StudioChatApiError["evidence"];
}

const componentLabels: Readonly<Record<StudioChatAssembly["components"][number]["area"], string>> = {
  input: "Input",
  memory: "Memory",
  context: "Context",
  planning: "Planning",
  control: "Control",
  "tool-use": "Tool Use",
  "computer-use": "Computer Use",
  safety: "Safety",
  "execution-environment": "Execution Environment",
  "output-actions": "Output / Actions",
  "model-interface": "Model Interface",
  observability: "Observability",
};

function createId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof StudioApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "The Studio API request failed. Check that the local Studio API is running.";
}

function usageValue(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString();
}

function evidenceJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "Unavailable";
}

function fixtureScenario(response: StudioChatTurnResponse): "calculator" | "computer" | null {
  for (const call of response.modelCalls) {
    const detail = call.response.providerDetail;
    if (!isRecord(detail)) continue;
    if (detail.scenarioId === "calculator-round-trip") return "calculator";
    if (detail.scenarioId === "computer-click-round-trip") return "computer";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageDetail(message: StudioChatMessage): string {
  const sections: string[] = [];
  if (message.content !== null) sections.push(message.content);
  if (message.name) sections.push(`name: ${message.name}`);
  if (message.toolCallId) sections.push(`tool call ID: ${message.toolCallId}`);
  if (message.toolCalls?.length) sections.push(`tool calls:\n${evidenceJson(message.toolCalls)}`);
  return sections.join("\n\n") || "No text content";
}

function StudioChatEvidence({ response }: { readonly response: StudioChatTurnResponse }) {
  const receipt = response.memory.writeReceipt;
  const scenario = fixtureScenario(response);
  const fixtureRun = scenario !== null;

  return (
    <details className="studio-chat-evidence">
      <summary><span>Turn evidence</span><small>{response.modelCalls.length} model call{response.modelCalls.length === 1 ? "" : "s"} · {response.control.toolCalls} tool calls</small></summary>
      <div className="studio-chat-evidence-body">
        <section className="studio-chat-evidence-section">
          <h3>Assembly used for this run</h3>
          <p className="studio-memory-candidate-count">{response.assembly.id} · v{response.assembly.version} · {response.assembly.mode}</p>
          <ul className="studio-chat-evidence-components">{response.assembly.components.map((component) => (
            <li key={component.area}><strong>{component.area}</strong><span>{component.packageName}@{component.packageVersion} · {component.implementation.id}@{component.implementation.version}</span></li>
          ))}</ul>
        </section>

        <section className="studio-chat-evidence-section">
          <h3>Run record</h3>
          <p className="studio-memory-candidate-count">{response.observability.status} · {response.observability.eventsAttempted} ordered events · {response.observability.recorder?.id ?? "no recorder"}</p>
          {response.observability.failure && <p className="studio-evidence-note">Recorder: {response.observability.failure.message}</p>}
          <details className="studio-model-exchange-detail"><summary>Persistence receipts</summary>
            <pre>{evidenceJson({ appendReceipts: response.observability.appendReceipts, flushReceipt: response.observability.flushReceipt })}</pre>
          </details>
        </section>

        <section className="studio-chat-evidence-section">
          <h3>Planning proposal</h3>
          <p className="studio-memory-candidate-count">{response.planning.module.id} · v{response.planning.module.version}</p>
          <p className="studio-planning-summary">{response.planning.proposal.summary}</p>
          <ol className="studio-planning-steps">{response.planning.proposal.steps.map((step) => (
            <li key={step.stepId}><strong>{step.kind}</strong><span>{step.description}</span>{step.target && <code>{step.target}</code>}</li>
          ))}</ol>
          <p className="studio-evidence-note">Completion condition: {response.planning.proposal.completionCondition}</p>
          <details className="studio-model-exchange-detail"><summary>Planning input and source IDs</summary>
            <pre>{evidenceJson(response.planning.input)}</pre>
          </details>
        </section>

        {response.modelCalls.map((call, callIndex) => {
          const included = call.context.sourceLedger.filter((source) => source.disposition.status === "included");
          const omitted = call.context.sourceLedger.filter((source) => source.disposition.status === "omitted");
          return (
            <section className="studio-chat-evidence-section" key={`model-call-${callIndex}`}>
              <h3>Model call {callIndex + 1} · exact Context and messages</h3>
              <ol className="studio-context-messages">
                {call.context.messages.map((message, index) => (
                  <li key={`${index}-${message.sourceIds.join("-")}-${message.toolCallId ?? ""}`}>
                    <div className="studio-evidence-label"><strong>{message.role}</strong><span>{message.sourceIds.join(", ") || "No source ID"}</span></div>
                    <pre>{messageDetail(message)}</pre>
                  </li>
                ))}
              </ol>
              <div className="studio-source-groups">
                <div>
                  <h4><Check aria-hidden="true" size={13} /> Included ({included.length})</h4>
                  {included.length === 0 ? <p className="studio-evidence-empty">No sources included.</p> : (
                    <ul>{included.map((source) => <li key={source.sourceId}><code>{source.sourceId}</code><span>{source.kind} · {source.role} · {source.trust}</span></li>)}</ul>
                  )}
                </div>
                <div>
                  <h4><ArrowDown aria-hidden="true" size={13} /> Omitted ({omitted.length})</h4>
                  {omitted.length === 0 ? <p className="studio-evidence-empty">No sources omitted.</p> : (
                    <ul>{omitted.map((source) => source.disposition.status === "omitted" ? (
                      <li key={source.sourceId}><code>{source.sourceId}</code><span>{source.kind} · {source.disposition.reason}</span></li>
                    ) : null)}</ul>
                  )}
                </div>
              </div>
              <p className="studio-evidence-token-count">Context estimate: {call.context.tokenCount.value.toLocaleString()} tokens · {call.context.tokenCount.quality} · {call.context.tokenCount.basis}</p>
              <details className="studio-model-exchange-detail"><summary>Model Interface request and response</summary>
                <pre>{evidenceJson({ request: call.request, response: call.response })}</pre>
              </details>
            </section>
          );
        })}

        <section className="studio-chat-evidence-section">
          <h3>Session Memory</h3>
          <p className="studio-memory-candidate-count">Recall returned {response.memory.candidates.length} candidate{response.memory.candidates.length === 1 ? "" : "s"} at revision {response.memory.stateRevision}.</p>
          {response.memory.candidates.length > 0 && (
            <ul className="studio-memory-candidates">{response.memory.candidates.map((candidate) => (
              <li key={candidate.record.recordId}><code>{candidate.record.recordId}</code><span>{candidate.record.content}</span><small>{candidate.reason}</small></li>
            ))}</ul>
          )}
          {receipt === null ? <p className="studio-evidence-empty">No memory write receipt was returned.</p> : (
            <dl className="studio-memory-receipt">
              <div><dt>Write outcome</dt><dd>{receipt.outcome}</dd></div>
              <div><dt>Memory revision</dt><dd>{receipt.stateRevision}</dd></div>
              <div><dt>Stored records</dt><dd>{receipt.storedRecordIds.length ? receipt.storedRecordIds.join(", ") : "None"}</dd></div>
              <div><dt>Skipped observations</dt><dd>{receipt.skippedObservations.length ? receipt.skippedObservations.map((item) => `${item.observationId} (${item.reason})`).join(", ") : "None"}</dd></div>
            </dl>
          )}
        </section>

        <section className="studio-chat-evidence-section">
          <h3>{fixtureRun ? `${scenario === "computer" ? "Computer" : "Calculator"} fixture model usage` : "Deterministic Replay model usage"}</h3>
          <dl className="studio-model-usage">
            <div><dt>Model role</dt><dd>{response.model.name}</dd></div>
            <div><dt>Adapter</dt><dd>{response.model.adapter.id} · v{response.model.adapter.version}</dd></div>
            <div><dt>Usage basis</dt><dd>{response.model.usage.basis}</dd></div>
            <div><dt>Input tokens</dt><dd>{usageValue(response.model.usage.inputTokens)}</dd></div>
            <div><dt>Output tokens</dt><dd>{usageValue(response.model.usage.outputTokens)}</dd></div>
            <div><dt>Total tokens</dt><dd>{usageValue(response.model.usage.totalTokens)}</dd></div>
            <div><dt>Finish reason</dt><dd>{response.model.finishReason}</dd></div>
            <div><dt>Control outcome</dt><dd>{response.control.termination}</dd></div>
          </dl>
          <p className="studio-evidence-note">{scenario === "computer" ? "The fixture emits one fixed computer click, then checks the correlated action and verified page change; it makes no external LLM request." : scenario === "calculator" ? "The fixture emits one fixed calculator call and checks its correlated result; it makes no external LLM request." : "Replay reports what reached the Model Interface; it makes no external LLM request."} Token figures are shown with the basis returned by the adapter.</p>
        </section>

        {response.runEvidence.length > 0 && <section className="studio-chat-evidence-section">
          <h3>Run evidence</h3>
          <ol className="studio-tool-evidence-list">{response.runEvidence.map((item, index) => {
            const kind = typeof item === "object" && item !== null && "kind" in item && typeof item.kind === "string" ? item.kind : "Tool event";
            return <li key={`${kind}-${index}`}><strong>{kind}</strong><pre>{evidenceJson(item)}</pre></li>;
          })}</ol>
        </section>}
      </div>
    </details>
  );
}

function StudioChatTurn({ entry, pending }: { readonly entry: StudioChatEntry; readonly pending: boolean }) {
  return (
    <article className="studio-chat-turn" aria-label="Chat turn">
      <div className="studio-chat-message studio-chat-message-user">
          <span className="studio-chat-message-label">{entry.kind !== "replay" ? "Named scenario" : "You"}</span>
          <p>{entry.kind !== "replay" ? entry.response?.input.task ?? entry.text : entry.text}</p>
          <small>{entry.kind !== "replay" ? "Fixed task · no Memory write requested" : entry.remember ? "Save to session Memory requested" : "Not saved to session Memory"}</small>
      </div>
      {entry.response && (
        <div className="studio-chat-message studio-chat-message-assistant">
          <span className="studio-chat-message-label">{fixtureScenario(entry.response) === "computer" ? "Deterministic computer fixture" : fixtureScenario(entry.response) === "calculator" ? "Deterministic calculator fixture" : "Deterministic Replay"}</span>
          <p>{entry.response.assistantMessage.content}</p>
          <StudioChatEvidence response={entry.response} />
        </div>
      )}
      {pending && <div className="studio-chat-pending" role="status"><LoaderCircle aria-hidden="true" className="studio-chat-spinner" size={15} /> Preparing this turn with the selected Studio modules…</div>}
      {entry.error && <div className="studio-chat-turn-error" role="alert"><CircleAlert aria-hidden="true" size={15} /> <span>{entry.error}{entry.errorCode ? ` (${entry.errorCode})` : ""}</span>
        {entry.failureEvidence && <details className="studio-chat-failure-evidence"><summary>Partial run evidence</summary><pre>{evidenceJson(entry.failureEvidence)}</pre></details>}
      </div>}
    </article>
  );
}

export function StudioChatPage() {
  const [assembly, setAssembly] = useState<StudioChatAssembly | null>(null);
  const [assemblyLoading, setAssemblyLoading] = useState(true);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => createId("studio-conversation"));
  const [entries, setEntries] = useState<StudioChatEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const endOfThread = useRef<HTMLDivElement>(null);

  async function loadAssembly(signal?: AbortSignal) {
    setAssemblyLoading(true);
    setAssemblyError(null);
    try {
      const result = await getStudioChatAssembly(signal);
      setAssembly(result.assembly);
    } catch (error) {
      if (signal?.aborted) return;
      setAssemblyError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setAssemblyLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadAssembly(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    endOfThread.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries, busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy || clearing || !assembly) return;

    const requestId = createId("studio-request");
    const entry: StudioChatEntry = { requestId, text, remember, kind: "replay" };
    setEntries((current) => [...current, entry]);
    setPrompt("");
    setRemember(false);
    setPageError(null);
    setBusy(true);
    try {
      const response = await submitStudioChatTurn({ conversationId, requestId, text, remember });
      if (response.conversationId !== conversationId || response.requestId !== requestId) {
        throw new Error("Studio returned a response for a different chat turn.");
      }
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? { ...candidate, response } : candidate));
    } catch (error) {
      const message = errorMessage(error);
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? {
        ...candidate,
        error: message,
        ...(error instanceof StudioApiRequestError ? { errorCode: error.code, failureEvidence: error.evidence } : {}),
      } : candidate));
    } finally {
      setBusy(false);
    }
  }

  async function runCalculator() {
    if (busy || clearing || !assembly) return;
    const requestId = createId("studio-calculator");
    const entry: StudioChatEntry = {
      requestId,
      text: "Run the fixed calculator scenario (19 + 23).",
      remember: false,
      kind: "calculator",
    };
    setEntries((current) => [...current, entry]);
    setPageError(null);
    setBusy(true);
    try {
      const response = await runStudioCalculatorScenario({ conversationId, requestId });
      if (response.conversationId !== conversationId || response.requestId !== requestId) {
        throw new Error("Studio returned a response for a different calculator scenario.");
      }
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? { ...candidate, response } : candidate));
    } catch (error) {
      const message = errorMessage(error);
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? {
        ...candidate,
        error: message,
        ...(error instanceof StudioApiRequestError ? { errorCode: error.code, failureEvidence: error.evidence } : {}),
      } : candidate));
    } finally {
      setBusy(false);
    }
  }

  async function runComputer() {
    if (busy || clearing || !assembly) return;
    const requestId = createId("studio-computer");
    const entry: StudioChatEntry = {
      requestId,
      text: "Run the fixed computer scenario against the controlled page.",
      remember: false,
      kind: "computer",
    };
    setEntries((current) => [...current, entry]);
    setPageError(null);
    setBusy(true);
    try {
      const response = await runStudioComputerScenario({ conversationId, requestId });
      if (response.conversationId !== conversationId || response.requestId !== requestId) {
        throw new Error("Studio returned a response for a different computer scenario.");
      }
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? { ...candidate, response } : candidate));
    } catch (error) {
      const message = errorMessage(error);
      setEntries((current) => current.map((candidate) => candidate.requestId === requestId ? {
        ...candidate,
        error: message,
        ...(error instanceof StudioApiRequestError ? { errorCode: error.code, failureEvidence: error.evidence } : {}),
      } : candidate));
    } finally {
      setBusy(false);
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function startNewChat() {
    if (busy || clearing) return;
    setClearing(true);
    setPageError(null);
    try {
      await clearStudioChatSession(conversationId);
      setConversationId(createId("studio-conversation"));
      setEntries([]);
      setPrompt("");
      setRemember(false);
    } catch (error) {
      setPageError(errorMessage(error));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="studio-chat-page">
      <header className="studio-chat-heading">
        <div>
          <span className="studio-chat-eyebrow">Studio / assembled reference agent</span>
          <h1>Assembly chat</h1>
          <p>Send a message through the currently connected modules and inspect the exact Context and Memory decisions for each turn.</p>
        </div>
        <button className="studio-chat-new-button" disabled={busy || clearing} onClick={() => void startNewChat()} type="button">
          {clearing ? <LoaderCircle className="studio-chat-spinner" size={15} /> : <Trash2 aria-hidden="true" size={15} />}
          {clearing ? "Clearing…" : "New chat"}
        </button>
      </header>

      <div className="studio-replay-notice" role="note">
        <span className="studio-replay-mark"><MessageSquareText aria-hidden="true" size={17} /></span>
        <div><strong>Deterministic fixtures · no external LLM</strong><p>Free-text Replay reports what reached the Model Interface. The Calculator and Computer scenarios exercise tool dispatch, Safety, and the controlled Execution Environment through the same assembly.</p></div>
      </div>

      <section className="studio-chat-assembly" aria-label="Connected modules">
          <div className="studio-chat-section-heading"><div><span className="studio-chat-eyebrow">Current assembly</span><h2>{assembly?.id ?? (assemblyLoading ? "Loading assembly…" : "Assembly unavailable")}</h2></div>
          {assembly && <span className="studio-chat-assembly-version">v{assembly.version}</span>}
        </div>
        {assemblyLoading && <p className="studio-chat-loading" role="status"><LoaderCircle className="studio-chat-spinner" size={15} /> Loading the Studio assembly…</p>}
        {assemblyError && (
          <div className="studio-chat-api-error" role="alert"><CircleAlert aria-hidden="true" size={16} /><span>{assemblyError}</span><button onClick={() => void loadAssembly()} type="button"><RotateCw aria-hidden="true" size={14} /> Retry</button></div>
        )}
        {assembly && <>
          <ul className="studio-chat-module-list">
            {assembly.components.map((component) => (
              <li key={component.area}>
                <span className="studio-chat-module-area">{componentLabels[component.area]}</span>
                <strong>{component.implementation.id}</strong>
                <small>{component.packageName}@{component.packageVersion} · {component.implementation.id}@{component.implementation.version}</small>
              </li>
            ))}
          </ul>
          {assembly.limitations.length > 0 && <details className="studio-chat-limitations"><summary>Assembly limitations</summary><ul>{assembly.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>}
        </>}
      </section>

      {pageError && <div className="studio-chat-api-error" role="alert"><CircleAlert aria-hidden="true" size={16} /><span>{pageError}</span></div>}

      <section aria-label="Conversation" className="studio-chat-thread">
        {entries.length === 0 && !assemblyError && (
          <div className="studio-chat-empty"><MessageSquareText aria-hidden="true" size={21} /><h2>Try a message</h2><p>Send free text through the reference assembly, or run a fixed Calculator or Computer scenario to inspect a complete action round trip.</p></div>
        )}
        {entries.map((entry) => <StudioChatTurn key={entry.requestId} entry={entry} pending={busy && entry === entries[entries.length - 1] && !entry.response && !entry.error} />)}
        <div ref={endOfThread} />
      </section>

      <form className="studio-chat-composer" onSubmit={(event) => void submit(event)}>
        <label className="studio-chat-prompt-label" htmlFor="studio-chat-prompt">Message</label>
        <textarea
          id="studio-chat-prompt"
          aria-label="Message"
          autoComplete="off"
          disabled={!assembly || assemblyLoading || busy || clearing}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder="Send a message to the reference assembly…"
          value={prompt}
        />
        <div className="studio-chat-composer-footer">
          <div className="studio-chat-memory-choice">
            <label><input checked={remember} disabled={!assembly || busy || clearing} onChange={(event) => setRemember(event.target.checked)} type="checkbox" /> Save this message to session Memory</label>
            <small>Memory is in-process and is cleared when you start a new chat or restart the API.</small>
          </div>
          <div className="studio-chat-actions">
            <button className="studio-chat-scenario-button" disabled={!assembly || assemblyLoading || busy || clearing} onClick={() => void runCalculator()} type="button">
              {busy ? <LoaderCircle className="studio-chat-spinner" size={15} /> : <Calculator aria-hidden="true" size={15} />}{busy ? "Running…" : "Run calculator scenario"}
            </button>
            <button className="studio-chat-scenario-button" disabled={!assembly || assemblyLoading || busy || clearing} onClick={() => void runComputer()} type="button">
              {busy ? <LoaderCircle className="studio-chat-spinner" size={15} /> : <MousePointer2 aria-hidden="true" size={15} />}{busy ? "Running…" : "Run computer scenario"}
            </button>
            <button className="studio-chat-send-button" disabled={!assembly || assemblyLoading || busy || clearing || !prompt.trim()} type="submit">
              {busy ? <LoaderCircle className="studio-chat-spinner" size={15} /> : <Send aria-hidden="true" size={15} />}{busy ? "Preparing…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
