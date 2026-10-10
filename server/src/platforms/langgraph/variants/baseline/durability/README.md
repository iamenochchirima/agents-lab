# Durability

The local service owns admission and restart classification. LangGraph owns
graph scheduling, approval interruption and checkpoint recovery. The service uses
an exclusive local file lock on the state directory; a second process fails
startup instead of executing the same run concurrently. SQLite and this lock
do not establish distributed worker coordination.

For an admitted `execution.mode: "sustained"` run, restart reads the retained
request and original thread checkpoint. Every model, summary and tool call records
an operation intent before I/O. Recovery requires the checkpoint to belong to the
same Lab run and to contain any recorded operation: a completed model round,
summary revision, or matching tool-result identity and call count. Recovery passes
`None` to the native graph, preserving the original prompt, messages, call IDs,
counters and start time. It never submits a new user turn.

An unowned/missing checkpoint or an operation missing from checkpoint state becomes
`unknown` with `LANGGRAPH_RECOVERY_RECONCILIATION_REQUIRED`. A tool receipt or
approval alone is insufficient proof of checkpoint completion. External writes
remain subject to provider idempotency and reconciliation; no exactly-once effect
guarantee follows from checkpoint replay.

Retained cancellation prevents safe recovered work from restarting. The absolute
deadline never renews during resume or restart. A service timer expires suspended
approval waits; active nodes check the deadline and cancellation at native
boundaries. Blocking external clients still depend on their request timeout, so
deadline cancellation is cooperative. An unresolved interrupted operation takes
precedence over a cancellation or expiry claim when its external result is unknown.

Legacy runs without the sustained policy keep the existing conservative unknown
state after active process interruption. Suspended review checkpoints remain
explicitly resumable. Graceful shutdown requests cooperative cancellation and
drains workers; restart recovery targets abrupt loss, not a new retry policy for
terminal failures.

Validation: `service/tests/test_sustained_recovery.py` seeds retained native
checkpoints at controlled boundaries and tests safe continuation, unresolved
model/tool/summary outcomes, retained cancellation, expiry and exclusive ownership.
These fixtures are deterministic restart classification tests, not evidence of
distributed durability or successful provider side effects.

The bounded recovery diagnostics endpoint also returns `ownedRuns`, including
checkpoint identity, eligibility and reason. It can show a safe checkpoint,
waiting review, legacy policy, cancellation, expiry or required reconciliation.
This is a read-only snapshot of recovery safety; it cannot start a second worker
for an already active execution. Running state and checkpoints can advance while
an operator reads it. `unknown` owners keep the attention status even when they
have checkpoint rows, because storage alone cannot resolve their external outcome.
