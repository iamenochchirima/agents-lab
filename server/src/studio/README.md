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

Context comparisons vary `full-history`, `sliding-window`, or the lexical
`relevance-ranked` baseline. Memory comparisons vary an isolated Memory policy while
holding Context fixed. The initial Memory policies are `no-memory`, `working-memory`,
`episodic-lexical`, `semantic-keyed-facts`, and `procedural-cache`. The replay model
is deterministic and the Studio-owned evidence root records Context decisions,
Memory decisions, and the complete component composition. A minimal OpenRouter model
adapter is available for explicit injected live-provider profiles; replay remains the
default catalog environment.

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
- `compare-memory-retrieval@1` — varies Memory retrieval for a seeded preference.
- `compare-memory-updates@1` — checks keyed-fact supersession for a changed preference.

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
    memory/
      records.json                    # current trial-local Memory state
      events.jsonl                    # Memory operation journal
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

## Kernel ownership rules

The kernel is independently owned by `server/src/studio/`. It uses shared server
contracts for Context messages and token estimation, but it does not import Anesu,
Platform Lab runners, or platform SDKs.

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
the implementation does not claim exactly-once persistence.

## Experiment interpretation and UI handoff

The first procedure is deliberately narrow: submit the same old-important-fact case
with two or three Context strategies, then compare retained IDs, omitted IDs, budget
decisions, model-boundary message IDs, and replay outputs. The result can show that
this fixture's older fact was retained or omitted; it cannot establish a general
quality ranking between context strategies. `relevance-ranked` is a deterministic
lexical overlap heuristic, not a semantic retriever or production relevance model.

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
`trials/:trialId/memory/records.json`. Compare the fixed-control fingerprint and
Memory evidence before interpreting the grade; a passing fixture only describes that
fixture and policy combination.
