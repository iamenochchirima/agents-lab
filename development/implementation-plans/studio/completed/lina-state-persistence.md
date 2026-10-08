# Lina State, persistence and recovery design slice

## Scope

Populate the reserved State region with the four researched responsibilities,
connect existing owners, provide inspector JSON Schema and examples, and extend
deterministic simulation. This is an executable design model. It does not create
a live State database or prove crash durability for Lina.

Research authority: [comparative findings](../../../../docs/research/lina/state-persistence-research.md)
and [existing-design audit](../../../../docs/research/lina/state-existing-design-audit.md).

## Implementation checklist

- [x] Add Load state, Record state, Create execution checkpoint and Recover execution.
- [x] Connect scoped reads, conditional writes and requester-specific returns.
- [x] Keep Input/Execution ownership, Tools reconciliation and Safety authority intact.
- [x] Represent record families, operation identities, revisions/fences, exact checkpoint references and uncertain commits in JSON Schema.
- [x] Provide incoming variants and example inputs/outputs per State node and connected owner.
- [x] Preserve saved notes, positions, custom nodes/edges and grouped layout on refresh.
- [x] Show normal-path State service calls before acceptance/launch and after results/waits.
- [x] Add configurable recovery cases to Run; Auto and Next use the same reducer.
- [x] Inspect fixture commit/checkpoint/recovery evidence through collapsible colored JSON.
- [x] Model duplicate input, lost acknowledgment and resume before launch.
- [x] Preserve completed parallel work and exact pending approval on recovery.
- [x] Reconcile unknown effects and uncertain delivery; retain original operation identity.
- [x] Preserve Stop, reject stale ownership and refuse incomplete/incompatible recovery.
- [x] Validate graph endpoints, schemas/examples and meaningful simulation semantics.
- [x] Run Lina tests, web typecheck/build and browser verification.
- [x] Update documentation/index/proposal status and record limits/results.

## Boundaries

Acknowledged State commits return to the original requester and phase. Record
writes do not automatically trigger checkpoints. A committed execution checkpoint
references a supported continuation and coherent record revisions. Recovery
supplies a plan to the existing coordinator, not an arbitrary jump into dispatch.
Unknown effects require reconciliation. Credential material remains protected.

Ownership operations use conditional updates and a new owner generation after
restart. This blocks stale State mutations, but cannot reverse external actions.
Runtime-session grants expire on modeled restart; persistent grants still require
current permission and binding checks. Recovery retains cancellation intent.

## Validation

Implemented four nodes and 61 connections through thirty shared request/return
routes. The maintained graph has 100 nodes, 313 edges and 100 provisional contracts.
All 1,940 context/input/output examples pass the supported JSON Schema checks.

Validation:

- 33 State simulation tests cover fourteen cases, Auto/Next parity, lost-ack
  identity, sibling preservation, ownership conflict, invalid recovery, Stop,
  delivery uncertainty, grant expiry, independent restored approvals and
  Stop checkpoints retaining observed counters.
- State graph tests verify refresh preservation, grouped placement and collision
  avoidance. State contract tests verify scoped records, required manifests and
  exact requester/phase returns. The complete Lina suite passes all 506 tests.
- Browser verified the State region, recovery node JSON contract, two restored
  approvals, and the second call completing while the first remained waiting.
  Both reviewed scopes remain visible. Automatic duplicate playback returns
  the original input without inference.
- Web typecheck and production build pass. Existing large-bundle warning remains.

Pure fixture persistence is displayed in State evidence. No runtime State backend
was added. Process/machine/power-loss tests, live external effects,
actual credential retrieval and durable child scheduling are outside this slice.
