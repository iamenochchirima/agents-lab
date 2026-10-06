# Agent system explorers

These studies accompany the interactive maps in **Studio → System explorers**.
They derive architecture and illustrative message paths from pinned local source
repositories. They are explanatory research, not benchmarks or agent runs.

| System | Revision | Study | Studio page |
| --- | --- | --- | --- |
| OpenClaw | `e40ed06f23cb8bd939c9a6ff537eba7136074686` | [OpenClaw](openclaw.md) | `/studio/openclaw` |
| Pi (earendil-works/pi) | `a276dabe57911253350bffb93cb7d7aff6a73261` | [Pi](pi.md) | `/studio/pi` |
| Waku Agent | `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01` | [Waku Agent](waku.md) | `/studio/waku` |
| Hermes | `ddc0e65958b326a89f6c440c76c812d31ac27e2a` | [Expanded source study](hermes.md) | `/studio/hermes` |

All three new snapshots were clean at inspection. Repository identity matters:
the local Pi repository includes modules and experimental services absent from
older Pi descriptions. Each study distinguishes shipped behavior, optional
branches, experimental paths and collapsed boundaries.

## Read the map

1. Survey the system's regions, then select one region to see its nodes clearly.
2. Inspect a component, state, decision, store or external boundary.
3. Read its contracts, conditions, failure behavior and pinned source links.
4. Select a relationship to inspect the source behind the call, data transfer,
   transition or background operation.
5. Use **Follow a message** to step through an illustrative path on the stable
   architecture, then examine alternative paths and **Coverage & limits**.

The Stately-inspired viewer combines architecture with behavior; it is not an
executable statechart. A component is not itself an execution state. An edge
records a selected relationship, not an assertion that every message takes it.
No map claims to enumerate every helper, dashboard control, provider or tool.
The studies identify the boundaries that are collapsed and why.

## Evidence and limitations

Source code takes precedence over architectural prose when the two differ.
Node and relationship links pin the inspected revision and point at an owner or
caller. Illustrative outcomes are assumptions, and parallel tasks listed in a
trace do not become sequential just because the viewer has a step cursor.

Grouping and layout are interpretations for teaching; exact names, guards,
side effects and ownership should remain inspectable. Provider/service internals
remain outside a repository's control. A static study cannot demonstrate runtime
correctness, measured performance, durability guarantees or operational health.

The original Hermes lifecycle study is retained unchanged. Its surface map
remains available for the planned node-by-node review.

## Semantic audit

The [item-level audit](audits/README.md) records source reconciliation and
corrections for all four maps. Each explorer links to its own ledger through
**Audit evidence**. Verified surface claims, corrected items and boundaries
requiring deeper review are distinct; a source link alone does not certify behavior.
