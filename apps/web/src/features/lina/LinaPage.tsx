import type { OutputCase, OutputSettings } from './outputFixtures';
import type { EnvironmentCase, EnvironmentSettings } from './environmentFixtures';
import type { PlanningCase, PlanningSettings } from './planningFixtures';
import type { SubagentCase, SubagentSettings } from './subagentsFixtures';
import type { MemoryCase } from './memoryFixtures';
import { AgentSystemTabs } from '../system-explorer/AgentSystemTabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Download, Save, Undo2, PanelLeft, PanelRight, RotateCcw, RefreshCw } from 'lucide-react';
import { emptyLina, type LinaDocument, type LinaNode } from './linaModel';
import { linaInputBlock } from './inputBlock';
import { linaArchitecture, refreshDocumentation } from './architectureDocument';
import { LinaExecutionPath } from './LinaExecutionPath';
import { LinaNodeContract, LinaConnectionContract } from './LinaNodeContract';
import { LinaSimulation } from './LinaSimulation';
import { startSimulation, advanceSimulation, resetSimulation, pauseSimulation, resumeSimulation, stopSimulation, answerSimulation, selectSimulationWait, selectSimulationAgent, simulationView, activeSimulationNodes, type SimulationState, type SimulationChannel, type SimulationCase, type ContextCase, type ToolScenario } from './inputSimulation';
import { routeLinaEdge, LINA_NODE_WIDTH, LINA_NODE_HEIGHT } from './edgeRouting';
import { relationshipBlockLayout } from './blockLayout';
import { blockForNode } from './blockMembership';
import type { ModelProtocol, ModelCase } from './modelFixtures';
import type { SafetyCase } from './safetyFixtures';
import type { StateCase } from './stateFixtures';
import { plannedBlockRegions } from './plannedBlocks';
import './lina.css';

const api = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || 'http://127.0.0.1:4320').replace(/\/$/, '');
const draftKey = `agents-lab.lina.draft:${api}`;
const panelsKey = 'agents-lab.lina.panels';
const layoutKey = `${draftKey}:compact-layout-applied`;
const layoutRevision = 'output-relationships-2026-10-09';
function savedPanels(): { left: boolean; right: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(panelsKey) || 'null');
    return { left: value?.left === true, right: value?.right === true };
  } catch { return { left: false, right: false }; }
}
type Stored = { revision: number; document: LinaDocument | null };
async function request(method = 'GET', value?: Stored): Promise<Stored> {
  const response = await fetch(`${api}/lina`, { method, headers: value ? { 'content-type': 'application/json' } : undefined, body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `Database request failed (${response.status}).`);
  return data;
}
function isDocument(value: unknown): value is LinaDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as LinaDocument;
  return d.version === 1 && Array.isArray(d.nodes) && Array.isArray(d.edges)
    && d.nodes.every(n => n && ['id','title','area','status','purpose','inputs','outputs','decisions','references','experiments'].every(k => typeof n[k as keyof LinaNode] === 'string') && Number.isFinite(n.x) && Number.isFinite(n.y))
    && d.edges.every(e => e && ['id','source','target','label'].every(k => typeof e[k as keyof typeof e] === 'string'));
}

/** Editable architecture workspace. Explicit save commits a revision; edits made
 * during the request remain a separate local draft and cannot be falsely saved. */
export function LinaPage() {
  const [doc, setDoc] = useState<LinaDocument>(emptyLina);
  const live = useRef(doc);
  const inspector = useRef<HTMLElement>(null);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'design'|'contract'|'study'|'experiment'>('design');
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<'map' | 'path'>('map');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connections, setConnections] = useState<'all' | 'selected'>('all');
  const selectedEdge = doc.edges.find(edge => edge.id === selectedEdgeId);
  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [selected, selectedEdgeId, tab]);
  const [executionTrail, setExecutionTrail] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [followSimulation, setFollowSimulation] = useState(true);
  const simulationVisible = view === 'map' && simulation !== null;
  const inspectedSimulation = simulation ? simulationView(simulation) : null;
  const simulationNode = simulationVisible ? inspectedSimulation!.route[inspectedSimulation!.step] : undefined;
  const activeNodes = simulationVisible ? activeSimulationNodes(inspectedSimulation!) : [];
  const trail = simulationVisible ? inspectedSimulation!.route.slice(0, inspectedSimulation!.step + 1) : executionTrail;
  const [collapsed, setCollapsed] = useState(savedPanels);
  useEffect(() => {
    try { localStorage.setItem(panelsKey, JSON.stringify(collapsed)); }
    catch { /* Panel preferences are optional and do not affect design persistence. */ }
  }, [collapsed]);
  const [layoutUndo, setLayoutUndo] = useState<{ id: string; x: number; y: number }[] | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const blockDrag = useRef<{ pointerId: number; startX: number; startY: number; positions: { id: string; x: number; y: number }[] } | null>(null);
  const node = doc.nodes.find(n => n.id === selected);
  const mapScroll = useRef<HTMLDivElement>(null);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const zoomValue = useRef(zoom);
  zoomValue.current = zoom;
  const inputNodes = doc.nodes.filter(n => blockForNode(n) === 'input');
  const executionNodes = doc.nodes.filter(n => blockForNode(n) === 'execution');
  const contextNodes = doc.nodes.filter(n => blockForNode(n) === 'context');
  const toolsNodes = doc.nodes.filter(n => blockForNode(n) === 'tools');
  const modelNodes = doc.nodes.filter(n => blockForNode(n) === 'model');
  const safetyNodes = doc.nodes.filter(n => blockForNode(n) === 'safety');
  const stateNodes = doc.nodes.filter(n => blockForNode(n) === 'state');
  const subagentNodes = doc.nodes.filter(n => blockForNode(n) === 'subagents');
  const outputNodes = doc.nodes.filter(n => blockForNode(n) === 'output');
  const environmentNodes = doc.nodes.filter(n => blockForNode(n) === 'environment');
  const planningNodes = doc.nodes.filter(n => blockForNode(n) === 'planning');
  const memoryNodes = doc.nodes.filter(n => blockForNode(n) === 'memory');
  const blocks = [
    { key: 'input', title: '01 · Input and admission', nodes: inputNodes },
    { key: 'execution', title: '02 · Turn Execution', nodes: executionNodes },
    { key: 'context', title: '03 · Context', nodes: contextNodes },
    { key: 'tools', title: '05 · Tools', nodes: toolsNodes },
    { key: 'model', title: '06 · Model Interface', nodes: modelNodes },
    { key: 'safety', title: '08 · Safety and permissions', nodes: safetyNodes },
    { key: 'state', title: '13 · State, persistence and recovery', nodes: stateNodes },
    { key: 'memory', title: '04 · Memory', nodes: memoryNodes },
    { key: 'output', title: '11 · Output and delivery', nodes: outputNodes },
    { key: 'environment', title: '09 · Execution Environment', nodes: environmentNodes },
    { key: 'planning', title: '07 · Planning and task management', nodes: planningNodes },
    { key: 'subagents', title: '14 · Subagents / multi-agent orchestration', nodes: subagentNodes },
  ];

  const plannedRegions = plannedBlockRegions(doc);

  function focusPlannedBlock(key: string) {
    const block = plannedRegions.find(region => region.key === key);
    if (!block) return;
    const scale = Math.max(.85, zoom);
    zoomMap(scale);
    requestAnimationFrame(() => mapScroll.current?.scrollTo(
      Math.max(0, (block.x + block.width / 2) * scale - (mapScroll.current?.clientWidth ?? 0) / 2),
      Math.max(0, (block.y + block.height / 2) * scale - (mapScroll.current?.clientHeight ?? 0) / 2)));
  }

  function zoomMap(next: number, anchor?: { x: number; y: number }) {
    const viewport = mapScroll.current;
    const previous = zoomValue.current;
    const scale = Math.min(2, Math.max(.05, next));
    if (!viewport || scale === previous) return;
    const x = anchor?.x ?? viewport.clientWidth / 2;
    const y = anchor?.y ?? viewport.clientHeight / 2;
    const left = (viewport.scrollLeft + x) / previous * scale - x;
    const top = (viewport.scrollTop + y) / previous * scale - y;
    zoomValue.current = scale;
    setZoom(scale);
    requestAnimationFrame(() => viewport.scrollTo(Math.max(0, left), Math.max(0, top)));
  }

  useEffect(() => {
    const viewport = mapScroll.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (event.shiftKey) return; // Shift-wheel retains native canvas scrolling.
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      zoomMap(zoomValue.current * Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    // A non-passive listener prevents browser/page scrolling during canvas zoom.
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, []);

  function fitMap() {
    const viewport = mapScroll.current;
    if (!viewport) return;
    setZoom(Math.min(1, Math.max(.05, Math.min(viewport.clientWidth / width, viewport.clientHeight / height))));
    viewport.scrollTo(0, 0);
  }
  function centerNode(id: string) {
    const target = doc.nodes.find(n => n.id === id);
    if (!target) return;
    const scale = Math.max(.85, zoom);
    if (scale !== zoom) zoomMap(scale);
    requestAnimationFrame(() => {
      const viewport = mapScroll.current;
      if (viewport) viewport.scrollTo(Math.max(0, (target.x + LINA_NODE_WIDTH / 2) * scale - viewport.clientWidth / 2), Math.max(0, (target.y + LINA_NODE_HEIGHT / 2) * scale - viewport.clientHeight / 2));
    });
  }
  function focusNode(id: string) {
    selectNode(id); centerNode(id);
  }
  function selectNode(id: string) {
    setSelected(id);
    setSelectedEdgeId(null);
    setCollapsed(v => v.right ? { ...v, right: false } : v);
  }
  function runSimulation(channel: SimulationChannel, automatic: boolean, executionCase: SimulationCase, maxRounds: number, contextCase: ContextCase, toolScenario: ToolScenario, follow: boolean, modelProtocol: ModelProtocol, modelCase: ModelCase, safetyCase: SafetyCase, stateCase: StateCase, memoryCase: MemoryCase, subagentCase: SubagentCase, subagentSettings: Partial<SubagentSettings>, planningCase: PlanningCase, planningSettings: Partial<PlanningSettings>, environmentCase: EnvironmentCase, environmentSettings: Partial<EnvironmentSettings>, outputCase: OutputCase, outputSettings: Partial<OutputSettings>) {
    setFollowSimulation(follow);
    setView('map'); setExecutionTrail([]);
    setSimulation(startSimulation(channel, doc, automatic, executionCase, maxRounds, contextCase, toolScenario, modelProtocol, modelCase, safetyCase, simulation?.safetyGrants ?? [], stateCase, memoryCase, subagentCase, subagentSettings, planningCase, planningSettings, environmentCase, environmentSettings, outputCase, outputSettings));
  }
  useEffect(() => {
    if (simulationNode && followSimulation) centerNode(simulationNode);
  }, [simulationNode, followSimulation]);
  useEffect(() => {
    if (view !== 'map' || !ready || simulation?.status !== 'running') return;
    const timer = window.setTimeout(() => {
      setSimulation(current => current?.status === 'running' ? advanceSimulation(current, live.current) : current);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [simulation, view, ready]);

  function resetInputLayout() {
    const defaults = new Map(linaInputBlock.nodes.map(n => [n.id, n]));
    const outside = doc.nodes.filter(n => !defaults.has(n.id) && !n.id.startsWith('lina-execution-'));
    const offset = outside.length ? Math.max(...outside.map(n => n.x + LINA_NODE_WIDTH + 200)) : 0;
    const next = { ...doc, nodes: doc.nodes.map(n => {
      const position = defaults.get(n.id);
      return position ? { ...n, x: position.x + offset, y: position.y } : n;
    }) };
    setLayoutUndo(doc.nodes.filter(n => defaults.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })));
    change(next);
    mapScroll.current?.scrollTo(0, 0);
  }

  async function load(databaseOnly = false) {
    setBusy(true); setError('');
    try {
      const saved = await request();
      const raw = localStorage.getItem(draftKey);
      const draft = !databaseOnly && raw ? JSON.parse(raw) as Stored : null;
      if (draft && (!Number.isInteger(draft.revision) || !isDocument(draft.document))) throw new Error('The local draft has an invalid format. It has been preserved.');
      const original = draft?.document ?? saved.document ?? emptyLina;
      if (!isDocument(original)) throw new Error('The database returned an invalid design.');
      let next = refreshDocumentation(original);
      // Apply this requested layout update once, even when a browser draft is older
      // than the stored design. Retain its positions for undo and back up the draft.
      if (localStorage.getItem(layoutKey) !== layoutRevision && next.nodes.some(n => n.id.startsWith('lina-input-'))) {
        localStorage.setItem(`${draftKey}:before-layout-update`, JSON.stringify({ revision: draft?.revision ?? saved.revision, document: original }));
        setLayoutUndo(next.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })));
        next = relationshipBlockLayout(next);
        localStorage.setItem(layoutKey, layoutRevision);
      }
      const updated = JSON.stringify(next) !== JSON.stringify(original);
      // An old draft can safely adopt the saved revision only when refresh produces
      // identical content, connections, and positions. Distinct edits still conflict.
      const reconciled = !!draft && draft.revision !== saved.revision
        && JSON.stringify(next) === JSON.stringify(refreshDocumentation(saved.document ?? emptyLina));
      const baseRevision = !draft || reconciled ? saved.revision : draft.revision;
      const savedMatch = JSON.stringify(next) === JSON.stringify(saved.document);
      if (savedMatch && reconciled) localStorage.removeItem(draftKey);
      else if (updated || reconciled) localStorage.setItem(draftKey, JSON.stringify({ revision: baseRevision, document: next }));
      live.current = next; setDoc(next); setRevision(baseRevision);
      setDirty(!savedMatch || (!!draft && !reconciled)); setReady(true);
      requestAnimationFrame(() => {
        const viewport = mapScroll.current;
        if (!viewport || !next.nodes.length) return;
        const regions = plannedBlockRegions(next);
        const w = Math.max(1600, ...next.nodes.map(n => n.x + LINA_NODE_WIDTH + 500), ...regions.map(region => region.x + region.width + 100));
        const h = Math.max(1000, ...next.nodes.map(n => n.y + LINA_NODE_HEIGHT + 300), ...regions.map(region => region.y + region.height + 100));
        const scale = Math.min(1, Math.max(.05, Math.min(viewport.clientWidth / w, viewport.clientHeight / h)));
        zoomValue.current = scale; setZoom(scale); viewport.scrollTo(0, 0);
      });
      if (draft && draft.revision !== saved.revision && !reconciled) setError('The database has a newer revision. Download your draft before loading the database copy.');
      if (databaseOnly) { if (!updated) localStorage.removeItem(draftKey); setSelected(''); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Database unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [linaArchitecture]);
  function change(next: LinaDocument) {
    try { localStorage.setItem(draftKey, JSON.stringify({ revision, document: next })); }
    catch { setError('The browser could not back up this edit. The change was not accepted.'); return; }
    live.current = next; setDoc(next); setDirty(true);
  }
  async function save() {
    const submitted = live.current;
    setBusy(true); setError('');
    try {
      const saved = await request('PUT', { revision, document: submitted });
      setRevision(saved.revision);
      if (live.current === submitted) { localStorage.removeItem(draftKey); setDirty(false); }
      else localStorage.setItem(draftKey, JSON.stringify({ revision: saved.revision, document: live.current }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ revision, document: doc }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'lina-architecture.json'; a.click(); URL.revokeObjectURL(url);
  }
  const routedConnections = useMemo(() => doc.edges.map((edge, index) => ({
    edge, route: routeLinaEdge(edge, doc.nodes, index),
  })), [doc.nodes, doc.edges]);
  const width = Math.max(1600, ...doc.nodes.map(n => n.x + LINA_NODE_WIDTH + 500), ...plannedRegions.map(region => region.x + region.width + 100));
  const height = Math.max(1000, ...doc.nodes.map(n => n.y + LINA_NODE_HEIGHT + 300), ...plannedRegions.map(region => region.y + region.height + 100));
  const field = (key: 'purpose'|'inputs'|'outputs'|'decisions'|'references'|'experiments', label: string) => {
    const value = node?.[key]?.trim();
    if (!value) return null;
    const lines = value.split('\n').filter(line => line.trim());
    return <section className="lina-node-note"><h3>{label}</h3>{lines.every(line => line.startsWith('- '))
      ? <ul>{lines.map((line, index) => <li key={index}>{line.slice(2)}</li>)}</ul>
      : <div className="lina-note-text">{value}</div>}</section>;
  };

  return <div className="lina-page">
    <header className="lina-header"><div><Link to="/studio" className="lina-back"><ArrowLeft size={14} /> Studio</Link><div className="lina-heading"><h1>Lina</h1><span>Architecture workspace</span></div><p>Study the architecture one component at a time.</p></div>
      <div className="lina-actions"><span role="status">{busy ? 'Connecting…' : error ? 'Needs attention' : dirty ? 'Draft · not saved to database' : ready ? `Saved to database · v${revision}` : 'Database unavailable'}</span><button onClick={download} disabled={!ready} title="Download architecture backup"><Download size={14} /> Export</button><button className="lina-primary" onClick={() => void save()} disabled={!ready || busy || !dirty}><Save size={14} /> Save design</button></div></header>
    <AgentSystemTabs active="lina"><Link to="/studio/comparison">Comparison</Link></AgentSystemTabs>
    <div className="lina-view-tabs" aria-label="Architecture views"><button aria-pressed={view === 'map'} onClick={() => { setView('map'); setExecutionTrail([]); }}>Architecture map</button><button aria-pressed={view === 'path'} onClick={() => { setView('path'); setSimulation(current => current ? pauseSimulation(current) : current); }}>Follow a message</button></div>
    <LinaSimulation document={doc} state={simulation} active={view === 'map'} disabled={!ready || busy}
      onStart={runSimulation}
      onPause={() => setSimulation(current => current ? pauseSimulation(current) : current)}
      onResume={() => setSimulation(current => current ? resumeSimulation(current) : current)}
      onNext={() => setSimulation(current => current ? advanceSimulation(pauseSimulation(current), doc) : current)}
      onReset={() => setSimulation(current => current ? resetSimulation(current, doc) : current)}
      onStop={() => setSimulation(current => current ? stopSimulation(current, doc) : current)}
      onSelectAgent={agentId => setSimulation(current => current ? selectSimulationAgent(current, agentId) : current)}
      onSelectWait={waitId => setSimulation(current => current ? selectSimulationWait(current, waitId) : current)}
      onAnswer={answer => setSimulation(current => current ? answerSimulation(current, doc, answer) : current)}/>
    {view === 'path' && ready && <LinaExecutionPath document={doc} onFocus={focusNode} onTrail={setExecutionTrail}/>}
    <div className="lina-block-tools"><span>Input, Turn Execution, Context, Tools, Model, Safety, State, Memory, Subagents, Planning, Environment and Output · design draft</span><button disabled={busy} onClick={() => void load()} title="Reload stored design while preserving the browser draft"><RefreshCw size={14}/> Reload design</button><button disabled={!ready || busy} onClick={() => {
        setLayoutUndo(doc.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })));
        change(relationshipBlockLayout(doc));
        requestAnimationFrame(fitMap);
      }}>Arrange blocks</button><button disabled={!ready || busy || inputNodes.length === 0} onClick={resetInputLayout}><RotateCcw size={14}/> Reset input layout</button><div className="lina-panel-controls"><button aria-label={collapsed.left ? 'Expand components sidebar' : 'Collapse components sidebar'} aria-expanded={!collapsed.left} aria-controls="lina-components" onClick={() => setCollapsed(v => ({ ...v, left: !v.left }))}><PanelLeft size={14}/> Components</button><button aria-label={collapsed.right ? 'Expand inspector sidebar' : 'Collapse inspector sidebar'} aria-expanded={!collapsed.right} aria-controls="lina-inspector" onClick={() => setCollapsed(v => ({ ...v, right: !v.right }))}><PanelRight size={14}/> Inspector</button></div></div>
    {error && <div role="alert" className="lina-error">{error}<button disabled={busy} onClick={() => void (ready ? save() : load())}>Retry</button>{ready && <button disabled={busy} onClick={() => void load(true)}>Load database copy (discard draft)</button>}</div>}
    <div className={`lina-workspace ${collapsed.left ? 'left-collapsed' : ''} ${collapsed.right ? 'right-collapsed' : ''}`}><aside id="lina-components" hidden={collapsed.left} className="lina-index"><div className="lina-section-title"><h2>Components</h2></div>
      {doc.nodes.length === 0 ? <p className="lina-muted">Your architecture starts here.</p> : doc.nodes.map(n => <button className={`lina-index-node ${selected === n.id ? 'is-selected' : ''}`} key={n.id} onClick={() => focusNode(n.id)}><span className={`lina-dot ${n.status}`} /><span>{n.title}<small>{n.area}</small></span></button>)}
      {plannedRegions.length > 0 && <div className="lina-planned-index"><h2>Planned blocks</h2>{plannedRegions.map(block => <button key={block.key} onClick={() => focusPlannedBlock(block.key)}>{block.title}</button>)}</div>}
      <div className="lina-index-footer">{doc.nodes.length} components · {doc.edges.length} connections<div><span className="lina-dot proposed" /> Proposed <span className="lina-dot studying" /> Studying <span className="lina-dot decided" /> Decided</div></div></aside>
      <section className="lina-map" aria-label="Lina architecture canvas"><div className="lina-map-toolbar"><span>Architecture map</span><div><select aria-label="Connection visibility" value={connections} onChange={event => setConnections(event.target.value as 'all' | 'selected')}><option value="all">All relationships</option><option value="selected">Selected node only</option></select><button onClick={() => zoomMap(zoom / 1.2)} disabled={zoom <= .05} aria-label="Zoom out">−</button><span>{Math.round(zoom*100)}%</span><button onClick={() => zoomMap(zoom * 1.2)} disabled={zoom >= 2} aria-label="Zoom in">+</button><button onClick={fitMap}>Fit</button></div></div>
        {layoutUndo && <div className="lina-layout-undo">Layout updated. Previous positions kept.<button onClick={() => {
          const positions = new Map(layoutUndo.map(n => [n.id, n]));
          change({ ...doc, nodes: doc.nodes.map(n => { const p = positions.get(n.id); return p ? { ...n, x: p.x, y: p.y } : n; }) });
          setLayoutUndo(null);
        }}><Undo2 size={13}/> Undo layout reset</button></div>}
        <div className={`lina-map-scroll ${panning ? 'is-panning' : ''}`} ref={mapScroll}
          onPointerDown={e => {
            if (e.button !== 0 || (e.target as Element).closest('button, [role="button"]')) return;
            const viewport = e.currentTarget;
            pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            viewport.setPointerCapture(e.pointerId); setPanning(true); e.preventDefault();
          }}
          onPointerMove={e => {
            const start = pan.current;
            if (!start || start.pointerId !== e.pointerId) return;
            e.currentTarget.scrollLeft = start.left - (e.clientX - start.x);
            e.currentTarget.scrollTop = start.top - (e.clientY - start.y);
          }}
          onPointerUp={e => {
            if (pan.current?.pointerId !== e.pointerId) return;
            pan.current = null; setPanning(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => { pan.current = null; setPanning(false); }}
          onLostPointerCapture={() => { pan.current = null; setPanning(false); }}
        ><div style={{ width: width*zoom, height:height*zoom }}><div className="lina-canvas" data-simulation-running={simulationVisible && simulation.status === 'running'} style={{ width,height,transform:`scale(${zoom})`,transformOrigin:'top left' }}>
          {blocks.filter(block => block.nodes.length > 0).map(block => <div key={block.key} className="lina-block-region" style={{ left: Math.min(...block.nodes.map(n => n.x))-25, top: Math.min(...block.nodes.map(n => n.y))-75, width: Math.max(...block.nodes.map(n => n.x+LINA_NODE_WIDTH))-Math.min(...block.nodes.map(n => n.x))+50, height: Math.max(...block.nodes.map(n => n.y+LINA_NODE_HEIGHT))-Math.min(...block.nodes.map(n => n.y))+100 }}><button className="lina-block-handle" aria-label={`Drag ${block.key} block`} disabled={!ready || busy}
              onPointerDown={e => {
                if (e.button !== 0) return;
                e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
                blockDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, positions: block.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })) };
              }}
              onPointerMove={e => {
                const start = blockDrag.current;
                if (!start || start.pointerId !== e.pointerId) return;
                e.stopPropagation();
                const dx = Math.max(20 - Math.min(...start.positions.map(n => n.x)), Math.round((e.clientX - start.startX) / zoom));
                const dy = Math.max(80 - Math.min(...start.positions.map(n => n.y)), Math.round((e.clientY - start.startY) / zoom));
                if (dx === 0 && dy === 0) return;
                const positions = new Map(start.positions.map(n => [n.id, n]));
                change({ ...live.current, nodes: live.current.nodes.map(n => { const original = positions.get(n.id); return original ? { ...n, x: original.x + dx, y: original.y + dy } : n; }) });
              }}
              onPointerUp={e => { blockDrag.current = null; if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
              onPointerCancel={() => { blockDrag.current = null; }}
              onLostPointerCapture={() => { blockDrag.current = null; }}
            >{block.title} <span>Drag block</span></button></div>)}
          {plannedRegions.map(block => <section key={block.key} className="lina-block-region lina-planned-region" aria-label={`${block.title} block · empty`} style={{ left: block.x, top: block.y, width: block.width, height: block.height }}><h2>{block.number} · {block.title}</h2><span>{block.note ?? 'Not designed yet'}</span></section>)}
          <svg width={width} height={height} role="group" aria-label="Component connections"><defs><marker id="lina-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="context-stroke" /></marker></defs>{routedConnections.map(({ edge, route }) => {
            if (!route.path) return null;
            const traversed = simulationVisible
              ? inspectedSimulation!.transitions.slice(0, inspectedSimulation!.step).includes(edge.id)
              : trail.some((id, step) => id === edge.source && trail[step + 1] === edge.target);
            const connected = edge.source === selected || edge.target === selected;
            const simulationEdge = simulationVisible && (traversed || edge.id === inspectedSimulation!.transitions[inspectedSimulation!.step]);
            const justTraversed = simulationVisible && inspectedSimulation!.step > 0 && edge.id === inspectedSimulation!.transitions[inspectedSimulation!.step - 1];
            if (connections === 'selected' && !connected && !simulationEdge) return null;
            const source = doc.nodes.find(n => n.id === edge.source), target = doc.nodes.find(n => n.id === edge.target);
            return <g key={edge.id} className={`lina-map-edge ${connected ? 'is-connected' : ''} ${selectedEdgeId === edge.id ? 'is-inspected' : ''} ${traversed ? 'lina-traversed-edge' : ''} ${simulationEdge ? 'is-simulation-edge' : ''} ${justTraversed ? 'is-current-transition' : ''}`}>
              <path d={route.path} markerEnd="url(#lina-arrow)"/>
              {(connected || simulationEdge) && <text x={route.labelX} y={route.labelY} textAnchor={route.labelAnchor ?? 'middle'}>{edge.label}</text>}
              <path className="lina-edge-hit" d={route.path} role="button" tabIndex={connected || simulationEdge ? 0 : -1}
                aria-label={`Inspect relationship: ${source?.title ?? edge.source} to ${target?.title ?? edge.target}: ${edge.label}`}
                onClick={() => { setSelectedEdgeId(edge.id); setCollapsed(v => ({ ...v, right: false })); }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdgeId(edge.id); setCollapsed(v => ({ ...v, right: false })); } }}/>
              <title>{source?.title} → {target?.title}: {edge.label}</title>
            </g>;
          })}</svg>
          {doc.nodes.map(n => <button key={n.id} aria-label={`Select ${n.title}`} aria-current={simulationNode === n.id ? 'step' : undefined} className={`lina-canvas-node ${n.status} ${selected===n.id?'is-selected':''} ${trail.includes(n.id)?'is-visited':''} ${simulationVisible && trail.includes(n.id) ? 'is-simulation-visited' : ''} ${simulationNode === n.id ? 'is-simulation-current' : ''} ${activeNodes.includes(n.id) ? 'is-simulation-active' : ''}`} style={{ left:n.x,top:n.y }} onClick={()=>selectNode(n.id)} onPointerDown={e=>{ if(e.button!==0)return; e.currentTarget.setPointerCapture(e.pointerId); drag.current={id:n.id,startX:e.clientX,startY:e.clientY,x:n.x,y:n.y}; selectNode(n.id); }} onPointerMove={e=>{ const d=drag.current;if(!d||d.id!==n.id)return; const x=Math.max(20,Math.round(d.x+(e.clientX-d.startX)/zoom)),y=Math.max(20,Math.round(d.y+(e.clientY-d.startY)/zoom));change({...live.current,nodes:live.current.nodes.map(v=>v.id===d.id?{...v,x,y}:v)}); }} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}><small>{n.area}</small><strong>{n.title}</strong><span><i className={`lina-dot ${n.status}`} />{n.status}</span>{simulationVisible && inspectedSimulation!.operations.some(op => op.nodeId === n.id && ['running', 'waiting'].includes(op.status)) && <span className="lina-node-operations">{inspectedSimulation!.operations.filter(op => op.nodeId === n.id && ['running', 'waiting'].includes(op.status)).map(op => <code key={op.callId}>{op.callId} · {op.status}</code>)}</span>}{simulationVisible && inspectedSimulation!.modelWork?.nodeId===n.id && !['terminal','cancelled'].includes(inspectedSimulation!.modelWork.phase) && <span className="lina-node-operations"><code>{inspectedSimulation!.modelWork.attemptId ?? 'model intent'} · {inspectedSimulation!.modelWork.phase}</code></span>}</button>)}
          {doc.nodes.length===0 && <div className="lina-empty"><h2>No architecture components yet.</h2><p>Components will be added as we develop the design together.</p></div>}
        </div></div></div></section>
      <aside ref={inspector} id="lina-inspector" hidden={collapsed.right} className="lina-inspector">{selectedEdge ? <>
        <div className="lina-section-title"><h2>Connection</h2></div>
        <h2 className="lina-node-title">{selectedEdge.label || 'Connection'}</h2>
        <div className="lina-edge-endpoints"><button onClick={() => focusNode(selectedEdge.source)}>{doc.nodes.find(n => n.id === selectedEdge.source)?.title ?? selectedEdge.source}</button><span>→</span><button onClick={() => focusNode(selectedEdge.target)}>{doc.nodes.find(n => n.id === selectedEdge.target)?.title ?? selectedEdge.target}</button></div>
        <button onClick={() => setSelectedEdgeId(null)}>Return to node</button>
        <LinaConnectionContract key={selectedEdge.id} edgeId={selectedEdge.id}/>
      </> : node ? <>
        <div className="lina-section-title"><h2>Component documentation</h2></div>
        <h2 className="lina-node-title">{node.title}</h2>
        <div className="lina-node-meta"><span>{node.area}</span><span><i className={`lina-dot ${node.status}`}/> {node.status}</span></div>
        <div className="lina-tabs" role="tablist" aria-label="Component notes">{(['design','contract','study','experiment'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{t==='experiment'?'Experiments':t==='study'?'Study':t==='contract'?'Contract':'Design'}</button>)}</div>
        <div role="tabpanel">{tab==='design'?<>
          {field('purpose','Responsibilities')}{field('inputs','Inputs')}{field('outputs','Outputs')}{field('decisions','Decisions and open questions')}

        </>:tab==='contract'?<LinaNodeContract key={node.id} nodeId={node.id}/>:tab==='study'?field('references','Source mapping'):field('experiments','Alternatives and experiment ideas') || <p className="lina-muted">No experiments specified for this component yet.</p>}</div>
      </>:<div className="lina-inspector-empty"><h2>Node by node.</h2><p>Select a component to read its responsibilities, inputs, outputs, and design decisions.</p></div>}</aside>
    </div><footer className="lina-footer">Design document · local SQLite storage · hosted backup not configured</footer>
  </div>;
}
