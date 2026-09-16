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

Model transport failures may retry only before the provider emits its first event. Each
attempt and scheduled delay is recorded as lifecycle evidence. A failure after partial
text or a tool call is never replayed automatically.

The `run_command` tool is a foreground process turn within this lifecycle. Its approval
wait pauses the turn deadline, while the process itself has separate timeout, output,
argument, and termination-grace limits. Process events are persisted before the turn
can be treated as complete; an interrupted prepared/approved process is closed without
launch, and an interrupted running process is marked ambiguous rather than replayed.
