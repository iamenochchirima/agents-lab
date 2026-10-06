# Hermes system explorer

Open `/studio/hermes`, or follow **Hermes simulation** from Studio. The default
view is a Stately-inspired surface map inside the application, not an embedded
Stately service or executable XState model. Select a region in the component
index to zoom into it; select a node to inspect its short description, incoming
and outgoing relationships and source owners. Drag the canvas to pan, scroll to
zoom, or use the zoom and Fit system controls. Search narrows the component index
and dims unmatched nodes. Connection filters distinguish calls, data,
transitions and background work.

The **Existing step walkthrough** tab retains the earlier ordered paths and
playback. It does not execute Hermes. Playback has not yet been integrated into
the architecture map: we will develop those traces with the detailed node studies.

## Surface coverage plan

The map currently contains 157 nodes and 258 selected relationships in 25 regions.
Positions indicate ownership and grouping, not an execution sequence. These are
provisional teaching boundaries derived from the pinned source, not a claim that
Hermes defines these regions as architectural layers.

| Region | Surface coverage |
| --- | --- |
| Host · CLI | Message receipt, staging, settlement and rendering |
| AIAgent initialization | Reuse, client/tools, session, memory and context engine setup |
| Session ownership | Turn facade, SessionDB, turn-start persistence and release |
| Turn construction | Working history, prompt, hooks, pressure, memory and augmented input |
| Generic runtime | Runtime choice, iteration, request assembly/selection/cleanup, admission and response branching |
| Provider boundary | Model service, API calls, retries, overflow, interruption and terminal results |
| History rewrite | ContextEngine, compression, candidate summary, rejection and commit |
| Tools and delegation | Durable call admission, dispatch/environment, results, post-tool pressure, child agent and persistence failure |
| Completion and alternative runtime | Final text, finalizer, background memory/review and app-server projection |

Every node is marked **Surface only**. The next work unit is one node at a time:
review its name and owner, activation conditions, internal steps, state changes,
persistence, exits and failure behavior together. Expand grouped boundaries when
that review warrants it. Gateway hosts, cron, session management, configuration/resources and selected
runtime internals are now mapped. Individual transport/tool/provider internals
and child-agent algorithms still require separate studies.

The state map combines components and execution states, explicitly tagged by
kind. Its edges describe selected source relationships; they do not establish a
formal statechart, concurrency guarantees or complete executable semantics.
Self-contained statecharts and message traces can be added after node review.

## Source and scope

`hermesFlow.ts` pins Hermes commit
`ddc0e65958b326a89f6c440c76c812d31ac27e2a`. Nodes link to that revision rather than
the latest upstream code. The original
[context lifecycle study](../../../../../docs/research/context-lifecycles/hermes.md)
is retained unchanged.

The ordered walkthrough covers the CLI agent turn: CLI input, initialization/reuse, session
admission, instructions and memory, loop control, request preparation, provider
calls, tools, persistence, compaction, delegation, interruption, failures,
finalization, background work and delivery. The app-server path shows Hermes's
boundary with an external agent runtime.

These are predefined source-based paths with assumed branch outcomes. They are
not recorded runs, measured performance or execution of Hermes. Cold start and
reuse are separate paths. Gateway-specific input/delivery and each individual
tool/plugin's internal algorithm are outside this ordered walkthrough. The child
runtime is represented as a nested lifecycle boundary, not a fabricated child
trajectory. Default-disabled mechanisms such as micro-compaction are described
at their owning boundary, not silently enabled in every path.

## Ownership

- `hermesExpansion.ts`: added source-backed nodes, conditional relationships and regions.
- `hermesArchitecture.ts`: surface groups, typed nodes and relationships, layout and source/trace mappings.
- `hermesFlow.ts`: typed nodes, pinned source anchors and ordered example paths.
- `HermesSimulationPage.tsx`: architecture canvas, navigation and surface inspector.
- `HermesExecutionWalkthrough.tsx`: preserved cursor, playback and ordered path map.
- `hermes-architecture.css` and `hermes-simulation.css`: layouts using the existing theme.
- Routes and Studio entrance: lazy page loading and discoverable navigation.

In the ordered walkthrough, an edge means the next stage in the selected example. Repeated nodes represent
another iteration/attempt. Each node's explanation distinguishes alternatives,
guards and state changes; displaying an example path does not remove those guards.

## Local development and review

```sh
pnpm --filter @agent-harness-lab/web dev
```

If unrelated contract compilation blocks the startup prebuild, Vite can run
against already emitted contract output:

```sh
pnpm --filter @agent-harness-lab/web exec vite --host 127.0.0.1
```

This fallback does not establish that the full workspace typecheck passed.

The page introduces no graph dependency, server endpoint or model credential.
Review data against the pinned source before adding a new path. Keep node IDs
unique and every path reference resolvable; check code-file existence and line
bounds. Inspect Next/Previous, node selection, playback, path switching and narrow
layout in the running app. Preserve the lifecycle study as a separate artifact.

Implementation review: the feature TypeScript compile and Vite production build
passed. Live browser inspection covered Studio navigation, node selection,
stepping, playback and path switching. The full app typecheck is currently blocked
by the existing missing return in `studio/http-contract/src/context-experiment.ts`
(TS2366). The walkthrough runs through the direct Vite fallback above.

## Source reconciliation

The [Hermes semantic audit](../../../../../docs/research/system-explorers/audits/hermes.md)
records every architecture node, relationship and older walkthrough phase/path.
This pass corrected segmented tool execution, conditional detached delegation,
optional-store durability, interrupt routing and cleanup/persistence scope.
An async completion boundary now distinguishes later receipts from joined tool
results. It does not claim restart-resumable child execution. The original context
lifecycle document remains unchanged; the audit records corrections separately.

## Broader coverage

The [expanded source inventory](../../../../../docs/research/system-explorers/hermes.md)
records 106 added nodes and 167 relationships, including gateway, cron, session
controls, model/configuration/resource discovery, tool policy, streaming, memory,
compression, leases/liveness and lazy terminal environment acquisition. The original
semantic audit is a dated snapshot; its counts do not certify these additions.
Original map IDs and the ordered CLI walkthrough are retained. Relationship
evidence for the additions is available in the selected-component inspector.

The **Comparison** view tab embeds the shared manual comparison table without
leaving the explorer route. It edits the same database notes as `/studio/comparison`.
