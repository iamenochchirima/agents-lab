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

Lifecycle append validates the ordering of model attempt evidence: a
`ModelAttemptCompleted` event must follow its matching `ModelRequested` event, and a
`ModelRetryScheduled` event must follow that attempt's completion. Once a terminal turn
event exists, the same terminal event is idempotent and any different or later lifecycle
event is rejected.

If an interrupted turn contains a mutation that was still `proposed`, recovery closes
that approval lifecycle as `denied` with `approval-unavailable`; the filesystem proposal
is never replayed. Mutations that reached `approved` or `applying` use their operation-
specific reconciliation checks instead.

Local process executions use the same atomic per-operation record pattern. The record
contains the exact approved identity and bounded outcome, and its state transition is
validated before replacement. Restart recovery never starts a process: prepared and
approved records become approval-unavailable, while running records become ambiguous.

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
