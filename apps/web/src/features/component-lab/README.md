# Component Lab feature

The Component Lab is the UI workspace for studying one agent-harness responsibility
at a time. It is separate from the Platform Lab, which owns complete platform runs,
chat sessions, and platform comparisons.

`componentCatalog.ts` owns the static area, strategy, case, envelope, and evidence
descriptions. `componentModel.ts` validates those records and resolves the selected
area or strategy. `ComponentLabView.tsx` owns local preview state and renders the
index, planned states, and Context Management workspace.

The first slice has no execution path. Strategy and case selections live in browser
memory, no provider or server request is made, and no run or metric record is created.
The future component runner should consume the fixed experiment envelope without
making the component catalog depend on a platform implementation.

Public routes:

- `/components` shows the eleven-area catalog.
- `/components/:areaId` shows the selected area. `context-management` is the first
  detailed workspace; other areas show an honest planned state.
