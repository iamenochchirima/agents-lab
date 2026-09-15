# models

Owns provider/model wiring for the Activity worker. `fake-success`, `fake-failure`,
`fake-retry-once`, and `fake-timeout` are deterministic local controls; OpenRouter is
opt-in and reads its key only from the service process environment.
