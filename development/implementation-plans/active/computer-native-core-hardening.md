# Computer Native core hardening and production foundation

**Created:** 2026-09-16T12:15:00+02:00
**Last updated:** 2026-09-16T23:56:46+02:00
**Status:** Active
**Owner:** Computer Native standalone product

## Start here

Read these before changing code:

- [Repository rules](../../../AGENTS.md)
- [Computer Native rules](../../../computer-native/AGENTS.md)
- [Production-readiness gap register](computer-native-production-readiness-gaps.md)
- [Runtime ownership](../../../computer-native/src/runtime/README.md)
- [Persistence ownership](../../../computer-native/src/persistence/README.md)
- [Security ownership](../../../computer-native/src/security/README.md)
- [CLI ownership](../../../computer-native/src/cli/README.md)
- [Workspace ownership](../../../computer-native/src/workspace/README.md)
- [Computer Native package commands](../../../computer-native/package.json)

References for established agent-harness practice:

- [Hermes code map](../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md)
- [Completed process execution plan](../completed/computer-native-process-execution.md)
- [Completed filesystem plan](../completed/computer-native-workspace-filesystem.md)
- [Completed browser plan](../completed/computer-native-browser-interaction.md)
- [Completed memory plan](../completed/computer-native-memory.md)

These references inform boundaries and failure semantics. They do not make Computer
Native equivalent to either project. Computer Native must keep its own contracts,
evidence, and tests.

## Purpose

Close the foundational gaps that would make the next Computer Native capabilities
expensive to build or unsafe to expose. This slice hardens the existing local runtime,
approval path, real model path, and workspace tools before Skills, Plugins, and External
Integrations become active implementation targets.

The goal is not to claim that the whole product is production-ready. The goal is to
make the core trustworthy enough that later capabilities can use one lifecycle, one
approval contract, one evidence model, and one failure policy.

## Definition of done

From a normal `pnpm run chat` session using a configured real provider, a user can submit
a turn, review an exact approved action, cancel it, observe its lifecycle, restart after
an injected interruption, and inspect an honest final result. Model retries do not
silently replay a tool side effect. Filesystem actions include the required directory
operations and report partial or ambiguous outcomes rather than pretending that a
multi-file change was atomic when it was not.

```text
user input
  -> one typed runtime state machine
  -> persisted request/attempt/action records
  -> exact approval or fail-closed denial
  -> bounded model or filesystem operation
  -> recovery-aware result and evidence
  -> TUI status, artifact, and final outcome
```

The implementation is complete only when the same behaviour is covered by automated
tests and by a short manual TUI acceptance flow. A deterministic provider may control
tests, but it must never replace a configured real provider silently.

## Progress so far

- The persistence layer now compares durable results using stable serialization and
  refuses duplicate terminal events when the same result is committed again.
- The runtime now retries eligible provider failures only before the first stream event,
  records `ModelRetryScheduled`, exposes retry activity in the TUI, and leaves partial
  provider output non-retryable.
- The retry policy is configurable through `COMPUTER_NATIVE_MODEL_RETRY_ATTEMPTS` and
  `COMPUTER_NATIVE_MODEL_RETRY_BACKOFF_MS`.
- The workspace now supports approval-gated regular-file and bounded directory-tree copy,
  same-filesystem move, and explicit same-parent rename. Directory creation also checks
  configured depth and parent-entry limits at preparation and commit.
- Filesystem transfer identity is persisted as a byte hash or tree manifest, restart
  reconciliation distinguishes source-only and destination-complete states, and TUI
  approval context identifies file versus directory transfers.
- The runtime now gives each model request attempt a durable identity and records a
  bounded completion or failure event after the provider returns, while retry scheduling
  remains separate and observable.
- The runtime now rejects model attempt completion and retry events when their request
  evidence is missing or out of order, and refuses any event that would follow a
  terminal lifecycle event.
- The round persistence seam now accepts an identical immediate retry after an
  acknowledgement loss without appending a duplicate record, while a conflicting retry
  fails closed and later duplicate evidence remains out of order.
- Persisted model/tool round evidence now rejects unknown phases, a first record that is
  not `model_requested` round `1`, and a tool completion whose call ID or tool name does
  not match its immediately preceding request. This tightens the existing evidence
  validator; it does not add a generic workflow or transaction framework.
- Model request, attempt-completion, and retry evidence now requires stable attempt IDs,
  exact request matching, and a successful latest attempt before `ModelCompleted` can be
  recorded. Retry evidence must follow the latest non-successful attempt. This validates
  provider evidence already emitted by the runtime without adding replay or exactly-once
  execution machinery.
- Mutation records now persist the effective approval timeout, and the TUI renders that
  timeout as part of the review context. A changed timeout is treated as an identity
  change during durable mutation transitions.
- Process, browser, memory, and workspace approval requests now carry the effective
  timeout into the TUI and durable evidence. Browser action hashes include the timeout,
  and all four action records reject timeout identity drift.
- Shared numeric runtime, process, browser, workspace, tool, retry, and memory limits
  are validated at startup; invalid zero, negative, fractional, or non-finite values
  fail before a session starts.
- Model request and streamed output limits are now configured independently from tool
  output. Requests are rejected before provider transport with `ModelRequestRejected`;
  response text and tool-call fields are counted as UTF-8 bytes across the turn, and an
  over-limit response fails without persisting a partial assistant message. The
  OpenRouter adapter enforces its response bound while reading the stream as well.
- Workspace file, search, mutation, copy, and tree-manifest reads now use no-follow file
  descriptors with a bounded chunk loop. The loop probes at most one byte beyond the
  configured limit, so a file that grows after its initial metadata check fails closed
  instead of bypassing the limit. Exact multi-chunk reads are covered by the workspace
  contract tests.
- Approved regular-file copy commits now stream source chunks into a same-directory
  temporary inode while hashing, enforcing the source byte cap, and checking the
  prepared hash before atomically linking the destination. A multi-chunk copy is covered
  by the workspace contract tests.
- File-transfer preparation and directory-manifest generation now hash through the same
  bounded descriptor pattern, so identity checks do not retain full file buffers. Text
  reads and patch preparation remain content-producing operations by contract.
- Recovery manifests now use an operation-specific 8 MiB cap, a no-follow descriptor, and
  a post-read size check before JSON parsing; oversized or changing metadata fails closed.
- Multi-file patch preparation now uses an explicit aggregate resulting-content budget,
  reports the prepared byte total and effective limit in approval/evidence records, and
  recalculates both before commit. The default is 256 KiB through
  `COMPUTER_NATIVE_MAX_PATCH_SET_BYTES`; directory-tree operations retain their separate
  entry/byte/depth budget and now report the observed total plus effective `maxTreeBytes`
  in their approval/evidence records as well.
- The normalized lifecycle stream now validates process, browser, and memory action
  ordering by stable identity. Normal events cannot skip preparation or approval or
  extend a terminal action; recovery may insert a direct terminal observation only when
  it carries `recovered: true`.
- Memory action JSONL history now applies the same operation-local transition discipline
  at the persistence boundary: `proposed` must reach approval before `committed`, terminal
  outcomes cannot be rewritten, and identity fields cannot drift. The only mutable result
  is the newly assigned record ID for an approved `add`, which recovery needs to attach to
  the durable record it found.
- Denied or unavailable process, workspace, and memory approvals now emit their terminal
  lifecycle outcome during the normal turn, not only during restart recovery.
- Runtime diagnostics now expose explicit checkpoints before model transport, after a
  model response, before and after approval, before and after tool execution, before
  terminal commit, after process launch, and after each committed multi-file member.
  `RuntimeInterruptionError` leaves the turn non-terminal so restart recovery—not
  normal failure handling—classifies the stop.
- The recovery matrix now exercises pre-write terminal-result and terminal-event stops,
  pre-model and post-model stops, a post-approval process stop before launch, post-
  side-effect stops for filesystem, browser, and memory actions, a stop while a
  process is running, and a stop between multi-file members. Each case recovers twice
  without replaying the provider, process, filesystem mutation, browser action, memory
  write, or already committed patch member.
- The initial model instruction now describes the implemented bounded directory
  transfer and same-parent rename tools instead of limiting them to regular files.
- Multi-file patch commits now check cancellation before starting and between members;
  cancellation or partial/uncertain commit failures preserve the journal and return
  `reconciliation-required` with explicit no-automatic-retry guidance.
- Side-effecting tool execution now settles before a cancelled turn becomes terminal,
  so filesystem, process, browser, and memory evidence cannot be written after the
  caller has already observed cancellation.
- Workspace mutations now emit normalized lifecycle events into the turn event stream,
  with ordered proposal, approval, application/progress, and completion/failure phases;
  event history is validated again when read during recovery.
- SessionStore now exposes an optional diagnostic write hook. Failure-injection tests
  simulate acknowledgement loss after durable writes for terminal results/events,
  process records, workspace mutation records, browser action records, and memory
  action history. Reopening and running recovery twice repairs or preserves the
  evidence without replaying the turn or duplicating terminal evidence.
- The suite includes direct journal recovery, cancellation boundaries, tool-loop durable
  evidence, lifecycle ordering, and acknowledgement-failure recovery for every current
  persisted action family.
- Restart recovery now reconstructs a missing terminal lifecycle event from a durable
  process, browser, memory, or workspace action record. Workspace reconciliation has a
  distinct `WorkspaceMutationReconciled` event, so “not applied and not replayed” is not
  reported as either a commit or a generic failure.
- Recovery repairs are now tested through a real approved process side effect: if the
  marker write succeeds but acknowledgement of the completed process record is lost,
  restart repairs only the missing evidence and does not run the command again.
- A real child-process crash after a durable running record now exercises restart
  cleanup: the detached foreground process group is terminated where possible, the
  outcome remains ambiguous, and `terminationConfirmed` is persisted separately.
- If the launch lifecycle acknowledgement fails after spawn, `LocalProcessRunner`
  terminates the child before returning the persistence failure.
- If a diagnostic stop occurs before the durable running process record, the runner
  still terminates the spawned child; only a stop after that record is durable leaves
  the child for restart reconciliation.
- Process records now carry a Linux executable/start-token identity. Recovery verifies
  it before signalling a process group and fails closed on a mismatch or unsupported
  identity source.
- Persisted process records are now validated on both write and recovery. Ownership,
  immutable command context, limits, status, timestamps, optional outcome fields, and
  running PID evidence must match the durable contract before recovery interprets the
  record. A malformed PID therefore fails closed without changing the interrupted turn.
- Model request/output limits are covered at configuration, runtime, and OpenRouter
  adapter boundaries, including pre-provider rejection and no-partial-transcript
  failure behavior.
- Approval panels now expose the stable prepared-operation identity and effective expiry
  for workspace, process, browser, and memory actions. Repeated Ctrl-C requests one
  cancellation transition, keeps the approval safe-default, and does not add duplicate
  cancellation activity.
- Workspace approval waiting now resolves on parent-turn cancellation even when the
  approval surface does not resolve its own promise. The mutation remains uncommitted
  and durable evidence records approval as unavailable; the broader per-boundary crash
  matrix remains open.
- Streamed model text is sanitized at the TUI boundary, including control sequences split
  across chunks, and unfinished assistant lines are closed before lifecycle activity is
  printed. This prevents model output from controlling the terminal or colliding with
  tool/progress lines; full viewport/scrollback work remains open.
- Terminal safety is now shared by streamed text, lifecycle activity, session panels,
  history/evidence output, and approval review values. Control sequences from model,
  file, browser, or process-derived text cannot alter the terminal; full viewport,
  scrollback, redraw, and accessibility work remains open.
- The serialized package suite now uses an explicit provider-start barrier for turn
  admission coverage instead of a timing-based polling window, so instrumentation does
  not create asynchronous activity after the test has cleaned up its workspace.
- The TUI now labels interrupted turns, partial/uncertain filesystem mutations, and
  outcome-unknown process or browser actions distinctly from ordinary failure.
- Built-in model adapters now expose capability metadata, and the factory validates
  namespaced provider/model selection before a turn starts. The OpenRouter adapter now
  classifies context-limit and refusal responses, preserves bounded request IDs and
  latency evidence, and classifies pre-output versus post-output stream disconnects.
- The built-in model registry now owns provider construction and credential-free
  capability summaries. The TUI exposes `/models` as a read-only model/provider view;
  provider selection remains explicit at session start with no automatic fallback.
- OpenRouter now classifies rejected credentials as `provider-auth` and rejects malformed
  choices, deltas, and tool-call shapes as bounded non-retryable provider errors.
- Provider-reported token usage is copied into terminal turn metrics when supplied;
  attempt and round evidence also records observed request/output bytes and the effective
  configured limits. Cost remains explicitly `null` because no pricing source is configured.
- A runnable provider-acceptance playground documents the normal `pnpm run chat` flow,
  `/models`, `/status`, safe real-model prompts, evidence inspection, and restart-based
  credential rotation without storing a secret in the repository.
- The documented acceptance flow was run with the locally configured
  `openrouter/cohere/north-mini-code:free` model: `/models`, an exact-response prompt,
  a read-only workspace listing, and `/status` all behaved as expected. One pre-output
  provider retry was visible and recovered through the same real model path; session
  evidence contained usage/limits and no API key.
- Each newly admitted turn now receives a stable correlation ID propagated through TUI
  events, model requests, lifecycle/round evidence, terminal results, and action records;
  persistence rejects explicit cross-turn correlation mismatches while retaining a
  turn-ID fallback for older records.
- Model request, attempt completion, retry, and completion events are now idempotent by
  their stable identity when the repeated payload is identical; conflicting repeats fail
  closed instead of appending duplicate model evidence.
- Memory search evidence is now immutable by `searchId`: identical acknowledgement retries
  are no-ops and conflicting reuse cannot overwrite the recorded result set.
- One-shot process, browser, memory, workspace, search, and artifact lifecycle events
  now have the same idempotent identity check. Workspace progress remains append-only so
  repeated journal observations are preserved rather than collapsed.
- Durable lifecycle history now validates schema identity, known event types, contiguous
  sequence numbers, owning session/turn, and correlation before append or recovery.
- Browser screenshot and download results now write bounded per-turn artifact evidence
  before their `BrowserArtifactCreated` lifecycle event. Recovery repairs a missing event
  from that operation-specific record before finalizing the interrupted turn, and repeated
  recovery does not duplicate it. Artifact contents remain owned by the browser artifact
  store; turn evidence retains metadata and the managed path only.
- Terminal results are validated against the admitted session, turn, provider, model, and
  correlation before write or restart adoption; persisted process, browser, memory,
  memory-search, and workspace records are checked against their owning turn as well.
- Terminal turn events now compare their redacted payload on repeated append: identical
  acknowledgement-loss retries are accepted, while a conflicting terminal payload fails
  closed instead of silently reusing the first outcome.
- Session locks now persist the owner PID plus a Linux executable/start-time token. A
  live PID with a mismatched token is reclaimed as stale; unverified or permission-denied
  live owners fail closed, and invalid PIDs are never probed as process groups.
- The runtime now owns a separate turn-execution lock for the complete foreground turn.
  Admission rejects concurrent execution before provider dispatch, scans durable turn
  records for unrecovered `submitting`/`streaming` work, and recovery uses the same lock.
- Selected persistence and host-side interruption boundaries now have end-to-end tests:
  workspace stops before applying and after committed-record acknowledgement, and browser
  stops before durable start and after completion evidence. Browser persistence interruptions
  are preserved as runtime interruptions instead of being rewritten as adapter failures.
  Recovery proves the filesystem is not replayed, browser actions are not replayed, and
  recovery-only lifecycle evidence is emitted once.
- Cancellation requested before model dispatch now records only the durable turn start and
  cancellation outcome; it does not invoke the provider or claim that a model request was
  attempted. Cancellation during retry backoff is also tested to prevent a later attempt.
- Terminal commits now validate the requested turn-state transition before writing the
  terminal result. An invalid transition leaves both the durable turn state and
  `result.json` unchanged; a lost acknowledgement after a valid terminal write remains
  recoverable without replaying the model or tool.
- Malformed `result.json` is now distinct from a missing result. Direct terminal writes
  and restart recovery fail closed without overwriting malformed evidence or changing the
  durable turn state.
- Restart recovery now validates an existing terminal event against the durable result
  before advancing the turn state; contradictory status, assistant identity, or error
  payload is treated as persistence corruption.
- Turn state transitions now update the in-memory record only after the durable `turn.json`
  replacement returns. Before-write failures leave memory and disk aligned; after-write
  acknowledgement loss leaves the durable state ahead and makes an explicit retry safe.
- The shared JSONL reader now rejects internal or extra blank records instead of silently
  dropping evidence, and empty journal replacements write an empty stream rather than a
  misleading blank record.
- Atomic JSON and JSONL replacement now remove their known temporary file when a handled
  write or rename failure occurs, preserving the previous destination and preventing a
  failed artifact-metadata publication from leaving a stale temporary record behind.
- Transcript messages are validated against the owning session and stable message ID;
  identical acknowledgement retries are ignored, while conflicting message reuse fails
  closed instead of duplicating durable conversation evidence.
- `TurnStarted` provider/model metadata is checked against the admitted turn whenever
  present; metadata-free recovery records remain supported without weakening the normal
  runtime path.
- The latest validation is 329 passing tests across the package, with 89.62% line
  coverage, 79.12% branch coverage, and 85.11% function coverage. Coverage is from
  Node's experimental test-coverage runner and can vary slightly between runs. The
  latest full suite and coverage run both pass; one earlier coverage run was discarded
  because instrumentation caused timing-sensitive browser and admission tests to fail.

### Current slice boundary: model/tool round evidence ordering

Delivered in this increment:

- Round records validate their known phase, owning session/turn identity, positive round
  number, and required tool-call identity.
- A turn's first round record must be `model_requested` for round `1`.
- A `tool_completed` record must match the call ID and tool name from the immediately
  preceding `tool_requested` record; existing legal multi-call and next-round transitions
  remain supported.
- Tests cover an unknown phase, an invalid first phase, missing tool identity, a mismatched
  tool completion, duplicate tool calls, and phase reordering.

Practice check against the local Hermes and OpenClaw references:

- This is an operation-local integrity check on evidence the runtime already persists.
  It follows explicit lifecycle validation and fail-closed recovery patterns without
  adding a generic workflow engine, event-sourcing layer, transaction manager, rollback
  service, scheduler, or exactly-once claim.

Still open after this slice:

- Full turn-level transition helpers, the complete persistence/side-effect crash matrix,
  deterministic replay, concurrency/lease semantics, and remaining security and
  production-operation gates.

The plan remains active. This increment hardens an existing contract; it does not expand
Computer Native into a general durable workflow system.

### Current slice boundary: round acknowledgement retry

Delivered in this increment:

- `TurnStore.appendRound` compares the latest persisted round identity before applying
  normal ordering validation.
- An identical retry of the immediately latest `model_requested`, `model_completed`,
  `tool_requested`, or `tool_completed` record is a no-op, ignoring only the new
  acknowledgement-time timestamp.
- A retry with a different payload for that identity fails closed. A duplicate that is
  no longer the latest record still goes through the normal out-of-order and duplicate
  tool-call checks, so this does not weaken the round state machine.
- Tests cover identical retry, conflicting retry, and the existing invalid ordering
  cases through the public turn persistence seam.

Practice check against the local Hermes and OpenClaw references:

- This is the existing round record's operation-local acknowledgement behavior. It uses
  the stable call/round identity already emitted by the runtime and does not add a
  generic event store, replay engine, or exactly-once execution claim.

Still open after this slice:

- The complete process-level crash matrix across every durable write and host-side
  effect, plus deterministic replay, concurrency/lease acceptance, and remaining
  security and production-operation gates.

### Current slice boundary: atomic replacement failure cleanup

Delivered in this increment:

- `atomicWriteJson` and `atomicWriteJsonLines` now clean up the exact temporary path
  they created when writing, closing, syncing, or renaming fails. The original target is
  not replaced by a failed candidate.
- A focused regression test covers failed publication for both JSON and JSONL records and
  verifies that no `.tmp-*` evidence remains beside the original destination.

Practice check against the local Hermes and OpenClaw references:

- This is standard operation-local temporary-file hygiene at the existing atomic-write
  boundary. It does not claim crash-time cleanup, add a background janitor, or introduce
  a transaction coordinator. A process killed before the cleanup handler can still leave
  a temporary file; operation-specific cleanup and future crash tests remain separate.

Still open after this slice:

- Complete process-level crash coverage around every durable write and host side effect,
  including killed-process temporary files, plus deterministic replay, concurrency/lease
  acceptance, and remaining security and production-operation gates.

### Current slice boundary: turn-state acknowledgement ordering

Delivered in this increment:

- `TurnStore.updateState` validates the transition, writes the candidate durable record,
  and only then publishes that state to the live object.
- A failure before replacement leaves the previous state available for retry; an
  acknowledgement loss after replacement leaves the disk state authoritative without
  causing a false in-memory transition.
- Tests cover both injected boundaries and an explicit retry of the after-write case.

Practice check against the local Hermes and OpenClaw references:

- This preserves the existing persistence-first lifecycle contract at one state boundary.
  It does not add a transaction coordinator or attempt to provide exactly-once writes.

Still open after this slice:

- The complete process-level crash matrix across every durable write and host-side
  effect, plus deterministic replay, concurrency/lease acceptance, and remaining
  security and production-operation gates.

### Current slice boundary: malformed terminal-result handling

Delivered in this increment:

- `SessionStore` checks whether `result.json` exists before reading it, so only an absent
  file is treated as not-yet-written.
- A malformed or unreadable existing terminal result is surfaced as persistence
  corruption; it cannot be replaced by a later result or silently adopted as an
  interrupted turn during recovery.
- An existing same-type terminal event must agree with the durable result on any recorded
  status, assistant-message identity, and error payload. Recovery performs this check
  before changing the durable turn state.
- Tests cover the direct `TurnStore.writeResult` seam and restart recovery, including
  preservation of the malformed file, conflicting terminal evidence, and the
  non-terminal durable state.
- An already-terminal `turn.json` state must also agree with `result.json`; direct writes
  and restart recovery reject a completed/failed/cancelled mismatch without changing the
  durable state.

Practice check against the local Hermes and OpenClaw references:

- This keeps recovery fail-closed at the existing durable-record boundary. It does not
  add a database, migration layer, or generalized corruption-repair service.

Still open after this slice:

- The complete process-level crash matrix across every durable write and host-side
  effect, plus deterministic replay, concurrency/lease acceptance, and remaining
  security and production-operation gates.

### Current slice boundary: JSONL evidence integrity

Delivered in this increment:

- Transcript, lifecycle, round, and memory-evidence JSONL reads reject internal or
  repeated blank lines as malformed durable evidence.
- The atomic JSONL replacement path preserves a valid empty-stream representation by
  writing no delimiter when there are zero records.
- Tests cover detection of an extra blank transcript record and successful reading after
  an explicit empty-stream replacement.

Practice check against the local Hermes and OpenClaw references:

- This is a bounded parser and writer invariant at the existing evidence boundary. It
  does not add a journal database, repair daemon, or generic event-store abstraction.

Still open after this slice:

- The complete process-level crash matrix across every durable write and host-side
  effect, plus deterministic replay, concurrency/lease acceptance, and remaining
  security and production-operation gates.

### Current slice boundary: memory-search evidence identity

Delivered in this increment:

- `TurnStore.writeMemorySearch` now checks an existing record for the same `searchId`
  before replacing it.
- An identical retry is accepted without rewriting the evidence; a changed query hash,
  scope, result identity, limit, or other field fails closed.
- Existing ownership and correlation checks also apply to the previously persisted
  record, so a corrupt or cross-turn record cannot be silently overwritten.
- Restart recovery reconstructs a missing `MemorySearched` lifecycle event from the
  durable record before it closes the interrupted turn; the repair is marked recovered
  and does not replay the search.
- Tests cover the public persistence seam, identical retry, conflicting retry, and
  preservation of the original durable result set, acknowledgement-loss recovery, and
  repeat recovery without a duplicate lifecycle event.

Practice check against the local Hermes and OpenClaw references:

- This is a small telemetry/evidence integrity rule at the existing record boundary. It
  does not turn search into a durable job, add an index transaction, or introduce a
  repository-wide event ledger.

Still open after this slice:

- The complete process-level crash matrix across every durable write and host-side
  effect, plus deterministic replay, concurrency/lease acceptance, and remaining
  security and production-operation gates.

### Current slice boundary: model attempt lifecycle identity

Delivered in this increment:

- Model request, attempt-completion, and retry lifecycle events require a non-empty,
  stable `attemptId` and follow `TurnStarted`.
- Attempt completion must match an existing request with the same identity; retry evidence
  must match the latest attempt completion and cannot follow a successful attempt.
- `ModelCompleted` requires the latest attempt completion to have status `completed`.
- Tests cover missing identities, model evidence before turn start, mismatched attempts,
  retries for the wrong/latest attempt, and completion after failed versus successful
  attempts.

Practice check against the local Hermes and OpenClaw references:

- This is the smallest useful integrity check for the model evidence Computer Native
  already persists. It follows explicit attempt identity and fail-closed lifecycle
  practices without importing a provider scheduler, replay system, event-sourcing layer,
  or exactly-once guarantee.

Still open after this slice:

- Full turn-level transition helpers, the complete persistence/side-effect crash matrix,
  deterministic replay, concurrency/lease semantics, and remaining security and
  production-operation gates.

### Current slice boundary: terminal commit precondition

Delivered in this increment:

- `commitTerminal` validates the requested terminal lifecycle transition against the
  current durable turn state before writing `result.json`.
- An invalid transition, such as `submitting` → `completed`, fails without creating a
  result artifact or changing the turn state.
- Existing valid terminal retries remain idempotent, and an acknowledgement loss after a
  valid result write remains recoverable without replaying the model or tool.
- Tests cover the rejected precondition and the interaction with terminal-result and
  terminal-event acknowledgement-loss recovery.

Practice check against the local Hermes and OpenClaw references:

- This is a local write-order invariant around the existing terminal record. It follows
  explicit lifecycle validation and fail-closed recovery practice without adding a
  transaction manager, rollback service, workflow engine, event-sourcing layer, or
  exactly-once guarantee.

Still open after this slice:

- Full turn-level transition helpers, the complete persistence/side-effect crash matrix,
  deterministic replay, concurrency/lease semantics, and remaining security and
  production-operation gates.

### Current slice boundary: transcript evidence identity

Delivered in this increment:

- Transcript records are validated for schema, session ownership, turn identity, role,
  content, and timestamp before they are read or appended.
- Repeating an identical user or assistant message after an acknowledgement loss is a
  no-op keyed by the existing stable `messageId`; conflicting reuse of that ID fails
  closed and cannot add a second entry.
- Tests cover idempotent assistant-message append, conflicting content, and cross-session
  record rejection.

Practice check against the local Hermes and OpenClaw references:

- This is a narrow identity check on the existing session transcript. It uses the current
  append-only JSONL format and does not add a database, event-sourcing layer, transcript
  compaction service, or exactly-once execution claim.

Still open after this slice:

- Full turn-level transition helpers, the complete persistence/side-effect crash matrix,
  deterministic replay, concurrency/lease semantics, and remaining security and
  production-operation gates.

### Current increment: session ownership and stale-lock safety

Delivered in this increment:

- Session lock records include the current process identity when the host exposes a safe
  Linux identity token.
- Lock acquisition compares the persisted identity before reclaiming a lock whose PID is
  still numerically live, preventing a reused PID from being mistaken for the original
  session owner.
- PID-only legacy locks remain conservative; malformed or non-positive PID values are
  never probed as process group `0`, while partial metadata and permission-denied owner
  probes fail closed.
- Tests cover normal ownership, rejection of a live owner, stale identity reclamation,
  legacy PID-only compatibility, and invalid PID handling.

Still open after this increment:

- A full cross-platform process-identity contract and an operating-system-level lock
  lease/renewal protocol.
- Durable turn admission and concurrent-writer tests beyond the single application
  session lock; this increment prevents competing session owners but does not claim
  multi-turn scheduling or durable job leases.
- Crash, upgrade, and network-filesystem semantics for lock creation and release.

### Current increment: durable runtime turn admission

Delivered in this increment:

- `runTurn` acquires a separate execution lock before transcript read, turn admission,
  provider dispatch, or tool setup, and releases it in a `finally` path after normal,
  failed, cancelled, or diagnostic-interrupted execution returns.
- Admission validates the durable turn-record identity and rejects any existing
  `submitting` or `streaming` turn instead of starting a second runtime turn.
- Restart recovery takes the same execution lock, so recovery cannot rewrite action or
  terminal evidence while a live turn is executing.
- A stale execution lock can be reclaimed by the existing owner-identity checks, but an
  unrecovered durable turn still blocks new admission until recovery classifies it.
- Tests cover concurrent provider non-dispatch, recovery blocked during an active turn,
  durable orphan rejection, recovery before re-admission, and release after completion.

Still open after this increment:

- Queueing, fairness, cancellation of queued work, and durable leases for long-running
  jobs or worker processes.
- Cross-process scheduling beyond the foreground session lock, including network
  filesystem guarantees and operator-visible lease expiry.
- Deterministic replay and the remaining per-boundary crash matrix.

### Current slice boundary: persistence and side-effect boundary matrix

Delivered in this increment:

- A workspace mutation stopped before its durable applying record is written is reconciled
  as not applied; the target remains unchanged and the mutation is not retried.
- A workspace mutation whose committed record is durable but whose acknowledgement is
  interrupted is recovered as committed; the missing lifecycle event is repaired without
  replaying the file write.
- A browser action stopped before its durable start record is written does not reach the
  adapter and recovers as approval-unavailable.
- A browser action whose completion record is durable but whose acknowledgement is
  interrupted recovers as completed with one recovery-marked lifecycle event and no second
  adapter call.
- Workspace recovery now permits a recovery-marked `WorkspaceMutationReconciled` event
  immediately after approval when hash reconciliation proves that application never began.
- Browser runtime-interruption errors are no longer converted into ordinary adapter
  failures, preserving the restart path when persistence fails around a browser side effect.
- Memory canonical Markdown replacement and deletion-evidence append now have a narrow,
  diagnostic-only before/after write seam. Direct and runtime tests prove that a stop before
  canonical publication leaves the old state in place, a stop after publication is reconciled
  without replay, and a lost committed-deletion acknowledgement still recovers from the
  append-only evidence.
- Cross-file daily-memory batches now persist a bounded before/after canonical-file hash
  manifest before publication. Restart recovery reports all-before as not applied,
  all-after as committed, and mixed or unexpected file hashes as partial/ambiguous; it
  never retries an individual member or claims cross-file atomicity.

Practice check against the local Hermes and OpenClaw references:

- This uses operation-specific durable boundaries and existing action reconciliation, matching
  their explicit lifecycle/policy approach. It does not introduce a general transaction manager,
  a second memory index, or an exactly-once claim that the underlying files do not support.

Still open after this increment:

- The complete stop-before/after matrix for every durable write and every underlying host
  side effect, including process-level crash injection at each boundary.
- Browser profile/artifact crash recovery, cross-platform process isolation, and a
  complete per-write/per-side-effect crash matrix.

### Current slice boundary: browser artifact ownership

Delivered in this slice:

- Screenshot and download targets acquire a lock-backed artifact lease before exposing
  their managed path to the browser adapter.
- Finalization and discard release the lease only after the artifact data and metadata
  boundary has settled. A target without a lease cannot be finalized by a forged or
  stale caller.
- Bounded artifact cleanup retains old incomplete artifacts whose lease is still held by
  a live writer. It can reclaim an old artifact only after the existing process-identity
  lock rules establish that the writer is stale or absent.
- Per-turn artifact evidence is written before the lifecycle event. If its acknowledgement
  is lost, restart recovery reconstructs the missing `BrowserArtifactCreated` event before
  writing the interrupted turn result; recovery is idempotent and does not recreate the
  browser artifact.
- Bounded artifact cleanup now recognizes the atomic writer's temporary metadata files,
  associates them with their artifact, uses their mtime when they are the only remaining
  evidence, and removes them under the existing artifact lease and entry bound.
- Tests cover the live in-flight lease boundary, direct artifact-evidence recovery, and
  an integrated screenshot turn, plus expired temporary metadata cleanup; existing tests
  continue to cover malformed, oversized, symlinked, orphaned, and bounded cleanup cases.

Practice check against the local Hermes and OpenClaw references:

- This keeps ownership and cleanup explicit at the artifact boundary, like their
  session/run ownership patterns. It reuses the existing lock primitive and does not
  introduce a durable browser workflow or pretend artifact cleanup is transactional.
- The per-turn record is an operation-specific recovery checkpoint, matching the existing
  process, browser-action, memory, and workspace evidence patterns. It is not a generic
  artifact ledger or an exactly-once guarantee for external file creation.

Still open after this slice:

- Durable browser profile ownership/authentication policy, lock-corruption handling,
  hard-kill validation across data/metadata/temp-file states, metadata migration, and the
  full browser crash/navigation race matrix.
- Cross-platform process isolation and the complete per-write/per-side-effect crash
  matrix remain outside this slice.

### Current slice boundary: browser approval reservation cleanup

Delivered in this slice:

- A browser download target is reserved before approval only so the exact managed
  destination and byte limit can be shown to the reviewer.
- Denied or unavailable download approval now discards that target and releases its
  lock-backed lease before returning the terminal approval outcome. Approval-channel
  failures also release the reservation before propagating the failure.
- The adapter is still never called for a denied download, and no artifact or lock is
  left behind by the non-started operation.
- A focused regression test covers the denied approval path and checks the managed
  data, metadata, and lease files are absent.

Practice check against the local Hermes and OpenClaw references:

- This is an operation-local resource cleanup fix at the approval boundary, consistent
  with explicit ownership and fail-closed side-effect handling. It does not introduce a
  general reservation service, approval broker, or artifact transaction layer.

Still open after this slice:

- Browser profile/authentication policy, metadata migration, and the full browser
  crash/navigation race matrix.
- Cross-platform process isolation and the complete per-write/per-side-effect crash
  matrix remain outside this slice.

### Current slice boundary: browser profile ownership

Delivered in this slice:

- Managed local browser profiles can acquire a lock-backed ownership lease for the
  complete session lifetime, including adapter startup, close, expiry, and profile
  cleanup.
- Startup profile cleanup retains old profiles with a live lease and reclaims an old
  profile only after the existing process-identity checks establish stale ownership.
- The browser session manager treats profile leasing as an optional backend capability,
  keeping generic adapters free of an implicit local-filesystem lifecycle assumption.
- Tests cover live-lease retention and release, manager lease lifecycle, and the existing
  bounded/symlink/unknown profile cleanup rules.

Practice check against the local Hermes and OpenClaw references:

- This follows their explicit session ownership and cleanup boundaries, reusing the
  repository's lock primitive rather than creating a second lease protocol or durable
  browser scheduler.

Still open after this slice:

- Authentication/cookie/local-storage policy, profile metadata migration, and the full
  browser crash/navigation race matrix.
- Cross-platform process isolation and the complete per-write/per-side-effect crash
  matrix remain outside this slice.

### Current slice boundary: browser upload approval identity

Delivered in this slice:

- Browser upload preparation now captures the source file's device/inode/mode, size,
  modification time, and SHA-256 content identity through the workspace policy. The
  hash is bounded by the upload limit, uses a no-follow descriptor, and checks the
  descriptor metadata again before returning the prepared identity.
- After approval and immediately before the adapter call, the source is resolved and
  hashed again. A changed, replaced, symlinked, unavailable, or oversized source fails
  closed without emitting a browser start or calling the adapter.
- Tests cover identity capture and a same-size content replacement between approval and
  execution; the adapter call count remains zero and the terminal failure is visible.

Practice check against the local Hermes and OpenClaw references:

- This is the smallest operation-specific prepared-input recheck at the side-effect
  boundary. It uses the existing workspace policy and browser action lifecycle rather
  than adding a generic approval broker or transaction manager.

Still open after this slice:

- A hash recheck narrows the approval race but does not provide an OS-level immutable
  file handle across the browser adapter's path read. Staged upload snapshots,
  cross-platform process isolation, profile/authentication policy, and the full browser
  crash/navigation matrix remain separate work.

### Current slice boundary: browser element-reference integrity

Delivered in this slice:

- The managed Playwright adapter records a bounded SHA-256 fingerprint of each
  snapshot-assigned element after its reference marker is installed.
- Immediately before click, type, press, upload, or download, the adapter recomputes
  that fingerprint. A same-document DOM replacement therefore fails as
  `stale-reference` instead of allowing an ordinal locator to act on a different
  element.
- Navigation invalidation remains independent: the existing document identity still
  clears all references on a main-frame navigation.
- A real Playwright fixture test covers an element whose markup changes after the
  snapshot; no action is dispatched against the replacement.

Practice check against the local Hermes and OpenClaw references:

- This keeps browser reference validity inside the adapter/session boundary, matching
  their explicit session and tool ownership. It adds no browser workflow scheduler,
  generic DOM abstraction, or model-facing page-content state.

Still open after this slice:

- The fingerprint is bounded markup evidence, not a proof of semantic equivalence or an
  immutable browser element handle. Staged upload snapshots, auth/profile policy,
  cross-platform isolation, and the full crash/navigation/modal race matrix remain open.

### Current slice boundary: bounded workspace reads

Delivered in this slice:

- `readFile`, mutation/hash reads, search reads, and directory-tree manifest reads open
  regular files with `O_NOFOLLOW` and enforce their byte limit during descriptor reads,
  not only from a preceding path-size check.
- A file that grows beyond the configured per-file or remaining tree budget is rejected
  without returning the over-limit bytes. A file whose size changes during a bounded read
  is rejected as changed rather than treated as a stable snapshot.
- A multi-chunk file exactly at the configured limit is covered by an automated workspace
  test, while existing tree, copy, search, and mutation tests exercise their public
  callers.
- File-transfer preparation and tree-manifest generation hash bounded files in chunks and
  retain only byte counts and digests for their identity evidence.
- Recovery-manifest reads are bounded before parsing and retain the existing explicit
  symlink rejection behaviour.

Practice check against the local Hermes and OpenClaw references:

- This keeps the resource guard at the concrete filesystem operation boundary, alongside
  the existing workspace policy and evidence. It does not add a generic transaction
  manager, a virtual filesystem, or a new cross-component abstraction.

Still open after this slice:

- Text reads and patch preparation still materialize bounded content where their contracts
  require it. The current operation-specific aggregate budgets are delivered; an OS-level
  immutable snapshot/file-handle contract remains open.
- The remaining filesystem race, crash, cross-platform, and platform-isolation matrix is
  broader than this read-time limit check.

### Current slice boundary: streamed regular-file copy

Delivered in this slice:

- Regular-file `copy` commits no longer retain a second full source buffer while staging
  the destination. They stream bounded chunks into a temporary inode, update the SHA-256
  source identity as they go, flush the temporary file, and publish it with a no-replace
  link.
- The same bounded hash loop is used by file-transfer preparation and directory-manifest
  generation, keeping those identity-only paths from retaining complete file contents.
- The source is opened with `O_NOFOLLOW`, checked against the prepared byte count and
  hash, and checked again after the stream. A changed source, over-limit growth, write
  failure, or destination collision leaves no successful copy result.
- The test suite covers a multi-chunk exact-limit copy as well as the existing stale,
  destination-collision, directory, and recovery paths.

Practice check against the local Hermes and OpenClaw references:

- This is an operation-local staging and identity check at the filesystem side-effect
  boundary. It follows the same explicit prepare/execute/reconcile shape already used by
  the workspace and does not introduce a generic transaction layer.

Still open after this slice:

- Text reads and patch preparation still materialize bounded content where their contracts
  require it. The current operation-specific aggregate budgets are delivered; an OS-level
  immutable snapshot remains open.

### Current slice boundary: aggregate patch-set accounting

Delivered in this slice:

- Multi-file patch preparation now computes the sum of resulting UTF-8 member bytes while
  preparing members sequentially and rejects the set before approval when it exceeds
  `maxPatchSetBytes` (256 KiB by default, configurable through
  `COMPUTER_NATIVE_MAX_PATCH_SET_BYTES`).
- The prepared byte total and effective limit travel with the approval request, TUI review,
  normalized lifecycle payload, and durable mutation record. Commit recalculates the total
  and refuses mismatched or over-budget prepared data before creating the transaction
  directory.
- Directory-tree copy, move, rename, delete, and restore approvals likewise carry the
  observed tree byte total and effective tree byte limit, keeping the bounded operation
  visible at the same review and evidence boundary.
- The limit is intentionally separate from directory-tree `maxTreeBytes`: the former
  bounds the resulting contents of one patch set, while the latter bounds one traversed
  tree. No shared transaction manager or rollback guarantee was added.
- Tests cover configuration/env wiring, exact byte accounting, over-budget rejection with
  no filesystem change, approval/evidence propagation, and TUI display of the total and
  limit.

Practice check against the local Hermes and OpenClaw references:

- This follows their operation-specific policy and bounded-input pattern. It does not
  copy their broader turn orchestration, tool policy, or runtime product surfaces into
  the workspace module.

Still open after this slice:

- Text-producing reads and patch preparation still materialize bounded content by
  contract; this slice bounds the aggregate patch-set result but does not claim an OS-level
  immutable snapshot or cross-file atomicity.
- Any future multi-file operation must define its own aggregate accounting and recovery
  evidence before it is exposed.

### Current slice boundary: memory evidence maintenance

Delivered in this slice:

- Memory opens with a narrow repair rule for evidence JSONL: only an unterminated final
  line is treated as a crash-truncated append and removed. A malformed complete line or
  invalid evidence record fails closed and remains unchanged for deliberate repair.
- Deletion and cross-file batch evidence can be compacted through one memory-owned,
  lock-protected maintenance operation. It deduplicates stable operation identities and
  expires completed entries older than the configured retention window.
- Prepared deletion evidence and evidence for currently active records are retained even
  when older than the normal window. If the safe retained set exceeds the configured
  maximum, maintenance refuses to rewrite the journal rather than discarding evidence.
- Normal CLI startup runs this maintenance only after interrupted-turn recovery. The
  retention window and per-journal entry bound are explicit configuration values, and the
  store exposes the same operation for other standalone application owners.
- Tests cover expiration, duplicate compaction, prepared-evidence retention, truncated
  tail repair, malformed-line fail-closed behaviour, and the over-bound no-discard rule.

Practice check against the local Hermes and OpenClaw references:

- The operation is owned by the memory/persistence boundary and ordered after recovery,
  following their separation of recovery, policy, and housekeeping. It does not add a
  generic transaction manager, silently rewrite canonical memory, or claim exactly-once
  execution.

Still open after this slice:

- Versioned migration procedures for future deletion/batch evidence schemas, operator
  repair tooling, and a broader backup/restore policy.
- Browser profile/artifact crash recovery, cross-platform process isolation, and the
  complete per-write/per-side-effect crash matrix remain outside this slice.

### Current slice boundary: persistence acknowledgement recovery

Delivered in this slice:

- A scoped `SessionStore` write-hook seam for deterministic before/after durable-write
  failure injection.
- Recovery tests for “result/event is durable but its acknowledgement is lost” and the
  equivalent process, workspace mutation, browser action, and memory action records.
- Repeatable restart checks proving terminal evidence remains singular and no model,
  tool, filesystem, process, browser, or memory action is replayed.
- Recovery reconstruction tests proving missing terminal lifecycle events are restored
  once from persisted action records.
- An integration recovery test proving a real approved process side effect is not
  replayed when its terminal record acknowledgement is lost; the repaired event is
  inserted before an already durable turn-terminal event.
- A process-level crash test proving a still-running detached child is terminated during
  restart recovery without replaying it, plus a launch-acknowledgement failure test
  proving the in-process runner cleans up after spawn.
- Diagnostic-stop tests covering model dispatch/response, terminal result/event
  durability, process approval before launch, process execution while running, a
  completed filesystem/browser/memory side effect, and a multi-file member boundary.
- Memory recovery now reconciles approved `add` and `replace` mutations when the
  canonical Markdown write succeeded but acknowledgement of the durable memory-action
  record was lost. It matches the canonical entry by scope, source path, exact record
  identity where applicable, model call provenance, and content hash, records the commit,
  reconstructs missing lifecycle evidence, and never replays the write. Recovery is safe
  to run twice.
- Memory removal now records hash-only deletion evidence before and after canonical
  publication. Batch actions persist a bounded hash-only member manifest and reconcile
  add, replace, and remove members as one approved action. Mixed batches emit one
  terminal lifecycle event, and recovery never replays a member.
- Direct memory boundary tests now cover before/after canonical Markdown publication and
  before/after deletion-evidence append behaviour. Runtime tests exercise the same boundaries
  through approved model tool calls and restart recovery, including the fail-closed removal case.
- Cross-file daily-memory batch tests cover a stop before the first changed file and a stop
  after one file has committed. Recovery distinguishes not-applied from partial publication,
  preserves the committed member, and never replays either member.

Persistence slice limitations:

- Failure injection before and after every persistence write, and at every model-send,
  approval-decision, and underlying filesystem/process/browser/memory side-effect boundary,
  remains open. This increment adds the memory canonical/deletion-evidence boundaries but
  still covers only selected boundaries across the complete runtime.
- Complete per-write and per-side-effect process crash coverage, cross-platform process
  identity/process-group durability proof, and an exactly-once execution guarantee remain
  open.
- Evidence retention, safe tail repair, duplicate compaction, and fail-closed bounds are
  now implemented for the deletion ledger and batch publication journal. Versioned
  migration, operator repair tooling, and backup/restore procedures remain open. The
  current evidence proves the supported local acknowledgement-loss and operation-specific
  recovery paths, not an exactly-once guarantee or cross-file transaction.

### Current slice boundary: process record integrity

Delivered in this slice:

- `TurnStore.writeProcess` validates a complete process record before creating or
  replacing its durable evidence. Existing records are validated again before a state
  transition is accepted, so a damaged prior record cannot be used as transition input.
- Recovery validates process ownership, immutable execution context, sanitized-environment
  metadata, effective limits, state/decision values, bounded outcome fields, and the
  required PID/start timestamp for `running` records before reconciliation begins.
- A foreign-session record receives an explicit ownership error. A malformed PID or
  malformed record fails closed without interpreting the PID, signalling a process, or
  advancing the interrupted turn.
- Tests cover the public write/transition path, foreign-session rejection, and recovery
  of a malformed running record.

Practice check against the local Hermes and OpenClaw references:

- This is operation-specific durable-record validation at the existing process/recovery
  boundary, matching the references' preference for explicit lifecycle and guard checks.
  It does not add a generic schema framework, workflow engine, process sandbox, or
  exactly-once ledger.

Still open after this slice:

- The full per-write and host-side process crash matrix, cross-platform process identity
  and process-tree guarantees, OS/network isolation, PTY/background jobs, shell policy,
  and operational repair procedures remain open.

### Current slice boundary: browser action record integrity

Delivered in this slice:

- `TurnStore.writeBrowserAction` validates a browser action before creating or replacing
  its durable record. Existing records are validated again before a state transition is
  accepted, so recovery cannot transition from malformed prior evidence.
- Recovery validates browser-session, tab, document, reference, action hash, action/status,
  approval decision, bounded limit, error, dialog, diagnostic, and timestamp fields before
  classifying a browser action or reconstructing its terminal event.
- A `running` browser action must carry a non-empty start timestamp. Invalid action kinds,
  malformed nested dialog/diagnostic data, invalid error codes, and malformed limits fail
  closed without marking the action ambiguous or advancing the turn.
- Tests cover normal running-action recovery and rejection of a malformed persisted action
  before recovery classification.

Practice check against the local Hermes and OpenClaw references:

- This is operation-specific validation at the existing browser persistence/recovery
  boundary. It follows their explicit lifecycle and guard-check pattern without adding a
  generic schema framework, browser workflow engine, or transaction coordinator.

Still open after this slice:

- Equivalent complete validation for memory action records, the full per-write/side-effect
  crash matrix, and broader browser profile/authentication and cross-platform recovery work
  remain open.

### Current slice boundary: workspace mutation record integrity

Delivered in this slice:

- `TurnStore.writeMutation` validates a complete workspace mutation record before creating
  or replacing durable evidence. Existing records are validated again before a transition,
  so a damaged prior record cannot become transition input.
- Recovery validates the mutation operation/risk, path set, patch members, hashes, line
  counters, byte/depth bounds, decision and error values, and the multi-file journal before
  reconciliation begins. Optional operation-specific fields are validated when present.
- Malformed mutation evidence fails closed before the recovery classifier can infer whether
  a filesystem side effect occurred; the interrupted turn remains unchanged for inspection.
- Tests cover the public write/transition path and rejection of malformed persisted mutation
  evidence before recovery reconciliation.

Practice check against the local Hermes and OpenClaw references:

- This is operation-specific validation at the existing workspace persistence/recovery
  boundary. It follows their explicit lifecycle and guard-check pattern without adding a
  generic schema framework, transaction coordinator, or exactly-once ledger.

Still open after this slice:

- Equivalent complete validation for memory action records, the full per-write/side-effect
  crash matrix, filesystem race testing, and transaction guarantees beyond the existing
  `apply_patch_set` journal remain open.

### Current slice boundary: model payload resource limits

Delivered in this slice:

- Positive configuration and `.env` settings for independent serialized request and
  streamed response byte limits.
- Pre-transport request rejection with durable `ModelRequestRejected` evidence.
- Turn-wide UTF-8 accounting for response text and tool-call fields, with a typed
  `resource-limit` failure that does not retry or persist partial assistant output.
- OpenRouter-side response enforcement while consuming the provider stream, so the
  adapter also fails before unbounded response accumulation.
- Tests for defaults, invalid configuration, pre-provider rejection, partial-output
  failure, and provider-level stream enforcement.

### Current slice boundary: identity-scoped lifecycle ordering

Delivered in this slice:

- Shared persistence validation for process, browser, and memory lifecycle events,
  keyed by execution, action, or operation identity rather than global event position.
- Explicit normal ordering for preparation, approval, start, termination, and terminal
  outcomes, including recovery-compatible direct terminal reconstruction.
- Fail-closed rejection of missing identities, skipped approval/start phases, and events
  appended after a terminal action.
- Normal denied/unavailable approvals for process, workspace, and memory actions now
  persist a terminal lifecycle event, while recovery can still reconstruct one when
  only the durable action record survived.
- Contract tests covering all three action families and the recovered-terminal exception.
- An end-to-end denied process turn test proving the normal approval decision writes a
  terminal process outcome, leaves no `ProcessStarted` event, and does not launch the
  command.

### Current slice boundary: memory action record transitions

Delivered in this slice:

- `TurnStore.writeMemoryAction` validates the existing operation history before appending
  a new record, and `readMemoryActions` validates it again during inspection and recovery.
- The memory action state path is explicit: `proposed` may become `approved`, `denied`, or
  `failed`; an approved action may become `committed`, `denied`, or `failed`; terminal
  outcomes cannot receive another transition.
- Operation identity is held constant across the history, including session, turn,
  correlation, call, scope, source, content hashes, timeout, and batch member manifest.
  An approved `add` may receive its durable record ID during reconciliation; replace/remove
  targets may not change identity.
- Conflicting duplicate outcome evidence is rejected. A focused persistence test covers
  skipped transitions and identity drift, while the full package suite covers normal,
  denied, interrupted, acknowledgement-loss, and batch recovery paths.

Practice check against the local Hermes and OpenClaw references:

- This is a narrow enforcement of the memory action contract already used by runtime and
  recovery. It follows the references' explicit operation state and fail-closed recovery
  patterns without creating a generic workflow engine, event-sourcing layer, transaction
  manager, rollback service, or exactly-once claim.

Still open after this slice:

- The broader per-write and host-side crash matrix, schema migration/repair tooling,
  backup/restore, and the remaining memory retrieval/privacy/compaction work remain open.

### Current slice boundary: memory-search evidence integrity

Delivered in this slice:

- `TurnStore.writeMemorySearch` validates search evidence before publication and validates
  an existing record before accepting an identical acknowledgement retry.
- `readMemorySearches` and `ensureMemorySearchEvent` validate the same contract before
  inspection, recovery, or lifecycle-event repair. Validation covers ownership, query and
  call identity, scope filters, positive result bounds, result IDs/counts, truncation, and
  timestamps.
- A malformed result count or result set fails closed before recovery can reconstruct a
  `MemorySearched` event or advance the interrupted turn.
- Tests cover idempotent search evidence, conflicting identity reuse, acknowledgement-loss
  repair, and malformed evidence rejection.

Practice check against the local Hermes and OpenClaw references:

- This is operation-specific evidence validation at the existing memory-search persistence
  boundary. It keeps the search result set redacted and bounded without adding a generic
  event-sourcing or retrieval framework.

Still open after this slice:

- The broader per-write and host-side crash matrix, schema migration/repair tooling,
  backup/restore, and the remaining memory retrieval/privacy/compaction work remain open.

### Current slice boundary: memory action record integrity

Delivered in this slice:

- `TurnStore.writeMemoryAction` validates each action record before appending it to the
  operation's JSONL history. `readMemoryActions` validates every historical record before
  returning the latest state for inspection or recovery.
- Validation covers session/turn/correlation ownership, operation and scope, source and
  content hashes, batch member manifests, approval timeout, lifecycle status, decision,
  reason, and timestamp fields. A batch operation must carry a non-empty member manifest.
- Malformed memory evidence fails closed before recovery can reconcile or close the action;
  it cannot be mistaken for an approved operation or used to infer a memory side effect.
- Tests cover malformed persisted evidence and the existing transition, denial,
  acknowledgement-loss, interruption, and batch recovery paths.

Practice check against the local Hermes and OpenClaw references:

- This is operation-specific validation at the existing memory persistence/recovery
  boundary. It follows explicit lifecycle and fail-closed recovery patterns without adding
  a generic schema framework, workflow engine, rollback service, or exactly-once claim.

Still open after this slice:

- The broader per-write and host-side crash matrix, schema migration/repair tooling,
  backup/restore, and the remaining memory retrieval/privacy/compaction work remain open.

### Current slice boundary: runtime interruption checkpoints

Delivered in this slice:

- A diagnostic-only checkpoint contract for the model-send, model-response, approval,
  tool-execution, terminal-commit, process-start, and multi-file-member boundaries.
- An explicit interruption error that bypasses ordinary failure terminalisation, leaving
  the durable turn available for the same restart recovery used by the CLI.
- Tool-dispatch propagation that does not convert a diagnostic interruption into a
  model-visible tool error.
- Recovery tests for stops before model transport, after model response, before terminal
  result durability, before terminal event durability, after process approval but before
  launch, after process start while the child is running, after a real filesystem side
  effect, and between committed multi-file members.
- Recover-twice assertions showing no provider replay, no process launch replay, no
  duplicate terminal event, no repeated filesystem mutation, and no automatic retry of
  a partial patch set.

Still not delivered by the runtime interruption increment:

- Failure injection at every pre-write, post-write, and underlying side-effect boundary;
  the remaining gaps are full per-write coverage and additional host-side effect
  boundaries beyond this representative matrix.
- Full turn-level state-machine validation, concurrency limits, deterministic replay,
  and cross-platform process recovery evidence.

Broader gates still open after the current increments:

- OS-level process/container limits, network isolation, or a sandbox guarantee.
- Fallback policy, cost accounting, or the full provider resilience work listed in the
  model/provider section. Provider capability metadata and reported token usage are now
  delivered, but they are not a pricing or provider-acceptance guarantee.
- The remaining full runtime crash matrix and structured approval/TUI gates. The
  provider acceptance gate is complete for the documented local profile, but it does
  not certify other providers, models, credentials, or deployment profiles.

The plan remains active. These are verified vertical slices, not completion of the
remaining runtime, approval, filesystem, or security work below.

### Current slice boundary: provider reliability and evidence

Delivered in this increment:

- Capability metadata for the deterministic and OpenRouter adapters, with explicit
  provider/model validation and no silent deterministic fallback.
- Bounded provider request ID and latency metadata on successful model attempt and
  model-completion evidence.
- Classification of transport failures, incomplete streams, context overflow, and
  provider refusal, including retry eligibility and post-output disconnect handling.
- Tests for factory validation, adapter metadata, provider evidence, HTTP and streamed
  refusal/context errors, and pre/post-output disconnects.
- Registry and TUI tests prove the provider list is credential-free and that `/models`
  renders the active selection and declared capabilities without claiming fallback.
- Malformed stream-shape and rejected-credential fixtures prove these failures terminate
  as typed provider outcomes without a transport retry.
- Provider usage is surfaced in `TurnMetrics` when reported, while absent usage and
  unconfigured cost remain explicit rather than estimated.
- The manual acceptance procedure is documented in the provider-acceptance playground
  and has one successful local real-provider run recorded above. This does not certify
  other providers, models, credentials, or deployment profiles.

Still open after this increment:

- Broader provider fixtures for malformed response shapes, usage anomalies, fallback
  policy, credential rotation, cost accounting, and provider-native diagnostic retention.
- Broader provider selection UX beyond the read-only registry view.

### Current slice boundary: approval identity and cancellation UX

Delivered in this increment:

- Approval panels show the identity bound to the prepared operation: mutation ID, process
  execution ID plus argv hash, browser action ID plus action hash, or memory operation and
  call IDs.
- Approval panels show the effective approval lifetime while retaining the detailed
  timeout context for inspection.
- Active cancellation is idempotent in the TUI. The first Ctrl-C aborts the active
  controller and reports cancellation; repeated Ctrl-C input does not emit duplicate
  cancellation transitions.
- Partial/uncertain filesystem outcomes and ambiguous process/browser outcomes are
  rendered as outcome-unknown observations rather than ordinary failures.
- Tests cover panel identity/expiry rendering, idle Ctrl-C, active cancellation, and
  cancellation while an interactive approval or browser action is in progress, plus
  partial and outcome-unknown rendering.

### Current slice boundary: filesystem transfer stale-approval checks

Delivered in this increment:

- Added an approval-path regression matrix for file and directory `copy`, `move`, and
  `rename`.
- Each test changes the prepared source inside the approval callback. The registry now
  proves the operation returns `mutation-stale`, leaves the changed source untouched,
  and does not publish a destination.
- The test exercises the existing operation-specific safeguards: file transfers hash
  through a no-follow descriptor, directory transfers re-scan their bounded manifest,
  and destination publication remains no-replace.

Practice check against the local Hermes and OpenClaw references:

- This is a bounded stale-precondition test at the existing approval and filesystem
  seams. It strengthens an auditable safety contract without introducing a filesystem
  transaction coordinator, rollback service, or an exactly-once claim.

Still open after this increment:

- The complete crash matrix around every durable write and host-side filesystem effect,
  deterministic concurrency/lease tests, and platform-specific immutable-handle
  support. The operation still cannot claim an OS-level snapshot between the final
  observation and the host filesystem commit.

## Scope

- [ ] Define and enforce durable turn, attempt, tool-action, approval, and terminal-result
      state transitions.
- [ ] Record stable identities, attempt numbers, action hashes, timestamps, limits, and
      outcomes needed for restart reconciliation.
- [x] Add bounded model retry for transport failures with visible attempt evidence and
      no automatic replay of an approved or started side effect.
- [ ] Make cancellation, timeout, restart, duplicate events, and ambiguous outcomes
      explicit runtime results.
- [ ] Replace the current bare approval answer flow with a structured review interaction
      that shows the exact prepared operation and fails closed on unsupported input.
- [ ] Improve the existing TUI around lifecycle state, approval focus, cancellation,
      errors, and long output. Keep the renderer separate from the runtime.
- [x] Complete required local filesystem operations: directory creation, regular-file
      and directory rename, regular-file and directory move, and regular-file and
      directory copy where policy allows.
- [x] Define multi-file `apply_patch_set` semantics and implement reconciliation for
      partial completion. Use atomic replacement only where the underlying operation can
      prove it; the patch set explicitly reports partial or uncertain outcomes rather
      than claiming cross-file atomicity.
- [x] Add shared resource limits for turns, requests, output, files, directory entries,
      bytes, depth, and operation duration. Model request and streamed output limits are
      independently enforced and recorded; OS-level isolation remains a separate gap.
- [x] Recheck approved identities immediately before side effects and reject stale or
      changed approvals. The current filesystem transfer matrix covers file and
      directory copy, move, and rename through the public approval path; the remaining
      crash/TOCTOU limitations are recorded below and are not treated as solved by this
      check.
- [ ] Extend security and telemetry evidence for retries, cancellation, recovery,
      partial results, and denied operations.
- [ ] Add the remaining unit, integration, failure-injection, security, manual, and
      real-provider acceptance tests required by this plan. The multi-file patch-set
      slice now has direct, tool-loop, cancellation, and journal-recovery coverage.
- [ ] Update Computer Native documentation and the follow-on queue so the next slice
      cannot accidentally bypass this foundation.

## Explicitly out of scope

- Skills, Plugins, and External Integrations. They start only after this plan's
  completion gate passes.
- Semantic or hosted memory retrieval, automatic memory promotion, and the full context
  compaction lifecycle. The current memory foundation remains available behind its
  existing boundary.
- New browser profiles, personal Chrome/CDP control, extensions, arbitrary JavaScript,
  credential storage, or remote browser providers.
- Interactive PTYs, shell-language parsing, durable background jobs, remote execution,
  or container execution. This plan hardens the current bounded local process contract
  and records its host-execution limitation.
- General OS sandboxing or network isolation implementation. This plan defines the
  deployment decision, keeps the local profile honest, adds resource-policy seams, and
  fails closed where the declared profile cannot make a required guarantee. A separate
  isolation plan is required before claiming a sandboxed production profile.
- Main Agent Harness Lab UI integration. The standalone TUI and runner contracts are
  the target here; the shared UI consumes them in a later integration slice.
- Session-wide "always allow" grants. The first hardened approval path remains exact
  action approval with explicit scope and expiry decisions.

Do not add a partial version of any deferred capability merely to make the interface
look complete.

## Design decisions to preserve

### One lifecycle owner

`src/runtime` owns turn admission, state transitions, cancellation, and terminal
outcomes. The TUI, provider adapters, tools, and persistence modules do not implement
their own agent loops or competing retry policies.

### Persistence before interpretation

Persist the identity and prepared state of a turn, model attempt, tool action, and
approval before the next side effect. Persist the bounded outcome before exposing a
terminal result. Recovery must be able to distinguish "not started", "started", and
"outcome unknown".

### Retry model transport, not side effects

Model transport failures may be retried within a bounded policy because a model request
does not itself authorize a tool action. Once a tool or filesystem action is approved or
started, the runtime must not blindly replay it. It must reconcile its operation-specific
record or report an ambiguous outcome.

### Approval binds to prepared work

An approval identifies the exact prepared operation, resolved target, limits, and action
hash. A changed path, executable, argument vector, environment profile, or operation
payload invalidates the approval. The approval view is a review surface, not a yes/no
prompt hidden inside a tool implementation.

### Local execution is not a sandbox

The current local process adapter may access host resources available to its executable.
Workspace containment, approval, and environment filtering reduce risk but do not create
OS isolation. The TUI and evidence must say this plainly.

### Filesystem atomicity must be earned

Single-file replacement can use an atomic temporary-file and rename sequence where the
platform supports it. A multi-file mutation uses a journal, preconditions, ordered
operations, and reconciliation. It must report partial completion unless rollback is
actually proven for the supported filesystem profile.

## Ownership and boundaries

```text
runtime/       -> turn admission, state transitions, retry/cancel policy, final outcome
persistence/   -> durable records, atomic record writes, recovery scan, reconciliation
models/        -> provider transport, response parsing, provider-specific diagnostics
tools/         -> tool contracts and dispatch, never direct TUI rendering
workspace/     -> filesystem preparation and operation execution
security/      -> policy, approval inputs, identity rechecks, limits, redaction
cli/           -> input, rendering, approval interaction, terminal cancellation
telemetry/     -> normalized lifecycle events and provider/tool-native details
```

State explicitly in code and tests:

- `runtime` is the sole owner of turn and action lifecycle transitions.
- `persistence` is the sole writer of durable lifecycle records.
- `security` prepares and validates policy decisions but does not execute side effects.
- `workspace` executes only a prepared operation whose identity was revalidated.
- `models` never dispatches tools and never decides whether an action is approved.
- `cli` renders events and collects decisions but cannot bypass policy or persistence.

## State, persistence, and evidence

Extend the existing session layout without creating a second record format:

```text
sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/
    turn.json
    events.jsonl
    attempts/<attempt-id>.json
    executions/<execution-id>.json
    workspace-actions/<action-id>.json
    result.json
```

The exact directory names may follow existing code if equivalent ownership is preserved.
Each durable record must define:

- Stable identity and parent identity.
- State, legal next states, and terminal states.
- Creation and transition timestamps.
- Prepared payload hash and approved payload hash where approval applies.
- Scope, limits, redacted configuration, and effective provider/model identity.
- Attempt number and retry reason where a retry is allowed.
- Bounded output and an artifact reference instead of unbounded inline content.
- Recovery classification: not started, completed, failed, cancelled, interrupted, or
  outcome unknown.

Write rules:

- Use atomic replacement for JSON records and append-only JSONL for event streams.
- Validate state transitions before replacing a record.
- Never persist API keys, cookies, authorization headers, raw secret environment values,
  or unbounded model/page/file content.
- Recovery must be idempotent. Running recovery twice must not launch a process, repeat a
  filesystem mutation, or append duplicate terminal events.
- Preserve provider-native error details and normalized evidence together.

## Failure, retry, and recovery semantics

Implement and document these outcomes:

| Failure point | Required result |
| --- | --- |
| Before model request is accepted | Bounded retry if policy permits, otherwise failed with attempt evidence |
| Provider disconnect after request may have been accepted | Outcome unknown or bounded provider recovery, never an invisible retry loop |
| Before tool approval | Approval unavailable or denied on restart; no side effect |
| After approval, before side effect | Revalidate identity and limits; execute once or close as not started |
| During filesystem mutation | Reconcile journal and preconditions; report completed, rolled back, partial, or unknown |
| During process execution | Terminate within the configured grace period; report confirmed or ambiguous termination |
| During TUI approval | Keep the action pending until decision, cancellation, or process shutdown; shutdown fails closed |
| Duplicate or out-of-order event | Ignore or record as a diagnostic without changing a terminal state |
| User cancellation | Stop admission and active work where supported, persist cancellation, and clean up |

Retry limits, backoff, and jitter must be configuration with safe defaults. Every retry
must have a reason, attempt identity, and final disposition. There is no exactly-once
claim in this plan.

## Security and configuration

- Validate all configured limits at startup and reject unsafe combinations.
- Keep provider keys in the existing local development configuration path. Do not add
  keys to records, logs, tests, plans, fixtures, or commits.
- Redact secrets before persistence, rendering, error reporting, and artifacts.
- Keep workspace paths canonical and reject traversal, symlink escape, unsupported
  special files, and targets outside the configured root.
- Recheck the canonical target, executable identity, argv, cwd, limits, and operation
  hash after approval and immediately before execution.
- Enforce aggregate file count, byte, depth, request, output, tool-round, and duration
  limits before approval and during execution where possible.
- Make the local host-execution limitation visible in approval text and evidence.
- Fail closed when there is no interactive approval channel for a mutation or process
  operation.
- Treat model output, file contents, browser content, and recovered records as untrusted
  data. They cannot alter policy or approval state directly.

## Implementation checklist

### 1. Contracts and configuration

- [ ] Define typed lifecycle states and legal transitions for turns, model attempts,
      approvals, workspace actions, and terminal results.
- [ ] Add stable attempt/action identities and idempotency or reconciliation keys where
      an operation needs them.
- [ ] Define retry, timeout, backoff, output, file, directory, and tool-round limits.
- [ ] Define error categories that distinguish denied, invalid, failed, interrupted,
      cancelled, partial, and outcome-unknown results.
- [x] Add configuration validation with safe defaults and actionable error messages.

### 2. Runtime and persistence

- [ ] Implement the shared lifecycle transition helpers in `src/runtime`.
- [x] Persist model attempts before sending and after each bounded response or failure.
- [ ] Persist approval preparation and decision before tool execution.
- [ ] Record recovery classification and operation-specific reconciliation data.
- [x] Validate persisted process ownership, execution context, limits, state, and
      running-process identity before transitions or restart reconciliation.
- [x] Validate persisted browser action identity, action/status, limits, nested outcome
      evidence, and running timestamps before transitions or restart reconciliation.
- [x] Validate persisted workspace mutation identity, operation/risk, path/member and
      journal evidence, limits, counters, decisions, and outcomes before transitions or
      restart reconciliation.
- [x] Add repeatable recovery for durable terminal result/event acknowledgement failures;
      recovery does not auto-replay the turn or duplicate terminal evidence.
- [x] Reconstruct one missing terminal lifecycle event for each current persisted action
      family, including a distinct workspace reconciliation outcome.
- [ ] Extend crash recovery and duplicate/out-of-order handling across every persistence
      and side-effect boundary; the current completed scope is acknowledgement loss after
      durable records for all current action families.
- [x] Make the documented package test and coverage commands serialize host-sensitive
      fixtures so browser/profile/process tests remain reproducible under normal load.
- [ ] Add cancellation propagation from the TUI through runtime to model/tool/process
      work.
- [x] Expose normalized lifecycle events for model, workspace, process, browser, and
      memory actions while retaining provider and tool diagnostics.

### 3. Approval and TUI

- [x] Replace bare `y`/`yes` handling with a focused approval interaction using named
      choices such as approve, reject, inspect, and cancel.
- [x] Show the exact operation, resolved path or argv, scope, limits, risk warning,
      action hash, and expiry in the approval view.
- [x] Bind the selected decision to the prepared action identity and reject stale
      decisions.
- [x] Show retry, waiting, cancelling, interrupted, partial, and outcome-unknown states
      distinctly from success and failure.
- [x] Make Ctrl+C work while idle, during model transport, during approval, and during
      active tool execution without terminating the shell unexpectedly.
- [ ] Keep the renderer driven by typed runtime events and preserve the current honest
      capability list. Do not add fake activity or health panels.
- [ ] Improve long-output handling, scrollback, error visibility, and terminal redraw
      within the current renderer boundary. A complete alternate-screen redesign remains
      a later TUI plan.

### 4. Provider reliability

- [x] Add provider capability metadata and validate provider/model combinations before
      admission.
- [x] Add bounded retry for eligible transport failures, rate limits, and transient
      provider errors.
- [x] Handle partial streams, empty responses, incomplete tool calls, disconnects,
      context overflow, and provider refusal without hanging the turn. Broader malformed
      response-shape coverage remains open.
- [x] Record provider, model, attempt, request identifier when available, latency,
      usage, retry reason, and final disposition without secrets.
- [x] Make deterministic providers explicitly selected. No silent deterministic fallback
      is allowed in a real-provider run.
- [x] Add provider contract fixtures and complete one documented real-provider acceptance
      run using the local development environment.

### 5. Filesystem completion

- [x] Add directory creation with root, parent, depth, entry, and approval checks.
- [x] Add regular-file and directory rename with same-filesystem preconditions.
- [x] Add regular-file and directory move with destination and overwrite policy.
- [x] Add regular-file and directory copy with bounded recursive traversal and explicit
      symlink/special-file behaviour.
- [x] Reuse existing quarantine and recovery rules for destructive replacement or
      deletion paths.
- [x] Add prepared operation manifests, precondition checks, operation journals, and
      reconciliation records for the supported multi-file `apply_patch_set` boundary.
- [x] Report partial completion and recovery instructions when an `apply_patch_set`
      transaction cannot roll back fully.
- [x] Add operation-specific aggregate mutation limits for large inputs: directory-tree
      operations use the configured entry/byte/depth bounds, and multi-file patch sets
      now enforce `COMPUTER_NATIVE_MAX_PATCH_SET_BYTES` over resulting member content
      before approval and again before commit. Each patch-set request records its byte
      total for approval and evidence; text reads and individual file writes remain
      bounded by their own content limits.

### 6. Security, limits, and telemetry

- [x] Validate shared numeric limits at startup and include effective limits at the
      operation boundary where aggregate mutation approval depends on them (currently
      directory trees and multi-file patch sets).
- [ ] Keep future limit additions operation-specific; do not introduce a cross-component
      limit evaluator until two concrete consumers require the same semantics.
- [ ] Add tests for traversal, symlink escape, stale approvals, secret leakage,
      oversized inputs, hostile output, and cross-scope record access.
- [ ] Add lifecycle events for retry, cancellation, recovery, partial completion, and
      ambiguous outcomes.
- [x] Add correlation IDs that connect TUI messages, runtime events, provider attempts,
      tool actions, and persisted records.
- [x] Make model lifecycle evidence idempotent for identical acknowledgement-loss retries
      and reject conflicting duplicate payloads.
- [x] Make one-shot action lifecycle evidence idempotent while preserving repeatable
      workspace progress observations.
- [ ] Document which controls are policy controls and which guarantees require a future
      OS/container isolation profile.

### 7. Documentation and inspection

- [ ] Update runtime, persistence, security, CLI, workspace, and model READMEs with the
      final state and failure semantics.
- [x] Add a short playground or manual acceptance procedure using `pnpm run chat`.
- [x] Update the production-readiness gap register with delivered evidence and remaining
      limitations.
- [ ] Keep the follow-on queue pointed at Skills only after this plan is archived.

## Test coverage

### Unit and contract tests

- [ ] Legal and illegal lifecycle transitions.
- [ ] Attempt numbering, action hashes, idempotency/reconciliation keys, and redaction.
- [x] Reject malformed or foreign-session process records before PID interpretation or
      recovery-side process reconciliation.
- [x] Reject malformed browser action records before recovery classification or terminal
      event reconstruction.
- [x] Reject malformed workspace mutation records before recovery reconciliation or
      filesystem outcome classification.
- [x] Reject malformed memory action records before recovery reconciliation or terminal
      lifecycle reconstruction.
- [x] Reject malformed memory-search evidence before recovery lifecycle-event repair.
- [ ] Retry eligibility, backoff limits, provider error classification, and no silent
      fallback.
- [ ] Approval choice parsing, stale approval rejection, exact identity binding, and
      fail-closed behaviour.
- [x] Resolve workspace approval on parent cancellation and prove that cancellation
      cannot write the prepared mutation.
- [ ] Path, symlink, special-file, destination, overwrite, size, depth, and aggregate
      limit policy.
- [x] Filesystem operation manifests and partial-result classification for
      `apply_patch_set`; transfer manifests remain covered by their operation-specific
      recovery paths.
- [ ] TUI state rendering for waiting, approved, rejected, retrying, cancelling,
      interrupted, partial, ambiguous, failed, and completed states.
- [x] Sanitize streamed model control sequences, including sequences split across chunks,
      and terminate assistant output before rendering lifecycle activity.
- [x] Sanitize lifecycle summaries, session/history/evidence values, and approval review
      values before rendering them to the terminal.

### Integration tests

- [ ] A real local model adapter and deterministic provider use the same model contract.
- [ ] A model response leads to an approved workspace operation through the runtime,
      approval, security, workspace, persistence, and TUI boundaries.
- [ ] Directory create, copy, move, rename, and multi-file failure paths produce
      bounded evidence and recoverable outcomes.
- [ ] Provider disconnect, rate limit, malformed response, empty response, and context
      overflow paths terminate within configured limits.
- [ ] Ctrl+C cancels idle input, model transport, approval, and active filesystem work.
- [ ] Rebuilt evidence and TUI history agree after a restart.

### Failure-injection and recovery tests

- [ ] Stop before and after each durable record write.
- [ ] Stop before and after model send, provider response, approval decision, and
      filesystem side effect.
- [x] Inject durable acknowledgement failures for terminal evidence, process, workspace,
      browser, and memory records; recover twice and confirm no duplicate terminal
      evidence or side effect.
- [x] Remove a terminal process, browser, memory, or workspace lifecycle event while
      retaining its durable record; recover twice and confirm the event is reconstructed
      once from the record.
- [ ] Extend the recover-twice assertion to every supported side-effect record and the
      process-level crash harness.
- [ ] Inject duplicate, missing, and out-of-order events.
- [x] Change a target after approval and confirm the action is rejected as stale for
      file and directory copy, move, and rename through the public tool registry.
- [ ] Fail one operation in a multi-file change and verify the exact partial state and
      recovery path.
- [ ] Cancel during retry backoff, approval, copy, move, and cleanup.

### Security and resource tests

- [ ] Attempt traversal and symlink escape for every new filesystem operation.
- [ ] Attempt special-file access, oversized trees, deep trees, output exhaustion,
      oversized model responses, and excessive tool rounds.
- [ ] Confirm secrets do not appear in TUI output, records, events, artifacts, or error
      messages.
- [ ] Confirm a prepared approval cannot be reused for a changed operation or scope.
- [ ] Confirm a local process operation is labelled as host execution and does not claim
      sandboxing.

### Manual acceptance

With the normal local provider configuration already stored for development:

1. Run `pnpm run chat`.
2. Ask the agent to create a directory, write a file, copy it, rename it, move it, and
   remove or restore it in a throwaway workspace.
3. Inspect each approval before accepting it. Change one target after approval and
   confirm the stale decision is rejected.
4. Press Ctrl+C while idle, while an approval is visible, and while a real model turn is
   running. The process must return to a usable prompt or exit cleanly.
5. Interrupt a run using the documented failure-injection fixture, restart the TUI, and
   inspect the recovered status and evidence.
6. Repeat one safe flow with the real model. The transcript must identify the actual
   provider and model, and must not show a deterministic fallback.

## Required validation commands

Run from `computer-native/`:

```bash
pnpm run typecheck
pnpm run build
pnpm test
pnpm run coverage
git diff --check
```

The real-provider acceptance path is an additional manual check. It must use a locally
configured secret, never a committed key, and its output must identify the actual
provider/model path. If the provider is unavailable, the test must report unavailable,
not substitute a fake response.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] Runtime state transitions, retries, cancellation, persistence, and recovery are
      implemented behind one shared lifecycle owner.
- [ ] Recovery is repeatable and never silently replays a side effect.
- [ ] Approval is structured, exact, auditable, stale-safe, and fail-closed.
- [ ] The TUI exposes lifecycle and error states without inventing capabilities.
- [ ] Real-provider behaviour is bounded and visible, with no silent deterministic
      fallback.
- [x] Directory create, copy, move, and rename are implemented within the declared
      bounded local filesystem contract.
- [x] `apply_patch_set` reports honest partial/ambiguous outcomes with journal recovery;
      no cross-file rollback guarantee is claimed.
- [ ] Shared limits, redaction, identity rechecks, and host-execution boundaries are
      enforced and tested.
- [ ] Unit, integration, failure-injection, security, manual, and real-provider tests
      pass.
- [ ] Required documentation and the queue match the implementation.
- [ ] The production-readiness gap register records what this plan delivered and what
      still remains for maturity.

Passing this gate means the core foundation is ready for the next capability slice. It
does not mean Skills, Plugins, External Integrations, durable jobs, OS sandboxing, or the
whole Computer Native product are production-ready.

## Commit discipline and handoff

- [ ] Commit contracts and configuration separately from runtime/persistence changes
      where practical.
- [ ] Commit approval/TUI work separately from filesystem operations where practical.
- [ ] Keep provider, filesystem, and security tests with the implementation they verify.
- [ ] Review `git status` and each diff before committing. Preserve unrelated user work.
- [ ] Record changed files, validation results, manual observations, and known limits in
      the completion record.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]`: `[result]`
- `[manual check]`: `[result]`

### Known limitations

- `[remaining limitation]`

### Historical-scope note

This plan hardens the shared local foundation. Later plans may add capabilities that
need stronger isolation, durable background execution, or different approval semantics.
Those changes must update the production-readiness gap register instead of silently
expanding this completion record.
