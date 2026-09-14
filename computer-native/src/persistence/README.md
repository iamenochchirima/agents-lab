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
    result.json
```

JSON records are written atomically. Transcript and event records append one JSON object
per line. A turn record is created before its user message is appended, so a restart can
distinguish an admitted incomplete turn from a corrupt record. A turn with no result is
marked `interrupted` on load and is not sent to the model again.
