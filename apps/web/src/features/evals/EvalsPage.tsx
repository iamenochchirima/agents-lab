import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useSearchParams } from "react-router";

import specification from "../../../../../lab/scenarios/platform-agent-conformance/eval-cases.md?raw";
import { documents } from "../../generated/document-catalog";
import { pathForDocument } from "../documentation/documentPaths";
import { readEvalCases, type EvalGroup } from "./evalModel";
import { EvalCoverage } from "./EvalCoverage";
import { EvalResults } from "./EvalResults";
import "./evals.css";

const sourceId = "lab/scenarios/platform-agent-conformance/eval-cases.md";
const cases = readEvalCases(specification);
const documentIds = new Set(documents.map(document => document.id));
const groups: { id: EvalGroup; label: string; description: string }[] = [
  { id: "B", label: "Core harness", description: "Scripted model responses exercise each platform's real execution path. Every core case is required for baseline readiness." },
  { id: "M", label: "Real model", description: "Measure the model and harness together through repeated trials, after the corresponding core checks work." },
  { id: "X", label: "Platform capabilities", description: "Test an exact variant's declared capabilities. Optional capabilities are assessed separately from the shared core." },
];

function CaseText({ children }: { children: string }) {
  return <ReactMarkdown components={{
    a({ href, children: label }) {
      const resolved = href ? new URL(href, `https://agent-harness-lab.local/${sourceId}`) : null;
      const id = resolved?.pathname.slice(1);
      return id && documentIds.has(id)
        ? <Link to={pathForDocument(id)}>{label}</Link>
        : <>{label}</>;
    },
  }}>{children}</ReactMarkdown>;
}

export function EvalsPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const selected = groups.find(group => group.id === params.get("group")) ?? groups[0];
  const visible = cases.filter(item => item.group === selected.id &&
    `${item.id} ${item.title} ${item.task} ${item.acceptance}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <div className="page-content evals-page">
    <header className="page-heading">
      <div>
        <span className="eyebrow">Platform development</span>
        <h1>Agent evals</h1>
        <p>Inspect recorded trials and the behaviors each platform's agent harness is working toward.</p>
      </div>
    </header>
    <EvalCoverage />
    <EvalResults />
    <div className="evals-status"><strong>Acceptance specification</strong><span>Development commands cover twelve core cases and seven live probes. Saved trials show measured outcomes.</span><Link to={pathForDocument("docs/research/platform-eval-readiness.md")}>Readiness investigation</Link></div>
    <nav className="evals-groups" aria-label="Evaluation groups">
      {groups.map(group => <button key={group.id} type="button" aria-pressed={selected.id === group.id}
        onClick={() => { setParams({ group: group.id }); setQuery(""); }}>
        {group.label}<span>{cases.filter(item => item.group === group.id).length}</span>
      </button>)}
    </nav>
    <section className="evals-cases" aria-labelledby="evals-group-title">
      <div className="evals-heading">
        <div><h2 id="evals-group-title">{selected.label}</h2><p>{selected.description}</p></div>
        <label>Find a case<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tools, context, recovery…" /></label>
      </div>
      <p className="evals-count">{visible.length} cases</p>
      <div className="evals-list">
        {visible.map(item => <details key={item.id}>
          <summary><code>{item.id}</code><strong>{item.title}</strong><span>View criteria</span></summary>
          <div className="evals-detail">
            <div><h3>{selected.id === "X" ? "Capability" : "Task and fixture"}</h3><CaseText>{item.task}</CaseText></div>
            <div><h3>{selected.id === "M" ? "Grader" : "Acceptance check"}</h3><CaseText>{item.acceptance}</CaseText></div>
          </div>
        </details>)}
        {visible.length === 0 && <p className="evals-empty">No cases match your search.</p>}
      </div>
    </section>
    <footer className="evals-docs" aria-label="Evaluation documents">
      <span>Read in Docs</span>
      <Link to={pathForDocument(sourceId)}>Full specification</Link>
      <Link to={pathForDocument("docs/research/platform-agent-evals.md")}>Research and sources</Link>
      <Link to={pathForDocument("lab/experiments/agent-harness-baseline/README.md")}>Experiment protocol</Link>
      <Link to={pathForDocument("lab/experiments/agent-harness-baseline/development-evals.md")}>Run development evals</Link>
    </footer>
  </div>;
}
