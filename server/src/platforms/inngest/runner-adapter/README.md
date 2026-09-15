# Lab runner adapter

`inngest-runner.ts` adapts the generic `PlatformRunner` interface to the
platform-owned Inngest service. It does not import the Inngest SDK or write common
run evidence.

The retained native reference contains the Lab run ID, event deduplication ID,
returned event ID when known, function run ID when observed, submission
acknowledgement state, status, retry count, and cancellation flag. If the service
or Dev Server is temporarily unavailable, inspection raises an availability error
so the common server can preserve its last projection. It does not turn an unknown
outcome into a fabricated result.
