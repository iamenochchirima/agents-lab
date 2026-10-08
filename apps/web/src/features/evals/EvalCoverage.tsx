import { EvalEvidenceInspector } from "./EvalResults";
import { useEffect, useState } from "react";
import { getEvalCoverage, type EvalCoverageView } from "./evalResultsApi";

/** Original observations and implementation coverage answer different questions. */
export function EvalCoverage() {
  const [selectedEvidence, setSelectedEvidence] = useState<{ invocationId: string; caseId: string; trial: number } | null>(null);
  const [coverage, setCoverage] = useState<EvalCoverageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("langgraph"), [group, setGroup] = useState("B"), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void getEvalCoverage(controller.signal).then(setCoverage).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Coverage unavailable."); });
    return () => controller.abort();
  }, [refresh]);
  return <details className="evals-coverage"><summary>Coverage and remaining gaps</summary>
    <div className="evals-result-controls">
      <label>Baseline<select value={platform} onChange={event => setPlatform(event.target.value)}>{["mastra", "langgraph", "temporal", "restate"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Requirements<select value={group} onChange={event => setGroup(event.target.value)}><option value="B">Core harness</option><option value="M">Real model</option><option value="X">Optional capabilities</option></select></label>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh coverage</button>
    </div>
    <p>Original retained outcomes for this baseline. A passing observation is not full readiness; assessments and native capability boundaries are separate evidence.</p>
    {error && <p role="alert">{error}</p>}
    {coverage?.issues?.length ? <details><summary>Incomplete native evidence ({coverage.issues.length})</summary>{coverage.issues.map(issue => <p key={issue}>{issue}</p>)}</details> : null}
    {!coverage && !error && <p>Reading coverage…</p>}
    {coverage?.scanTruncated && <p>Evidence scan was bounded. Unlisted observations may exist.</p>}
    {coverage && <table><thead><tr><th>Requirement</th><th>Implementation</th><th>Observed outcome</th><th>Boundary and evidence</th></tr></thead><tbody>{coverage.cells.filter(cell => cell.platform === platform && cell.group === group).map(cell => <tr key={cell.requirementId}>
      <td><code>{cell.requirementId}</code></td><td>{cell.implementation.replaceAll("-", " ")}</td><td>{cell.measurement.replaceAll("-", " ")}</td><td>{cell.boundary}{cell.evidence && <details><summary>{cell.evidence.caseId} · trial {cell.evidence.trial}</summary><code>{cell.evidence.invocationId}</code><p>{cell.evidence.suiteVersion} · {cell.evidence.graderVersion ?? "Grader version unavailable"}</p><p>{cell.evidence.completedAt}</p><button type="button" onClick={() => setSelectedEvidence(cell.evidence!)}>Inspect trial evidence</button></details>}{cell.extensionEvidence && <details><summary>Native capability evidence</summary><code>{cell.extensionEvidence.invocationId}</code><p>{cell.extensionEvidence.report.reason}</p><p>{cell.extensionEvidence.completedAt} · {cell.extensionEvidence.revision ?? "Revision unavailable"}</p><details><summary>Execution controls and versions</summary><pre>{JSON.stringify(cell.extensionEvidence.metadata, null, 2)}</pre></details><pre>{JSON.stringify(cell.extensionEvidence.report, null, 2)}</pre></details>}</td>
    </tr>)}</tbody></table>}
    {selectedEvidence && <section aria-label="Selected coverage evidence"><button type="button" onClick={() => setSelectedEvidence(null)}>Close trial evidence</button><EvalEvidenceInspector key={`${selectedEvidence.invocationId}:${selectedEvidence.caseId}:${selectedEvidence.trial}`} {...selectedEvidence} /></section>}
  </details>;
}
