import { useEffect, useRef, useState } from "react";
import { canReviewAction, invocationDecision } from "./connectedToolState";
import { decideInvocation, getInvocationReviews, renewInvocation, type InvocationDecision, type InvocationReviewView, type RunView } from "./platformApi";

/** One conversation controller polls all runs. Decisions remain bound to a revision, including after a lost response. */
export function useInvocationReviews(runs: Readonly<Record<string, RunView>>, conversationKey: string, onRun: (run: RunView) => void) {
  const [actions, setActions] = useState<Record<string, readonly InvocationReviewView[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, InvocationDecision>>({});
  const [now, setNow] = useState(Date.now());
  const runsRef = useRef(runs); runsRef.current = runs;
  const callback = useRef(onRun); callback.current = onRun;
  const scope = useRef(new AbortController());
  const decisions = useRef(new Map<string, InvocationDecision>());
  const submitting = useRef(false);
  const fetched = useRef(new Map<string, string>());
  const key = (action: InvocationReviewView) => `${action.runId}:${action.requestId}:${action.revision}`;
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    fetched.current.clear(); decisions.current.clear(); submitting.current = false;
    setActions({}); setErrors({}); setUncertain({}); setBusy(null);
    let timeout: number | undefined;
    async function poll() {
      await Promise.all(Object.values(runsRef.current).map(async run => {
        if (fetched.current.get(run.runId) === run.status && !["created", "queued", "running", "suspended"].includes(run.status)) return;
        try {
          const next = await getInvocationReviews(run.runId, controller.signal);
          if (controller.signal.aborted) return;
          fetched.current.set(run.runId, run.status);
          setActions(current => ({ ...current, [run.runId]: next }));
          setErrors(current => { const copy = { ...current }; delete copy[run.runId]; return copy; });
        } catch (cause) {
          if (!controller.signal.aborted) setErrors(current => ({ ...current, [run.runId]: message(cause) }));
        }
      }));
      if (!controller.signal.aborted) { setNow(Date.now()); timeout = window.setTimeout(() => void poll(), 1000); }
    }
    void poll();
    return () => { controller.abort(); if (timeout !== undefined) window.clearTimeout(timeout); };
  }, [conversationKey]);
  async function submit(action: InvocationReviewView, choice?: InvocationDecision["decision"], renewal = false) {
    if (submitting.current || scope.current.signal.aborted) return;
    const identity = key(action);
    if (choice && (!canReviewAction(action) || uncertain[identity])) return;
    let decision = action.decision ?? decisions.current.get(identity);
    if (choice && !decision) { decision = invocationDecision(action, choice, `decision_${crypto.randomUUID()}`); decisions.current.set(identity, decision); }
    if (!renewal && !decision) return;
    const controller = scope.current;
    submitting.current = true; setBusy(identity);
    try {
      const run = renewal ? await renewInvocation(action.runId, action.requestId, controller.signal) : await decideInvocation(action.runId, decision!, controller.signal);
      if (!controller.signal.aborted) callback.current(run);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setErrors(current => ({ ...current, [action.runId]: message(cause) }));
        if (decision) setUncertain(current => ({ ...current, [identity]: decision! }));
      }
    } finally {
      // A failed submission may already be durable. Refetch before exposing a conflicting choice.
      try {
        const next = await getInvocationReviews(action.runId, controller.signal);
        if (!controller.signal.aborted) {
          setActions(current => ({ ...current, [action.runId]: next }));
          const persisted = next.find(value => key(value) === identity);
          if (persisted?.decision || persisted?.status !== "pending") setUncertain(current => { const copy = { ...current }; delete copy[identity]; return copy; });
        }
      } catch { /* Retain the decision and allow only retrying that exact decision. */ }
      if (!controller.signal.aborted) { submitting.current = false; setBusy(null); }
    }
  }
  return { actions, errors, busy, uncertain, now, submit };
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : "Action review unavailable. Inspect persisted state before continuing."; }
