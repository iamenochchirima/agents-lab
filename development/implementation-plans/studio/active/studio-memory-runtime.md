# Studio Memory runtime

**Created:** `2026-09-20T00:13:17+02:00`  
**Last updated:** `2026-09-20T00:13:17+02:00`  
**Status:** Active  
**Owner:** Agent Harness Lab maintainers

## Start here

Read these before changing code:

- [`AGENTS.md`](../../../../AGENTS.md)
- [`CONTEXT.md`](../../../../CONTEXT.md)
- [`Studio implementation roadmap`](../README.md)
- [`Studio server module`](../../../../server/src/studio/README.md)
- [`Studio foundation kernel`](../completed/studio-runtime-kernel.md)
- [`Context and memory ecosystem research`](../../../../docs/research/context-engineering-ecosystem-2026.md)
- [`Keep Studio as a server module`](../../../../docs/adr/0004-keep-studio-as-server-module.md)

The foundation kernel is the starting point. It already provides a complete
single-turn harness composition, a narrow fixture Memory adapter, Context strategies,
deterministic replay, evidence files, and lifecycle handling. This plan replaces the
fixture Memory behaviour with a real local Memory experiment slice while preserving the
existing Context comparison contract.

## Purpose

Implement the first useful Studio Memory subsystem so Memory can be varied as an
independent harness component while Context remains a separate consumer of retrieved
records. The finished slice lets the Lab test what is stored, what is retrieved, what
is updated or rejected, what reaches Context, and what survives a restart.

This is a concrete Memory research slice, not the complete memory research program. It
uses deterministic local policies and storage so contributors can inspect and reproduce
results before introducing embeddings, external databases, or learned memory managers.

## Definition of done

From the existing Lab server, a caller can submit either the existing Context
comparison or a Memory comparison. A Memory comparison runs the same fixed scenario
through two or more Memory policies while holding the model, Context strategy, task,
seed, token budgets, and environment constant.

Each Memory trial can:

1. load isolated seeded records;
2. retrieve records for a turn using the selected policy;
3. pass the selected records to the existing Context assembler;
4. complete a deterministic model turn;
5. apply a write policy to the turn outcome;
6. apply deterministic update, deduplication, and consolidation rules;
7. persist the resulting state; and
8. run a later turn or restart inspection against that state.

The result exposes the exact records considered, selected, omitted, scored, written,
updated, superseded, deleted, or rejected. It does not claim that one Memory policy is
generally better from one fixture.

```text
Memory experiment request
  → fixed scenario and harness envelope
  → isolated trial memory namespace
  → seed records
  → retrieve and record decisions
  → Context assembles model-visible messages
  → deterministic model turn
  → write/update/consolidation decisions
  → durable memory state and evidence
  → later-turn/restart verification
```

## Research question and experimental rule

The first Memory experiment asks:

> With the same task, model, Context strategy, seed, and budget, how do different
> Memory read/write/consolidation policies affect source recall, update correctness,
> stale-memory exposure, token usage, persistence, and recovery?

The changed variable is the complete Memory policy. The following remain fixed for
every strategy slot in one comparison:

- scenario fixture and turn sequence;
- model adapter and model settings;
- Context strategy and parameters;
- system instructions and task text;
- token window, reserved output, and safety margin;
- execution environment and side-effect policy;
- random seed;
- grading questions and expected observations.

Memory evidence must stay separate from Context evidence. Memory decides what can be
retrieved or persisted. Context decides how retrieved records are represented, ordered,
budgeted, and passed to the model.

## Scope

- [ ] Define a versioned Memory domain model for records, scopes, provenance,
      revisions, lifecycle state, retrieval decisions, write decisions, and
      consolidation decisions.
- [ ] Replace the fixture-only Memory seam with a typed read/write/consolidate seam
      that can support multiple deterministic policies without becoming a generic
      plugin SDK.
- [ ] Add the four baseline Memory scopes: working, episodic, semantic, and
      procedural, with explicit lifetime and ownership rules.
- [ ] Add deterministic local implementations for no-memory, working-memory,
      episodic retrieval, semantic fact retrieval, and procedural cache retrieval.
- [ ] Add a durable local Memory repository with atomic writes, bounded records, and
      restart loading under the Studio evidence namespace.
- [ ] Add deterministic ranking, deduplication, supersession, update, discard, and
      consolidation behaviour with inspectable decisions.
- [ ] Extend the Studio experiment catalog and request validation to allow a Memory
      component experiment while preserving the current Context request and response
      behaviour.
- [ ] Run Memory trials through the existing `StudioHarnessRuntime` and preserve the
      twelve-slot composition evidence.
- [ ] Add fixed Memory scenarios for recall, update/conflict, retrieval miss,
      duplicate memory, forgetting/expiry, and procedural reuse.
- [ ] Add Memory-specific grading, metrics, events, evidence files, and safe HTTP
      projections.
- [ ] Add deterministic, persistence, restart, cancellation, failure-injection,
      idempotency, and isolation tests.
- [ ] Update the Studio backend documentation, roadmap, and a contributor inspection
      procedure without redesigning the UI.

## Explicitly out of scope

- Embedding generation, vector databases, hosted retrieval services, or semantic
  similarity claims beyond the deterministic local baseline.
- Learned memory managers, model-generated summaries, autonomous memory agents, or
  model-controlled `ADD`/`UPDATE`/`DELETE` decisions.
- Cross-user or multi-tenant production storage, encryption-at-rest, or a hosted
  Memory service.
- Mixing Memory records into the canonical transcript or allowing Memory to mutate
  Context strategy behaviour.
- Tool-based memory operations exposed to the model. The first slice exercises the
  Memory subsystem as a harness component, not as a new model-facing tool set.
- Parallel trial execution or shared mutable Memory between comparison strategies.
- Provider-specific Memory implementations, external side effects, or production
  retention/deletion workflows.
- A full UI workspace. The API and catalog must be ready for the later UI slice, but
  this plan does not rebuild the existing Studio interface.
- Broad generalisation of every component strategy. Only the explicit Context and
  Memory experiment branches are supported in this slice.

## Domain model

### Memory record

A Memory record is a durable or scoped representation that may be retrieved for a
future turn. It is not automatically model-visible.

Every record must include:

- stable `recordId` and schema version;
- one scope: `working`, `episodic`, `semantic`, or `procedural`;
- content plus a bounded representation kind;
- a stable logical key when the policy supports updates;
- source references to the turn, scenario, or fixture that produced it;
- namespace identity and session identity;
- created and updated timestamps from the injected clock;
- revision number;
- lifecycle state: `active`, `superseded`, `discarded`, or `expired`;
- optional `supersedesRecordId` and expiry metadata;
- deterministic provenance and policy identity.

Records with the same text are not automatically duplicates. Deduplication must use
the policy's declared logical key and normalized content, and the decision must be
recorded.

### Memory scopes

| Scope | Lifetime | Initial behaviour | Not to be confused with |
| --- | --- | --- | --- |
| Working | Current trial/session | bounded mutable state, never shared across strategy slots | durable episodic history |
| Episodic | Completed turns or sessions | append-only local records with recency and lexical retrieval | the raw transcript itself |
| Semantic | Facts, preferences, and stateful assertions | keyed records with revisions and supersession | arbitrary document search |
| Procedural | Reusable solutions or tool-use patterns | keyed successful-procedure cache | model planning or tool registry |

The namespace is part of the record identity. A trial cannot read another trial's
working, episodic, semantic, or procedural records unless a scenario explicitly seeds a
copy into that trial. This prevents a comparison slot from contaminating another slot.

### Memory operations

The subsystem records these operation intents:

- `ADD`: create a new logical record;
- `UPDATE`: create a new revision and supersede the previous revision;
- `DELETE`: mark a record discarded without pretending physical deletion is immediate;
- `NOOP`: reject or ignore a candidate because it is unchanged, invalid, duplicate, or
  outside policy;
- `EXPIRE`: mark a record expired because its retention condition was reached;
- `RETRIEVE`: return a record candidate and its deterministic score/reason;
- `OMIT`: retain a candidate in the store but do not pass it to Context;
- `CONSOLIDATE`: merge or reconcile records according to an explicit policy.

The model adapter must never create these operations implicitly. The Memory policy
creates them, and the repository applies them with idempotent keys.

## Baseline Memory policies

The first catalog should expose these policies as separate, inspectable choices:

1. **No memory** — returns no records and never persists turn output. This is the
   control condition.
2. **Working memory** — keeps bounded records for the current trial/session only;
   restart and later comparison trials begin empty.
3. **Episodic lexical** — appends bounded turn records and retrieves active records by
   deterministic lexical overlap, recency, and stable tie-breakers.
4. **Semantic keyed facts** — stores explicit fact records by logical key, updates a
   key by supersession, and retrieves active facts whose normalized key or content
   matches the task.
5. **Procedural cache** — stores successful task-pattern records under a deterministic
   procedure key and retrieves only exact or declared lexical matches.

These are baseline policies, not claims that lexical retrieval is semantic
understanding. The catalog and evidence must call out the limitation.

The policy contract should expose separate methods or typed phases for retrieval,
write decision, and consolidation. A single `remember()` method is not acceptable
because it would hide which operation caused an observation.

## Ownership and boundaries

```text
Studio HTTP routes
  → validate safe Memory experiment requests and expose projections

Studio comparison service
  → owns comparison lifecycle, fixed controls, strategy slots, and aggregate result

Studio Memory experiment runner
  → owns Memory trial sequencing, seeded fixture loading, later-turn execution,
    and Memory-specific grading

Memory policy adapters
  → own retrieval, write, update, deduplication, and consolidation decisions

Memory repository
  → sole writer for durable Memory state within one trial namespace

Studio evidence store
  → sole writer for comparison/trial evidence and normalized event records

Context strategy
  → consumes the Memory read result and owns model-visible packing/budgeting

Existing Platform Lab and Anesu
  → remain outside this subsystem and must not be imported as shortcuts
```

The Memory policy may read through the Memory repository and the current turn input.
It may not write arbitrary evidence files, mutate the scenario fixture, call the model,
or decide how records are packed into Context.

The Context serializer may turn retrieved Memory records into `ContextMessage` values,
but it must preserve source IDs, scope, provenance, and trust classification. A record
being retrieved does not make it trusted system instruction.

## State, persistence, and evidence

The existing Studio comparison root remains the parent namespace. Memory state is
trial-local and is separate from the summary evidence file.

```text
<AGENTLAB_STUDIO_RUN_ROOT>/<comparison-id>/
  config.json                         # immutable comparison envelope
  events.jsonl                        # ordered normalized events
  trajectory.json
  metrics.json
  result.json
  trials/<trial-id>/
    config.json                       # strategy and fixed controls
    context.json                      # model-visible Context decision
    memory.json                       # Memory summary/projection
    memory/
      records.json                    # current durable state snapshot
      events.jsonl                    # Memory operation journal
      decisions.jsonl                 # retrieval/write/consolidation decisions
    composition.json
    result.json
```

Rules:

- [x] The repository creates a trial Memory namespace before the first Memory turn.
- [x] Seed records are written before execution and included in the immutable trial
      configuration or a separately hashed fixture record.
- [x] State writes use a temporary file plus atomic rename and bounded file sizes.
- [ ] The journal records operation ID, policy version, namespace, record IDs,
      previous revision, decision, reason, and timestamp.
- [x] Replaying the same operation ID produces the same state and does not duplicate
      a write.
- [x] `records.json` is a recoverable projection of the journal, not the only source
      needed to diagnose a partial operation.
- [x] `memory.json` contains a safe summary: retrieved IDs, candidate IDs, scores,
      writes, updates, deletes, expiries, consolidation results, and scopes.
- [x] Raw record content remains bounded and safe to expose through the existing
      allowlisted evidence route.
- [x] Corrupt or incomplete Memory state produces an explicit recovery-required
      outcome; the runtime never silently starts with an empty store.
- [x] Trial namespaces are isolated even when comparisons run in the same process.

## Scenario fixtures

The plan should add versioned deterministic cases with explicit setup, turns, and
grading expectations. Existing Context scenarios remain valid.

| Case | Setup | Observation |
| --- | --- | --- |
| Previous preference recall | seed a preference in an earlier session | correct active preference is retrieved and reaches Context |
| Preference update conflict | seed `language=English`, then introduce `language=Spanish` | new revision supersedes the old one; stale value is not selected |
| Retrieval miss | seed unrelated records | no false positive is retrieved; grade records a miss |
| Duplicate write | produce the same fact twice | second operation is `NOOP`, not a duplicate active record |
| Expiry/forgetting | seed a record past its retention boundary | record becomes `EXPIRE`/omitted with reason |
| Procedural reuse | seed a successful procedure for a matching task | procedure is retrieved; unrelated tasks do not receive it |

Each case must specify:

- fixed turn sequence and source IDs;
- initial records and their provenance;
- expected retrieval/update/consolidation observations;
- the grading question and required source IDs;
- controls that must remain equal across strategy slots.

## Failure, retry, and recovery semantics

- [x] Memory retrieval is pure with respect to durable state and is not retried as a
      write operation.
- [ ] A write has a deterministic operation ID derived from comparison, trial, turn,
      policy, and candidate identity.
- [x] A repeated write operation ID is idempotent and returns the original decision.
- [x] A crash before persistence leaves no visible new record.
- [x] A crash after journal append but before snapshot publication rebuilds the same
      state from the journal on restart.
- [x] A crash after state publication but before acknowledgement is reconciled as an
      already-applied operation, not duplicated.
- [x] A corrupt journal, mismatched namespace, or invalid revision stops the trial
      with explicit recovery-required evidence.
- [ ] Cancellation before retrieval, during persistence, and after persistence is
      represented distinctly; completed writes are not described as rolled back.
- [ ] Consolidation is bounded, deterministic, and idempotent. It cannot silently
      erase source records without recording the decision and supersession links.
- [x] Duplicate and out-of-order Memory events are detected by operation ID and
      sequence/revision checks.
- [x] Memory failure does not cause the runtime to fabricate Context or model evidence.
- [x] No comparison strategy reads another strategy's state after process restart.

The implementation must use at-least-once-safe persistence with idempotent operations.
It must not claim exactly-once Memory writes.

## Security, limits, and configuration

- [x] Validate scope, namespace, record IDs, logical keys, revisions, timestamps, and
      operation IDs before persistence.
- [x] Enforce maximum record count, record bytes, content bytes, retrieved-record
      count, retrieval token contribution, journal bytes, and consolidation work.
- [ ] Keep Memory content out of logs and errors unless it is already part of the
      explicitly inspectable fixture evidence.
- [x] Preserve source and trust metadata when converting records to Context messages.
- [ ] Reject path traversal and symlink escapes in Memory state paths.
- [ ] Use the existing server configuration style for Studio root and add only
      Memory-specific bounded defaults.
- [x] Do not require credentials, network access, a database, or an external service.
- [ ] Report unavailable future providers honestly instead of falling back to an
      empty Memory store.

## Implementation checklist

### 1. Domain contracts and catalog

- [x] Add versioned Memory record, namespace, query, candidate, decision, and policy
      types.
- [x] Define explicit scope, lifecycle, provenance, revision, supersession, and
      retention semantics.
- [x] Define retrieval, write, and consolidation result contracts with decision
      reasons and bounded diagnostic detail.
- [x] Add Memory experiment and scenario descriptors to the Studio catalog.
- [x] Extend request validation to accept `component: "memory"` only for registered
      Memory experiments and policies.
- [x] Preserve the existing Context request shape, validation, catalog, and response
      semantics.
- [x] Define Memory-specific graders without putting grading logic in the model
      adapter.

### 2. Repository and deterministic policies

- [x] Implement the trial-local Memory repository with atomic snapshot and journal
      persistence.
- [x] Implement restart loading and recovery validation.
- [x] Implement the no-memory control policy.
- [x] Implement bounded working-memory policy.
- [x] Implement episodic lexical retrieval and append policy.
- [x] Implement semantic keyed-fact retrieval, update, supersession, and conflict
      policy.
- [x] Implement procedural cache retrieval and write policy.
- [x] Implement deterministic deduplication, expiry, and consolidation policies.
- [x] Make every policy expose adapter ID/version and its effective parameters.

### 3. Runtime integration

- [ ] Keep `StudioHarnessRuntime` responsible for one complete turn and add a narrow
      Memory-aware trial/sequence runner around it.
- [x] Add seeded fixture loading before a trial starts.
- [x] Add retrieval evidence before Context assembly and write/consolidation evidence
      after the model/output phase.
- [x] Support the Memory scenario turn sequence without breaking the current single-
      turn Context scenario.
- [x] Ensure each strategy slot receives an isolated Memory namespace.
- [x] Keep Context as the only component that decides how retrieved records enter the
      model-visible message budget.
- [x] Add Memory-specific grade and metrics aggregation while preserving current
      Context grades and metrics.
- [x] Emit canonical Memory events: `MemorySeeded`, `MemoryCandidatesRanked`,
      `MemoryRetrieved`, `MemoryWriteDecided`, `MemoryConsolidated`,
      `MemoryStatePersisted`, and `MemoryStateRecovered`.

### 4. Evidence and HTTP projection

- [x] Extend `StudioMemoryEvidence` to include candidates, scores/reasons, selected
      records, writes, updates, deletes, expiries, consolidation, and state revision.
- [x] Add safe Memory state and decision evidence to the allowlisted route.
- [x] Keep raw content exposure bounded and consistent with existing Studio evidence
      rules.
- [x] Return Memory trial projections with strategy identity, grade, counters, and
      recovery status.
- [x] Add catalog and request examples to the Studio backend README.

### 5. Tests and reproducibility

- [x] Add unit tests for record validation, scope rules, provenance, revisions, and
      supersession.
- [x] Add unit tests for each baseline policy's retrieval, write, deduplication,
      expiry, and consolidation decisions.
- [x] Add repository tests for atomic writes, journal replay, duplicate operations,
      corrupt state, and namespace isolation.
- [x] Add runtime tests proving Memory evidence remains separate from Context evidence.
- [ ] Add integration tests for the recall, update, miss, duplicate, expiry, and
      procedural cases.
- [ ] Add comparison tests proving only Memory policy changes across slots.
- [x] Add restart and failure-injection tests before and after journal/snapshot writes.
- [ ] Add cancellation and idempotency tests.
- [x] Add deterministic replay tests for identical seed, fixture, policy, and turn
      sequence.
- [ ] Add regression tests proving existing Context comparisons and Platform Lab
      endpoints remain unchanged.

### 6. Documentation and inspection procedure

- [x] Update `server/src/studio/README.md` with Memory ownership, state layout,
      policies, limits, and limitations.
- [ ] Update the Studio roadmap and active-plan index when this plan is completed.
- [x] Add a backend-only curl/Node inspection procedure for submitting a Memory
      comparison and reading its evidence.
- [ ] Document observed results separately from interpretation and open questions.
- [ ] Record validation results and known limitations before archiving this plan.

## Test coverage

### Unit tests

- [ ] Valid records accept all four scopes and reject invalid lifecycle transitions.
- [ ] Records preserve provenance, namespace, revision, and supersession links.
- [ ] Retrieval ranking is deterministic, bounded, and stable under ties.
- [ ] No-memory and working policies do not leak state across trials or restarts.
- [ ] Episodic policy appends and retrieves only active, in-scope records.
- [ ] Semantic policy updates a logical key by supersession and rejects stale
      revisions.
- [ ] Procedural policy only returns matching procedure keys/patterns.
- [ ] Duplicate, invalid, expired, and over-limit writes produce explicit decisions.
- [ ] Consolidation is deterministic and idempotent.
- [ ] Memory-to-Context serialization preserves IDs, scopes, provenance, and trust
      classification.
- [ ] Memory graders remain separate from the model adapter.

### Integration tests

- [ ] A Memory recall comparison executes through the existing server and returns
      complete twelve-slot composition evidence.
- [ ] An update/conflict comparison retrieves the latest active fact and records the
      superseded revision.
- [ ] A retrieval miss does not fabricate a source or answer grade.
- [ ] Duplicate writes do not create duplicate active records.
- [ ] Expired records are omitted and the expiry decision is inspectable.
- [ ] Procedural reuse retrieves only the matching procedure.
- [ ] Context evidence shows exactly which Memory records reached the model-bound
      input, while Memory evidence shows candidates that Context omitted.
- [ ] Restart after a persisted write reconstructs the same Memory state.
- [ ] Journal replay after a simulated interrupted snapshot is deterministic.
- [ ] Corrupt state produces recovery-required evidence rather than an empty store.
- [ ] Failure injection before retrieval, after journal append, after snapshot write,
      and during evidence publication remains recoverable.
- [ ] Cancellation before and during Memory persistence records the correct outcome.
- [ ] Repeated idempotency keys return the original comparison without duplicate
      Memory operations.
- [ ] Existing Context comparison tests and Platform Lab tests continue to pass.

### Manual acceptance checks

- [ ] Submit a two-policy Memory comparison using the documented local command.
- [ ] Inspect the comparison projection, event stream, `memory.json`, state snapshot,
      and decision journal.
- [ ] Confirm that the two strategy slots have equal fixed-control fingerprints and
      different Memory policy identities only.
- [ ] Restart the service or reconstruct the repository, inspect the same trial, and
      verify the state revision and active records are unchanged.
- [ ] Verify no credentials, hidden model reasoning, or arbitrary workspace files are
      persisted in Memory evidence.
- [ ] Verify the UI remains honest: no Memory run result is shown until a later UI
      integration connects to the real API.

## Required validation commands

```bash
pnpm --dir server run typecheck
pnpm --dir server run build
node --test server/dist/tests/studio/*memory*.test.js
node --test server/dist/tests/studio/*.test.js
pnpm --dir server run test
pnpm --dir apps/web run typecheck
git diff --check
```

The live OpenRouter adapter is not required for Memory tests. Memory tests must use
deterministic replay and local filesystem fixtures. Any manually run live-provider
check must be labelled as non-deterministic and must not be required for completion.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] A Memory comparison executes end to end through the existing Lab server.
- [ ] At least two Memory policies can be compared with all fixed controls recorded.
- [ ] All four Memory scopes have explicit baseline semantics and evidence.
- [ ] Retrieval, writing, updating, deduplication, expiry, and consolidation are
      observable and deterministic.
- [ ] Memory state survives a supported restart/recovery path without cross-trial
      leakage.
- [ ] Context and Memory evidence remain separate and the model sees only the
      Context-selected representation.
- [ ] Failure, cancellation, idempotency, duplicate, and corruption paths are tested.
- [ ] Existing Context and Platform Lab behaviour remains compatible.
- [ ] Documentation, examples, validation results, and known limitations match the
      implementation.

## Next plan after completion

The next Studio slice should return to Context research with Memory held as a fixed,
inspectable subsystem. It can then compare compaction, hierarchical summaries,
relevance ranking, caching, multimodal representations, and context-pressure policies
without confusing Context loss with Memory retrieval loss.

## Commit discipline and handoff

- [ ] Commit contracts/catalog changes separately from repository/runtime changes where
      the boundaries are reviewable.
- [ ] Commit integration, evidence, tests, and documentation with the behaviour they
      describe.
- [ ] Run focused checks before each coherent commit.
- [ ] Preserve unrelated Anesu, Platform Lab, and UI changes in the worktree.
- [ ] Record changed files, validation results, and known limitations in the final
      handoff.

## Completion record

Complete this section only when the plan is archived.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`  
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

This plan records the first deterministic local Memory subsystem. Later plans may add
external retrieval, learned memory managers, richer retention policy, or provider-native
memory, but those must preserve this slice's separate Memory/Context evidence boundary.
