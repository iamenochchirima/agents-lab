# Studio components feature

Studio components is the UI workspace for studying one agent-harness responsibility
at a time. It belongs inside Studio and remains separate from the Platform Lab, which
owns complete platform runs, chat sessions, and platform comparisons.

`componentCatalog.ts` owns the static area and strategy descriptions.
`componentModel.ts` validates those records and resolves the selected area.
`ComponentLabView.tsx` renders the index, planned states, and Context Management
workspace. `contextExperimentApi.ts` is the browser client for the versioned Context
comparison endpoints; it validates request and response projections with the shared
Studio HTTP contract.

Context Management runs the server-owned `old-important-fact-v1` case through two
registered Context implementations: budget-fitted recent history and a fixed
recent-message window. The only adjustable value is the alternative's window, from
one to twelve prior messages. The Studio API owns module selection, execution,
comparison IDs, persistence, and authoritative status. The browser sends a new UUID
with each run and places it in the `comparisonId` query parameter. Opening that URL
loads the saved projection with GET; it does not start another run.

The page first checks the local Studio API health endpoint. It disables Run while the
API is checking, unavailable, or already running a comparison. A failed health check
has a retry action. POST results and GET projections are rendered as returned; an API
error does not turn earlier evidence into a new result. If the page is refreshed while
POST is active, its request is aborted when the browser disconnects, and reopening the
comparison URL inspects the saved or interrupted state.

Evidence is shown side by side for both ordinary run records: implementation identity
and configuration, run IDs, exact messages passed to Replay, included and omitted
sources with reasons, token count and basis, Replay output, ordered-event counts, and
flush receipts. The deterministic Replay model reports request shape; it does not
establish answer quality. The UI deliberately has no score. Other Context strategies
remain labelled Planned and cannot be selected for execution.

Public routes:

- `/components` is the compatibility route for Studio's twelve-area catalog, including
  the planned Computer Use area.
- `/components/:areaId` shows the selected area. `context-management` is the first
  executable workspace; other areas show an honest planned state.
