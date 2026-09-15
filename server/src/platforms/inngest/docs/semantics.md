# Inngest baseline execution semantics

## Lifecycle

```text
admit local projection
  -> send idempotent Inngest event
  -> function starts
  -> durable model step
  -> terminal projection
  -> runner reconciliation
```

The service persists a native projection in its configured local data directory.
The common Lab evidence store is deliberately outside this directory and remains
the only writer of normalized `lab/runs/<run-id>/` records after shared registration.

## Retries and lost acknowledgements

The baseline configures a bounded function retry count. `fake-retry` fails before
dispatch on attempt zero and succeeds on the next attempt. A provider result that
was already sent is represented as `outcome_unknown` rather than being retried by
the model adapter.

The event deduplication ID is stable for the Lab run. If the send response is lost,
the service stores `submissionOutcome: "unknown"`; a repeated dispatch reuses the
same ID and records the returned event ID as reconciliation. Inngest's documented
deduplication window is 24 hours, so long-term Lab identity comes from the retained
run reference and evidence, not from the Inngest event ID.

The local JSON projection uses atomic replacement and idempotent event keys. A
service restart reloads the projection. If an Inngest function is replayed, repeated
projection writes with the same logical key do not append duplicate native events.

## Cancellation

`POST /runs/:runId/cancel` sends `agentlab/run.cancelled` with a matching `runId`.
The function uses the official `cancelOn` configuration and the service registers a
handler for `inngest/function.cancelled`. Cancellation is therefore asynchronous.
Inngest documents that cancellation occurs between step boundaries; an active step
may finish. The local state records a cancellation request before sending the event
and records a terminal cancelled result only when the cancellation projection is
observed.

If the cancellation acknowledgement is lost, the service returns an unknown
acknowledgement but keeps the same cancellation event ID for retry. It does not
claim that the function stopped.

## Scope and limitations

- The baseline does not claim exactly-once execution or exactly-once model calls.
- The local Dev Server is not a production deployment. Its persistence and execution
  behavior differ from hosted Inngest.
- Orphan adoption is intentionally absent: a run not present in the local projection
  is not adopted from an arbitrary function run.
- The platform service owns only safe metadata. Prompts and provider credentials are
  not stored in its native JSON state.
- OpenRouter is optional and reads `OPENROUTER_API_KEY` only from the service process.
  Network ambiguity is terminal `outcome_unknown`, not a blind retry.
- Tools, memory, skills, MCP, OAuth connections, plugins, multi-turn sessions, and
  external side effects are deferred to later variants.
