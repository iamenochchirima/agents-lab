# Sustained execution policy

A run can opt into `execution: { mode: "sustained" }` at admission. The manifest
records an absolute deadline, defaulting to one hour, and a per-model timeout,
defaulting to 60 seconds. Requests can lower duration or configure a model timeout
up to five minutes. Tool timeout and exact-action approval remain separate limits.
Approval waiting counts toward the task deadline. Resume does not reset it.

The pure helpers do not schedule execution. Each native adapter applies the deadline
at its own step and wait boundaries. A run without this field retains legacy policy.
Tool-round/call budgets remain explicit capabilities settings; the chat sustained
option uses 24 rounds and 48 dispatched calls. Per-tool limits are never increased
by enabling sustained execution. No credentials are retained in this policy.
