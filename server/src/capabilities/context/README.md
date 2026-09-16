# Context management

This module owns the common meaning of a model context. It does not own model
credentials, provider transport, long-term memory, or platform durability.

The canonical session transcript and the request sent to a model are different
records. A platform builds a request-local copy, measures it against the selected
model's context window, and may compact that copy. Compaction creates a versioned
summary record. It never deletes canonical session messages.

Token counts carry their quality. `exact` means a model-specific tokenizer or provider
count supports the number. `estimated` identifies a conservative local estimator.
`unknown` means the system must not display a fabricated percentage or proceed as if
the request were safe.

The context module exposes pure budget and compaction behaviour through small
interfaces. Platform variants supply the summary implementation because the model call
belongs inside their execution and retry boundary.

## Runtime records

The file-backed implementation currently stores one session per directory:

```text
<context-root>/<session-id>/
  session.json                 # immutable model/policy identity and active turn
  transcript.jsonl             # canonical ordered messages
  turns.jsonl                  # append-only turn state transitions
  context-revisions.jsonl      # published snapshot and compaction metadata
  snapshots/<snapshot-id>.json # immutable request-local message list and budget
```

Admission, snapshot publication, and turn settlement use an in-process queue plus a
short-lived directory lease. JSONL updates are copy-and-rename writes, so a process
crash leaves the previous complete file or the complete next file rather than a
partially appended record. Repeated operations repair the expected gaps between
canonical message, turn-state, session-index, snapshot, and revision-ledger publication.

The default policy reserves 4,096 output tokens, keeps a 1,024-token safety margin,
starts compaction at 20% remaining budget, and retains the newest two complete message
groups outside the summary. These are session policy values, not provider guarantees.
The local character estimator is intentionally labelled `estimated`; a provider/model
specific tokenizer can replace it behind `ContextTokenCounter` later.

The browser receives only `ContextProjection`. It sees the latest server-owned budget,
pressure, compaction revision, and token-count quality; it does not read transcript
files or calculate the authoritative percentage.
