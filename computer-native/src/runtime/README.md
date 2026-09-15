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
