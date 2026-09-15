# Computer Native turn lifecycle

Computer Native handles one bounded turn at a time. The CLI owns input and rendering. The
runtime owns state transitions and the model/tool loop. The context module builds model
messages and tool definitions. The model adapter owns provider transport. Workspace and
security own filesystem authorization. Persistence owns all durable records.

## States

```text
idle → submitting → streaming → completed
                 ├────────────→ failed
                 ├────────────→ cancelled
                 └────────────→ interrupted
```

The runtime creates a turn record before appending the user message. It then records
`TurnStarted`, admits bounded model rounds, persists each round before tool execution,
streams text, and commits an assistant message only after a complete final response.

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
    rounds.jsonl
    result.json
```

`session.json` records the stable session ID, local CLI source, and default profile.
`transcript.jsonl` contains ordered user and assistant messages. `turn.json` records the
admission state and safe provider/model metadata. `events.jsonl` contains ordered,
correlated lifecycle events. `rounds.jsonl` records normalized model and tool phases,
call IDs, round numbers, safe summaries, and bounded content sizes. `result.json` is
written atomically and belongs to one turn. Normal turn results include model-request,
tool-call, round-count, duration, and null-cost metrics; provider usage is retained only
when the provider supplies it.

When a later turn is admitted, the context builder includes only the most recent bounded
transcript messages. This provides ordinary conversational continuity without allowing
an unbounded session history to become a model request.

## Restart recovery

If the process stops after the user message is durable but before a terminal result exists,
the next session load marks the turn `interrupted`, writes a terminal result and event,
and does not call the model again. The provider may have completed after the process lost
its acknowledgement, so automatic replay could duplicate cost or output.

If a turn record exists but its user message is missing, the loader stops with a
repairable incomplete-record error. It does not silently overwrite evidence or invent a
message.

## Workspace and tool limits

The configured workspace root is an authorization boundary for `list_directory` and
`read_file`; it is not automatically a process sandbox. Paths must be relative to the
root, traversal and symlink escapes are rejected, reads are UTF-8 and size-bounded, and
directory listings and tool output are bounded. The model/tool loop has an explicit round
limit and tool deadline.

This slice does not load skills, memory, shell tools, plugins, gateway messages, or
profile-specific context. It also does not claim exactly-once provider execution. Those
belong to later slices with their own plans and evidence rules.
