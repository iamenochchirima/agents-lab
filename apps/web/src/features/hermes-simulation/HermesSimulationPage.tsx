import { AgentSystemTabs } from '../system-explorer/AgentSystemTabs';
import { ArrowLeft, BookOpen, Crosshair, ExternalLink, Minus, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { appPaths } from "../../routes/paths";
import { pathForDocument } from "../documentation/documentPaths";
import { architectureGroups as groups, architectureNodes as nodes, architectureEdges as edges, architectureCanvas, architectureNodeSize } from "./hermesArchitecture";
import { sourceCommit } from "./hermesFlow";
import { HermesExecutionWalkthrough } from "./HermesExecutionWalkthrough";
import { SystemComparisonPage } from "../system-comparison/SystemComparisonPage";
import "./hermes-architecture.css";

const WIDTH = architectureCanvas.width, HEIGHT = architectureCanvas.height, NW = architectureNodeSize.width, NH = architectureNodeSize.height;
const nodeMap = new Map(nodes.map(n => [n.id, n]));
const kinds = ["transition", "call", "data", "background"] as const;

/** A provisional architecture graph, separate from the ordered example execution paths. */
export function HermesSimulationPage() {
  const [mode, setMode] = useState("map");
  const [selectedId, setSelectedId] = useState(nodes[0].id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [scale, setScale] = useState(.55);
  const [offset, setOffset] = useState({ x: 30, y: 30 });
  const [edgeKind, setEdgeKind] = useState("all");
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const selected = nodeMap.get(selectedId)!;
  const connected = edges.filter(e => e.from === selectedId || e.to === selectedId);
  const shown = nodes.filter(n => (filter === "all" || n.groupId === filter) && `${n.label} ${n.kind} ${n.summary}`.toLowerCase().includes(query.toLowerCase()));
  const shownIds = new Set(shown.map(n => n.id));

  function fit() {
    const el = viewport.current;
    if (!el) return;
    const s = Math.min((el.clientWidth - 48) / WIDTH, (el.clientHeight - 48) / HEIGHT);
    setScale(s); setOffset({ x: (el.clientWidth - WIDTH * s) / 2, y: (el.clientHeight - HEIGHT * s) / 2 });
  }
  useEffect(() => { fit(); }, [mode]);
  function zoom(next: number) {
    const el = viewport.current;
    if (!el) return;
    const s = Math.max(.04, Math.min(1.5, next));
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setOffset({ x: cx - (cx - offset.x) * s / scale, y: cy - (cy - offset.y) * s / scale }); setScale(s);
  }
  function focus(id: string) {
    const n = nodeMap.get(id); const el = viewport.current;
    if (!n || !el) return;
    setSelectedId(id); setFilter("all"); setQuery(""); setScale(.9);
    setOffset({ x: el.clientWidth / 2 - (n.x + NW / 2) * .9, y: el.clientHeight / 2 - (n.y + NH / 2) * .9 });
  }

  return <div className="hermes-system-page">
    <header className="hermes-system-header">
      <div><Link to={appPaths.studio} className="hermes-back"><ArrowLeft size={14} /> Studio</Link><h1>Hermes system explorer</h1><p>Explore the components, their states and the connections between them.</p></div>
      <Link to="/docs/research/system-explorers/audits/hermes.md">Audit evidence</Link>
      <Link className="hermes-reading-link" to={pathForDocument("docs/research/system-explorers/hermes.md")}><BookOpen size={15} /> Source study</Link>
    </header>
    <AgentSystemTabs active="hermes" showIndex />
    <div className="hermes-system-tabs"><button aria-pressed={mode === "map"} onClick={() => setMode("map")}>System map</button><button aria-pressed={mode === "steps"} onClick={() => setMode("steps")}>Existing step walkthrough</button><button aria-pressed={mode === "comparison"} onClick={() => setMode("comparison")}>Comparison</button><span>Surface map · node studies pending · {sourceCommit.slice(0, 7)}</span></div>
    {mode === "comparison" ? <SystemComparisonPage embedded /> : mode === "steps" ? <HermesExecutionWalkthrough /> : <>
      <div className="hermes-map-toolbar"><label><Search size={15} /><input aria-label="Find a component" placeholder="Find a component or state…" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Connection type" value={edgeKind} onChange={e => setEdgeKind(e.target.value)}><option value="all">All connections</option>{kinds.map(k => <option key={k} value={k}>{k}</option>)}</select><span>{nodes.length} nodes · {groups.length} regions</span></div>
      <div className="hermes-system-workbench">
        <nav className="hermes-system-outline" aria-label="Component index"><button className="hermes-outline-all" onClick={() => { setFilter("all"); setQuery(""); fit(); }}>Whole system</button>{groups.map(g => <section key={g.id}><button className="hermes-group-link" aria-pressed={filter === g.id} onClick={() => { setFilter(g.id); setSelectedId(nodes.find(n => n.groupId === g.id)!.id); const el = viewport.current; if (el) { const s = Math.min((el.clientWidth - 80) / g.width, (el.clientHeight - 80) / g.height); setScale(s); setOffset({ x: el.clientWidth / 2 - (g.x + g.width / 2) * s, y: el.clientHeight / 2 - (g.y + g.height / 2) * s }); } }}>{g.label}</button>{nodes.filter(n => n.groupId === g.id && shownIds.has(n.id)).map(n => <button key={n.id} className="hermes-outline-node" aria-current={n.id === selectedId ? "true" : undefined} onClick={() => focus(n.id)}><i data-kind={n.kind} />{n.label}</button>)}</section>)}</nav>
        <section className="hermes-system-canvas"><div className="hermes-system-legend"><span>Drag canvas to pan · scroll to zoom</span>{kinds.map(k => <span key={k}><i className={`edge-${k}`} />{k}</span>)}</div>
          <div ref={viewport} className="hermes-map-viewport" onWheel={e => { e.preventDefault(); zoom(scale * (e.deltaY > 0 ? .9 : 1.1)); }} onPointerDown={e => { if ((e.target as Element).closest("button")) return; drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d = drag.current; if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            <svg width={WIDTH} height={HEIGHT} className="hermes-architecture-svg" style={{ transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})` }} aria-label="Hermes component and state map" role="group">
              <defs>{kinds.map(k => <marker key={k} id={`architecture-arrow-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path className={`edge-${k}`} d="M0 0 L8 4 L0 8 Z" /></marker>)}</defs>
              {groups.map(g => <g key={g.id} className={`hermes-map-group ${filter !== "all" && filter !== g.id ? "is-dim" : ""}`}><rect x={g.x} y={g.y} width={g.width} height={g.height} rx="18" /><text x={g.x + 25} y={g.y + 35}>{g.label}</text><text className="hermes-group-subtitle" x={g.x + 25} y={g.y + 58}>Surface structure · {nodes.filter(n => n.groupId === g.id).length} nodes</text></g>)}
              {edges.map((e, i) => { const a = nodeMap.get(e.from), b = nodeMap.get(e.to); if (!a || !b || (edgeKind !== "all" && edgeKind !== e.kind)) return null;
                const dx = b.x - a.x, dy = b.y - a.y, horizontal = Math.abs(dx) > Math.abs(dy);
                const x1 = a.x + (horizontal ? dx > 0 ? NW : 0 : NW / 2), y1 = a.y + (horizontal ? NH / 2 : dy > 0 ? NH : 0);
                const x2 = b.x + (horizontal ? dx > 0 ? 0 : NW : NW / 2), y2 = b.y + (horizontal ? NH / 2 : dy > 0 ? 0 : NH);
                const bend = 40 + (i % 4) * 18;
                const path = horizontal ? `M${x1},${y1} C${x1 + Math.sign(dx) * bend},${y1} ${x2 - Math.sign(dx) * bend},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + Math.sign(dy) * bend} ${x2},${y2 - Math.sign(dy) * bend} ${x2},${y2}`;
                const active = e.from === selectedId || e.to === selectedId;
                return <g key={e.id} className={`hermes-map-edge edge-${e.kind} ${active ? "is-connected" : ""} ${!shownIds.has(a.id) || !shownIds.has(b.id) ? "is-dim" : ""}`}><path d={path} markerEnd={`url(#architecture-arrow-${e.kind})`} />{active && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>{e.label}</text>}<title>{a.label} → {b.label}: {e.label} ({e.kind})</title></g>;
              })}
              {nodes.map(n => <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`hermes-map-node node-${n.kind} ${n.id === selectedId ? "is-selected" : ""} ${!shownIds.has(n.id) ? "is-dim" : ""}`}><rect width={NW} height={NH} rx={n.kind === "decision" ? 3 : n.kind === "store" ? 18 : 9} /><text x="14" y="21" className="hermes-map-kind">{n.kind}</text><foreignObject x="14" y="30" width={NW - 28} height="44"><div className="hermes-map-title">{n.label}</div></foreignObject><foreignObject width={NW} height={NH}><button aria-label={`Inspect ${n.label}`} aria-pressed={n.id === selectedId} onClick={() => setSelectedId(n.id)} /></foreignObject></g>)}
            </svg>
            <div className="hermes-map-controls"><button aria-label="Zoom out" onClick={() => zoom(scale / 1.2)}><Minus size={16} /></button><span>{Math.round(scale * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(scale * 1.2)}><Plus size={16} /></button><button onClick={fit}><Crosshair size={15} /> Fit system</button></div>
          </div>
        </section>
        <aside className="hermes-system-inspector" aria-label="Selected component"><div className="hermes-inspector-heading"><span className="hermes-eyebrow">{selected.kind}</span><span className="hermes-surface-badge">Surface only</span></div><h2>{selected.label}</h2><p>{selected.summary}</p><h3>Relationships</h3><div className="hermes-relationships">{connected.map(e => { const outgoing = e.from === selectedId, other = nodeMap.get(outgoing ? e.to : e.from)!; return <button key={e.id} onClick={() => focus(other.id)}><small>{outgoing ? "OUT" : "IN"} · {e.kind}</small><strong>{other.label}</strong><span>{e.label}{e.condition ? ` · ${e.condition}` : ""}</span></button>; })}</div><div className="hermes-source-list">{connected.some(e => e.source?.length) && <><h3>Relationship evidence</h3>{connected.filter(e => e.source?.length).map(e => <div key={e.id}><p>{e.label}</p>{e.source!.map(s => <a key={`${s.file}:${s.line}`} href={`https://github.com/NousResearch/hermes-agent/blob/${sourceCommit}/${s.file}#L${s.line}`} target="_blank" rel="noreferrer"><span>{s.symbol}</span><code>{s.file}:{s.line}</code><ExternalLink size={13} /></a>)}</div>)}</>}</div><div className="hermes-source-list"><h3>Source owners</h3>{selected.source.map(s => <a key={`${s.file}:${s.line}`} href={`https://github.com/NousResearch/hermes-agent/blob/${sourceCommit}/${s.file}#L${s.line}`} target="_blank" rel="noreferrer"><span>{s.symbol}</span><code>{s.file}:{s.line}</code><ExternalLink size={13} /></a>)}</div><div className="hermes-node-study"><h3>Next: study this node together</h3><p>Internal steps, guards, state changes and failure behavior are awaiting our node-by-node review.</p></div></aside>
      </div><footer className="hermes-footer">Stately-inspired exploration inside Studio. This is a provisional source map, not an executable state machine or a Hermes run. Connections show selected relationships; detailed node behavior will be developed together.</footer>
    </>}
  </div>;
}
