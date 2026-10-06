# Studio prototype

This feature is a throwaway UI prototype for Studio inside the main application shell.
It uses the project's shared sidebar and top bar; it does not create a second
navigation system.

Open `/studio` to inspect three local-only views:

- `?variant=command` — Studio command center
- `?variant=focus` — Context Management inside Studio
- `?variant=map` — complete agent execution path

The page checks the separate Studio API host through a small JSON health contract.
That request only reports whether the host is reachable. The prototype does not
send selections, persist configuration, create runs, or display benchmark data.
See the [Studio API README](../../../../studio-api/README.md) for local startup.

The Context focus view keeps a compact component-area rail for moving between the
twelve harness areas. The environment inspector was
removed so the experiment controls remain the visual centre of the page. The view
only shows the currently supported old-important-fact case; unsupported scenarios
are not presented as selectable controls.

## Hermes simulation

Hermes remains available through System explorers at `/studio/hermes`, a source-grounded whole-agent
walkthrough with selectable paths and node inspection. See the
[simulation README](../hermes-simulation/README.md) for scope and source revision.

## Source system explorers

The **System explorers** entry opens `/studio/explorers`, with separate maps for
OpenClaw, Pi, Waku Agent and the existing Hermes study. These are source-based
learning pages; they do not configure or execute Studio assemblies. See
`../system-explorer/README.md` for ownership, interactions and scope.

## Manual comparison

The Comparison table opens `/studio/comparison`, a four-agent study table with fixed
topic rows and initially empty per-agent item lists. See [ownership and persistence](../system-comparison/README.md).

## Lina architecture

**Lina architecture** opens `/studio/lina`, an empty editable design canvas with
component notes, directed connections, source studies and experiment ideas. It saves
explicit document revisions through the local Studio API; see
[the workspace guide](../lina/README.md). It is separate from the executable reference assembly.
