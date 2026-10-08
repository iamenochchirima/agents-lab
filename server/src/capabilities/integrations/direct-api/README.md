# Direct API integrations

`DirectApiClient` is the provider-neutral boundary for a first-party HTTP adapter. Every
request has a stable request ID and may carry an idempotency key. Bounded retries are
limited to documented retryable responses. Each attempt receives a child abort signal so
timeouts and caller cancellation reach the provider adapter. A timeout after a non-read
operation has been dispatched is reported as an unknown outcome and is never silently
repeated.

## Configured hosted HTTP operations

The shared `extensions/connected-sources.ts` adapter binds trusted operation
configuration to this transport. `bindings` maps destination names to top-level
argument names in `path`, `query`, `headers` and `body`. For example:

```json
{
  "name": "assign_ticket",
  "method": "POST",
  "path": "/tickets/{id}/assignment",
  "bindings": {
    "path": { "id": "ticketId" },
    "query": { "notify": "notify" },
    "body": { "owner": "owner" }
  },
  "requestEncoding": "json",
  "idempotency": { "header": "Idempotency-Key" },
  "effectContract": { "rejectionStatusCodes": [409] }
}
```

This fragment omits the required input schema, description and risk class.
Path segments are encoded; paths remain on the configured origin. Bound headers
cannot replace credentials or transport-owned fields. JSON and URL-encoded form
bodies are supported. Omitted bindings preserve legacy GET-query/JSON-body
behavior. Multipart, arbitrary local-file upload paths and general OpenAPI import
are not implemented. Document/file providers can expose bounded content through
connected MCP tools instead.

Credentials resolve immediately before dispatch. An optional provider idempotency
header uses the stable run/turn/call identity, so a resumed call keeps the key.
The host rejects changed arguments for an already reserved call ID. Independently
generated calls have different keys: this does not deduplicate every business
action or establish exactly-once effects.

The generic adapter uses one transport attempt. Reads have no mutation outcome;
write rejections are known only when explicitly listed by a provider-documented
`effectContract.rejectionStatusCodes`. Other HTTP error replies, including 500,
retain unknown effects and stop native continuation. Successful statuses establish
an acknowledgement; `successConfirmsEffect: true` requires a provider contract.
Invalid output after an acknowledged write stays `effect.state=acknowledged`,
`presentation=invalid`, with execution status unknown to require reconciliation
without inviting another write. Original bounded replies and source attempts
remain inspectable. Configure reconciliation reads separately from write retries.

## Explicit cursor and response mapping

A GET operation can configure one page per tool call:

```json
{
  "pagination": {
    "cursorArgument": "cursor",
    "cursorQuery": "after",
    "nextCursorPath": ["paging", "next"]
  },
  "responseMapping": {
    "valuePath": ["result", "records"],
    "requestIdHeader": "X-Provider-Trace"
  }
}
```

Property-path selectors have at most 16 segments. Pagination maps the selected
payload to `{ "value": ..., "nextCursor": ... }`; absent/null next cursor becomes
null. Cursors are strings of at most 2048 characters. The configured output schema
validates this final mapped result. Missing selected payload or invalid next cursor
is a presentation failure, with acknowledged mutation semantics preserved. No
expression evaluation or implicit next-page calls occur; the native model decides
whether to request another page. Original provider payload stays in source evidence.
`requestIdHeader` defaults to `x-request-id`; retained IDs are bounded to 256 characters.
