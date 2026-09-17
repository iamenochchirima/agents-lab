# Telemetry

Owns native diagnostics and adapts relevant events to the future Lab runner protocol.

The first slice records `TurnStarted`, `ModelRequested`, per-attempt
`ModelAttemptCompleted`, `ModelRetryScheduled`, `ModelCompleted`, process and browser
approval/start/completion events when those capabilities are used, browser artifact
metadata events, workspace mutation proposal/approval/application/progress/completion
events, and one terminal event: `TurnCompleted`, `TurnFailed`, `TurnCancelled`, or
`TurnInterrupted`. Every event carries a session ID, turn ID, sequence number, timestamp,
correlation ID, and redacted payload. The correlation ID links TUI events, model attempts,
rounds, tool actions, and durable records for one turn without replacing their specific
operation identities. Workspace lifecycle payloads retain action identity, resolved path,
hashes, effective limits, and bounded journal state; full diffs remain in the mutation
record. Browser lifecycle payloads retain action identity, outcome status, and managed
artifact metadata without persisting page pixels, downloaded contents, cookies, or typed
secrets.
