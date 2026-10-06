/** Study categories organize manual observations; they do not assert agent capabilities. */
export const COMPARISON_CATEGORIES = [
  'Entry points and message admission',
  'Session identity and lifecycle',
  'Turn ownership and concurrency',
  'Configuration and resource discovery',
  'Instructions and prompt construction',
  'Conversation state and history',
  'Context selection and budgets',
  'Compaction and history rewriting',
  'Memory and retrieval',
  'Agent orchestration',
  'Models and provider requests',
  'Tools and external integrations',
  'Execution environments',
  'Delegation and subagents',
  'Persistence, durability and recovery',
  'Background and scheduled work',
  'Response delivery and presentation',
  'Observability and reproducibility',
  'Extensibility and architectural boundaries',
] as const;

export type ComparisonCategory = (typeof COMPARISON_CATEGORIES)[number];

/** One user-authored question or mechanism and its four independent observations. */
export interface ComparisonRow {
  id: string;
  item: string;
  category: ComparisonCategory;
  hermes: string;
  openclaw: string;
  pi: string;
  waku: string;
}

export const COMPARISON_STORAGE_KEY = 'agents-lab.system-comparison';
const STORAGE_VERSION = 1;

export interface ComparisonStoreFailure {
  ok: false;
  reason: 'unavailable' | 'invalid' | 'unsupported-version' | 'write-failed';
  error: string;
}

export type ComparisonLoadResult =
  | { ok: true; rows: ComparisonRow[] }
  | ComparisonStoreFailure;

export type ComparisonSaveResult = { ok: true } | ComparisonStoreFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRows(value: unknown): value is ComparisonRow[] {
  if (!Array.isArray(value)) return false;
  const identifiers = new Set<string>();
  return value.every((row: unknown) => {
    if (!isRecord(row)) return false;
    const fields = ['id', 'item', 'category', 'hermes', 'openclaw', 'pi', 'waku'];
    if (!fields.every((field) => typeof row[field] === 'string')) return false;
    const id = row.id as string;
    if (!id.trim() || identifiers.has(id)) return false;
    if (!COMPARISON_CATEGORIES.some((category) => category === row.category)) return false;
    identifiers.add(id);
    return true;
  });
}

function resolveStorage(storage?: Storage): Storage {
  // Access itself can throw when browser policy disables local storage.
  if (storage) return storage;
  if (typeof window === 'undefined') throw new Error('Browser storage is unavailable.');
  return window.localStorage;
}

function loadFromStorage(storage: Storage): ComparisonLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(COMPARISON_STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'unavailable', error: 'The comparison could not be read from browser storage.' };
  }
  if (raw === null) return { ok: true, rows: [] };

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid', error: 'The saved comparison contains invalid JSON. It has been preserved.' };
  }
  if (!isRecord(document)) {
    return { ok: false, reason: 'invalid', error: 'The saved comparison has an invalid format. It has been preserved.' };
  }
  if (document.version !== STORAGE_VERSION) {
    return {
      ok: false,
      reason: typeof document.version === 'number' ? 'unsupported-version' : 'invalid',
      error: 'The saved comparison uses an unsupported or missing format version. It has been preserved.',
    };
  }
  if (!validRows(document.rows)) {
    return { ok: false, reason: 'invalid', error: 'The saved comparison contains invalid rows. It has been preserved.' };
  }
  return { ok: true, rows: document.rows };
}

/**
 * Read this browser's comparison. Missing data is an empty table; invalid data
 * returns a visible error and is never removed or rewritten. Supply Storage to
 * use another browser-compatible store without touching the default one.
 */
export function loadComparisonRows(storage?: Storage): ComparisonLoadResult {
  try {
    return loadFromStorage(resolveStorage(storage));
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Browser storage is unavailable. Your comparison cannot be loaded.' };
  }
}

/**
 * Save a complete manual table in a versioned document. Existing malformed or
 * newer-version data blocks writes, including autosave. replaceInvalidData is
 * only for an explicit user action accepting replacement of the saved content.
 * Failed writes leave the caller responsible for retaining unsaved edits.
 */
export function saveComparisonRows(
  rows: readonly ComparisonRow[],
  storage?: Storage,
  options: { replaceInvalidData?: boolean } = {},
): ComparisonSaveResult {
  if (!validRows(rows)) {
    return { ok: false, reason: 'invalid', error: 'The comparison has invalid rows and was not saved.' };
  }

  let destination: Storage;
  try {
    destination = resolveStorage(storage);
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Browser storage is unavailable. Your edits have not been saved.' };
  }

  const previous = loadFromStorage(destination);
  if (!previous.ok) {
    const replaceable = previous.reason === 'invalid' || previous.reason === 'unsupported-version';
    if (!options.replaceInvalidData || !replaceable) return previous;
  }

  try {
    destination.setItem(COMPARISON_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, rows }));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write-failed', error: 'The comparison could not be saved. Keep this page open to retain your unsaved edits.' };
  }
}

export type ComparisonAgent = 'hermes' | 'openclaw' | 'pi' | 'waku';
/** An independently editable item inside one topic × agent cell. */
export interface ComparisonNote {
  id: string;
  category: ComparisonCategory;
  agent: ComparisonAgent;
  text: string;
}
const NOTES_KEY = `${COMPARISON_STORAGE_KEY}.cell-items`;
type NotesResult = { ok: true; notes: ComparisonNote[] } | ComparisonStoreFailure;
function validNotes(value: unknown): value is ComparisonNote[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(note => {
    if (!isRecord(note) || typeof note.id !== 'string' || !note.id || ids.has(note.id)
      || typeof note.text !== 'string' || !COMPARISON_CATEGORIES.some(c => c === note.category)
      || typeof note.agent !== 'string' || !['hermes', 'openclaw', 'pi', 'waku'].includes(note.agent)) return false;
    ids.add(note.id); return true;
  });
}
/** Load cell items, migrating previous observations without modifying the old document.
 * Previous row names accompany their observations; original rows remain recoverable
 * in the old storage key, including rows with no observations. */
export function loadComparisonNotes(storage?: Storage): NotesResult {
  try {
    const destination = resolveStorage(storage);
    const raw = destination.getItem(NOTES_KEY);
    if (raw !== null) {
      const data: unknown = JSON.parse(raw);
      if (!isRecord(data) || data.version !== 2 || !validNotes(data.notes)) {
        return { ok: false, reason: 'invalid', error: 'Saved cell items have an unsupported or invalid format. They have been preserved.' };
      }
      return { ok: true, notes: data.notes };
    }
    const old = loadComparisonRows(destination);
    if (!old.ok) return old;
    const notes: ComparisonNote[] = [];
    for (const row of old.rows) {
      for (const agent of ['hermes', 'openclaw', 'pi', 'waku'] as const) {
        if (row[agent].trim()) notes.push({ id: `${row.id}:${agent}`, category: row.category, agent,
          text: row.item.trim() ? `${row.item}\n${row[agent]}` : row[agent] });
      }
    }
    return { ok: true, notes };
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Cell items could not be read from browser storage. Existing data has been preserved.' };
  }
}
/** Save all cell items. Invalid existing data blocks autosave; the legacy row document
 * remains untouched. A failed write must remain visible while the caller retains drafts. */
export function saveComparisonNotes(notes: readonly ComparisonNote[], storage?: Storage): ComparisonSaveResult {
  if (!validNotes(notes)) return { ok: false, reason: 'invalid', error: 'Invalid cell items were not saved.' };
  try {
    const destination = resolveStorage(storage);
    const previous = loadComparisonNotes(destination);
    if (!previous.ok) return previous;
    destination.setItem(NOTES_KEY, JSON.stringify({ version: 2, notes }));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write-failed', error: 'Cell items could not be saved. Keep this page open to retain your edits.' };
  }
}
