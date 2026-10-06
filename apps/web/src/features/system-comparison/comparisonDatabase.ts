import { useEffect, useSyncExternalStore } from 'react';
import { COMPARISON_CATEGORIES, loadComparisonNotes, type ComparisonNote } from './comparisonStore';

const base = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || 'http://127.0.0.1:4320').replace(/\/$/, '');
const draftKey = 'agents-lab.comparison.pending-database-writes';
const migratedKey = 'agents-lab.comparison.database-imported';
type Change = { id: string; item: ComparisonNote | null };
type Snapshot = { notes: ComparisonNote[]; ready: boolean; busy: boolean; pending: number; error: string };
let snapshot: Snapshot = { notes: [], ready: false, busy: true, pending: 0, error: '' };
const listeners = new Set<() => void>();
const pending = new Map<string, Change>();
let initialized = false, loading = false, flushing = false;
function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch, pending: pending.size };
  listeners.forEach(listener => listener());
}
async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (response.ok && response.status === 204) return null;
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === 'object' && data && 'message' in data ? String(data.message) : `Database request failed (${response.status}).`);
  return data;
}
function writeDrafts() {
  // Save the operation log before acknowledging UI edits. Deletes are tombstones,
  // so reconnect cannot resurrect a locally removed item from an older snapshot.
  localStorage.setItem(draftKey, JSON.stringify([...pending.values()]));
}
function overlay(items: ComparisonNote[]) {
  const map = new Map(items.map(item => [item.id, item]));
  for (const change of pending.values()) {
    if (change.item) map.set(change.id, change.item); else map.delete(change.id);
  }
  return [...map.values()];
}
function noteLike(value: unknown): value is ComparisonNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<ComparisonNote>;
  return typeof note.id === 'string' && !!note.id.trim()
    && COMPARISON_CATEGORIES.some(category => category === note.category)
    && ['hermes', 'openclaw', 'pi', 'waku'].some(agent => agent === note.agent)
    && typeof note.text === 'string';
}
async function load() {
  if (loading) return;
  loading = true; publish({ busy: true, error: '' });
  try {
    if (!initialized) {
      const raw = localStorage.getItem(draftKey);
      const changes: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(changes) || changes.some(change => !change || typeof change.id !== 'string' || !(change.item === null || noteLike(change.item)) || (change.item && change.item.id !== change.id))) throw new Error('Saved pending edits have an invalid format. They have been preserved.');
      for (const change of changes as Change[]) pending.set(change.id, change);
      initialized = true;
    }
    // Import is insert-only and retry-safe. Keep legacy documents intact; the
    // marker prevents later page visits from re-importing deleted database items.
    if (!localStorage.getItem(migratedKey)) {
      const old = loadComparisonNotes();
      if (!old.ok) throw new Error(old.error);
      await request('/comparison/import', 'POST', { items: old.notes });
      localStorage.setItem(migratedKey, '1');
    }
    const data = await request('/comparison') as { items?: unknown };
    if (!Array.isArray(data.items) || !data.items.every(noteLike)) throw new Error('The API returned an invalid comparison document.');
    publish({ notes: overlay(data.items), ready: true, busy: false, error: '' });
    void flush();
  } catch (error) {
    publish({ busy: false, error: error instanceof Error ? error.message : 'Comparison database unavailable.' });
  } finally { loading = false; }
}
async function flush() {
  if (flushing || !snapshot.ready || !pending.size) return;
  flushing = true; publish({ busy: true, error: '' });
  try {
    while (pending.size) {
      const change = pending.values().next().value!;
      const path = `/comparison/items/${encodeURIComponent(change.id)}`;
      if (change.item) {
        const { category, agent, text } = change.item;
        await request(path, 'PUT', { category, agent, text });
      } else await request(path, 'DELETE');
      // A newer keystroke may have replaced this operation while SQL was saving.
      if (pending.get(change.id) === change) pending.delete(change.id);
      writeDrafts(); publish({});
    }
    publish({ busy: false, error: '' });
  } catch (error) {
    publish({ busy: false, error: error instanceof Error ? error.message : 'Database save failed. Your edits are pending.' });
  } finally { flushing = false; }
}
function change(change: Change) {
  const previous = pending.get(change.id);
  pending.set(change.id, change);
  try { writeDrafts(); } catch {
    if (previous) pending.set(change.id, previous); else pending.delete(change.id);
    publish({ error: 'This browser could not back up the edit. The change was not accepted; existing notes are preserved.' }); return;
  }
  publish({ notes: overlay(snapshot.notes) }); void flush();
}
/** One shared synchronization owner across standalone and embedded views. Pending
 * writes outlive view unmounts and are backed up until the API acknowledges SQL. */
export function useComparisonDatabase() {
  const state = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);
  useEffect(() => { if (!snapshot.ready && !loading) void load(); }, []);
  return { ...state, put: (item: ComparisonNote) => change({ id: item.id, item }), remove: (id: string) => change({ id, item: null }), retry: () => { if (snapshot.ready && pending.size) void flush(); else void load(); } };
}
