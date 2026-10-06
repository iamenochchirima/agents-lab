# Source system explorers

Studio's **System explorers** entry opens `/studio/explorers`. Separate pages at
`/studio/openclaw`, `/studio/pi` and `/studio/waku` display code-grounded maps of
those local source snapshots. Hermes remains at `/studio/hermes` with its existing
surface map and earlier step walkthrough.

## Responsibilities

- `data/`: each repository's named components, states, stores, decisions, external
  boundaries, relationships and illustrative message journeys. Each snapshot
  records its upstream URL and exact commit. This is research content, not an
  adapter implementing the studied harness.
- `types.ts`: common display semantics. Node contracts and framework-specific
  behavior remain in each dataset; no common agent execution contract is implied.
- `layout.ts`: deterministic grouping in three columns. Layout order expresses
  ownership regions, not scheduling or execution order.
- `SystemExplorer.tsx`: region/search navigation, zoom/pan, node and relationship
  source inspection, coverage and example stepping/playback.
- `graphs.ts`, index and page wrappers: registered studies and route selection.

The common viewer is justified by three concrete source studies. It uses React,
SVG and the existing application theme, with no new graph or state-machine
runtime dependency. Stately supplies the interaction reference; this is not
Stately's hosted editor, an XState machine or execution of any studied agent.

## Reading and interactions

The whole-system view displays ownership regions. Select a region in the left
index or the Region selector to zoom to readable nodes. **Expand canvas** hides
the index and inspector for a larger workspace; **Show inspector** restores them. Clicking a node updates the inspector without
changing the graph's layout. Search includes labels, descriptions and source
paths. Calls, data transfers, execution transitions and background relationships
have separate styles and filters; external boundaries have dashed outlines.

Select an inspector relationship or its canvas edge to read its condition and
source evidence. The endpoint buttons move to the other node. Relationships are
selected architectural facts, not a total control-flow graph. Read conditions
before interpreting an edge as always taken.

**Follow a message** steps through an assumed source path on the same stable map.
The event narrative states what is assumed or conditional. Listed parallel tasks
are explanatory order, not a claim of sequential execution. Changing traces
resets the cursor and playback. Manual node inspection does not move the trace
cursor; the current event remains visible beneath the canvas. Playback changes
only the cursor. No credentials, model calls, tools, runtime stores or external
services are invoked by these pages.

**Coverage & limits** lists what was inspected and what remains collapsed.
Providers, channel integrations and tool implementations are not interchangeable
across graphs. Optional/experimental services are identified in their own study.

## Reproducibility and review

See `docs/research/system-explorers/` for pinned revisions, research notes,
coverage, assumptions and exclusions. Source anchors refer to those revisions,
not the moving default branch. The source repositories were clean when studied.

When editing a graph, inspect its actual caller and state-owner code. Maintain
unique node/edge/trace IDs, existing endpoints and group membership, and source
file/line bounds. Check node positions remain within generated region bounds.
An anchor's existence does not establish that its prose is accurate: source
semantics require separate review. Never invent a feature or a run result to fill
out a diagram.

The local web app can run with:

```sh
pnpm --filter @agent-harness-lab/web dev
```

If the existing context-experiment contract compilation blocks startup, directly
start Vite using already emitted contract output:

```sh
pnpm --filter @agent-harness-lab/web exec vite --host 127.0.0.1
```

That fallback does not establish that the full application typecheck passes.

## Semantic audit evidence

Each page's **Audit evidence** link opens a per-item ledger under
`docs/research/system-explorers/audits/`. The ledgers distinguish inspected surface
claims, corrections and unresolved subsystem details. Review is static source
reconciliation, not runtime proof; it does not make the example paths measured runs.

## Manual comparison

The Comparison table opens `/studio/comparison`, a four-agent study table with fixed
topic rows and initially empty per-agent item lists. See [ownership and persistence](../system-comparison/README.md).

The **Comparison** view tab embeds the shared manual comparison table without
leaving the explorer route. It edits the same database notes as `/studio/comparison`.
