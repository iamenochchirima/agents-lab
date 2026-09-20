# Studio multi-turn Memory and measurement

**Created:** `2026-09-20T00:00:00+02:00`  
**Last updated:** `2026-09-20T13:31:00+02:00`

**Status:** Active — core implementation complete; hardening follow-up remains
**Owner:** Agent Harness Lab maintainers

## Start here

Read these before implementation:

- [`AGENTS.md`](../../../../AGENTS.md)
- [`CONTEXT.md`](../../../../CONTEXT.md)
- [`Studio implementation roadmap`](../README.md)
- [`Current Memory runtime plan`](studio-memory-runtime.md)
- [`Studio server module`](../../../../server/src/studio/README.md)
- [`Context and memory ecosystem research`](../../../../docs/research/context-engineering-ecosystem-2026.md)

## Dependency and purpose

This plan follows the first deterministic Memory runtime slice. That slice can seed,
retrieve, update, expire, and persist records for one turn. This plan makes Memory
temporal and measurable: a trial will carry one isolated Memory policy across an
ordered sequence of turns, and the result will expose comparable measurements rather
than only a final grade.

This is still a local research runtime. It does not introduce embeddings, hosted
databases, learned memory managers, or a new server. It remains a Studio module in
the existing Lab server.

## Implementation checkpoint

The core sequence block is now implemented. The existing server can run ordered
Memory scenarios with one isolated store per strategy slot, reopen durable stores
between turns, persist turn projections, and expose aggregate and per-turn
measurements. The catalog includes learn/recall, update, duplicate/no-op, expiry,
miss, and procedural-reuse sequences. Existing single-turn Context and Memory
projections remain compatible.

The remaining hardening is intentionally separate from the core plumbing: exercise
multi-turn cancellation and persistence interruption at more injection points, add
broader deterministic replay assertions, and complete path/symlink review before
this plan is archived.

## Definition of done

A caller can submit a Memory comparison whose scenario contains an ordered turn
sequence. Every strategy slot receives the same turns, fixed Context strategy, model,
budgets, seed, and environment. The selected Memory policy is the only changed
variable.

For each turn, the runtime performs:

```text
turn input
  → input normalization
  → Memory retrieval
  → fixed Context assembly
  → planning and model turn
  → grading and output collection
  → Memory write decision
  → consolidation
  → turn evidence and metrics
```

The final comparison exposes:

- ordered turn results and grades;
- Memory candidates, retrieved records, writes, updates, no-ops, expiries, and
  active-state revisions per turn;
- the exact Memory records that reached Context on each turn;
- retrieval, retention, growth, token, latency, model-call, and recovery metrics;
- fixed-control fingerprints proving comparable strategy slots; and
- restart and idempotency outcomes without claiming exactly-once persistence.

## Research question

> With the task sequence, model, Context policy, and environment fixed, how do
> different Memory policies affect recall across turns, stale-value exposure,
> update correctness, memory growth, Context cost, and recovery behaviour?

The metrics are observations and fixture-specific proxies. They must not be presented
as a general ranking of Memory systems.

## Scope

- [x] Add a versioned ordered-turn scenario contract without breaking existing
      single-turn Context and Memory requests.
- [x] Run multiple turns through one isolated Memory store per strategy slot.
- [x] Seed fixture records once per trial and prevent cross-strategy or cross-trial
      state leakage.
- [x] Execute retrieval, Context assembly, model, write, and consolidation for every
      turn with deterministic turn and operation identities.
- [x] Persist turn-level Memory, Context, grade, event, and trajectory evidence.
- [x] Add a measurement projection for Memory quality proxies, state growth, Context
      cost, latency, model calls, and recovery outcomes.
- [x] Add restart/resume inspection between turns and preserve at-least-once-safe
      Memory semantics.
- [x] Add deterministic multi-turn scenarios for learn-then-recall, update-then-
      recall, duplicate write, expiry, miss, and procedural reuse.
- [x] Keep the existing Context comparison response and evidence shape compatible.
- [x] Document the turn request shape, metric meanings, limitations, and inspection
      procedure.

## Explicitly out of scope

- Embeddings, vector databases, hosted memory services, or model-generated summaries.
- Cross-user persistence, production retention workflows, encryption-at-rest, or
  multi-tenant Memory.
- Changing Context strategy behaviour. Context is a fixed consumer in this plan.
- Parallel turn execution or parallel strategy trials.
- A leaderboard, universal quality score, or claim that one policy wins generally.
- UI redesign. The API and evidence become ready for a later frontend connection.
- New implementations for tools, control, safety, computer use, or other slots.

## Contracts and state model

### Ordered scenario turns

Add a versioned `StudioScenarioTurn` representation containing:

- stable `turnId` and ordinal;
- task text and turn-local input messages;
- optional expected answer and required Context/Memory source IDs;
- fixed failure-injection and restart points;
- the grading question and intended observation.

Existing scenarios remain valid through a one-turn normalization path. The scenario
definition, not the frontend, owns the order and fixed controls.

### Turn evidence

Add a turn-level projection linked to the parent trial. It must include the turn ID,
Memory adapter identity, Context strategy identity, grade, state revision before and
after the turn, retrieved and omitted record IDs, write decisions, consolidation
decisions, and model-bound Context IDs.

Evidence must keep Memory records and Context messages separate. A retrieved record is
not automatically trusted and is not automatically a system instruction.

### Measurement contract

Use explicit nullable values when an adapter cannot observe a metric. At minimum,
record per turn and aggregate values for:

| Measurement | Meaning |
| --- | --- |
| required-record hit | whether the fixture-required record was retrieved |
| candidate count | records ranked before selection |
| selected/omitted count | Memory records selected or withheld before Context |
| irrelevant selection count | selected fixture records not expected for the task |
| writes/updates/no-ops/expiries | policy decisions, not quality claims |
| active record count and bytes | state growth after consolidation |
| Context input tokens | estimated or exact model-bound input size |
| model calls, latency, cost | observed adapter values, otherwise `null` |
| recovered state | whether the repository rebuilt from journal evidence |

Do not call retrieval precision or recall unless the scenario supplies an explicit
relevance set. Label fixture-derived counts as proxies.

## Runtime and recovery design

- The comparison service creates one Memory store for each trial and reuses it for
  the full turn sequence.
- The runtime executes one turn at a time; a sequence coordinator owns ordering,
  turn identity, and aggregation.
- Seeding is performed once before turn one. Replaying the seed operation is
  idempotent.
- Each turn receives a deterministic turn ID used by Memory operation IDs, events,
  and evidence paths.
- A restart after a completed turn reconstructs the same state before the next turn.
- A crash after journal append or snapshot publication is reconciled as an applied
  or recoverable operation, never silently rolled back.
- Cancellation records whether persistence completed; it does not claim rollback.
- Existing one-turn Context comparisons remain on their current runtime path.

## Scenario matrix

| Case | Turn sequence | Expected evidence |
| --- | --- | --- |
| Learn then recall | turn 1 writes a preference; turn 2 asks for it | later retrieval and Context source are visible |
| Update then recall | English preference, then Spanish update, then query | old revision superseded; current revision retrieved |
| Duplicate write | same keyed fact appears on two turns | second write is `NOOP`; active count does not grow |
| Expiry | record expires between turns | omitted on later read and explicitly expired |
| Retrieval miss | unrelated setup, targeted query | no false source or fabricated retrieval grade |
| Procedural reuse | successful procedure setup, matching later task | matching procedure retrieved; unrelated task omitted |

## Implementation checklist

### 1. Contracts and compatibility

- [x] Add ordered-turn scenario and turn-result types.
- [x] Add turn-level Memory and Context evidence references.
- [x] Add nullable metric fields with measurement basis and provenance.
- [x] Preserve existing single-turn request validation and projections.
- [x] Include turn sequence and fixed controls in the comparison fingerprint.

### 2. Sequence runtime

- [x] Add a narrow sequence coordinator around `StudioHarnessRuntime`.
- [x] Reuse one strategy-specific Memory store for all turns in a trial.
- [x] Execute retrieval, Context, model, write, and consolidation once per turn.
- [x] Emit ordered turn-start, Memory, Context, grade, and turn-completed events.
- [x] Aggregate the final trial result without hiding intermediate failures.
- [x] Keep Memory policy identity as the changed variable and Context fixed.

### 3. Metrics and evidence

- [x] Add per-turn metrics and a deterministic aggregate comparison projection.
- [x] Record token basis, latency basis, cost basis, and `null` for unavailable data.
- [x] Record Memory state growth and decision counts without exposing hidden reasoning.
- [x] Add allowlisted turn evidence and preserve existing evidence paths.
- [x] Ensure metric calculations do not alter runtime decisions.

### 4. Restart, failure, and idempotency

- [ ] Test restart between every pair of turns.
- [x] Test interruption after journal append and after snapshot publication.
- [x] Test repeated turn and Memory operation identities.
- [ ] Test cancellation before retrieval, during model execution, and during Memory
      persistence.
- [x] Test a failed intermediate turn without fabricating later turns.
- [x] Preserve explicit recovery-required state when reconciliation is impossible.

### 5. Tests and documentation

- [x] Add unit tests for turn ordering, metric basis, aggregation, and fixed controls.
- [x] Add integration tests for every scenario in the matrix.
- [ ] Add deterministic replay tests for identical sequence inputs.
- [x] Add regression tests for existing Context and one-turn Memory comparisons.
- [x] Update `server/src/studio/README.md` and the backend inspection procedure.
- [ ] Record validation results and known limitations before archiving this plan.

## Completion gate

Do not archive this plan until:

- [x] A two-turn Memory comparison runs through the existing server.
- [x] At least two Memory policies share the same fixed turn sequence and Context.
- [x] A later turn retrieves a record written by an earlier turn.
- [x] Updates, no-ops, expiries, misses, and procedural reuse are observable.
- [x] Metrics are bounded and clearly labelled as observations or fixture-derived
      proxies.
- [ ] Metrics are deterministic across independent runs where the adapter reports
      wall-clock latency.
- [ ] Multi-turn cancellation, corruption, and idempotency behaviour is tested at
      every persistence boundary.
- [x] Existing Context comparisons remain compatible.
- [x] Documentation and API examples match the implementation.

## Validation checkpoint

- Focused Studio and Memory suites: 54 passing tests.
- Full `@agent-harness-lab/lab-server` test command: passed; existing skipped
  platform fixtures remain skipped.
- Root `pnpm run build`: passed.
- Web typecheck: passed.
- `git diff --check`: passed.

Known limitations remain the unchecked hardening items above. In particular, replay
latency is wall-clock evidence and is normalized out of deterministic comparison
assertions; durable repository recovery is tested directly and through sequence
reopen, but every possible cancellation boundary is not yet covered.

## Next plan

After this plan, implement the Context research runtime with Memory held fixed as an
inspectable dependency. That plan is [`studio-context-research-runtime.md`](studio-context-research-runtime.md).
