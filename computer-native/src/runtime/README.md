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

Each admitted turn receives a stable `correlationId`. The runtime forwards it on TUI
events and model requests, and persistence copies it to lifecycle events, round evidence,
the terminal result, and action records. Older records without this field use their
turn ID as a compatibility fallback; a non-matching correlation is rejected rather than
joining evidence from another turn.

When `TurnStarted` includes provider and model fields, persistence checks them against
the admitted turn. Recovery and focused persistence tests may use the minimal event form
without those optional fields.

The runtime exposes an optional diagnostic checkpoint hook for deterministic failure
injection. Checkpoints cover model dispatch and response completion, approval boundaries,
tool execution, terminal commit, process launch, and each committed member of a
multi-file patch. A diagnostic may throw `RuntimeInterruptionError` to model the parent
process stopping at that boundary; the runtime deliberately leaves the turn non-terminal
so the normal restart recovery path can classify it. This seam is unset in normal CLI
operation and is not a retry or fallback mechanism.

Legal state transitions are checked by the small shared `lifecycle.ts` primitive used by
turn, process, browser, memory, and workspace persistence validators. It treats an
acknowledgement retry that repeats the current state as idempotent and fails closed for
an unlisted transition. Each owning component still validates its own immutable action
identity, terminal outcome fields, and recovery exceptions; the helper is not a generic
workflow engine.

Model lifecycle writes are safe to repeat after an acknowledgement loss when the same
attempt identity and payload are supplied. A conflicting repeat is rejected as
persistence corruption; it cannot create a second observation for the same attempt.
Transcript writes use the same narrow identity rule: an acknowledged user or assistant
message can be retried without duplication, while conflicting reuse of its message ID
fails closed.

Terminal persistence is also recovery-aware at the acknowledgement boundary. A durable
result or terminal event may already exist when the caller reports a write error. On
restart, persistence reconciles the result, turn state, and event history; repeating
recovery repairs missing terminal evidence without replaying the model or a tool and
without appending a second terminal event. This is an at-least-once evidence write
boundary, not an exactly-once execution guarantee. Before a terminal result is written,
the current durable turn state must permit the requested transition; an invalid terminal
transition leaves the result evidence and turn state unchanged.

The same recovery boundary applies to terminal process, browser, memory, and workspace
action records. If a record was durable but its first lifecycle append was not, recovery
rebuilds the prepared/approval prelude before its terminal observation, using
`recovered: true` and the bounded record as the source of truth. Workspace
reconciliation uses `WorkspaceMutationReconciled` when the before-state proves that
the mutation was not applied; it does not label that outcome as a commit. Recovery
never replays the action.

Model transport failures may retry only before the provider emits its first event. Each
attempt gets a durable `attempt_<hex>` identity; `ModelRequested` is written before the
provider call and `ModelAttemptCompleted` records success or bounded failure. Scheduled
delays are separate lifecycle evidence. A failure after partial text or a tool call is
never replayed automatically.

Persistence requires model request, completion, and retry evidence to carry that attempt
identity and match the existing attempt order. `ModelCompleted` is recorded only after
the latest attempt completes successfully; this protects the evidence contract without
claiming that provider execution itself is replayable or exactly once.

Successful model attempt and `ModelCompleted` evidence may also include a provider request
identifier and adapter latency when the selected adapter supplies them. The identifier is
bounded and redacted before persistence. Usage remains normalized in the existing model
usage shape, while provider-native diagnostics stay in the adapter error/evidence path.
Provider context-limit, refusal, and authentication outcomes are terminal provider
classifications, not transient retries; pre-output transport failure is the only
disconnect case eligible for the existing bounded retry policy.

When a provider reports token usage, the terminal result repeats its input, output, and
total token counts in `TurnMetrics`, and the model attempt/round evidence retains the
bounded usage object. Missing usage remains missing; the runtime does not estimate it.
Attempt and completion evidence also records observed request/output bytes and the
effective configured limits. Cost remains `null` until a pricing source is explicitly
configured, so the TUI and evidence never imply a cost estimate that was not measured.

Model requests and streamed model output are bounded independently from tool output.
`COMPUTER_NATIVE_MAX_MODEL_REQUEST_BYTES` is checked before a provider call and emits
`ModelRequestRejected` when the serialized request is too large. The runtime also counts
UTF-8 response text and assembled tool-call fields across the entire turn; exceeding
`COMPUTER_NATIVE_MAX_MODEL_OUTPUT_BYTES` fails the turn with `resource-limit` and does
not append a partial assistant transcript message. The OpenRouter adapter enforces the
same response bound while reading the provider stream, so an oversized response is
stopped before it can accumulate in memory.

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
is returned to this lifecycle; only a diagnostic stop after durable running evidence is
allowed to leave the child for restart reconciliation.
