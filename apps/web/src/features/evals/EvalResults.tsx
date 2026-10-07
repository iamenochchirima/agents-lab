import React, { useEffect, useState } from "react";
import { evalEvidenceUrl, getSavedEvals, type EvalMode, type SavedEvalInvocation } from "./evalResultsApi";

const taskLabels: Readonly<Record<string, string>> = {
  L01: "Prompt completion", L02: "Calculator use", L03: "Context continuation",
  B01: "Prompt completion", B02: "Calculator use", B03: "Context continuation", B07: "Tool budget",
};

/** Display only persisted summaries, including cases that could not start a run. */
export function SavedEvalResults({ invocations }: { invocations: readonly SavedEvalInvocation[] }) {
  return <div className="evals-saved-list">
    {invocations.map(invocation => <article key={invocation.invocationId} className="evals-invocation">
      <header>
        <div><h3>{invocation.platform}<span>{invocation.mode === "live" ? "Live model" : invocation.mode === "scripted" ? "Scripted" : "Unknown execution"}</span></h3>
          <p>{invocation.modelId ?? (invocation.mode === "scripted" ? "Scripted model" : "Model identity unavailable")}</p></div>
        <time dateTime={invocation.startedAt}>{new Date(invocation.startedAt).toLocaleString()}</time>
      </header>
      {invocation.status === "incomplete" && <p className="evals-summary-issue">Incomplete invocation. {invocation.summaryIssue}</p>}
      <div className="evals-verdict-counts" aria-label="Recorded verdicts">
        {(["pass", "fail", "blocked", "error"] as const).map(verdict => <span key={verdict}>
          {invocation.counts[verdict]} {verdict}
        </span>)}
      </div>
      {invocation.cases.map(item => <details key={`${item.caseId}-${item.trial}`}>
        <summary><code>{item.caseId}</code><strong>{taskLabels[item.caseId] ?? item.caseId}</strong>
          <span>Trial {item.trial}</span><span className={`evals-verdict evals-verdict-${item.verdict}`}>{item.verdict}</span></summary>
        <div className="evals-trial-detail">
          {item.reason && <p>{item.reason}</p>}
          {item.runIds.length === 0 ? <p>No run was admitted. There is no run evidence for this trial.</p> :
            item.runIds.map((runId, index) => <div className="evals-evidence-links" key={runId}>
              <code>Run {index + 1}: {runId}</code>
              {index === 0 && item.evidence && <a href={evalEvidenceUrl(runId, "artifacts/eval.json")} target="_blank" rel="noreferrer">Verdict and assertions</a>}
              <a href={evalEvidenceUrl(runId, "trajectory.json")} target="_blank" rel="noreferrer">Trajectory</a>
              <a href={evalEvidenceUrl(runId, "events.jsonl")} target="_blank" rel="noreferrer">Model and tool events</a>
              <a href={evalEvidenceUrl(runId, "context.json")} target="_blank" rel="noreferrer">Context</a>
            </div>)}
          <small>Invocation <code>{invocation.invocationId}</code>{invocation.suiteVersion && ` · ${invocation.suiteVersion}`}</small>
        </div>
      </details>)}
    </article>)}
  </div>;
}

export function EvalResults() {
  const [invocations, setInvocations] = useState<readonly SavedEvalInvocation[]>([]);
  const [mode, setMode] = useState<EvalMode | "all">("all");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanTruncated, setScanTruncated] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getSavedEvals(controller.signal).then(result => {
      setInvocations(result.invocations);
      setScanTruncated(result.scanTruncated ?? false);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Saved evals could not be read.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const visible = invocations.filter(invocation => mode === "all" || invocation.mode === mode);
  return <section className="evals-results" aria-labelledby="evals-results-title">
    <div className="evals-heading"><div><h2 id="evals-results-title">Saved results</h2><p>Recent retained trials. A single trial is development feedback, not a reliability score.</p></div>
      <div className="evals-result-controls"><label>Execution<select value={mode} onChange={event => setMode(event.target.value as EvalMode | "all")}>
        <option value="all">All results</option><option value="live">Live model</option><option value="scripted">Scripted</option>
      </select></label><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div></div>
    <div aria-live="polite">
      {loading && <p className="evals-empty">Reading saved results…</p>}
      {error && <p className="evals-empty" role="alert">{error} Start or check the lab server, then refresh.</p>}
      {!loading && !error && scanTruncated && <p className="evals-empty">The result index exceeds the scan limit. This view shows a bounded subset of retained invocations.</p>}
      {!loading && !error && visible.length === 0 && <p className="evals-empty">No saved {mode === "all" ? "eval" : mode} results found. Run the development eval command to collect evidence.</p>}
    </div>
    {!error && <SavedEvalResults invocations={visible.slice(0, 5)} />}
    {!error && visible.length > 5 && <details className="evals-older-results"><summary>Older invocations ({visible.length - 5})</summary><SavedEvalResults invocations={visible.slice(5)} /></details>}
  </section>;
}
