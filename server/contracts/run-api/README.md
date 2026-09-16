# Run API contract

The browser communicates with the server through these local HTTP
endpoints. It never connects to Temporal or reads `lab/runs/` directly.

## Platform availability

`GET /api/platforms/<platform-id>/health?variant=<variant>` checks only the selected
platform runner and returns a stable `200` response containing `platform`, `variant`,
`reachable`, and `message`. An unavailable platform is represented as
`reachable: false`; it does not make the browser depend on the aggregate health of
every optional platform service. `GET /health` remains the whole-lab diagnostic and
may return `503` with `status: degraded` when any registered service is unavailable.

## Submit a run

`POST /api/runs`

```json
{
  "platform": "temporal",
  "variant": "baseline",
  "task": { "kind": "prompt", "prompt": "Explain durable execution." },
  "model": {
    "provider": "openrouter",
    "model": "cohere/north-mini-code:free",
    "contextWindowTokens": 256000
  }
}
```

The server writes `config.json` and `RunCreated` before dispatching. A successful
response is `202` and contains the run view. `openrouter` is accepted only when
explicitly enabled by the server profile; the API key remains in the server environment
and is never accepted in this request body.

The `fake` provider is a separate deterministic fixture for automated tests and
deliberate local failure/recovery exercises. For example, a test may send
`{"provider":"fake","model":"fake-timeout"}` to exercise cancellation without
waiting on or paying for an external provider. The browser UI does not expose fake
models and the server never substitutes one when an OpenRouter request fails.

## Inspect and poll

`GET /api/runs/<run-id>` returns the server-derived status, safe manifest, normalized
events, the selected platform's opaque execution reference, and terminal evidence when
available. The reference has `platform`, `variant`, `executionId`, and a safe `native`
object. The server does not interpret the native object's platform-specific fields.

The response also contains `projection`:

```json
{
  "state": "current",
  "observedAt": "2026-09-16T12:00:00.000Z",
  "reason": null
}
```

When a platform or local evidence write is temporarily unavailable, `state` is
`stale`, the response keeps the last durable status/events/result, and `reason`
contains a bounded safe explanation. A stale response is not evidence that the
platform has reached that status; poll again after the dependency recovers.

If the platform accepted a submission but the server could not retain its native
execution reference, the initial response remains a stale `queued` view without a
terminal result. It is not reported as `DISPATCH_FAILED`, because the platform may
already be running it. If the reference cannot be recovered, a later inspection
reports `reconciliation_required` for operator recovery.

`GET /api/runs/<run-id>/events?after=<recorded-sequence>&limit=<1-500>` is a bounded
polling endpoint. Start with `after=0`, append returned events in order, and use the
returned `nextSequence` for the next request. Continue while `hasMore` is true. A
terminal result makes `done` true. Refreshing or reconnecting should read the run
view again rather than infer state from the browser.

## Cancel

`POST /api/runs/<run-id>/cancel`

```json
{ "reason": "Stop this run." }
```

Cancellation is forwarded to the selected platform runner. Repeating the request after
a terminal result is safe and returns the terminal run rather than changing it.

## Evidence

`GET /api/runs/<run-id>/evidence/<file>` exposes only these files:

```text
config.json
events.jsonl
trajectory.json
metrics.json
result.json
native/<platform>.json
```

Unknown files and arbitrary paths are rejected. API errors use
`{ "error": { "code": string, "message": string } }`; messages never include
credentials or raw provider responses.
