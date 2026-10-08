import { useEffect, useRef, useState } from "react";
import { renewInvocation, decideInvocation, getInvocationReviews, type InvocationDecision, type InvocationReviewView, type RunView } from "./platformApi";
import { canReviewAction, invocationDecision } from "./connectedToolState";
import "./connected-tools.css";

export function InvocationReviewPanel({ run, onRun, onLoaded }: { readonly run: RunView; readonly onRun: (run: RunView) => void; readonly onLoaded: (hasActions: boolean) => void }) {
  const [actions, setActions] = useState<readonly InvocationReviewView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const decisions = useRef(new Map<string, InvocationDecision>());
  const callbacks = useRef({ onLoaded, onRun }); callbacks.current = { onLoaded, onRun };
  useEffect(() => {
    const controller = new AbortController(); let timeout: number | undefined;
    setActions([]); setError(null);
    async function refresh() {
      try {
        const next = await getInvocationReviews(run.runId, controller.signal);
        if (controller.signal.aborted) return;
        setActions(next); setNow(Date.now()); callbacks.current.onLoaded(next.length > 0); setError(null);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Action reviews unavailable."); }
      if (!controller.signal.aborted && ["created", "queued", "running", "suspended"].includes(run.status)) timeout = window.setTimeout(() => void refresh(), 1000);
    }
    void refresh();
    return () => { controller.abort(); if (timeout !== undefined) window.clearTimeout(timeout); };
  }, [run.runId, run.status]);
  async function decide(action: InvocationReviewView, choice: InvocationDecision["decision"]) {
    if (!canReviewAction(action)) return;
    const key = `${action.requestId}:${action.revision}:${choice}`;
    let decision = decisions.current.get(key);
    if (!decision) { decision = invocationDecision(action, choice, `decision_${crypto.randomUUID()}`); decisions.current.set(key, decision); }
    setBusy(action.requestId); setError(null);
    try {
      callbacks.current.onRun(await decideInvocation(run.runId, decision));
      const next = await getInvocationReviews(run.runId); setActions(next); callbacks.current.onLoaded(next.length > 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The decision could not be confirmed. Retry the same decision."); }
    finally { setBusy(null); }
  }
  async function continueDecision(action: InvocationReviewView) {
    if (!action.decision) return;
    setBusy(action.requestId); setError(null);
    try { callbacks.current.onRun(await decideInvocation(run.runId, action.decision)); setActions(await getInvocationReviews(run.runId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Native continuation is temporarily unavailable. Retry the retained decision."); }
    finally { setBusy(null); }
  }
  async function renew(action: InvocationReviewView) {
    setBusy(action.requestId); setError(null);
    try { callbacks.current.onRun(await renewInvocation(run.runId, action.requestId)); setActions(await getInvocationReviews(run.runId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Review renewal could not complete."); }
    finally { setBusy(null); }
  }
  if (actions.length === 0 && !error) return null;
  return <section className="invocation-review-panel" aria-label="Action review">
    {actions.map(action => <div className="invocation-review" key={action.requestId}>
      <header><strong>{action.call.name}</strong><span>{action.status === "pending" && !canReviewAction(action, now) ? "Review expired" : action.status.replaceAll("_", " ")}</span></header>
      <dl className="invocation-arguments">{Object.entries(action.displayArguments).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</dd></div>)}</dl>
      {action.decision && ["approved", "denied"].includes(action.status) && run.status === "suspended" && <button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void continueDecision(action)}>Continue reviewed action</button>}
      {action.status === "expired" && <button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void renew(action)}>Request fresh review</button>}
      {action.status === "pending" && <div className="invocation-review-actions">
        <small>Review expires {new Date(action.expiresAt).toLocaleTimeString()}</small>
        <button type="button" className="quiet-button" disabled={busy !== null || !canReviewAction(action, now)} onClick={() => void decide(action, "denied")}>Deny</button>
        <button type="button" className="button button-primary" disabled={busy !== null || !canReviewAction(action, now)} onClick={() => void decide(action, "approved")}>{busy === action.requestId ? "Submitting…" : "Approve action"}</button>
      </div>}
    </div>)}
    {error && <p className="chat-availability-error" role="alert">{error}</p>}
  </section>;
}
