# Lina Subagents / multi-agent orchestration

Accepted scope: [full specification](../../../../docs/research/lina/subagents-research.md).
The user authorized completion on 2026-10-08. This slice implements Studio design
and deterministic fixture execution, not live agent processes.

## Checklist
- [x] Eight lifecycle nodes with saved-draft preservation and related block layout.
- [x] JSON schemas/examples for all nodes and owner-specific edges.
- [x] Internal child turn origin, instance identities and independent loop projections.
- [x] Recursive spawning, configurable depth/concurrency/tree budgets and capacity queue.
- [x] Foreground/result waiting, background parent continuation and explicit detached ownership.
- [x] Persistent sessions, resume, steering and follow-up task identities.
- [x] Task-only/selected/fork Context and worker/model/tool/skill/Memory profiles.
- [x] Selective joins, partial failure, results capture/validation/delivery accounting.
- [x] Matched child approval/Memory review waits and no implicit delegated grants.
- [x] Cascade Stop, detached-owner close, timeouts and late/stale/duplicate events.
- [x] Unknown launch/restart reconciliation without repeated work.
- [x] Run settings, per-agent inspection, Auto/Next and manual graph exploration.
- [x] Meaningful tests, production build/typecheck, browser proof and docs/index updates.

## Evidence
Graph: 120 nodes and 477 edges; this block contributes eight nodes and 77 edges.
Registry: 120 contracts, 1,352 input examples and 1,300 output examples.

- Six dedicated graph tests pass: node/edge inventory, correlated State routes,
  saved-draft preservation, collision-free layout and missing-node restoration.
- 71 contract tests pass, including exact producer coverage and JSON examples.
- 729 Lina tests pass, including 46 integration tests for all 29 active Subagent
  cases, Auto/Next equivalence, scoped Memory, actual child loops and owner Stop.
- Web typecheck and production build pass. Vite reports the existing large-chunk
  warning; no new dependency was added for this slice.
- Browser verified Run settings, manual stepping, main/child selection, automatic
  completion, unchanged viewport under manual graph following, and collapsible
  JSON contracts for Validate delegation. Local proof is kept in the ignored
  long-running-work folder; it is not a benchmark artifact.

Graph admission, launch/session/join/result protocols are modeled explicitly.
All child/task/session records are deterministic in-memory fixtures; live process
launch, persistent scheduler and remote cancellation guarantees are future runtime
work, not evidence produced by this design slice.

## Implementation notes and limits

The eight-node lifecycle stays separate from the reused per-agent execution loop.
`subagentsFixtures.ts` owns request admission, task/session/launch/join records and
result delivery; `subagentHarness.ts` namespaces work, builds scoped provider
requests and retains parent delegation call/result groups. `inputSimulation.ts`
compiles the existing harness layers and reduces each child independently.

Run defaults are selected Context, await-result, attached ownership, task-scoped
sessions, general worker, depth three, three concurrent children and eight total
tree tasks. These are fixture policy settings rather than claims of optimal limits.
The specialist preset loads a source-review skill and a permitted fixture connector.
Child Memory starts in a fresh private store; shared reads require explicit scope,
and shared publication uses the existing matched parent review. Fork Context
contains actual admitted parent user evidence and only observed complete tool groups;
open calls, system instructions, private Memory and opaque provider continuation are
excluded. Follow-up tasks keep prior child result references under their session.

The fixture schedule is deterministic round-robin interleaving, not a physical
scheduler or a concurrency measurement. The cases are selected examples rather
than arbitrary exhaustive task trees. Cancellation cannot invent certainty about
unknown launches or external effects. These fixture ledgers are in memory and reset
with the run; live process launching, durable restart, secret storage, real provider
calls and sandbox enforcement belong to the future harness implementation.
