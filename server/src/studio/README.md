# Studio backend

Studio is a separately owned module family inside the existing Lab server. It does
not create a second server or use the Platform Lab control-plane run lifecycle.

The foundation kernel supports deterministic Context Management and Memory comparisons
through `/api/studio/`. Each trial runs through a complete baseline harness composition:

```text
input
  -> memory read
  -> context assembly
  -> planning
  -> bounded control loop
  -> model
  -> tool/computer capability observation
  -> safety gate
  -> output
  -> memory write
  -> canonical events and evidence
```

Context comparisons vary `full-history`, `sliding-window`, and the lexical
`relevance-ranked` baseline, plus `group-aware-sliding-window`,
`relevance-ranked-groups`, `deterministic-compaction`, `hierarchical-summary`, and
`token-budget-allocation`. Memory comparisons vary an isolated Memory policy while
holding Context fixed. The initial Memory policies are `no-memory`, `working-memory`,
`episodic-lexical`, `semantic-keyed-facts`, and `procedural-cache`. The replay model
is deterministic and the Studio-owned evidence root records Context decisions,
Memory decisions, and the complete component composition. A minimal OpenRouter model
adapter is available for explicit injected live-provider profiles; replay remains the
default catalog environment.

The `compare-context-research-boundary@1` experiment fixes the
`semantic-keyed-facts` Memory policy and changes only Context. Its source-group
fixture distinguishes instructions, transcript turns, a grouped tool call/result,
retrieved Memory, and the active turn. Context research evidence is additive to the
legacy message projection: it records source groups, trust, provenance, token
contributions, allocation decisions, compaction coverage, pressure, and which
retrieved Memory records were model-bound. Memory evidence remains in `memory.json`
and is not merged into Context evidence.

Compaction and hierarchical-summary are bounded deterministic fixtures. They expose
coverage and limitations but do not claim that a rule-based summary is semantically
equivalent to the source. Provider context overflow is classified at the OpenRouter
boundary and gets at most one changed-input deterministic-compaction recovery; an
unrecoverable overflow fails the turn without fabricating a model result or Memory
write.

```text
server/src/studio/
  domain/       Studio records, validation, and lifecycle
  runtime/      trial environment, typed kernel contracts, baseline adapters, and runtime
  strategies/   replaceable component strategies
  application/  comparison coordination
  adapters/     model adapters and evidence persistence
  http/         /api/studio route registration
```

The replay adapter is a harness-fixture adapter. It verifies what context reached
the model boundary; it is not evidence of model quality.

## First API contract

Create a comparison with `POST /api/studio/comparisons`. The request references the
versioned system, deterministic environment, experiment, and scenario catalog entries;
the request supplies the component strategies and a seed. An `x-idempotency-key`
header is preferred, with `idempotencyKey` accepted in the JSON body for local use.

The catalog accepts `neutral-agent@1` and `deterministic-replay@1`, plus these
executable experiments:

- `compare-context-retention@1` — varies Context retention for the old-fact case.
- `compare-context-research-boundary@1` — compares source grouping, ranking,
  deterministic compaction, and source-class allocation against one fixed Memory
  state.
- `compare-memory-retrieval@1` — varies Memory retrieval for a seeded preference.
- `compare-memory-multiturn@1` — writes a preference on one turn and recalls it on a later turn.
- `compare-memory-multiturn-updates@1` — checks supersession across turns.
- `compare-memory-multiturn-deduplication@1` — checks repeated keyed writes become a no-op.
- `compare-memory-multiturn-expiry@1` — checks explicit expiry across turns.
- `compare-memory-multiturn-misses@1` — checks an unrelated record remains a miss.
- `compare-memory-multiturn-procedures@1` — checks procedural reuse across turns.
- `compare-memory-updates@1` — checks keyed-fact supersession for a changed preference.
- `compare-memory-misses@1` — checks that unrelated records are omitted.
- `compare-memory-deduplication@1` — checks keyed no-op behavior for unchanged facts.
- `compare-memory-expiry@1` — checks omission and retirement after expiry.
- `compare-memory-procedures@1` — checks matching procedural reuse.

Memory records use four explicit scopes: working, episodic, semantic, and procedural.
The local baselines use deterministic lexical matching and keyed revision rules. They
are inspectable fixtures, not claims of embedding-quality retrieval or production
memory quality. Context's `recentMessages` and `maxMessages` remain bounded string
parameters for the applicable Context strategies.

`GET /api/studio/catalog` returns the versioned, safe catalog for the Studio UI. It
lists all twelve harness areas, marks Context Management and Memory as currently
available, and marks the other areas as planned. Planned entries are discoverable but
expose no fake strategies or executable run path.

`GET /api/studio/comparisons/:comparisonId` returns the safe projection, including each
trial's context evidence and result. `GET /api/studio/comparisons/:comparisonId/events`
reads ordered observations. The bounded evidence route allows only the JSON files and
JSONL event file documented below.

## Frontend integration contract

The frontend must load `GET /api/studio/catalog` before constructing a comparison. The
catalog is the source of truth for available component IDs, experiment IDs, scenario
versions, strategy IDs, parameter defaults, environment limits, and planned versus
available status. The browser must not hard-code an executable strategy that the
catalog does not advertise.

The minimum request shape is:

```json
{
  "system": { "id": "neutral-agent", "version": "1" },
  "environment": { "id": "deterministic-replay", "version": "1" },
  "experiment": {
    "id": "compare-memory-retrieval",
    "version": "1",
    "scenario": { "id": "memory-previous-preference", "version": "1" },
    "subject": {
      "component": "memory",
      "strategies": [
        { "id": "no-memory", "version": "1", "parameters": {} },
        { "id": "semantic-keyed-facts", "version": "1", "parameters": {} }
      ]
    }
  },
  "seed": "ui-inspection-seed-1",
  "idempotencyKey": "ui-inspection-memory-1"
}
```

Send the idempotency key in the `x-idempotency-key` header when possible. The server
returns `202` with a safe comparison projection. A client must treat `created` and
`running` as non-terminal, poll the comparison or its events endpoint, and stop at
`completed`, `failed`, `cancelled`, or `recovery_required`. The event cursor is the
`after` query value returned as `nextSequence`; a reconnect must not infer completion
from a lost browser request.

The UI may render status, trial manifests, grades, observed metrics, event payloads,
and the allowlisted evidence files. It must keep Context evidence separate from Memory
evidence and must not recalculate grades or strategy decisions in the browser. Planned
component areas remain visible in the catalog but have no executable request path.

Errors use the shape `{ "error": { "code": string, "message": string } }`. The
server deliberately omits provider credentials, raw headers, arbitrary filesystem
paths, hidden model reasoning, and unsupported component data from public projections.

```text
<AGENTLAB_STUDIO_RUN_ROOT>/<comparison-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  trials/<trial-id>/
    config.json
    context.json                      # model-visible Context decision
    memory.json                       # Memory retrieval/write summary
    turns/<turn-id>.json               # ordered turn Context, Memory, grade, and metrics
    memory/
      records.json                    # current trial-local Memory state
      events.jsonl                    # Memory operation journal
      decisions.jsonl                 # bounded write/consolidation decisions
    composition.json
    result.json
```

Configuration is immutable and evidence writes are idempotent. A repeated request with
the same key and a different definition is a conflict. The current replay execution is
sequential and completes in the request process; a later provider-backed profile must
add external request identity and reconciliation before it can claim resumability.
The deterministic replay profile is not a general OS sandbox. It is safe in this slice
because it performs no network, filesystem-workspace, computer-use, or side-effecting
tool operation. Computer Use is recorded as unavailable rather than simulated.

The server bounds local Memory state with `AGENTLAB_STUDIO_MEMORY_*` configuration
values. The bounds apply before persistence and cover record count, record/content
bytes, retrieved records, journal bytes, and consolidation operations. A persistence
cancellation is classified as `not-started`, `unknown`, or `applied`; an `applied`
write is never presented as rolled back. A repository restart reconstructs from its
journal when the snapshot is behind, and corrupt state is reported as an error rather
than treated as an empty store.

## Kernel ownership rules

The kernel is independently owned by `server/src/studio/`. It uses shared server
contracts for Context messages and token estimation, but it does not import Platform
Lab runners or platform SDKs.

`StudioComparisonService` owns comparison lifecycle and evidence publication.
`StudioHarnessRuntime` owns one complete trial turn. Component adapters return typed
observations and do not write arbitrary evidence files. Memory retrieves records and
decides what to persist; Context serializes retrieved records as model-visible
messages, applies ordering and token budgets, and records what it omitted. Retrieved
Memory content is labelled untrusted in Context metadata and does not become a system
instruction merely because it was selected.

The current Memory slice is intentionally local and deterministic. Durable policies
write under the trial evidence namespace; working memory is process-local and is not
carried across a restart. The no-memory policy ignores fixture seeding and never
persists turn output. Repository writes are at-least-once-safe through operation IDs;
the implementation does not claim exactly-once persistence. Each Memory repository
also bounds record count, record and content bytes, retrieved records, journal bytes,
and consolidation operations. A consolidation that exceeds its configured work limit
fails before applying any mutation.

Multi-turn Memory scenarios reuse one strategy-specific store for the full trial. A
durable policy reopens its trial-local repository between turns, while working Memory
intentionally remains process-local. The `turns/<turn-id>.json` projections expose
per-turn retrieval, model-bound Context, write/consolidation decisions, grade, and
fixture-derived measurements. Aggregate `metrics.json` counts turns and Memory
decisions but labels them as observations; they are not precision, recall, or a
general policy ranking.

## Context research inspection

For a Context research comparison, inspect the fixed-control fingerprint on every
trial first. It must be identical across strategy slots. Then compare:

1. `trials/<trial-id>/memory.json` for records considered, retrieved, and persisted;
2. `trials/<trial-id>/context.json` for the strategy decision and research projection;
3. `trials/<trial-id>/turns/<turn-id>.json` for the same decision alongside the grade;
4. `events.jsonl` for the ordered `MemoryRetrieved`, `ContextAssembled`,
   `ContextOverflowRecovery`, and model events; and
5. `metrics.json` for counts derived from those records, including their measurement
   basis and unavailable values.

`memoryRecordIdsConsidered` means retrieved Memory was available at the
Memory-to-Context boundary. `memoryRecordIdsModelBound` means Context actually
serialized it for the model. These are not retrieval quality or answer-quality
claims. Source retention and grading are meaningful only for the declared fixture.

## Experiment interpretation and UI handoff

The first procedure is deliberately controlled: submit the same scenario and fixed
Memory state with at least three Context strategies, then compare retained IDs,
omitted IDs, group decisions, budget decisions, model-boundary message IDs, and
replay outputs. The result can show what this fixture retained, summarized, or
omitted; it cannot establish a general quality ranking between Context strategies.
`relevance-ranked` and `relevance-ranked-groups` are deterministic lexical overlap
heuristics, not semantic retrievers or production relevance models.

Once this contract is stable, the Studio screen can submit the comparison, poll the
projection or event endpoint, and link each visible trial to its bounded evidence files.
The UI should render the server's safe projections and availability honestly; it should
not recreate strategy selection, token budgets, or benchmark conclusions in the browser.

## Local inspection

Build and run the focused backend checks from the repository root:

```bash
pnpm --filter @agent-harness-lab/lab-server build
node --test server/dist/tests/studio/*.test.js server/dist/tests/studio/memory/*.test.js
```

For a manual run, submit a request matching the `memoryRequest` fixture in
`server/tests/studio/http.test.ts` to `POST /api/studio/comparisons`, then use the
returned comparison ID with `GET /api/studio/comparisons/:comparisonId` and the
allowlisted evidence route for `trials/:trialId/memory.json` or
`trials/:trialId/memory/records.json`. For a temporal run, use the
`memoryMultiturnRequest` fixture and inspect `trials/:trialId/turns/turn-02-recall.json`.
Compare the fixed-control fingerprint and Memory evidence before interpreting the
grade; a passing fixture only describes that fixture and policy combination.
For the Context research slice, use the `contextResearchRequest` fixture in
`server/tests/studio/http.test.ts`, then inspect `context.json`, `memory.json`, and
the Context-related events for every trial. The focused checks also cover fitting,
near-limit, over-budget, unknown-token, cancellation, restart, deterministic replay,
and provider-overflow recovery cases.

For a copyable backend-only procedure, see
[`development/playground/studio-backend-inspection.md`](../../../development/playground/studio-backend-inspection.md).
