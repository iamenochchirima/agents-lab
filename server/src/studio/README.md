# Studio backend

Studio is a separately owned module family inside the existing Lab server. It does
not create a second server or use the Platform Lab control-plane run lifecycle.

The first slice supports a deterministic Context Management comparison through
`/api/studio/`. It runs the same fixed scenario with `full-history`,
`sliding-window`, or the lexical `relevance-ranked` baseline, using a replay model
adapter and a Studio-owned evidence root.

```text
server/src/studio/
  domain/       Studio records, validation, and lifecycle
  runtime/      fixed trial-environment assembly
  strategies/   replaceable component strategies
  application/  comparison coordination
  adapters/     replay model and evidence persistence
  http/         /api/studio route registration
```

The replay adapter is a harness-fixture adapter. It verifies what context reached
the model boundary; it is not evidence of model quality.

## First API contract

Create a comparison with `POST /api/studio/comparisons`. The request references the
versioned system, deterministic environment, experiment, and scenario catalog entries;
the request supplies the component strategies and a seed. An `x-idempotency-key`
header is preferred, with `idempotencyKey` accepted in the JSON body for local use.

The first catalog accepts `neutral-agent@1`, `deterministic-replay@1`,
`compare-context-retention@1`, and `context-old-important-fact@1`. The available
strategies are `full-history@1`, `sliding-window@1`, and `relevance-ranked@1`.
The latter two accept bounded string parameters: `recentMessages` and
`maxMessages`, respectively.

`GET /api/studio/catalog` returns the versioned, safe catalog for the Studio UI. It
lists all eleven harness areas, marks Context Management as currently available, and
marks the other areas as planned. Planned entries are discoverable but expose no fake
strategies or executable run path.

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
    context.json
    result.json
```

Configuration is immutable and evidence writes are idempotent. A repeated request with
the same key and a different definition is a conflict. The current replay execution is
sequential and completes in the request process; a later provider-backed profile must
add external request identity and reconciliation before it can claim resumability.
The deterministic replay profile is not a general OS sandbox; it is safe in this slice
because it performs no network, filesystem-workspace, or side-effecting tool operation.

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
