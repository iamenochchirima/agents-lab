# Anesu turn lifecycle

Anesu handles one bounded turn at a time. The CLI owns input and rendering. The
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
    mutations/<mutation-id>.json
    executions/<execution-id>.json
    memory-actions/<operation-id>.jsonl
    memory-searches/<search-id>.json
    result.json
```

`session.json` records the stable session ID, local CLI source, and default profile.
`transcript.jsonl` contains ordered user and assistant messages. `turn.json` records the
admission state and safe provider/model metadata. `events.jsonl` contains ordered,
correlated lifecycle events. `rounds.jsonl` records normalized model and tool phases,
call IDs, round numbers, safe summaries, and bounded content sizes. `result.json` is
written atomically and belongs to one turn. Normal turn results include model-request,
tool-call, round-count, duration, and null-cost metrics; provider usage is retained only
when the provider supplies it. `mutations/<mutation-id>.json` stores the exact bounded
change request, optional before/after hashes, approval outcome, and commit bytes for an
`apply_patch` or `write_file` proposal, the prepared directory preview for `mkdir`, the
non-recursive directory preview for `delete_directory`, the bounded manifest metadata for
`delete_directory_tree` and `restore_directory`, the exact-token metadata for
`purge_quarantine`, or the quarantine/restore metadata for `delete` and `restore`, or
source/destination hashes for file `copy` and `move`, bounded source/destination manifests
for directory transfers, and same-parent identity for `rename`. The effective approval
timeout is persisted with the mutation so a recovered action cannot silently inherit a
different review window.

`executions/<execution-id>.json` records the immutable executable/argument identity,
workspace cwd, sanitized environment profile and keys, limits, approval decision,
process state, bounded stdout/stderr, byte counts, exit or signal result, and whether
termination was confirmed. Process records move one way from `prepared` through
`approved` and `running` to a terminal state. Approval denial, unavailable approval,
pre-launch cancellation, output overflow, timeout, runner failure, and ambiguous
termination have typed process error codes; command output is bounded and known API
keys are redacted.

`memory-actions/<operation-id>.jsonl` records the append-only lifecycle of the exact memory operation identity,
profile/workspace-scoped source path, expected and resulting content hashes, approval
decision, and bounded terminal status. It never stores the full memory body. Prepared or
approved-but-uncommitted memory operations are closed as unavailable during restart
recovery; the model call is never replayed. Canonical memory remains under
`<state-directory>/memory/` and the index is rebuilt from it when necessary.
`memory-searches/<search-id>.json` stores only a query digest, bounded scopes, result
references, and truncation status; it does not persist raw search text.

Mutation records are updated atomically as the operation moves through `proposed`,
`approved`, `applying`, and a terminal outcome (`committed`, `failed`, `denied`,
`reconciled`, or `reconciliation_required`). Approval denial and unavailable approval
persist their typed `approval-denied` or `approval-unavailable` error code. The prepared operation, target identity,
hashes, preview, and operation-specific risk classification are immutable once recorded;
a terminal record cannot be rewritten into an applying state. Known commit errors record
`failed` with a typed safe reason. If the process stops after `applying`, restart reconciliation checks the
recorded before and after hashes for content mutations, the presence/type of the
directory for `mkdir` and `delete_directory`, source/quarantine state for `delete` and restore,
tree manifest/source/quarantine state for `delete_directory_tree` and `restore_directory`, or
exact quarantine-entry state for `purge_quarantine`, or source/destination state for `copy`
and `move`, and never retries the filesystem operation
automatically. `apply_patch_set` additionally records each member's before/after hashes,
commit order, and workspace-local temporary path in a restricted transaction journal.
It validates the full set before the first commit but does not claim all-or-nothing
filesystem atomicity; a partial or conflicting set is surfaced for reconciliation.
Reconciliation removes only an empty transaction directory after a proved before- or
after-state; conflicting or non-empty transaction material is retained for manual
inspection.

If the process stops while a mutation is still `proposed`, recovery records
`decision: unavailable`, `errorCode: approval-unavailable`, and a denied terminal state.
This makes the absence of an approval decision explicit while preserving the invariant
that no filesystem write occurs before approval.

If the process stops while a local command is `prepared` or `approved`, recovery closes
that execution as `failed` with `process-approval-unavailable`. If it is `running`,
recovery marks it `ambiguous` with `process-ambiguous`. No command is replayed because
the child may have completed after its last durable acknowledgement.

When a later turn is admitted, the context builder includes only the most recent bounded
transcript messages plus a frozen, character-bounded snapshot of user/workspace memory.
Daily notes and old session material remain out of bootstrap context until a bounded
memory search requests them. Memory bodies are delimited as advisory, untrusted data and
cannot override system instructions, tool policy, or approval decisions.

## Restart recovery

If the process stops after the user message is durable but before a terminal result exists,
the next session load marks the turn `interrupted`, writes a terminal result and event,
and does not call the model again. The provider may have completed after the process lost
its acknowledgement, so automatic replay could duplicate cost or output.

If a turn record exists but its user message is missing, the loader stops with a
repairable incomplete-record error. It does not silently overwrite evidence or invent a
message.

## Workspace and tool limits

The configured workspace root is an authorization boundary for `list_directory`,
`read_file`, `stat`, `search_files`, `list_quarantine`, `write_file`, `mkdir`, `delete_directory`,
`delete_directory_tree`, `delete`, `restore`, `restore_directory`, `purge_quarantine`, `copy`,
`move`, `rename`, `apply_patch`, and `apply_patch_set`; it is not
automatically a process sandbox. Paths must be relative to the root, traversal and
symlink escapes are rejected, reads, searches, and writes are bounded, and directory
listings, metadata, matches, diffs, and tool output are bounded. `write_file` and
`apply_patch` prepare content before approval, while `mkdir` prepares an explicit
one-directory creation with an existing parent and `delete_directory` prepares an
empty-only, non-recursive removal. `delete` moves one regular file into a
workspace-local quarantine and `restore` moves it back without overwriting. File
content mutations recheck the before-hash immediately before commit and use a flushed
same-directory temporary file plus atomic rename. `apply_patch_set` uses a restricted
workspace-local transaction directory for its per-member temporary paths and leaves
partial or conflicting outcomes for reconciliation. The model/tool loop has an explicit
round limit and tool deadline. No ambiguous commit is replayed automatically.

This slice does not load skills, shell grammar, plugins, gateway messages, or
profile-specific context. It also does not claim exactly-once provider execution. Those
belong to later slices with their own plans and evidence rules.
