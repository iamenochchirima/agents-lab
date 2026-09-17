# Session boundary

The first Temporal baseline uses the common file-backed session store rather than
Temporal workflow history as its canonical conversation record. `RunService` admits
one user turn with a stable session ID and run ID before dispatch. The store rejects a
second active turn for the same session, repairs a crash after the user message but
before the turn record, and appends the assistant result exactly once by turn ID.

The platform-specific adapter receives only the session/turn identity and context
snapshot reference. This directory remains the reading point for Temporal-specific
session lifecycle notes; the storage implementation belongs in
`server/src/capabilities/context/session-store.ts`.
