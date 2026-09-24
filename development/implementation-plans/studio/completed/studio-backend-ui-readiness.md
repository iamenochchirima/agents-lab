# Studio backend completion and UI readiness

**Created:** `2026-09-20T19:24:42+02:00`<br>
**Last updated:** `2026-09-20T19:53:00+02:00`<br>
**Status:** Completed<br>
**Owner:** Agent Harness Lab maintainers

## Start here

Read these before changing code:

- [`AGENTS.md`](../../../../AGENTS.md)
- [`CONTEXT.md`](../../../../CONTEXT.md)
- [`Studio implementation roadmap`](../README.md)
- [`Studio server module`](../../../../server/src/studio/README.md)
- [`Studio Memory runtime`](studio-memory-runtime.md)
- [`Studio foundation kernel`](../completed/studio-runtime-kernel.md)
- [`Keep Studio as a server module`](../../../../docs/adr/0004-keep-studio-as-server-module.md)
- [`Documentation guide`](../../../../docs/contributing/documentation.md)

This plan continues the existing Studio backend work. It does not create another
server, replace the Platform Lab lifecycle, or decide the final Studio interface.
The existing Memory plan remains the detailed source for Memory semantics; this plan
owns the remaining completion gates and the boundary needed by a future UI.

## Purpose

Finish the deterministic Context and Memory backend foundation and make its existing
`/api/studio` contract reliable enough for a frontend to consume without backend
guesswork. The result should be a real, inspectable local experiment service rather
than a UI prototype that happens to have a run button.

## Definition of done

A contributor can use the existing Lab server to submit a versioned Context or Memory
comparison, observe its lifecycle, inspect its events and evidence, cancel it where
permitted, restart or reconstruct its local state, and receive an honest terminal
outcome. The catalog and request/response documentation are sufficient for a future
UI to configure and inspect these comparisons without inventing IDs, status values, or
evidence paths.

The final UI layout remains intentionally undecided. This slice delivers the stable
backend and integration seam that the chosen UI will use later.

```text
catalog + comparison request
  → existing Lab server /api/studio
  → isolated deterministic Context/Memory trial
  → lifecycle events + durable evidence
  → safe comparison projection for a future UI
```

## Scope

- [x] Finish the remaining Memory persistence, cancellation, consolidation, security,
      and recovery hardening gates from the active Memory plan.
- [x] Verify Context and Memory comparisons through the real HTTP boundary, not only
      through direct service tests.
- [x] Make the catalog, request schema, lifecycle states, safe projections, and
      evidence routes an explicit versioned frontend integration contract.
- [x] Add a reproducible contributor inspection procedure for successful, failed,
      cancelled, restarted, and idempotent comparisons.
- [x] Record validation results, limitations, and the exact handoff to the later UI
      implementation plan.

## Explicitly out of scope

- Final Studio visual design, information architecture, navigation changes, or layout
  decisions.
- Connecting the current preview-only Components UI to the API.
- Tool-use, computer-use, control-graph, delegation, or environment/safety strategy
  experiments.
- Hosted databases, vector stores, embedding retrieval, learned memory managers, or
  production multi-tenant persistence.
- Treating deterministic replay as evidence of general model quality.
- A second server or a second Studio execution lifecycle.

## Finished behaviour

### User-visible and API behaviour

The server exposes these usable boundaries:

- `GET /api/studio/health` reports the deterministic local execution profile.
- `GET /api/studio/catalog` is the source of truth for available component areas,
  experiments, scenarios, strategies, versions, and limits.
- `POST /api/studio/comparisons` accepts a validated Context or Memory comparison and
  returns the created lifecycle projection.
- `GET /api/studio/comparisons/:comparisonId` returns safe status, manifest, trial,
  grade, metric, and recovery information.
- `GET /api/studio/comparisons/:comparisonId/events` returns bounded ordered events
  with a polling/reconnection cursor.
- `POST /api/studio/comparisons/:comparisonId/cancel` has idempotent cancellation
  semantics and distinguishes already-terminal comparisons.
- `GET /api/studio/comparisons/:comparisonId/evidence/*` exposes only allowlisted
  evidence files; browser requests never provide arbitrary filesystem paths.

The API must expose unavailable capabilities honestly. The current executable scope is
deterministic Context and Memory experiments; tool execution, computer use, and other
component areas remain planned.

### Ownership and boundaries

```text
server/src/studio/catalog.ts
  → owns versioned available IDs, strategies, scenarios, and safe limits

server/src/studio/http/
  → owns request parsing, status codes, safe projections, and allowlisted evidence access

server/src/studio/application/
  → owns comparison lifecycle, trial ordering, cancellation, and idempotency

server/src/studio/runtime/
  → owns one complete deterministic harness turn and component composition

server/src/studio/memory/
  → owns Memory policy decisions, namespaces, journal/snapshot state, and Memory evidence

server/src/studio/adapters/evidence-store.ts
  → is the sole writer for durable comparison and trial evidence

future Studio UI
  → owns configuration interaction, polling, display, and user navigation;
    it must not execute strategies or read the filesystem directly
```

The existing server module remains the only Studio runtime boundary. Platform Lab
routes and Anesu execution remain outside this plan.

## State, persistence, and evidence

The existing local run root remains authoritative:

```text
<STUDIO_RUN_ROOT>/<comparison-id>/
  config.json                 # immutable comparison manifest
  events.jsonl                # ordered comparison events
  trajectory.json             # normalized turn trajectory
  metrics.json                # observed metrics and unavailable values
  result.json                 # terminal result or recovery-required result
  trials/<trial-id>/
    config.json               # immutable trial configuration
    context.json              # model-bound Context decision
    memory.json               # safe Memory decision summary
    turns/<turn-id>.json      # per-turn Context, Memory, grade, and metrics
    memory/
      records.json            # recoverable Memory projection
      events.jsonl            # Memory operation journal
```

- [x] Every Memory mutation has a deterministic operation ID derived from comparison,
      trial, turn, policy, and candidate identity.
- [x] Journal records contain operation ID, policy version, namespace, record IDs,
      previous revision, decision, reason, and timestamp.
- [x] Complete JSON records are published atomically and bounded by configured limits.
- [x] Cancellation and crash points distinguish no-write, persisted-write, and
      acknowledgement-unknown outcomes.
- [x] Memory content is redacted from logs and errors unless it is explicitly part of
      bounded fixture evidence.
- [x] Safe HTTP projections preserve source IDs, provenance, policy identity, and
      recovery status without exposing credentials or arbitrary files.
- [x] Restart and corruption paths produce recovery-required evidence rather than an
      empty or fabricated Memory store.

## Failure, retry, and recovery semantics

- [x] Pure Context and Memory reads are not retried as writes.
- [x] A repeated Memory operation ID returns the original decision without duplicating
      a record or event.
- [x] Consolidation is bounded, deterministic, idempotent, and records supersession or
      discard decisions instead of silently erasing source records.
- [x] Cancellation before retrieval, during persistence, and after persistence is
      represented distinctly; completed writes are never described as rolled back.
- [x] A comparison is created once for an idempotency key and repeated creation does
      not create another durable comparison.
- [x] Incomplete comparisons discovered after restart become `recovery_required` and
      are not presented as completed.
- [x] Trials stop after a non-recoverable failure and preserve completed trial evidence.
- [x] Failure injection before retrieval, after journal append, after snapshot
      publication, and during evidence publication has a tested recovery outcome.
- [x] The implementation makes no exactly-once claim; persistence is at-least-once-safe
      through idempotent operations.

## Security and configuration

- [x] Memory state paths reject traversal and symlink escapes before opening files.
- [x] Memory-specific limits use the existing server configuration style with bounded
      safe defaults.
- [x] The deterministic profile requires no credentials, network, database, or hosted
      dependency.
- [x] Future provider-backed Memory profiles are reported as unavailable rather than
      falling back to an empty store.
- [x] Evidence routes accept allowlisted logical file names only and never arbitrary
      paths supplied by a client.
- [x] Provider credentials, raw headers, and unrelated server configuration remain
      excluded from public projections and evidence.

## Implementation checklist

### 1. Close the Memory backend gates

- [x] Implement and test deterministic Memory operation IDs.
- [x] Complete Memory journal metadata and replay validation.
- [x] Implement distinct cancellation outcomes before, during, and after persistence.
- [x] Make consolidation bounded, deterministic, idempotent, and evidence-producing.
- [x] Add Memory-content redaction for logs, errors, and safe projections.
- [x] Reject path traversal and symlink escapes in Memory state paths.
- [x] Validate configuration defaults and explicitly report unavailable future providers.
- [x] Reconcile the remaining unchecked Memory plan items with this plan before archive.

### 2. Verify the existing HTTP contract

- [x] Exercise every currently catalogued Context experiment through HTTP.
- [x] Exercise every currently catalogued Memory experiment through HTTP.
- [x] Verify valid requests return a created/running projection and invalid requests
      return structured actionable errors.
- [x] Verify comparison inspection, event polling, cancellation, and evidence access
      work from the comparison ID alone.
- [x] Verify idempotency returns the original comparison and does not duplicate Memory
      operations or evidence.
- [x] Verify fixed-control fingerprints remain equal across strategy slots except for
      the declared changed component strategy.
- [x] Verify Context evidence and Memory evidence remain separate and inspectable.
- [x] Verify all planned component areas remain discoverable but non-executable.

### 3. Define the frontend integration seam without choosing the UI

- [x] Document the minimum UI request model: catalog selection, scenario, strategy
      slots, parameters, seed, environment, and idempotency key.
- [x] Document the lifecycle state machine and polling/reconnection rules.
- [x] Document the safe result model the UI may render: status, grade, metrics,
      component evidence, events, and recovery diagnostics.
- [x] Document the evidence-file allowlist and prohibit browser filesystem access.
- [x] Add contract fixtures or tests proving the documented examples match the actual
      server responses.
- [x] Record which current browser fields are preview-only and must not be treated as
      server-backed until a later UI plan connects them.

### 4. Contributor inspection and documentation

- [x] Add a backend-only curl or Node procedure for a Context comparison.
- [x] Add a backend-only curl or Node procedure for a Memory comparison.
- [x] Include inspection of `config.json`, `events.jsonl`, `context.json`,
      `memory.json`, the journal, and the terminal result.
- [x] Include restart, cancellation, idempotency, and failure-injection procedures.
- [x] Update `server/src/studio/README.md` with the final contract, limitations, and
      UI handoff boundary.
- [x] Update the Studio roadmap and active-plan index when all gates pass.
- [x] Record observed results separately from interpretation and open questions.

## Test coverage

### Unit tests

- [x] Operation ID derivation is stable for identical inputs and changes when the
      policy, candidate, turn, or namespace changes.
- [x] Journal entries validate required metadata, revisions, namespaces, and decisions.
- [x] Consolidation is bounded, deterministic, idempotent, and preserves provenance.
- [x] Cancellation state is classified correctly at each persistence boundary.
- [x] Redaction removes Memory content and credentials from logs/errors while retaining
      safe identifiers.
- [x] Path traversal, symlink escape, invalid namespaces, and over-limit state are
      rejected before persistence.
- [x] Catalog and request examples validate against the public schema.

### Integration tests

- [x] Context comparisons run through the HTTP API and expose complete evidence.
- [x] Memory comparisons run through the HTTP API and expose complete evidence.
- [x] Memory state survives restart and journal replay without duplicate active records.
- [x] Failure injection before retrieval, after journal append, after snapshot write,
      and during evidence publication produces documented outcomes.
- [x] Cancellation before, during, and after Memory persistence produces documented
      terminal or recovery states.
- [x] Repeated idempotency keys return the same comparison and evidence.
- [x] Strategy namespaces remain isolated across comparison slots and restarts.
- [x] Context evidence identifies model-bound Memory records without absorbing the full
      Memory evidence.
- [x] Existing Platform endpoints and existing Context comparisons remain unchanged.

### Manual acceptance checks

- [x] Submit a Context comparison using the documented local command and inspect its
      lifecycle, events, result, and evidence.
- [x] Submit a Memory comparison using the documented local command and inspect its
      journal, snapshot, retrieval decisions, and Memory evidence.
- [x] Cancel a comparison at an available boundary and verify the result does not claim
      work was undone when it was already persisted.
- [x] Reconstruct or restart the local repository and verify state and revisions remain
      unchanged.
- [x] Repeat a request with the same idempotency key and verify no duplicate trial,
      write, or evidence record appears.
- [x] Attempt an unsafe evidence path and a Memory state path escape; verify both are
      rejected.
- [x] Confirm the current UI still honestly labels execution as unavailable and does
      not display fabricated run results.

## Required validation commands

```bash
pnpm --dir server run typecheck
pnpm --dir server run build
node --test server/dist/tests/studio/*.test.js
pnpm --dir server run test
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run build
git diff --check
```

The local HTTP inspection procedures are required in addition to automated tests.
Provider credentials, hosted services, and the final browser UI are not prerequisites
for this plan and must not be silently substituted with mocks that claim execution.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every applicable checkbox in this plan and the remaining Memory hardening scope
      is complete.
- [x] Context and Memory comparisons are usable through `/api/studio` with no direct
      filesystem or browser-only dependency.
- [x] Lifecycle, cancellation, idempotency, restart, failure, and recovery behaviour
      are implemented and tested.
- [x] Evidence is durable, bounded, safe, and sufficient for a future UI to inspect a
      comparison without reading implementation internals.
- [x] The catalog and request/response examples match the running server.
- [x] Documentation, inspection procedures, validation results, and limitations are
      recorded.
- [x] No final UI layout has been implied or fabricated by the backend.

## Commit discipline and handoff

- [x] Review Memory hardening, API-contract verification, and documentation as coherent
      sections. A commit is intentionally deferred because the worktree contains
      unrelated Anesu, Platform, and UI changes that must not be committed together.
- [x] Run the narrow validation relevant to each section before committing or handing
      off the work.
- [x] Inspect `git status` and the exact diff; preserve unrelated user changes already
      present in the worktree.
- [x] Record changed files, validation results, and known limitations in the handoff.
- [x] Move the older Memory plan to its correct lifecycle state only after this plan's
      gates are satisfied; do not mark either plan complete based on tests alone while
      checklist or documentation gates remain unchecked.

## Completion record

This section records the backend completion pass. The final Studio visual design is
still intentionally deferred to the separate UI plan.

**Completed:** `2026-09-20T19:53:00+02:00`<br>
**Commits:** `Deferred: the worktree contains unrelated user changes; no mixed commit was created.`

### Validation

- `pnpm --dir server run typecheck` — passed.
- `pnpm --dir server run build` — passed.
- `node --test server/dist/tests/studio/*.test.js server/dist/tests/studio/memory/*.test.js server/dist/tests/control-plane/config.test.js` — passed, 95 tests.
- `pnpm --dir apps/web run typecheck` — passed; generated docs catalog completed.
- `pnpm --dir apps/web run build` — passed.
- `git diff --check` — passed.
- `pnpm --dir server run test` — 407 passed, 2 skipped, 1 unrelated pre-existing tools-registry assertion failure.
- `development/playground/studio-backend-inspection.md` — live same-server Context/Memory boundary inspection passed with restart, idempotency, conflict, evidence, and safe-path checks.

### Known limitations

- Deterministic replay is a local experiment profile, not a production agent runtime.
- Tool execution and Computer Use remain unavailable; they are reported honestly in the
  catalog and composition evidence.
- The current replay request completes synchronously, so live cancellation requires an
  injected blocking adapter; the HTTP cancellation endpoint is still idempotent for
  terminal comparisons.
- No final Studio UI layout or API wiring was added in this backend slice.

### Historical-scope note

This plan makes the Studio backend ready for a future UI decision. The next UI work
belongs in `component-lab-ui.md` and must consume the catalog and safe projections
documented here rather than recreate backend decisions in the browser.
