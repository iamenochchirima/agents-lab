import { AgentSystemTabs } from './AgentSystemTabs';
import { ArrowLeft, ArrowRight, BookOpen, Crosshair, ExternalLink, Minus, Pause, Play, Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { placeGraph, nodeSize } from './layout';
import type { ExplorerGraph, ExplorerEdge, SourceAnchor } from './types';
import { SystemComparisonPage } from '../system-comparison/SystemComparisonPage';
import './system-explorer.css';

const kinds = ['transition', 'call', 'data', 'background'] as const;

function SourceLinks({ graph, anchors }: { graph: ExplorerGraph; anchors: readonly SourceAnchor[] }) {
  const unique = [...new Map(anchors.map(a => [`${a.file}:${a.line}:${a.symbol}`, a])).values()];
  return <div className="explorer-sources">{unique.map(source => <a key={`${source.file}:${source.line}:${source.symbol}`} href={`${graph.repository}/blob/${graph.commit}/${source.file}#L${source.line}`} target="_blank" rel="noreferrer"><span>{source.symbol}</span><code>{source.file}:{source.line}</code><ExternalLink size={13} aria-hidden="true" /></a>)}</div>;
}

/** Display source relationships and illustrative traces without invoking a studied agent. */
export function SystemExplorer({ graph }: { graph: ExplorerGraph }) {
  const layout = useMemo(() => placeGraph(graph), [graph]);
  const nodeMap = useMemo(() => new Map(layout.nodes.map(n => [n.id, n])), [layout]);
  const groupMap = useMemo(() => new Map(layout.groups.map(g => [g.id, g])), [layout]);
  const [selectedId, setSelectedId] = useState(graph.nodes[0].id);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [edgeKind, setEdgeKind] = useState('all');
  const [connections, setConnections] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState('map');
  const [traceId, setTraceId] = useState(graph.traces[0]?.id ?? '');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(.3);
  const [offset, setOffset] = useState({ x: 20, y: 20 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const selected = nodeMap.get(selectedId) ?? layout.nodes[0];
  const selectedEdge = graph.edges.find(e => e.id === selectedEdgeId);
  const connected = graph.edges.filter(e => e.from === selected.id || e.to === selected.id);
  const trace = graph.traces.find(t => t.id === traceId);
  const visible = new Set(layout.nodes.filter(n => (region === 'all' || n.groupId === region) && `${n.label} ${n.summary} ${n.source.map(s => s.file).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(n => n.id));

  function fit() {
    const el = viewport.current;
    if (!el) return;
    const s = Math.min((el.clientWidth - 40) / layout.width, (el.clientHeight - 40) / layout.height);
    setScale(s); setOffset({ x: (el.clientWidth - layout.width * s) / 2, y: (el.clientHeight - layout.height * s) / 2 });
  }
  useEffect(() => {
    if (view === 'coverage') return;
    if (region !== 'all') focusRegion(region); else fit();
  }, [layout, view]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // A non-passive listener keeps canvas zoom from also scrolling the workspace.
    const stopScroll = (event: WheelEvent) => event.preventDefault();
    element.addEventListener('wheel', stopScroll, { passive: false });
    return () => element.removeEventListener('wheel', stopScroll);
  }, [view]);
  function zoom(next: number) {
    const el = viewport.current;
    if (!el) return;
    const s = Math.max(.06, Math.min(1.6, next));
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setOffset({ x: cx - (cx - offset.x) * s / scale, y: cy - (cy - offset.y) * s / scale }); setScale(s);
  }
  function focus(id: string, zoomToNode = true) {
    const n = nodeMap.get(id), el = viewport.current;
    if (!n) return;
    setSelectedId(id); setSelectedEdgeId(null);
    if (zoomToNode && el) {
      setRegion('all'); setQuery(''); setScale(.85);
      setOffset({ x: el.clientWidth / 2 - (n.x + nodeSize.width / 2) * .85, y: el.clientHeight / 2 - (n.y + nodeSize.height / 2) * .85 });
    }
  }
  function focusRegion(id: string) {
    const g = groupMap.get(id), el = viewport.current;
    if (!g) return;
    setRegion(id); setQuery('');
    const n = layout.nodes.find(n => n.groupId === id);
    if (n) focus(n.id, false);
    if (!el) return;
    const s = Math.min((el.clientWidth - 70) / g.width, (el.clientHeight - 70) / g.height);
    setScale(s); setOffset({ x: el.clientWidth / 2 - (g.x + g.width / 2) * s, y: el.clientHeight / 2 - (g.y + g.height / 2) * s });
  }
  function moveStep(index: number) {
    if (!trace) return;
    const next = Math.max(0, Math.min(index, trace.steps.length - 1));
    setStep(next); focus(trace.steps[next].nodeId);
  }
  useEffect(() => {
    if (!playing || !trace) return;
    const timer = window.setInterval(() => setStep(s => Math.min(s + 1, trace.steps.length - 1)), 2200);
    return () => window.clearInterval(timer);
  }, [playing, trace]);
  useEffect(() => {
    if (view !== 'trace' || !trace) return;
    focus(trace.steps[step].nodeId);
    if (step === trace.steps.length - 1) setPlaying(false);
  }, [step, trace, view]);

  function edgePath(edge: ExplorerEdge, index: number) {
    const a = nodeMap.get(edge.from)!, b = nodeMap.get(edge.to)!;
    if (a.id === b.id) {
      const x = a.x + nodeSize.width, y = a.y + nodeSize.height / 2;
      return { path: `M${x},${y - 15} C${x + 95},${y - 100} ${x + 95},${y + 100} ${x},${y + 15}`, lx: x + 60, ly: y - 55 };
    }
    const dx = b.x - a.x, dy = b.y - a.y, horizontal = Math.abs(dx) > Math.abs(dy);
    const x1 = a.x + (horizontal ? dx > 0 ? nodeSize.width : 0 : nodeSize.width / 2), y1 = a.y + (horizontal ? nodeSize.height / 2 : dy > 0 ? nodeSize.height : 0);
    const x2 = b.x + (horizontal ? dx > 0 ? 0 : nodeSize.width : nodeSize.width / 2), y2 = b.y + (horizontal ? nodeSize.height / 2 : dy > 0 ? 0 : nodeSize.height);
    const bend = 55 + (index % 4) * 24;
    return { path: horizontal ? `M${x1},${y1} C${x1 + Math.sign(dx) * bend},${y1} ${x2 - Math.sign(dx) * bend},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + Math.sign(dy) * bend} ${x2},${y2 - Math.sign(dy) * bend} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 8 };
  }

  return <div className="system-explorer">
    <header className="explorer-header"><div><Link to="/studio/explorers" className="explorer-back"><ArrowLeft size={14} /> System explorers</Link><h1>{graph.name} system explorer</h1><p>{graph.description}</p></div><Link className="explorer-reading" to={`/docs/research/system-explorers/audits/${graph.id}.md`}>Audit evidence</Link><Link className="explorer-reading" to={`/docs/research/system-explorers/${graph.id}.md`}><BookOpen size={15} /> Source study</Link></header>
    <AgentSystemTabs active={graph.id}><a className="explorer-revision" href={`${graph.repository}/tree/${graph.commit}`} target="_blank" rel="noreferrer">Source {graph.commit.slice(0, 8)} <ExternalLink size={11} /></a></AgentSystemTabs>
    <div className="explorer-toolbar"><div className="explorer-view-tabs"><button aria-pressed={view === 'map'} onClick={() => { setView('map'); setPlaying(false); }}>Explore system</button><button aria-pressed={view === 'trace'} onClick={() => setView('trace')} disabled={!graph.traces.length}>Follow a message</button><button aria-pressed={view === 'coverage'} onClick={() => { setView('coverage'); setPlaying(false); }}>Coverage & limits</button><button aria-pressed={view === 'comparison'} onClick={() => { setView('comparison'); setPlaying(false); }}>Comparison</button></div><span>{graph.nodes.length} nodes · {graph.edges.length} relationships · {graph.groups.length} regions</span></div>
    {view === 'comparison' ? <SystemComparisonPage embedded /> : view === 'coverage' ? <section className="explorer-coverage"><h2>What this map covers</h2><p>{graph.scope}</p><div className="explorer-coverage-groups">{graph.groups.map(g => <button key={g.id} onClick={() => { setView('map'); focusRegion(g.id); }}><strong>{g.label}</strong><span>{g.summary}</span><small>{graph.nodes.filter(n => n.groupId === g.id).length} nodes</small></button>)}</div><h2>Limits and interpretation</h2><ul>{graph.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul><p>These are source-based teaching diagrams. Example traces assume outcomes; they are not recorded executions, benchmarks or a formal executable state machine.</p></section> : <>
      {view === 'trace' && trace && <section className="explorer-trace-toolbar"><select aria-label="Example trace" value={trace.id} onChange={e => { setTraceId(e.target.value); setStep(0); setPlaying(false); }}>{graph.traces.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select><div className="explorer-trace-controls"><button aria-label="Reset trace" onClick={() => { setPlaying(false); moveStep(0); }}><RotateCcw size={15} /></button><button aria-label="Previous step" disabled={step === 0} onClick={() => { setPlaying(false); moveStep(step - 1); }}><ArrowLeft size={15} /></button><button disabled={step === trace.steps.length - 1} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play'}</button><button disabled={step === trace.steps.length - 1} onClick={() => { setPlaying(false); moveStep(step + 1); }}>Next <ArrowRight size={15} /></button></div><span role="status">{step + 1} / {trace.steps.length}</span><p>{trace.description}</p></section>}
      <div className="explorer-map-tools"><label><Search size={14} /><input aria-label="Find a component" placeholder="Find a component, state or source…" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Region" value={region} onChange={e => { if (e.target.value === 'all') { setRegion('all'); fit(); } else focusRegion(e.target.value); }}><option value="all">Whole system</option>{graph.groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select><select aria-label="Connection type" value={edgeKind} onChange={e => setEdgeKind(e.target.value)}><option value="all">All connection types</option>{kinds.map(k => <option key={k}>{k}</option>)}</select><select aria-label="Connection visibility" value={connections} onChange={e => setConnections(e.target.value)}><option value="all">All relationships</option><option value="selected">Selected node only</option></select><button className="explorer-expand" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show inspector' : 'Expand canvas'}</button></div>
      <div className={`explorer-workbench ${expanded ? 'is-expanded' : ''}`}>
        <nav className="explorer-outline" aria-label="Component index"><button className="explorer-outline-all" onClick={() => { setRegion('all'); setQuery(''); fit(); }}>Whole system</button>{view === 'trace' && trace && <section className="explorer-trace-log"><h2>Message journey</h2>{trace.steps.map((s, i) => <button key={`${s.nodeId}:${i}`} aria-current={step === i ? 'step' : undefined} onClick={() => { setPlaying(false); moveStep(i); }}><small>{String(i + 1).padStart(2, '0')}</small>{nodeMap.get(s.nodeId)?.label}</button>)}</section>}{graph.groups.map(g => <section key={g.id}><button className="explorer-group-link" aria-pressed={region === g.id} onClick={() => focusRegion(g.id)}>{g.label}<small>{graph.nodes.filter(n => n.groupId === g.id).length}</small></button>{layout.nodes.filter(n => n.groupId === g.id && visible.has(n.id)).map(n => <button key={n.id} className="explorer-outline-node" aria-current={n.id === selected.id ? 'true' : undefined} onClick={() => { setPlaying(false); focus(n.id); }}><i data-kind={n.kind} />{n.label}</button>)}</section>)}{!visible.size && <p className="explorer-no-match">No matching nodes. Clear the search or choose Whole system.</p>}</nav>
        <section className="explorer-canvas"><div className="explorer-legend"><span>Drag to pan · scroll to zoom</span>{kinds.map(k => <span key={k}><i className={`explorer-edge-${k}`} />{k}</span>)}</div><div ref={viewport} className="explorer-viewport" onWheel={e => { zoom(scale * (e.deltaY > 0 ? .9 : 1.1)); }} onPointerDown={e => { if ((e.target as Element).closest('button, [role="button"]')) return; drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d = drag.current; if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <svg width={layout.width} height={layout.height} className="explorer-svg" style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})` }} role="group" aria-label={`${graph.name} component and state map`}><defs>{kinds.map(k => <marker key={k} id={`${graph.id}-arrow-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path className={`explorer-edge-${k}`} d="M0 0 L8 4 L0 8 Z" /></marker>)}</defs>
            {layout.groups.map(g => <g key={g.id} className={`explorer-map-group ${region !== 'all' && region !== g.id ? 'is-dim' : ''}`}><rect x={g.x} y={g.y} width={g.width} height={g.height} rx="18" /><text x={g.x + 25} y={g.y + 43}>{g.label}</text><foreignObject x={g.x + 25} y={g.y + 60} width={g.width - 50} height="40"><div className="explorer-group-summary">{g.summary}</div></foreignObject></g>)}
            {graph.edges.map((edge, i) => {
              const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to);
              if (!a || !b || (edgeKind !== 'all' && edgeKind !== edge.kind)) return null;
              const active = connected.some(e => e.id === edge.id), inspected = edge.id === selectedEdgeId;
              if (connections === 'selected' && !active) return null;
              const p = edgePath(edge, i);
              return <g key={edge.id} className={`explorer-map-edge explorer-edge-${edge.kind} ${active ? 'is-connected' : ''} ${inspected ? 'is-inspected' : ''} ${!visible.has(a.id) || !visible.has(b.id) ? 'is-dim' : ''}`}><path d={p.path} markerEnd={`url(#${graph.id}-arrow-${edge.kind})`} />{active && <text x={p.lx} y={p.ly}>{edge.label}</text>}<path className="explorer-edge-hit" d={p.path} role="button" tabIndex={active ? 0 : -1} aria-label={`Inspect relationship: ${a.label} to ${b.label}: ${edge.label}`} onClick={() => setSelectedEdgeId(edge.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedEdgeId(edge.id); } }} /><title>{a.label} → {b.label}: {edge.label}</title></g>;
            })}
            {layout.nodes.map(n => <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`explorer-map-node node-${n.kind} ${n.id === selected.id ? 'is-selected' : ''} ${!visible.has(n.id) ? 'is-dim' : ''}`}><rect width={nodeSize.width} height={nodeSize.height} rx={n.kind === 'decision' ? 3 : n.kind === 'store' ? 18 : 9} /><text x="15" y="22" className="explorer-node-kind">{n.kind}</text><foreignObject x="15" y="33" width={nodeSize.width - 30} height="65"><div className="explorer-node-title">{n.label}</div></foreignObject><foreignObject width={nodeSize.width} height={nodeSize.height}><button aria-label={`Inspect ${n.label}`} aria-pressed={n.id === selected.id} onClick={() => { setPlaying(false); focus(n.id, false); }} /></foreignObject></g>)}
          </svg><div className="explorer-zoom-controls"><button aria-label="Zoom out" onClick={() => zoom(scale / 1.2)}><Minus size={15} /></button><span>{Math.round(scale * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(scale * 1.2)}><Plus size={15} /></button><button onClick={fit}><Crosshair size={14} /> Fit system</button></div></div>{view === 'trace' && trace && <div className="explorer-current-event"><span>Example step {step + 1}</span><p>{trace.steps[step].detail}</p></div>}</section>
        <aside className="explorer-inspector" aria-label="Source inspector">{selectedEdge ? <><div className="explorer-inspector-tag">{selectedEdge.kind} relationship</div><h2>{selectedEdge.label}</h2><div className="explorer-edge-endpoints"><button onClick={() => focus(selectedEdge.from)}>{nodeMap.get(selectedEdge.from)?.label}</button><ArrowRight size={15} /><button onClick={() => focus(selectedEdge.to)}>{nodeMap.get(selectedEdge.to)?.label}</button></div>{selectedEdge.condition && <><h3>Condition</h3><p>{selectedEdge.condition}</p></>}<h3>Relationship evidence</h3><SourceLinks graph={graph} anchors={selectedEdge.source} /><button className="explorer-inspector-back" onClick={() => setSelectedEdgeId(null)}>Return to node</button></> : <><div className="explorer-inspector-tag">{selected.kind}<span>Code study</span></div><h2>{selected.label}</h2><p>{selected.summary}</p><dl>{[["Inputs", selected.inputs], ["Outputs / state", selected.outputs], ["Conditions", selected.conditions], ["Failure / recovery", selected.failures], ["Notes", selected.notes]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><h3>Source owners</h3><SourceLinks graph={graph} anchors={selected.source} /><h3>Relationships · {connected.length}</h3><div className="explorer-relationships">{connected.map(e => { const outgoing = e.from === selected.id, other = nodeMap.get(outgoing ? e.to : e.from)!; return <div key={e.id}><button onClick={() => { setPlaying(false); setSelectedEdgeId(e.id); }}><small>{outgoing ? 'OUT' : 'IN'} · {e.kind}</small><strong>{e.label}</strong>{e.condition && <span>{e.condition}</span>}</button><button className="explorer-follow" onClick={() => { setPlaying(false); focus(other.id); }}>{other.label} <ArrowRight size={11} /></button></div>; })}</div></>}</aside>
      </div><footer className="explorer-footer">{graph.scope} Source-based map with assumed example paths; no agent, model or tool is executed. Open Coverage & limits for collapsed boundaries.</footer>
    </>}
  </div>;
}
