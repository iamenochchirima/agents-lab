import { useMemo, useState } from 'react';

function download(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The old origin retains browser drafts. This page exports them without clearing storage. */
export function LinaPage() {
  const backup = useMemo(() => {
    const values: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith('agents-lab.lina.')) values[key] = localStorage.getItem(key) ?? '';
    }
    return values;
  }, []);
  const drafts = useMemo(() => Object.entries(backup).flatMap(([key, raw]) => {
    if (!key.startsWith('agents-lab.lina.draft:')) return [];
    try {
      const value = JSON.parse(raw);
      return value?.document?.version === 1 && Array.isArray(value.document.nodes) ? [{key, value}] : [];
    } catch {return [];}
  }), [backup]);
  const [selected, setSelected] = useState(0);
  return <section className="page-section" style={{maxWidth: 760, padding: 32}}>
    <h1>Lina has moved</h1>
    <p>Architecture, simulations and execution inspection now run in the Lina repository.</p>
    <p><a href="http://127.0.0.1:4318/#architecture" target="_blank" rel="noreferrer">Open Lina inspection</a></p>
    <p>Start it from Lina with <code>pnpm inspect</code>. See <code>docs/architecture/observability.md</code> for setup.</p>
    <h2>Keep your browser drafts</h2>
    {drafts.length ? <>
      <label>Architecture draft <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
        {drafts.map((draft, index) => <option key={draft.key} value={index}>{draft.key.endsWith(':before-layout-update') ? 'Before layout update' : 'Current draft'} · {draft.value.document.nodes.length} nodes</option>)}
      </select></label>
      <p><button onClick={() => download(drafts[selected].value, 'lina-architecture-draft.json')}>Export architecture draft</button></p>
      <details><summary>View draft JSON</summary><textarea aria-label="Architecture draft JSON" readOnly value={JSON.stringify(drafts[selected].value, null, 2)} style={{width: '100%', height: 240}} /></details>
      <p>Import this file on Lina's Architecture screen, review it, then save.</p>
    </> : <p>No architecture draft was found in this browser origin.</p>}
    <button disabled={!Object.keys(backup).length} onClick={() => download({version: 1, origin: location.origin, values: backup}, 'lina-lab-browser-backup.json')}>Export all draft backups</button>
    <details><summary>View backup JSON</summary><textarea aria-label="Browser backup JSON" readOnly value={JSON.stringify({version: 1, origin: location.origin, values: backup}, null, 2)} style={{width: '100%', height: 240}} /></details>
    <p>Existing browser storage and the saved Lab snapshot are retained.</p>
  </section>;
}
