# Session context, token budgets, and bounded compaction

**Created:** `2026-09-15T21:21:00+02:00`
**Last updated:** `2026-09-16T23:17:43+02:00`
**Status:** Active
**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [`repository rules`](../../../AGENTS.md)
- [`server ownership`](../../../server/README.md)
- [`server architecture`](../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../server/src/platforms/README.md)
- [`runner interface`](../../../server/src/control-plane/ports/README.md)
- [`server platform foundation`](../completed/server-platform-foundation.md)
- [`context reference review`](../../../docs/research/context-management-reference.md)
- [`Hermes code map`](../../../docs/research/harness-code-maps/hermes.md)
- [`OpenClaw code map`](../../../docs/research/harness-code-maps/openclaw.md)
- [`Waku code map`](../../../docs/research/harness-code-maps/waku.md)

The reference repositories are design input, not requirements. Preserve the Lab's
separation between harness execution, platform durability, context, memory, tools,
evidence, and UI. The initial implementation must not turn a Temporal checkpoint or a
provider usage field into a claim that context is durable or perfectly measured.

## Purpose

Build the first real session-context subsystem for the platform side of the Lab. It will
keep canonical conversation history separate from the request context sent to a model,
measure available context budget with explicit uncertainty, compact old history before
the request becomes unsafe, and expose the latest server-owned budget projection to the
Platform UI. Long-term memory is a separate later implementation.

## Definition of done

From the Platform UI, a contributor can send multiple turns to one selected platform
session. The server persists the session transcript, constructs a bounded request,
records the token budget and sources used, compacts older turns when the configured
threshold is reached, and shows the latest remaining percentage from the server. The
same session can be inspected after a server restart; the canonical transcript and
compaction ledger remain available. Temporal's workflow history/checkpoint is used only
for Temporal execution state, not as an implicit substitute for the context store.

```text
chat turn → session admission → context assembly and token accounting
          → preflight compaction when required → selected platform execution
          → durable turn/context projection → UI remaining-budget meter
```

The result is not complete when a fixed number of recent messages are merely sliced off,
when a client calculates the percentage, or when an oversized provider request is
blindly retried.

## Scope

- [x] Define a language-neutral context/session contract for ordered messages, source
      provenance, model window metadata, reserved output, token-count quality, pressure,
      compaction revision, and safe UI projection.
- [x] Add a server-owned, versioned session/transcript store with atomic append and
      restart-safe reads. Keep canonical messages distinct from request-local context.
- [x] Add a tokenizer/estimator seam. Use an exact tokenizer only where its model basis
      is known; otherwise expose a conservative estimate and its uncertainty.
- [x] Add deterministic preflight compaction that preserves identity/system messages,
      the active user turn, and coherent assistant/tool message groups; retain a
      compaction ledger and source references.
- [x] Integrate one real platform first: Temporal baseline, with context state outside
      workflow history and activity boundaries that are safe to replay.
- [x] Add the run API session/turn path needed by the Platform UI and show the server-projected
      remaining percentage, used/reserved/limit token numbers, and compacting state.
- [x] Add unit, integration, restart, overflow, duplicate, and crash-repair tests.
- [x] Update architecture, platform, local-development, UI, and contributor docs.

The first slice uses the existing run API as its session/turn API: the server creates a
session when `sessionId` is absent and admits a subsequent turn when the UI sends the
returned ID. Dedicated session-list/history endpoints are intentionally deferred until
the UI needs them.

## Explicitly out of scope

- Long-term semantic/episodic memory, embeddings, retrieval ranking, consolidation, or
  automatic `MEMORY.md`-style mirrors. That will be a separate memory implementation.
- Skills, MCP, OAuth/direct integrations, plugins, tool authorization, and side effects.
  The context contract will leave room for tool and skill sources, but the first real
  session only uses identity instructions and transcript turns.
- Computer Native. It is a separate harness and is owned by another implementation
  stream; its context/session design must not be coupled to this platform-side slice.
- Implementing every platform at once. After the shared contract and Temporal adapter
  are proven, each platform gets its own follow-on plan for its native state/replay
  boundary.
- Pretending Waku's fixed history window is compaction or that Hermes/OpenClaw's
  behaviours are guarantees for this project.
- Browser-side token estimation, raw provider transcript exposure, or secret-bearing
  context snapshots.

## Finished behaviour

### User-visible behaviour

- A platform session has a stable session ID and a visible current context meter.
- A new turn shows `used`, `reserved output`, `limit`, and `remaining` values from the
  server projection. The percentage is rounded only for display; the raw values remain
  available to inspection and evidence.
- When pressure crosses the preflight threshold, the UI shows a factual compacting state
  and then the updated budget. It does not claim a turn is safe while compaction is
  pending.
- A model/provider context overflow produces an explicit context error or one bounded
  recovery attempt. It does not silently drop the current user message or retry the same
  oversized request indefinitely.
- After a server restart, the session reloads its canonical transcript and latest
  compaction revision. The UI can distinguish an unavailable platform execution from an
  unavailable session context store.

### Ownership and boundaries

```text
server/src/capabilities/context/       → contracts, budget math, token-count seam,
                                          compaction policy, safe context projection
server/src/control-plane/              → session/turn admission, API, normalized evidence
server/src/platforms/temporal/...      → Temporal-specific execution and replay adapter
lab/sessions/<session-id>/              → canonical transcript and compaction ledger
lab/runs/<run-id>/                      → run-scoped manifest, events, metrics, result,
                                          and context snapshot reference
apps/web/src/features/platforms/        → chat session state and server budget meter
```

State explicitly before implementation:

- The session store is the sole writer of canonical transcript and compaction records.
- The context builder is the sole owner of the request-local message representation.
- The selected platform owns in-flight execution, retries, cancellation, and native
  replay/checkpoint state.
- The control-plane evidence store owns the normalized run projection and may retain a
  redacted context snapshot, but it does not rebuild platform-native state.
- The browser reads context projections; it never reads the session store directly and
  never computes the authoritative percentage.
- Provider SDKs, Temporal types, and native checkpoint objects remain inside platform or
  provider boundaries.

## Context contract

The first implementation must settle these records before platform wiring begins.

### Canonical message

Each message has a stable ID, session revision, role, content blocks, source, and
relationship metadata. A tool call and its result are one compaction unit even if the
provider protocol represents them as multiple messages. The schema must support text,
structured tool metadata, and redacted source references without requiring raw provider
payloads in the common record.

### Context snapshot

Every model request records a safe snapshot containing at least:

```json
{
  "schemaVersion": 1,
  "sessionId": "session-123",
  "sessionRevision": 12,
  "compactionRevision": 2,
  "model": "provider/model-id",
  "contextWindowTokens": 128000,
  "reservedOutputTokens": 4096,
  "safetyMarginTokens": 1024,
  "inputTokens": 38100,
  "remainingTokens": 84476,
  "remainingPercent": 66,
  "tokenCountQuality": "estimated",
  "tokenizerBasis": "provider-model-estimator-v1",
  "pressure": "normal",
  "sources": ["system", "transcript", "compaction-summary"],
  "compaction": null
}
```

The exact field names may change at the contract checkpoint, but the distinction among
window, input, output reservation, safety margin, remaining budget, and count quality is
mandatory. `remainingPercent` is derived as:

```text
max(0, contextWindow - input - reservedOutput - safetyMargin)
---------------------------------------------------------------- × 100
                       contextWindow
```

The projection must also expose a status such as `normal`, `compaction_due`,
`compacting`, `exhausted`, or `unknown`. A null/unknown window must not be displayed as
`100% remaining`.

### Compaction record

Compaction is a versioned transformation of a request representation. It records the
source session revision, policy, trigger, retained message IDs, summarised message IDs,
summary ID/content reference, before/after counts, and outcome. It is idempotent for the
same session revision and policy. Canonical history remains inspectable.

The policy must:

- run before the context budget is exhausted;
- preserve system/developer identity instructions and the current user turn;
- preserve assistant/tool-call/tool-result groups coherently;
- prefer pruning redundant/old tool results before summarising high-value dialogue;
- retain a recent-turn tail;
- fail closed if it cannot form a valid provider message sequence;
- allow one bounded provider-overflow recovery pass, then return an explicit failure.

## Platform integration rules

The semantic context contract is shared; the lifecycle boundary is platform-specific.

| Platform concern | Shared rule | Temporal first implementation |
| --- | --- | --- |
| Context source order | Record source and precedence | Build in a context activity or server-owned context service, not in workflow-only nondeterministic code |
| Token budget | Use model window, reservation, margin, and count quality | Pass an immutable context snapshot/reference into the workflow; do not grow workflow history with the full transcript |
| Compaction | Versioned, bounded, canonical history preserved | Persist compaction outcome outside workflow history; workflow records safe reference and outcome events |
| Retry | Never repeat an oversized request unchanged | Context preparation is separately identifiable from model-call attempts |
| Recovery | Reload by session/revision and compaction revision | A worker/server restart reuses the same session revision and context snapshot rather than creating a new transcript |
| UI | Read server projection | Temporal query/inspection exposes the latest safe snapshot through the runner adapter |

Later platform plans must state how their native mechanisms map to this table. A
LangGraph checkpoint, Restate replay log, or Mastra thread is not automatically the
canonical context store or the compaction policy.

## State, persistence, and evidence

The local Lab store may begin as an atomic filesystem implementation behind a narrow
interface, but the record format and ownership must be suitable for replacement by a
transactional service in a deployed profile.

```text
lab/sessions/<session-id>/
  session.json              # immutable identity, model/profile, current revision
  transcript.jsonl          # canonical append-only messages
  context-revisions.jsonl   # budget snapshots and compaction ledger entries
  .lock/                    # bounded admission/compaction lease

lab/runs/<run-id>/
  context.json              # safe request snapshot for this run/turn
  events.jsonl              # normalized ContextPrepared/Compaction* events
  result.json               # one terminal result for this run
```

- [x] Session and turn identities/cardinality are explicit.
- [x] Appends and revision updates are atomic and idempotent.
- [x] Concurrent turns for one session are serialized or rejected with a clear state;
      concurrent sessions remain independent.
- [x] A session revision cannot be compacted twice into conflicting results.
- [x] The context snapshot can be inspected without the provider or platform service.
- [x] Transcript/summary retention and cleanup are documented; source-specific redaction
      is explicit about its current first-slice limits.
- [x] Raw credentials, authorization headers, and unbounded provider responses are never
      written to session or run context records.

## Failure, retry, and recovery semantics

- [x] A tokenizer/estimator failure produces `unknown` budget state or a safe rejection;
      it never invents a precise percentage.
- [x] A missing model context-window limit is represented as `unknown`; it never becomes
      a fabricated percentage or an implicit safe-to-send decision. OpenRouter metadata
      is resolved server-side when the production runtime has the catalog available.
- [x] Compaction has a bounded timeout at the Temporal Activity boundary and no recursive
      compaction loop.
- [x] A compaction retry is keyed by session revision and policy revision.
- [x] A provider context overflow triggers at most one changed-input recovery attempt.
- [x] A model call that timed out after dispatch is recorded with its existing ambiguous
      outcome semantics; compaction must not be mistaken for a safe model retry.
- [x] A crash after canonical user-message persistence but before model completion leaves
      a resumable turn state, not a duplicate user message.
- [x] A crash during compaction leaves either the prior valid context revision or a
      complete new revision; partial summaries are not active.
- [x] A duplicate turn request with the same `clientTurnId`, explicit `sessionId`, and
      normalized prompt returns the existing durable turn/run. A changed prompt under
      the same key is a conflict; a different key while active is busy. Without a key,
      the existing server run-ID recovery semantics remain unchanged.
- [x] Cancellation while compacting or waiting for a model leaves a consistent session
      revision and records the cancellation boundary.
- [x] A platform execution can be missing while session context remains readable; these
      are reported as different failures.

Exactly-once model execution is not claimed. Canonical transcript append and context
revision publication should be idempotent; external model calls retain the platform's
existing unknown-outcome rules.

## Security and configuration

- [x] Session IDs, message IDs, and file paths are validated against traversal and
      collision attacks.
- [x] System/instruction sources are tagged. Automatic redaction of arbitrary user text
      is deferred because the first slice has no tool-result or integration sources.
- [x] Context snapshots exclude provider keys, bearer tokens, raw headers, and secrets
      embedded in tool results.
- [x] Context and transcript size limits are configured independently from model output
      limits, persisted with each session, and enforced against projected UTF-8 bytes
      before durable writes.
- [x] Session admission and compaction use a bounded lease; stale leases are recoverable.
- [x] The UI receives only safe content required for its own conversation display and
      budget meter.
- [x] Local setup documents the session-store directory and its cleanup/retention rule.

## Implementation checklist

### 1. Contract and design checkpoint

- [x] Confirm the message, session, context snapshot, compaction record, and UI projection
      schemas.
- [x] Confirm the formula and threshold defaults, including reserved output and margin.
- [x] Confirm exact-versus-estimated token count semantics and supported model metadata.
- [x] Confirm serialization boundaries and redaction rules.
- [x] Record alternatives and why the initial session store is replaceable.

### 2. Context foundation

- [x] Add `server/src/capabilities/context/` contracts and focused README.
- [x] Implement deterministic budget calculation and pressure classification.
- [x] Implement tokenizer/estimator adapter with explicit quality/basis metadata.
- [x] Implement request-local context assembly from system instructions and transcript.
- [x] Implement compaction policy and idempotent revision ledger.
- [x] Add atomic session/transcript/context-revision persistence.
- [x] Resolve OpenRouter context-window metadata at the server boundary before it is
      frozen into a run manifest.

### 3. Temporal baseline integration

- [x] Extend the Temporal baseline with a session/turn input and context snapshot
      reference without placing the full transcript in workflow history.
- [x] Add context preparation and compaction events with stable source sequences.
- [x] Preserve Temporal retry, cancellation, unknown-outcome, and reconciliation rules.
- [x] Expose the latest context snapshot through the runner inspection seam.
- [x] Prove restart recovery and no duplicate user-message append.

### 4. API and Platform UI

- [x] Use the existing run creation/inspection endpoints for session creation and
      append-turn admission, with durable `clientTurnId` idempotency at the session
      store seam and no implicit session creation for keyed requests.
- [x] Replace the one-shot-only UI state with a stable session and turn state.
- [x] Add a compact server-owned context meter showing percentage and token details on
      demand, without adding a noisy permanent panel.
- [x] Show compacting, unavailable budget, overflow, and restart states concisely.
- [x] Keep comparison runs independent unless a comparison explicitly chooses separate
      or shared session semantics.

### 5. Documentation and learning material

- [x] Document context versus memory and context versus platform durability.
- [x] Document the session/revision lifecycle and compaction invariants.
- [x] Link the Hermes, OpenClaw, and Waku code paths and upstream docs from the relevant
      Lab architecture/context pages.
- [x] Add a local manual walkthrough that lets the contributor force compaction and
      inspect transcript, context snapshot, and ledger files.
- [x] Update platform baseline READMEs to state the first session/context capability and
      remaining gaps.

## Test coverage

### Unit tests

- [x] Budget arithmetic, clamping, threshold transitions, reserved output, and safety
      margin.
- [x] Exact/estimated/unknown token-count metadata and model-window validation.
- [x] Source ordering, precedence, stable message IDs, and request-local copying.
- [x] Compaction preserves identity/current turn and coherent tool groups.
- [x] Compaction is deterministic and idempotent for a session revision/policy.
- [x] Invalid/oversized messages, independent transcript/session limits, and traversal
      attempts are rejected at the relevant contract/store boundaries before writes.
- [x] The first slice never adds keys, headers, or tool-result secret fields to context
      records; generic arbitrary-text redaction remains a later source-specific policy.

### Integration tests

- [x] Multi-turn session with persisted transcript and changing context percentage.
- [x] Preflight compaction occurs before the model request at the configured threshold.
- [x] Simulated provider overflow causes one changed-input recovery and then terminates
      clearly if the request remains unsafe.
- [x] Session restart reloads the canonical transcript and latest valid context revision.
- [x] Crash/failure after user-message append does not duplicate the message on resume.
- [x] Crash/failure during compaction leaves no partially active revision through atomic
      snapshot publication and ledger repair; a process-kill harness remains follow-on.
- [x] Concurrent turns are serialized/rejected according to the chosen rule.
- [x] Temporal worker/server restart preserves session and context references.
- [x] Context events and `context.json` reconcile idempotently into run evidence.

### Manual acceptance checks

- [ ] Open a platform session, send enough deterministic fixture text to cross the
      threshold, and observe a server-projected remaining percentage.
- [ ] Trigger compaction, inspect the before/after context revision and verify canonical
      transcript entries remain available.
- [ ] Restart the server, reopen the session, and verify the meter and transcript agree.
- [ ] Cause an overflow/estimator failure and verify the UI shows a factual error without
      claiming a false percentage or silently dropping the current turn.
- [ ] Inspect `lab/sessions/<session-id>/` and `lab/runs/<run-id>/context.json` for safe
      source references and no provider secret.

## Required validation commands

```bash
pnpm --dir server typecheck
pnpm --dir server test
pnpm --dir server test:temporal
pnpm --dir apps/web run typecheck
pnpm --dir apps/web run build
git diff --check
```

The Temporal integration checks require the existing local Temporal profile and worker.
Any unavailable provider or platform must be represented as an unavailable test profile,
not replaced by a fake success in a production-path acceptance check.

## Completion gate

- [ ] Every applicable implementation and test checkbox is complete. Manual browser
      acceptance remains owned by the browser-chat workstream.
- [x] The exact finished flow is real, multi-turn, restart-readable, and inspectable.
- [x] The UI meter is server-owned and distinguishes exact, estimated, and unknown counts.
- [x] Compaction is bounded, versioned, idempotent, and tested around failure gaps.
- [x] Platform-specific durability and context semantics remain distinguishable.
- [x] Documentation and manual walkthrough match the implementation.
- [x] Required automated validation commands pass; manual acceptance is still pending.

## Current implementation record

**Implemented:** `2026-09-16T07:51:37+02:00`

- Common context contracts, budget accounting, conservative estimation, request-local
  compaction, filesystem session persistence, crash-gap repair, and safe projections are
  implemented under `server/src/capabilities/context/`.
- Temporal baseline now prepares context in an Activity, passes immutable snapshot
  references into the model Activity, records context/compaction events, and performs one
  bounded provider-overflow recovery with a changed snapshot.
- The run API creates/continues Temporal sessions through `sessionId`; the Platform UI
  retains that ID and displays a compact server-owned budget meter with expandable token
  details.
- The server runtime shares the OpenRouter catalog with the run service, so selected model
  context windows are resolved server-side before manifest creation.

**Server hardening updated:** `2026-09-16T23:17:43+02:00`

- Explicit `clientTurnId` retries are scoped to an explicit session, replay the recorded
  run when safe, classify changed prompts as conflicts, and classify competing active
  turns as busy. A keyed request without `sessionId` is rejected before session creation.
- Each session persists independent transcript and aggregate-session UTF-8 byte limits;
  projected writes are checked before persistence and exposed as `CONTEXT_LIMIT_EXCEEDED`.

## Known limitations and next plans

- The first context adapter is Temporal/baseline. Other durable platforms still need
  platform-specific context lifecycle adapters and replay tests.
- Counts use a conservative character estimator, so the UI labels them `estimated`.
  Provider/model-specific tokenizers and provider usage reconciliation are follow-on work.
- The local filesystem store has bounded process/file leases and is intentionally
  replaceable; a deployed profile needs a transactional shared session store.
- A first turn using client idempotency must provide an explicit `sessionId`; the server
  intentionally does not create an implicit session for a keyed request.
- `clientTurnId` prevents duplicate canonical turns and safe replay dispatches, but does
  not claim exactly-once model execution when the provider outcome is ambiguous.
- Byte ceilings count retained session files, including snapshots and revision records;
  cleanup and TTL policy are not implemented. The filesystem store remains replaceable,
  and a deployed profile needs a transactional shared session store.
- Automatic source-specific secret redaction, long-term memory, tool groups, provider
  tokenizer reconciliation, and manual browser acceptance remain follow-on work.

**Validation record updated:** `2026-09-16T07:56:23+02:00`

- `pnpm --dir server test` — 166 tests passed.
- `pnpm --dir server test:temporal` — local Temporal success/retry/ambiguity/timeout/
  cancellation/reconciliation plus multi-turn context and overflow recovery passed.
- `pnpm --dir apps/web typecheck` — passed.
- `pnpm --dir apps/web build` — passed; Vite emitted the existing large-chunk warning.
- `git diff --check` — passed.

**Final server validation:** `2026-09-16T23:17:43+02:00`

- `pnpm --dir server typecheck` — passed.
- `pnpm --dir server test` — 248 passed, 2 skipped.
- `pnpm --dir server test:temporal` — 1 passed.
- `git diff --check` — passed.

## Commit discipline and handoff

- [ ] Commit the context contracts and pure budget/compaction logic as one coherent
      validated section.
- [ ] Commit session persistence and its tests as a separate coherent section.
- [ ] Commit Temporal integration and restart/reconciliation tests separately.
- [ ] Commit API/UI context projection and its validation separately.
- [ ] Commit documentation and manual walkthrough updates with the relevant implementation
      section or as a focused docs commit.
- [ ] Before each commit, inspect `git status` and only stage owned files; preserve the
      unrelated dirty work already present in this repository.
- [ ] Record commit hashes, validation results, and known limitations in this plan before
      archiving it.

### Server-side hardening commits

- `022f7eb` — context contracts, persisted limits, keyed admission, and API error mapping.
- `610f34f` — store, service, API, and configuration coverage for retries, conflicts,
  limits, restart recovery, and pre-session validation.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[timestamp]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[result]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

This plan intentionally starts with a shared context contract and one Temporal adapter.
Later platform plans must document their own native session, replay, and compaction
boundaries rather than treating this first adapter as universal platform behaviour.
