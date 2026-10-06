import { ArrowLeft, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { COMPARISON_CATEGORIES, type ComparisonNote, type ComparisonAgent, type ComparisonCategory } from './comparisonStore';
import { useComparisonDatabase } from './comparisonDatabase';
import './system-comparison.css';

const agents = [
  { key: 'hermes', label: 'Hermes' }, { key: 'openclaw', label: 'OpenClaw' },
  { key: 'pi', label: 'Pi' }, { key: 'waku', label: 'Waku' },
] as const;

/** Fixed comparison topics contain independently editable user notes in each agent cell. */
export function SystemComparisonPage({ embedded = false }: { embedded?: boolean }) {
  const database = useComparisonDatabase();
  const { notes, error } = database;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<ComparisonNote | null>(null);
  const locked = !database.ready;

  function add(category: ComparisonCategory, agent: ComparisonAgent) {
    const id = crypto.randomUUID();
    database.put({ id, category, agent, text: '' }); setFocusId(id);
  }
  function remove(id: string) {
    const note = notes.find(item => item.id === id);
    if (note) setDeleted(note);
    database.remove(id);
  }
  function undo() {
    if (!deleted) return;
    database.put(deleted); setDeleted(null);
  }

  return <div className={`comparison-page${embedded ? " comparison-embedded" : ""}`}>
    <header className="comparison-header"><div>
      {!embedded && <Link className="comparison-back" to="/studio/explorers"><ArrowLeft size={14} /> System explorers</Link>}
      {embedded ? <h2>System comparison</h2> : <h1>System comparison</h1>}<p>Topics stay in place. Add small items inside each agent’s cell.</p>
    </div><span className="comparison-save" role="status">{error ? 'Not saved to database' : !database.ready ? 'Loading database…' : database.busy || database.pending ? 'Saving…' : 'Saved to database'}</span></header>
    {error && <p className="comparison-error" role="alert">{error} {locked ? 'Saved notes remain unchanged.' : 'Pending edits are backed up in this browser.'} <button onClick={database.retry} disabled={database.busy}>Retry</button></p>}
    {deleted && <div className="comparison-undo" role="status"><span>Item removed.</span><button onClick={undo}><Undo2 size={14} /> Undo</button><button aria-label="Dismiss removal notice" onClick={() => setDeleted(null)}>Dismiss</button></div>}
    <div className="comparison-table-scroll"><table className="comparison-table"><thead><tr><th scope="col">Comparison topic</th>{agents.map(agent => <th scope="col" key={agent.key}><Link to={`/studio/${agent.key}`}>{agent.label} ↗</Link></th>)}</tr></thead>
      <tbody>{COMPARISON_CATEGORIES.map((category, index) => <tr key={category}><th scope="row" className="comparison-topic"><small>{String(index + 1).padStart(2, '0')}</small><span>{category}</span></th>
        {agents.map(agent => <td key={agent.key}>
          <div className="comparison-cell-items">{notes.filter(note => note.category === category && note.agent === agent.key).map((note, noteIndex) => <div className="comparison-cell-item" key={note.id}>
            <textarea rows={2} aria-label={`${agent.label} · ${category} · item ${noteIndex + 1}`} placeholder="Write a small item…" value={note.text} disabled={locked}
              ref={element => { if (element && focusId === note.id) element.focus(); }} onBlur={() => { if (focusId === note.id) setFocusId(null); }}
              onChange={e => database.put({ ...note, text: e.target.value })} />
            <button aria-label={`Remove ${agent.label} · ${category} · item ${noteIndex + 1}`} title="Remove item" disabled={locked} onClick={() => remove(note.id)}><Trash2 size={13} /></button>
          </div>)}</div>
          <button className="comparison-cell-add" aria-label={`Add item to ${agent.label} · ${category}`} disabled={locked} onClick={() => add(category, agent.key)}><Plus size={14} /> Add item</button>
        </td>)}
      </tr>)}</tbody></table></div>
    <footer className="comparison-footer">Study notes saved in the Studio database. Pending edits stay in this browser until saving completes.</footer>
  </div>;
}
