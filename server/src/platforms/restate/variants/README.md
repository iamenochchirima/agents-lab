# Restate harness variants

Each variant owns a concrete Restate composition and its lifecycle semantics. The
`baseline` variant is intentionally narrow: one keyed Workflow, a durable model step,
and the shared bounded capability boundary. It can execute the pure calculator and the
local read/write fixture when the resolved profile and approval permit them. MCP, OAuth,
and direct API protocol behavior is implemented in `server/src/capabilities/` and is
currently exercised through local protocol tests; adding provider-specific services,
virtual objects, signals, or richer agent behavior requires its own plan.
