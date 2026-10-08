import React, { useEffect, useState } from "react";
import { evalEvidenceUrl, getSavedEvals, getEvalTrialDetail, type EvalTrialDetail, type SavedEvalCase, type EvalMode, type SavedEvalInvocation } from "./evalResultsApi";

const taskLabels: Readonly<Record<string, string>> = {
  L01: "Prompt completion", L02: "Calculator use", L03: "Context continuation",
  L04: "Tool-error feedback", L05: "Missing information", L06: "Untrusted tool content",
  B04: "Session isolation", B05: "Tool validation", B06: "Permissions", B08: "Failure handling", B09: "Cancellation", B10: "Submission identity", B11: "Evidence integrity", B12: "Dispatch uncertainty",
  B01: "Prompt completion", B02: "Calculator use", B03: "Context continuation", B07: "Tool budget",
};

/** Display only persisted summaries, including cases that could not start a run. */
export function SavedEvalResults({ invocations }: { invocations: readonly SavedEvalInvocation[] }) {
  return <div className="evals-saved-list">
    {invocations.map(invocation => <article key={invocation.invocationId} className="evals-invocation">
      <header>
        <div><h3>{invocation.platform === "multiple" ? "Multiple platforms" : invocation.platform}<span>{invocation.mode === "capability-acceptance" ? "Business workflows" : invocation.mode === "live" ? "Live model" : invocation.mode === "scripted" ? "Scripted" : "Unknown execution"}</span></h3>
          <p>{invocation.modelId ?? (invocation.mode === "scripted" ? "Scripted model" : "Model identity unavailable")}</p></div>
        <time dateTime={invocation.startedAt}>{new Date(invocation.startedAt).toLocaleString()}</time>
      </header>
      {invocation.status === "incomplete" && <p className="evals-summary-issue">Incomplete invocation. {invocation.summaryIssue}</p>}
      <p className="evals-comparison-status">{invocation.comparisonKey ? "Recorded controls available for comparison" : `Not comparable: ${invocation.comparisonIssue ?? "Common controls are missing."}`}</p>
      <div className="evals-verdict-counts" aria-label="Recorded verdicts">
        {(["pass", "fail", "blocked", "error"] as const).map(verdict => <span key={verdict}>
          {invocation.counts[verdict]} {verdict}
        </span>)}
      </div>
      {invocation.cases.map(item => <TrialResult key={`${item.caseId}-${item.trial}`} invocation={invocation} item={item} />)}
    </article>)}
  </div>;
}

function TrialResult({ invocation, item }: { invocation: SavedEvalInvocation; item: SavedEvalCase }) {
  const [expanded, setExpanded] = useState(false);
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary><code>{item.caseId}</code><strong>{item.task === "support" ? "Reviewed customer adjustment" : item.task === "workspace" ? "Document report and correction" : item.task === "service" ? "Connected service workflow" : taskLabels[item.caseId] ?? item.caseId}</strong>
          <span>{item.platform ? `${item.platform} · ` : ""}Trial {item.trial}</span><span className={`evals-verdict evals-verdict-${item.verdict}`}>{item.reviewRequired ? "Review required" : item.verdict}</span></summary>
        <div className="evals-trial-detail">
          {item.reason && <p>{item.reason}</p>}
          {item.statuses && item.statuses.length > 0 && <p>Recorded run outcomes: {item.statuses.join(" → ")}</p>}
          {item.runIds.length === 0 ? <p>No run was admitted. There is no run evidence for this trial.</p> :
            item.runIds.map((runId, index) => <div className="evals-evidence-links" key={runId}>
              <code>Run {index + 1}: {runId}</code>
              {index === 0 && item.evidence && <a href={evalEvidenceUrl(runId, item.evidence === "artifacts/eval-grader-3.json" ? "artifacts/eval-grader-3.json" : "artifacts/eval.json")} target="_blank" rel="noreferrer">Verdict and assertions</a>}
              <a href={evalEvidenceUrl(runId, "trajectory.json")} target="_blank" rel="noreferrer">Trajectory</a>
              <a href={evalEvidenceUrl(runId, "events.jsonl")} target="_blank" rel="noreferrer">Model and tool events</a>
              <a href={evalEvidenceUrl(runId, "context.json")} target="_blank" rel="noreferrer">Context</a>
            </div>)}
          {expanded && (item.runIds.length > 0 || invocation.mode === "capability-acceptance") && <TrialInspector invocation={invocation} item={item} />}
          <small>Invocation <code>{invocation.invocationId}</code>{invocation.suiteVersion && ` · suite ${invocation.suiteVersion}`}{invocation.graderVersion && ` · grader ${invocation.graderVersion}`}{invocation.sourceInvocationId && <> · Regraded from <code>{invocation.sourceInvocationId}</code></>}</small>
        </div>
      </details>;
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Project only actual retained fixture receipts; absent counters stay unavailable. */
function FixtureEvidence({ observations }: { observations: readonly unknown[] }) {
  const snapshots = observations.filter(objectValue).flatMap(observation => Array.isArray(observation.fixtureSnapshots) ? observation.fixtureSnapshots.filter(objectValue) : []);
  if (snapshots.length === 0) return null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "Unavailable";
  return <section aria-label="Recorded fixture effects"><h4>Fixture effects</h4>
    {snapshots.map((snapshot, index) => <details key={index}>
      <summary>{typeof snapshot.probe === "string" ? snapshot.probe : `Fixture ${index + 1}`} · Effects: {count(snapshot.effectCount)}</summary>
      {typeof snapshot.namespace === "string" && <p>Namespace <code>{snapshot.namespace}</code></p>}
      {(snapshot.lookupCount !== undefined || snapshot.writeAttemptCount !== undefined) && <p>Lookups: {count(snapshot.lookupCount)} · Write attempts: {count(snapshot.writeAttemptCount)}</p>}
      <div className="evals-assertion-values"><div><strong>Before</strong>{snapshot.before !== undefined ? <pre>{JSON.stringify(snapshot.before, null, 2)}</pre> : <p>Unavailable</p>}</div><div><strong>After</strong>{snapshot.after !== undefined ? <pre>{JSON.stringify(snapshot.after, null, 2)}</pre> : <p>Unavailable</p>}</div></div>
    </details>)}
  </section>;
}

function ReviewEvidence({ detail }: { detail: EvalTrialDetail }) {
  if (!detail.case.reviewRequired && !detail.report?.reviewRequired) return null;
  const observations = (detail.report?.observations ?? []).filter(objectValue);
  const rubrics = [...new Set(observations.flatMap(observation => {
    const rubric = objectValue(observation.fixture) ? observation.fixture.reviewRubric : observation.reviewRubric;
    return typeof rubric === "string" && rubric.length > 0 ? [rubric] : [];
  }))];
  const answers = observations.flatMap(observation => Array.isArray(observation.runs) ? observation.runs.filter(objectValue).filter(run => typeof run.output === "string" && run.output.length > 0) : []);
  return <details open><summary>Human review evidence</summary>
    {rubrics.length > 0 ? rubrics.map(rubric => <p key={rubric}>{rubric}</p>) : <p>No review rubric was retained.</p>}
    {answers.map((run, index) => <div key={index}><strong>{index === 0 ? "Challenge answer" : `Control answer ${index}`}</strong><pre>{String(run.output)}</pre></div>)}
    {answers.length === 0 && <p>No final answer was retained in the task observations.</p>}
  </details>;
}

export function TrialDetailView({ detail }: { detail: EvalTrialDetail }) {
  return <div className="evals-inspector">
    {detail.issues.map(issue => <p key={issue} role="status">{issue}</p>)}
    {(detail.case.reviewRequired || detail.report?.reviewRequired) && <p>Review required. This trial remains blocked until its answer is assessed.</p>}
    <ReviewEvidence detail={detail} />
    <FixtureEvidence observations={detail.report?.observations ?? []} />
    <h4>Assertions</h4>
    {detail.report?.assertions?.map(assertion => <details key={assertion.id} open={!assertion.passed}>
      <summary><span className={`evals-verdict evals-verdict-${assertion.passed ? "pass" : "fail"}`}>{assertion.passed ? "pass" : "fail"}</span>{assertion.id}</summary>
      <div className="evals-assertion-values"><div><strong>Expected</strong><pre>{JSON.stringify(assertion.expected, null, 2)}</pre></div><div><strong>Observed</strong><pre>{JSON.stringify(assertion.observed, null, 2)}</pre></div></div>
      {assertion.observationRefs !== undefined && <details><summary>Evidence references</summary><pre>{JSON.stringify(assertion.observationRefs, null, 2)}</pre></details>}
    </details>)}
    {!detail.report && <p>No supported verdict report is available.</p>}
    <details><summary>Task observations and fixture state</summary><pre>{JSON.stringify(detail.report?.observations ?? [], null, 2)}</pre></details>
    {detail.runs.map(run => <div key={run.runId} className="evals-run-inspection"><h4>Run <code>{run.runId}</code></h4>
      {run.issues.map(issue => <p key={issue}>{issue}</p>)}
      <h5>Recorded model and tool timeline</h5><ol className="evals-timeline">{Array.isArray(run.artifacts["events.jsonl"]) && (run.artifacts["events.jsonl"] as Record<string, unknown>[]).map((event, index) => <li key={index}>
        <details><summary><code>{String(event.recordedSequence ?? index + 1)}</code> {String(event.kind ?? event.type ?? event.eventType ?? "Recorded event")}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
      </li>)}</ol>
      {(["result.json", "context.json", "trajectory.json"] as const).map(file => run.artifacts[file] !== undefined && <details key={file}><summary>{file === "result.json" ? "Terminal outcome" : file === "context.json" ? "Context and messages" : "Native trajectory"}</summary><pre>{JSON.stringify(run.artifacts[file], null, 2)}</pre></details>)}
    </div>)}
  </div>;
}

function TrialInspector({ invocation, item }: { invocation: SavedEvalInvocation; item: SavedEvalCase }) {
  const [detail, setDetail] = useState<EvalTrialDetail | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getEvalTrialDetail(invocation.invocationId, item.caseId, item.trial, controller.signal).then(setDetail).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Trial detail could not be read."); });
    return () => controller.abort();
  }, [invocation.invocationId, item.caseId, item.trial]);
  return error ? <p role="alert">{error}</p> : detail ? <TrialDetailView detail={detail} /> : <p>Reading trial evidence…</p>;
}

export function EvalComparison({ invocations }: { invocations: readonly SavedEvalInvocation[] }) {
  const groups = new Map<string, { invocation: SavedEvalInvocation; item: SavedEvalCase }[]>();
  for (const invocation of invocations) for (const item of invocation.cases) {
    if (!invocation.comparisonKey) continue;
    const key = `${invocation.comparisonKey}:${item.caseId}`;
    groups.set(key, [...groups.get(key) ?? [], { invocation, item }]);
  }
  const comparable = [...groups.entries()].filter(([, entries]) => new Set(entries.map(entry => entry.invocation.platform)).size > 1);
  return <details className="evals-comparisons"><summary>Cross-platform comparison ({comparable.length} matching task groups)</summary>
    {comparable.length === 0 && <p>No cross-platform trials have matching retained controls in this selection.</p>}
    {comparable.map(([key, entries]) => <div key={key}><h4>{entries[0].item.caseId} · {entries[0].invocation.suiteVersion}</h4><p>{entries[0].invocation.modelId ?? "Scripted model"}</p>
      <table><thead><tr><th>Platform</th><th>Trial</th><th>Outcome</th><th>Invocation</th></tr></thead><tbody>{entries.map(({ invocation, item }) => <tr key={`${invocation.invocationId}-${item.trial}`}><td>{invocation.platform}</td><td>{item.trial}</td><td>{item.reviewRequired ? "Review required" : item.verdict}</td><td><code>{invocation.invocationId}</code></td></tr>)}</tbody></table>
      <details><summary>Shared controls</summary><pre>{JSON.stringify(entries[0].invocation.controls, null, 2)}</pre></details></div>)}
  </details>;
}

export function EvalResults() {
  const [invocations, setInvocations] = useState<readonly SavedEvalInvocation[]>([]);
  const [platform, setPlatform] = useState("all"), [caseId, setCaseId] = useState("all");
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
  const visible = invocations.filter(invocation => (mode === "all" || invocation.mode === mode) && (platform === "all" || invocation.platform === platform || invocation.cases.some(item => item.platform === platform))).map(invocation => {
    const cases = invocation.cases.filter(item => (platform === "all" || (item.platform ?? invocation.platform) === platform) && (caseId === "all" || (item.task ?? item.caseId) === caseId));
    const counts = { pass: 0, fail: 0, blocked: 0, error: 0 };
    for (const item of cases) counts[item.verdict]++;
    return { ...invocation, cases, counts };
  }).filter(invocation => invocation.cases.length > 0 || caseId === "all" && (platform === "all" || invocation.platform === platform));
  return <section className="evals-results" aria-labelledby="evals-results-title">
    <div className="evals-heading"><div><h2 id="evals-results-title">Saved results</h2><p>Recent retained trials. A single trial is development feedback, not a reliability score.</p></div>
      <div className="evals-result-controls"><label>Execution<select value={mode} onChange={event => setMode(event.target.value as EvalMode | "all")}>
        <option value="all">All results</option><option value="live">Live model</option><option value="scripted">Scripted</option><option value="capability-acceptance">Business workflows</option>
      </select></label><label>Platform<select value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">All platforms</option>{[...new Set(invocations.flatMap(item => item.platform === "multiple" ? item.cases.map(entry => entry.platform ?? "Unknown") : [item.platform]))].sort().map(value => <option key={value}>{value}</option>)}</select></label><label>Task<select value={caseId} onChange={event => setCaseId(event.target.value)}><option value="all">All tasks</option>{[...new Set(invocations.flatMap(item => item.cases.map(entry => entry.task ?? entry.caseId)))].sort().map(value => <option key={value}>{value}</option>)}</select></label><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div></div>
    <div aria-live="polite">
      {loading && <p className="evals-empty">Reading saved results…</p>}
      {error && <p className="evals-empty" role="alert">{error} Start or check the lab server, then refresh.</p>}
      {!loading && !error && scanTruncated && <p className="evals-empty">The result index exceeds the scan limit. This view shows a bounded subset of retained invocations.</p>}
      {!loading && !error && visible.length === 0 && <p className="evals-empty">No saved {mode === "all" ? "eval" : mode} results found. Run the development eval command to collect evidence.</p>}
    </div>
    {!error && <EvalComparison invocations={visible} />}
    {!error && <SavedEvalResults invocations={visible.slice(0, 5)} />}
    {!error && visible.length > 5 && <details className="evals-older-results"><summary>Older invocations ({visible.length - 5})</summary><SavedEvalResults invocations={visible.slice(5)} /></details>}
  </section>;
}
