# Telemetry

Owns native diagnostics and adapts relevant events to the future Lab runner protocol.

The first slice records `TurnStarted`, `ModelRequested`, `ModelCompleted`, and one
terminal event: `TurnCompleted`, `TurnFailed`, `TurnCancelled`, or `TurnInterrupted`.
Every event carries a session ID, turn ID, sequence number, timestamp, and redacted
payload.
