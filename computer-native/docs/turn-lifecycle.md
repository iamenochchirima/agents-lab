# First-slice turn lifecycle

The first Computer Native slice handles one text-only turn at a time. The CLI owns input
and rendering. The runtime owns state transitions. The context module builds the initial
instruction plus the current user prompt. The model adapter owns provider transport.
Persistence owns all durable records.

## States

```text
idle → submitting → streaming → completed
                 ├────────────→ failed
                 ├────────────→ cancelled
                 └────────────→ interrupted
```

The runtime creates a turn record before appending the user message. It then records
`TurnStarted` and `ModelRequested`, streams text, and commits an assistant message only
after the provider stream completes.

Failures, timeouts, and cancellation write a terminal result without an assistant
message. A timeout has result status `failed` and error code `timeout`. Cancellation has
result status `cancelled` and error code `cancelled`.

## Evidence layout

```text
<state-directory>/sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/
    turn.json
    events.jsonl
    result.json
```

`session.json` records the stable session ID, local CLI source, and default profile.
`transcript.jsonl` contains ordered user and assistant messages. `turn.json` records the
admission state and safe provider/model metadata. `events.jsonl` contains ordered,
correlated lifecycle events. `result.json` is written atomically and belongs to one turn.

## Restart recovery

If the process stops after the user message is durable but before a terminal result exists,
the next session load marks the turn `interrupted`, writes a terminal result and event,
and does not call the model again. The provider may have completed after the process lost
its acknowledgement, so automatic replay could duplicate cost or output.

If a turn record exists but its user message is missing, the loader stops with a
repairable incomplete-record error. It does not silently overwrite evidence or invent a
message.

## Limits

This slice does not load skills, memory, workspace files, tools, plugins, gateway
messages, or profile-specific context. It also does not claim exactly-once provider
execution. Those belong to later slices with their own plans and evidence rules.
