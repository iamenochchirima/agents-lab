# Process execution

This module implements the first local process slice for Computer Native. It is a
foreground, one-shot execution path for an exact executable plus argument vector. It
does not parse shell syntax, open an interactive terminal, detach background work, or
provide an operating-system sandbox.

## Boundary

`ProcessSecurityPolicy` prepares and rechecks the request. Preparation resolves the
workspace-relative working directory, creates a sanitized environment, resolves the
executable through an explicit `PATH`, records executable and working-directory
identity, and applies argument and timeout limits. The executable identity includes a
streamed SHA-256 content hash so a same-size rewrite cannot pass approval rechecking
only because its filesystem timestamp did not change at the available precision.

`LocalProcessRunner` owns `spawn` and the foreground lifecycle. It always uses
`shell: false`, ignores stdin, captures bounded stdout/stderr, and terminates the
process group on timeout, cancellation, or output overflow where the platform permits
it. If the durable `started` acknowledgement fails after spawn, it also terminates the
child before returning that failure. Asynchronous lifecycle callbacks are delivered in
order and are awaited; an output or termination acknowledgement failure stops the child
and is surfaced instead of becoming an unhandled rejection. A termination that cannot
be confirmed is reported as `ambiguous`; it is never silently treated as success.

`ToolRegistry` exposes this through `run_command`. The runtime supplies an approval
callback and persists the process events under the turn's `executions/` directory.
Without an approval callback the tool fails closed and does not spawn a child. The
effective approval timeout is included in the request and durable execution record so
the review window is auditable.

## State and recovery

The durable states are `prepared`, `approved`, `running`, `completed`, `failed`,
`cancelled`, and `ambiguous`. Identity and resource limits are immutable after the
first record. Restart recovery closes `prepared` and `approved` executions as
approval-unavailable. For a `running` execution, the application recovery path attempts
to terminate the recorded foreground process group only after the persisted process
identity matches the current OS identity. Linux records the
executable path and `/proc` start token to defend against PID reuse; a missing or
unsupported identity source fails closed and does not signal the target. Recovery
records whether termination was confirmed and still marks the outcome `ambiguous`. It
never replays a process automatically because the child may have completed after its
acknowledgement was lost.

`terminationConfirmed` means that no process remained in the recorded target after the
cleanup attempt. It does not mean that an external side effect was undone. If the PID
is missing, invalid, reused, inaccessible, or the operating system cannot confirm
termination, recovery records `false` and leaves the outcome explicitly ambiguous.

This is an at-most-once launch policy from the harness perspective, with an explicit
ambiguous outcome when the child lifecycle cannot be confirmed. It does not claim
exactly-once operating-system execution.

## Deliberate limits

The process is started in the configured workspace by default, but the workspace is
not a host sandbox: an approved command can access other host files or network
resources available to that executable. The environment is allowlisted rather than
inherited wholesale, and sensitive argument values are redacted from approval display
and durable output. Shell grammar, PTY support, background jobs, remote execution,
containers, and stronger OS isolation belong to later slices.
