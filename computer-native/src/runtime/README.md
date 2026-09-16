# Runtime

Owns turn lifecycle, action selection, retries, cancellation, and terminal outcomes.
It asks the context module for a bounded request, invokes the model module, and routes
approved actions through tools. It must not construct prompt context, implement provider
transport, or know which Lab scenario or experiment requested a run.

The current terminal slice implements a bounded model/tool turn. Its persisted turn
states are `submitting`, `streaming`, `completed`, `failed`, `cancelled`, and
`interrupted`. Model and tool rounds are recorded before and after tool execution.
Interrupted turns are recorded after restart and are never automatically resent because
the provider or tool may have completed after the process stopped.

Terminal persistence is also recovery-aware at the acknowledgement boundary. A durable
result or terminal event may already exist when the caller reports a write error. On
restart, persistence reconciles the result, turn state, and event history; repeating
recovery repairs missing terminal evidence without replaying the model or a tool and
without appending a second terminal event. This is an at-least-once evidence write
boundary, not an exactly-once execution guarantee.

The same recovery boundary applies to terminal process, browser, memory, and workspace
action records. If their normalized terminal event was not durable, recovery rebuilds it
from the record. Workspace reconciliation uses `WorkspaceMutationReconciled` when the
before-state proves that the mutation was not applied; it does not label that outcome as
a commit.

Model transport failures may retry only before the provider emits its first event. Each
attempt gets a durable `attempt_<hex>` identity; `ModelRequested` is written before the
provider call and `ModelAttemptCompleted` records success or bounded failure. Scheduled
delays are separate lifecycle evidence. A failure after partial text or a tool call is
never replayed automatically.

Workspace actions use the same turn event stream as model, process, browser, and memory
work. The runtime persists `WorkspaceMutationProposed`, approval, application/progress,
and committed or failed events alongside the detailed mutation record. The event payload
contains action identity, scope, hashes, limits, and bounded journal metadata, but not the
full diff; the mutation record remains the source for the reviewable diff. Cancellation
and partial multi-file outcomes therefore remain inspectable after the turn ends.

The `run_command` tool is a foreground process turn within this lifecycle. Its approval
wait pauses the turn deadline, while the process itself has separate timeout, output,
argument, and termination-grace limits. Process events are persisted before the turn
can be treated as complete; an interrupted prepared/approved process is closed without
launch, and an interrupted running process is reconciled by terminating its recorded
foreground process group where possible, then marked ambiguous rather than replayed.
If launch evidence fails after spawn, the runner cleans up the child before the failure
is returned to this lifecycle.
