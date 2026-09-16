# Persistence

Owns checkpoints, recovery state, and durable stores for Computer Native itself. The
artifacts module defines what an output is; persistence supplies the storage and
retention mechanisms it needs.

The first terminal slice stores one session as:

```text
sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/
    turn.json
    events.jsonl
    executions/<execution-id>.json
    browser-actions/<action-id>.json
    result.json
```

JSON records are written atomically. Transcript and event records append one JSON object
per line. A turn record is created before its user message is appended, so a restart can
distinguish an admitted incomplete turn from a corrupt record. A turn with no result is
marked `interrupted` on load and is not sent to the model again.

All durable writes pass through `SessionStore`. Normal application code leaves its
optional write hooks unset. Tests and diagnostics may install a `beforeWrite` or
`afterWrite` hook to model a process stopping before a write, or after the filesystem
write succeeds but before the caller receives acknowledgement. An after-write failure
therefore means that the outcome is uncertain to the caller, not that the write was
rolled back. Recovery checks the existing result, turn state, and event stream and can
be run repeatedly without replaying a side effect or appending a duplicate terminal
event. These hooks are a failure-injection seam, not a production retry mechanism.

Runtime interruption checkpoints complement the write hooks by stopping a turn before
or after model dispatch, approval, tool execution, terminal commit, process launch, or
a committed member of a multi-file patch. Recovery uses the records that were already
durable at the stop point: prepared or approved actions are closed without execution,
running processes are reconciled without replay, partial patch journals remain
reconciliation-required, completed side effects are reconciled from their records, and
an interrupted turn is never resent automatically.

Lifecycle append validates the ordering of model attempt evidence: a
`ModelAttemptCompleted` event must follow its matching `ModelRequested` event, and a
`ModelRetryScheduled` event must follow that attempt's completion. Once a terminal turn
event exists, the same terminal event is idempotent and any different or later lifecycle
event is rejected. Workspace mutation events are also ordered and checked when read back:
`WorkspaceMutationProposed` must precede its approval decision, an allow-once decision
must precede application, progress may repeat only after application starts, and a
committed, reconciled, or failed event closes that mutation's lifecycle. Reading an existing event
stream validates these rules again, so persisted corruption is reported instead of being
silently treated as a valid recovery state.

Model attempt evidence may carry bounded `providerRequestId` and `latencyMs` fields when
the adapter reports them. They describe transport observation only and do not authorize
replay or imply exactly-once model execution. Provider and model identity remain part of
the request/turn evidence, while credentials and unbounded provider response bodies are
excluded from durable records.

Process, browser, and memory lifecycle events use the same identity-scoped ordering
checks. Process events follow prepared → approval → started → optional terminating →
completed; browser events follow prepared → approval → started → completed; memory events
follow prepared → approval → committed, forgotten, or failed. A recovery-only terminal
event may be inserted directly from a durable action record and must carry `recovered:
true`; normal events cannot skip their preparation or approval phase, and a terminal
action cannot be extended with a later event. This keeps the normalized event stream
consistent with the immutable action records while still allowing recovery to reconstruct
missing evidence after an acknowledgement loss.

If an interrupted turn contains a mutation that was still `proposed`, recovery closes
that approval lifecycle as `denied` with `approval-unavailable`; the filesystem proposal
is never replayed. Mutations that reached `approved` or `applying` use their operation-
specific reconciliation checks instead.

Workspace mutation records and their normalized lifecycle events are both retained. The
record carries the full bounded diff and operation-specific evidence; the event stream
links the action to the turn timeline using the mutation identity, operation, hashes,
limits, and journal state without duplicating the full diff. Recovery preserves the
distinction between a committed mutation, a failed or reconciliation-required mutation,
and a `WorkspaceMutationReconciled` result proving that the recorded before-state
remained authoritative and the mutation was not replayed.

When an action record is terminal but its normalized terminal event is missing, restart
reconstructs that event before it finalizes an interrupted turn. If the turn-terminal
event was already acknowledged, recovery atomically inserts the repaired action event
immediately before it so the turn-terminal event remains last. Reconstruction is
idempotent and only uses the persisted bounded record; it never launches a process,
reopens a browser action, mutates the workspace, or changes memory contents.

Local process executions use the same atomic per-operation record pattern. The record
contains the exact approved identity and bounded outcome, and its state transition is
validated before replacement. Restart recovery never starts or replays a process:
prepared and approved records become approval-unavailable, while running records are
handed to the runtime's process reconciler. That reconciler attempts to terminate the
recorded foreground process group, persists whether cleanup was confirmed, and retains
the running operation's ambiguous outcome.

Terminal result writes compare stable serialized values, so repeating the same commit is
safe after a retry or recovery. The terminal lifecycle event is appended only once, and a
result cannot be committed with a mismatched terminal event type.

Browser actions use the same immutable-identity and one-way-transition pattern. The
record stores the session, tab, document, reference, action hash, approval decision,
approval timeout, bounded outcome, and terminal status. Browser actions that were prepared or approved
when the parent stopped are closed as approval-unavailable; actions that were running
become ambiguous and are never replayed. Known configured secrets are redacted before
browser action records and lifecycle payloads are written. Screenshot and download
artifacts also emit a durable `BrowserArtifactCreated` event containing only managed
path, MIME type, size, identity, and timestamp metadata; artifact contents are not
copied into turn evidence.

Memory action recovery is operation-specific. An approved `add` or `replace` can be
reconciled after the canonical Markdown write succeeded but acknowledgement of its
memory-action record was lost: recovery reloads canonical memory and requires exactly one
entry matching the approved scope, source path, model call provenance, content hash, and
record identity for replacement before recording `committed`. Removal writes hash-only
deletion evidence before and after canonical publication, allowing recovery to verify
that the exact file moved from its recorded before-hash to its after-hash without treating
absence alone as proof. Batch actions persist a bounded member manifest and reconcile
add, replace, and remove members together; normal and recovered batches emit one terminal
action event. Direct fault injection around the memory store's own writes, ledger
retention, and cross-file batch publication remain open. This is deliberately not an
exactly-once guarantee.
