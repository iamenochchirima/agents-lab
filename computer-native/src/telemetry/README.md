# Telemetry

Owns native diagnostics and adapts relevant events to the future Lab runner protocol.

The first slice records `TurnStarted`, `ModelRequested`, per-attempt
`ModelAttemptCompleted`, `ModelRetryScheduled`, `ModelCompleted`, process and browser
approval/start/completion events when those capabilities are used, browser artifact
metadata events, and one terminal event: `TurnCompleted`, `TurnFailed`, `TurnCancelled`,
or `TurnInterrupted`. Every event carries a session ID, turn ID, sequence number,
timestamp, and redacted payload. Browser lifecycle payloads retain action identity,
outcome status, and managed artifact metadata without persisting page pixels, downloaded
contents, cookies, or typed secrets.
