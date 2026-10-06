# Manual system comparison

Open the **Comparison** tab inside any agent explorer, or `/studio/comparison`.
Both display the same database notes. The 19 topics are permanent rows; Hermes,
OpenClaw, Pi and Waku are the columns. Topic labels and column headers stay visible
while scrolling. Cells begin empty. Use **+ Add item** inside a cell, edit its text
directly, or remove it with its trash button. Undo restores the latest removed
note during the current page visit. Agent headings link to their source explorers.

## Ownership and persistence

These are user-authored study notes, separate from audited map facts and experiment
evidence. No observations are prefilled. Fixed topics make no capability claims.

`comparisonDatabase.ts` uses the Studio API at `VITE_AGENTLAB_STUDIO_API_URL`
(default `http://127.0.0.1:4320`). The API stores each note's stable ID, topic,
agent and text in SQLite at `lab/state/studio.sqlite`; configure
`STUDIO_DATABASE_PATH` to change the file. See the [Studio API guide](../../../../../apps/studio-api/README.md)
for startup, endpoints, limits and database backup instructions. For a browser at
`http://127.0.0.1:5173`, start the API with that exact `STUDIO_API_WEB_ORIGIN`.

Edits are backed up as pending operations in browser localStorage before appearing
in the UI, then sent individually to the API. Deletes use pending tombstones.
**Saved to database** appears only after the API acknowledges all writes. If saving
fails, the pending operations remain in this browser and **Retry** resends them.
The initial database load must succeed before editing is enabled. Closing a view
does not cancel the shared synchronization worker. Reloading replays pending edits;
clearing browser data before they are acknowledged loses those unsaved edits.

The first successful connection imports existing version-2 browser notes from
`agents-lab.system-comparison.cell-items`. If absent, `comparisonStore.ts` converts
legacy version-1 row observations from `agents-lab.system-comparison`. Import is
transactional and insert-only, so retries do not replace newer notes with the same
ID. A browser marker prevents re-importing old notes after database deletion. Both
original browser documents remain untouched. Invalid legacy data blocks import and
is preserved for recovery. Named legacy rows without observations remain in the
old document, since the table uses fixed topics.

The local workspace shares one database. Same-item concurrent writes use the last
committed write; there is no revision conflict detection, cross-tab synchronization
or live refresh from other browsers. Reload to fetch another editor's changes.
Undo is in-memory only. This implementation does not move agent chat sessions or
run evidence into the database.

`SystemComparisonPage.tsx` owns editing and Undo; `comparisonDatabase.ts` owns the
shared save queue. The stylesheet uses theme tokens, sticky headings and horizontal
scrolling. No dependency was added: SQLite uses Node's built-in module.
