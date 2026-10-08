# Connected tools and native business agents

Status: accepted for the four baseline implementations. Date: 2026-10-08.

Each platform keeps its own model decisions, tool batching, waiting and continuation.
The shared capability host owns source adapters, final permission checks and durable
call receipts. This boundary is required because TypeScript and Python workers must
execute the same admitted source semantics without duplicating credential handling.
A shared agent loop was rejected because it would erase the behavior being studied.

HTTP and MCP are source adapters. Trusted package configuration supplies schemas,
request bindings, approval modes and provider effect contracts. Skills supply
procedures and context, never credentials or permission. Executable plugin loading
and local process installation are outside this milestone.

Agent file access belongs to an optional separately running document provider.
The core package loader rejects legacy native workspace declarations with migration
instructions. Internal configuration, skill resources, checkpoints and evidence may
still use files. A shared VM or native shell is unnecessary for a business agent.

Connection identity binds owner, resource and permitted scopes. The admitted catalog
freezes that authority and the source schema, while credentials resolve at dispatch.
Token rotation does not change identity. Revocation or changed authority blocks old
admissions rather than silently rebinding them. Catalog refresh is atomic for future
runs; retained run snapshots remain immutable.

Permission to propose an action differs from approval to execute it. Invocation
review retains the exact call and argument digest before effects, then suspends the
native agent. The final host check serializes decision, cancellation and dispatch
reservation in this single-host deployment. It is not a distributed lease. Renewal
requires a fresh review revision and updates the native waiter without executing or
asking the model to repeat its decision.

Execution status, effect certainty and response validity remain separate. An error
reply or malformed response does not prove a write had no effect. Unknown effects
stop native continuation for reconciliation. Same-call receipt replay prevents repeat
dispatch of that call; independently generated call IDs are different operations.
Provider idempotency is explicit, and exactly-once effects are not claimed.

This design adds an authenticated host dependency and platform-specific approval
integration. It preserves framework telemetry alongside normalized run evidence.
The compatibility matrix and experiments must state which transports, native
recovery boundaries and result projections were actually verified.

See the [implementation plan](../../development/implementation-plans/platforms/active/connected-business-agent-tools.md)
and [research evidence](../research/connected-business-agent-foundation.md).
