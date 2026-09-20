# Direct API integrations

`DirectApiClient` is the provider-neutral boundary for a first-party HTTP adapter. Every
request has a stable request ID and may carry an idempotency key. Bounded retries are
limited to documented retryable responses. Each attempt receives a child abort signal so
timeouts and caller cancellation reach the provider adapter. A timeout after a non-read
operation has been dispatched is reported as an unknown outcome and is never silently
repeated.
