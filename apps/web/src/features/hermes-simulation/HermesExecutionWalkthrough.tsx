import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { appPaths } from "../../routes/paths";
import { pathForDocument } from "../documentation/documentPaths";
import { flowNodes, flowScenarios, sourceCommit } from "./hermesFlow";
import type { FlowNode } from "./hermesFlow";
import "./hermes-simulation.css";

const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
const columnWidth = 232;
const rowHeight = 106;
const nodeWidth = 206;
const nodeHeight = 70;

function position(index: number, columns: number) {
  const row = Math.floor(index / columns);
  const column = row % 2 === 0 ? index % columns : columns - 1 - index % columns;
  return { x: 24 + column * columnWidth, y: 24 + row * rowHeight };
}

function labelLines(label: string): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > 24) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function NodeInspector({ node, step, total }: { node: FlowNode; step: number; total: number }) {
  return <aside className="hermes-inspector" aria-label="Selected step">
    <div className="hermes-inspector-heading"><span className="hermes-eyebrow">{node.phase}</span><span className="hermes-step-number">{step + 1} / {total}</span></div>
    <h2>{node.label}</h2>
    <p className="hermes-node-detail">{node.detail}</p>
    <dl className="hermes-io">
      <dt>Input</dt><dd>{node.input}</dd>
      <dt>Output / state change</dt><dd>{node.output}</dd>
    </dl>
    <div className="hermes-source-list">
      <h3>Code owner</h3>
      {node.source.map((source) => <a key={`${source.file}:${source.line}`} href={`https://github.com/NousResearch/hermes-agent/blob/${sourceCommit}/${source.file}#L${source.line}`} target="_blank" rel="noreferrer">
        <span>{source.symbol}</span><code>{source.file}:{source.line}</code><ExternalLink aria-hidden="true" size={13} />
      </a>)}
    </div>
  </aside>;
}

/** A deterministic source walkthrough: stepping changes the inspected path position only. */
export function HermesExecutionWalkthrough() {
  const [scenarioId, setScenarioId] = useState(flowScenarios[0].id);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);
  const scenario = flowScenarios.find((candidate) => candidate.id === scenarioId) ?? flowScenarios[0];
  const nodes = useMemo(() => scenario.steps.map((id) => {
    const node = nodeById.get(id);
    if (!node) throw new Error(`Unknown Hermes flow node: ${id}`);
    return node;
  }), [scenario]);
  const selected = nodes[step] ?? nodes[0];
  const height = Math.ceil(nodes.length / columns) * rowHeight + 12;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setColumns(Math.max(1, Math.min(4, Math.floor((entry.contentRect.width - 24) / columnWidth)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const y = position(step, columns).y;
    if (y < element.scrollTop || y + nodeHeight > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: Math.max(0, y - element.clientHeight / 3), behavior: "instant" });
    }
  }, [step, columns]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStep((current) => Math.min(current + 1, nodes.length - 1)), 1400);
    return () => window.clearInterval(timer);
  }, [playing, nodes.length]);

  useEffect(() => { if (step === nodes.length - 1) setPlaying(false); }, [step, nodes.length]);

  function goTo(index: number) { setPlaying(false); setStep(index); }

  return <div className="hermes-page">
    <header className="hermes-heading">
      <div><Link to={appPaths.studio} className="hermes-back"><ArrowLeft size={14} aria-hidden="true" /> Studio</Link><h1>Hermes agent flow</h1><p>Follow a message through the agent, one step at a time.</p></div>
      <Link className="hermes-reading-link" to={pathForDocument("docs/research/context-lifecycles/hermes.md")}><BookOpen size={15} aria-hidden="true" /> Source study</Link>
    </header>
    <div className="hermes-toolbar">
      <label htmlFor="hermes-path">Path<select id="hermes-path" value={scenario.id} onChange={(event) => { setScenarioId(event.target.value); setStep(0); setPlaying(false); }}>{flowScenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className="hermes-step-controls">
        <button type="button" onClick={() => goTo(0)} disabled={step === 0} aria-label="Return to first step"><RotateCcw size={16} /></button>
        <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0} aria-label="Previous step"><ArrowLeft size={16} /></button>
        <button className="hermes-play" type="button" onClick={() => setPlaying((current) => !current)} disabled={step === nodes.length - 1}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={() => goTo(step + 1)} disabled={step === nodes.length - 1}>Next <ArrowRight size={16} /></button>
      </div>
      <span className="hermes-position" role="status" aria-live="polite">Step {step + 1} of {nodes.length}</span>
    </div>
    <div className="hermes-path-description"><span>{scenario.description}</span><span className="hermes-source-mode">Source walkthrough · {sourceCommit.slice(0, 7)}</span></div>
    <div className="hermes-workbench">
      <section className="hermes-canvas" aria-label={`${scenario.label} flow`}>
        <div className="hermes-canvas-legend"><span><i className="hermes-legend-current" />Current step</span><span><i className="hermes-legend-visited" />Earlier on this path</span><span>Click any node to inspect it</span></div>
        <div className="hermes-canvas-scroll" ref={canvas}>
          <svg className="hermes-flow-svg" viewBox={`0 0 ${columns * columnWidth + 24} ${height}`} style={{ height }} role="group" aria-label="Numbered execution path">
            <defs><marker id="hermes-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="var(--border-strong)" /></marker></defs>
            {nodes.slice(0, -1).map((_, index) => {
              const a = position(index, columns); const b = position(index + 1, columns);
              const sameRow = a.y === b.y;
              const right = b.x > a.x;
              const x1 = sameRow ? a.x + (right ? nodeWidth : 0) : a.x + nodeWidth / 2;
              const y1 = sameRow ? a.y + nodeHeight / 2 : a.y + nodeHeight;
              const x2 = sameRow ? b.x + (right ? 0 : nodeWidth) : b.x + nodeWidth / 2;
              const y2 = sameRow ? b.y + nodeHeight / 2 : b.y;
              return <path key={index} className={`hermes-edge ${index < step ? "is-visited" : ""}`} d={`M${x1} ${y1} L${x2} ${y2}`} markerEnd="url(#hermes-arrow)" />;
            })}
            {nodes.map((node, index) => {
              const p = position(index, columns); const lines = labelLines(node.label);
              return <g key={`${node.id}-${index}`} transform={`translate(${p.x},${p.y})`} className={`hermes-flow-node ${index === step ? "is-current" : index < step ? "is-visited" : ""}`}>
                <rect className="hermes-node-shape" width={nodeWidth} height={nodeHeight} rx={node.kind === "decision" ? 3 : 10} />
                <text className="hermes-node-index" x="12" y="18">{String(index + 1).padStart(2, "0")}</text>
                <text className="hermes-node-phase" x="38" y="18">{node.phase}</text>
                <text className="hermes-node-label" x="12" y={lines.length > 1 ? 40 : 47}>{lines.map((line, i) => <tspan key={i} x="12" dy={i === 0 ? 0 : 16}>{line}</tspan>)}</text>
                <foreignObject x="0" y="0" width={nodeWidth} height={nodeHeight}><button type="button" className="hermes-node-hit" onClick={() => goTo(index)} aria-label={`Step ${index + 1}: ${node.label}`} aria-current={index === step ? "step" : undefined} /></foreignObject>
              </g>;
            })}
          </svg>
        </div>
      </section>
      <NodeInspector node={selected} step={step} total={nodes.length} />
    </div>
    <footer className="hermes-footer">Paths follow the inspected source. Model replies, tool outcomes and branch conditions are assumed for learning; this page does not execute Hermes.</footer>
  </div>;
}
