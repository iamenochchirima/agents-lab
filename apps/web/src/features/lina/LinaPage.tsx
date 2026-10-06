import { AgentSystemTabs } from '../system-explorer/AgentSystemTabs';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Download, Save, Undo2, PanelLeft, PanelRight, RotateCcw } from 'lucide-react';
import { emptyLina, type LinaDocument, type LinaNode } from './linaModel';
import { linaInputBlock } from './inputBlock';
import './lina.css';

const api = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || 'http://127.0.0.1:4320').replace(/\/$/, '');
const draftKey = `agents-lab.lina.draft:${api}`;
const panelsKey = 'agents-lab.lina.panels';
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

/** Refresh maintained documentation without changing user-arranged positions or edges.
 * Only empty, unconnected placeholders created by the former add button are removed. */
function refreshDocumentation(document: LinaDocument): LinaDocument {
  const defaults = new Map(linaInputBlock.nodes.map(n => [n.id, n]));
  const nodes = document.nodes.filter(n => !(n.title === 'New component'
    && ['purpose', 'inputs', 'outputs', 'decisions', 'references', 'experiments'].every(k => !n[k as keyof LinaNode])
    && !document.edges.some(e => e.source === n.id || e.target === n.id)))
    .map(n => {
      const maintained = defaults.get(n.id);
      return maintained ? { ...n, purpose: maintained.purpose, inputs: maintained.inputs,
        outputs: maintained.outputs, decisions: maintained.decisions, references: maintained.references } : n;
    });
  return { ...document, nodes };
}

/** Editable architecture workspace. Explicit save commits a revision; edits made
 * during the request remain a separate local draft and cannot be falsely saved. */
export function LinaPage() {
  const [doc, setDoc] = useState<LinaDocument>(emptyLina);
  const live = useRef(doc);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'design'|'study'|'experiment'>('design');
  const [zoom, setZoom] = useState(1);
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
  const inputNodes = doc.nodes.filter(n => n.id.startsWith('lina-input-'));

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
  function focusNode(id: string) {
    const target = doc.nodes.find(n => n.id === id);
    if (!target) return;
    selectNode(id);
    const scale = zoom;
    requestAnimationFrame(() => {
      const viewport = mapScroll.current;
      if (viewport) viewport.scrollTo(Math.max(0, (target.x + 110) * scale - viewport.clientWidth / 2), Math.max(0, (target.y + 56) * scale - viewport.clientHeight / 2));
    });
  }
  function selectNode(id: string) {
    setSelected(id);
    setCollapsed(v => v.right ? { ...v, right: false } : v);
  }
  function resetInputLayout() {
    const defaults = new Map(linaInputBlock.nodes.map(n => [n.id, n]));
    const outside = doc.nodes.filter(n => !defaults.has(n.id));
    const offset = outside.length ? Math.max(...outside.map(n => n.x + 300)) : 0;
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
      const next = refreshDocumentation(original);
      const updated = JSON.stringify(next) !== JSON.stringify(original);
      if (updated) localStorage.setItem(draftKey, JSON.stringify({ revision: draft ? draft.revision : saved.revision, document: next }));
      live.current = next; setDoc(next); setRevision(draft ? draft.revision : saved.revision);
      setDirty(!!draft || updated); setReady(true);
      if (draft && draft.revision !== saved.revision) setError('The database has a newer revision. Download your draft before loading the database copy.');
      if (databaseOnly) { if (!updated) localStorage.removeItem(draftKey); setSelected(''); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Database unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
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
  const width = Math.max(1300, ...doc.nodes.map(n => n.x + 300));
  const height = Math.max(850, ...doc.nodes.map(n => n.y + 220));
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
    <div className="lina-block-tools"><span>Input block · design draft</span><button disabled={!ready || busy || inputNodes.length === 0} onClick={resetInputLayout}><RotateCcw size={14}/> Reset input layout</button><div className="lina-panel-controls"><button aria-label={collapsed.left ? 'Expand components sidebar' : 'Collapse components sidebar'} aria-expanded={!collapsed.left} aria-controls="lina-components" onClick={() => setCollapsed(v => ({ ...v, left: !v.left }))}><PanelLeft size={14}/> Components</button><button aria-label={collapsed.right ? 'Expand inspector sidebar' : 'Collapse inspector sidebar'} aria-expanded={!collapsed.right} aria-controls="lina-inspector" onClick={() => setCollapsed(v => ({ ...v, right: !v.right }))}><PanelRight size={14}/> Inspector</button></div></div>
    {error && <div role="alert" className="lina-error">{error}<button disabled={busy} onClick={() => void (ready ? save() : load())}>Retry</button>{ready && <button disabled={busy} onClick={() => void load(true)}>Load database copy (discard draft)</button>}</div>}
    <div className={`lina-workspace ${collapsed.left ? 'left-collapsed' : ''} ${collapsed.right ? 'right-collapsed' : ''}`}><aside id="lina-components" hidden={collapsed.left} className="lina-index"><div className="lina-section-title"><h2>Components</h2></div>
      {doc.nodes.length === 0 ? <p className="lina-muted">Your architecture starts here.</p> : doc.nodes.map(n => <button className={`lina-index-node ${selected === n.id ? 'is-selected' : ''}`} key={n.id} onClick={() => focusNode(n.id)}><span className={`lina-dot ${n.status}`} /><span>{n.title}<small>{n.area}</small></span></button>)}
      <div className="lina-index-footer">{doc.nodes.length} components · {doc.edges.length} connections<div><span className="lina-dot proposed" /> Proposed <span className="lina-dot studying" /> Studying <span className="lina-dot decided" /> Decided</div></div></aside>
      <section className="lina-map" aria-label="Lina architecture canvas"><div className="lina-map-toolbar"><span>Architecture map</span><div><button onClick={() => zoomMap(zoom / 1.2)} disabled={zoom <= .05} aria-label="Zoom out">−</button><span>{Math.round(zoom*100)}%</span><button onClick={() => zoomMap(zoom * 1.2)} disabled={zoom >= 2} aria-label="Zoom in">+</button><button onClick={fitMap}>Fit</button></div></div>
        {layoutUndo && <div className="lina-layout-undo">Input layout reset.<button onClick={() => {
          const positions = new Map(layoutUndo.map(n => [n.id, n]));
          change({ ...doc, nodes: doc.nodes.map(n => { const p = positions.get(n.id); return p ? { ...n, x: p.x, y: p.y } : n; }) });
          setLayoutUndo(null);
        }}><Undo2 size={13}/> Undo layout reset</button></div>}
        <div className={`lina-map-scroll ${panning ? 'is-panning' : ''}`} ref={mapScroll}
          onPointerDown={e => {
            if (e.button !== 0 || (e.target as Element).closest('button')) return;
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
        ><div style={{ width: width*zoom, height:height*zoom }}><div className="lina-canvas" style={{ width,height,transform:`scale(${zoom})`,transformOrigin:'top left' }}>
          {inputNodes.length > 0 && <div className="lina-block-region" style={{ left: Math.min(...inputNodes.map(n => n.x))-25, top: Math.min(...inputNodes.map(n => n.y))-75, width: Math.max(...inputNodes.map(n => n.x+220))-Math.min(...inputNodes.map(n => n.x))+50, height: Math.max(...inputNodes.map(n => n.y+112))-Math.min(...inputNodes.map(n => n.y))+100 }}><button className="lina-block-handle" aria-label="Drag input block" disabled={!ready || busy}
              onPointerDown={e => {
                if (e.button !== 0) return;
                e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
                blockDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, positions: inputNodes.map(n => ({ id: n.id, x: n.x, y: n.y })) };
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
            >01 · Input and admission <span>Drag block</span></button><p>Adapters → identity and access → durable input → dispatch branches. Execution and delivery are external handoffs.</p></div>}
          <svg width={width} height={height} aria-label="Component connections"><defs><marker id="lina-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>{doc.edges.map(e => { const a=doc.nodes.find(n=>n.id===e.source),b=doc.nodes.find(n=>n.id===e.target); if(!a||!b)return null; const sideways = Math.abs(a.x-b.x) > Math.abs(a.y-b.y); const right=b.x>a.x; const down=b.y>a.y; const x1=sideways?a.x+(right?220:0):a.x+110,y1=sideways?a.y+56:a.y+(down?112:0),x2=sideways?b.x+(right?0:220):b.x+110,y2=sideways?b.y+56:b.y+(down?0:112); return <g key={e.id}><path d={!sideways && Math.abs(y2-y1)>100 ? `M${x1},${y1} H${x1+145} V${y2-24} H${x2} V${y2}` : sideways?`M${x1},${y1} H${(x1+x2)/2} V${y2} H${x2}`:`M${x1},${y1} V${(y1+y2)/2} H${x2} V${y2}`} markerEnd="url(#lina-arrow)" /><text x={(x1+x2)/2+8} y={(y1+y2)/2}>{e.label}</text></g>; })}</svg>
          {doc.nodes.map(n => <button key={n.id} aria-label={`Select ${n.title}`} className={`lina-canvas-node ${n.status} ${selected===n.id?'is-selected':''}`} style={{ left:n.x,top:n.y }} onClick={()=>selectNode(n.id)} onPointerDown={e=>{ if(e.button!==0)return; e.currentTarget.setPointerCapture(e.pointerId); drag.current={id:n.id,startX:e.clientX,startY:e.clientY,x:n.x,y:n.y}; selectNode(n.id); }} onPointerMove={e=>{ const d=drag.current;if(!d||d.id!==n.id)return; const x=Math.max(20,Math.round(d.x+(e.clientX-d.startX)/zoom)),y=Math.max(20,Math.round(d.y+(e.clientY-d.startY)/zoom));change({...live.current,nodes:live.current.nodes.map(v=>v.id===d.id?{...v,x,y}:v)}); }} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}><small>{n.area}</small><strong>{n.title}</strong><span><i className={`lina-dot ${n.status}`} />{n.status}</span></button>)}
          {doc.nodes.length===0 && <div className="lina-empty"><h2>No architecture components yet.</h2><p>Components will be added as we develop the design together.</p></div>}
        </div></div></div></section>
      <aside id="lina-inspector" hidden={collapsed.right} className="lina-inspector">{node ? <>
        <div className="lina-section-title"><h2>Component documentation</h2></div>
        <h2 className="lina-node-title">{node.title}</h2>
        <div className="lina-node-meta"><span>{node.area}</span><span><i className={`lina-dot ${node.status}`}/> {node.status}</span></div>
        <div className="lina-tabs" role="tablist" aria-label="Component notes">{(['design','study','experiment'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{t==='experiment'?'Experiments':t==='study'?'Study':'Design'}</button>)}</div>
        <div role="tabpanel">{tab==='design'?<>
          {field('purpose','Responsibilities')}{field('inputs','Inputs')}{field('outputs','Outputs')}{field('decisions','Decisions and open questions')}
          {doc.edges.some(e => e.source === selected) && <section className="lina-node-note"><h3>Outgoing connections</h3><ul>{doc.edges.filter(e=>e.source===selected).map(e=><li key={e.id}>{e.label || 'Connection'} → {doc.nodes.find(n=>n.id===e.target)?.title}</li>)}</ul></section>}
        </>:tab==='study'?field('references','Source mapping'):field('experiments','Alternatives and experiment ideas') || <p className="lina-muted">No experiments specified for this component yet.</p>}</div>
      </>:<div className="lina-inspector-empty"><h2>Node by node.</h2><p>Select a component to read its responsibilities, inputs, outputs, and design decisions.</p></div>}</aside>
    </div><footer className="lina-footer">Design document · local SQLite storage · hosted backup not configured</footer>
  </div>;
}
