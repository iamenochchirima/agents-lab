# Run API contract

The browser communicates with the control plane through these local HTTP
endpoints. It never connects to Temporal or reads `lab/runs/` directly.

## Submit a run

`POST /api/runs`

```json
{
  "platform": "temporal",
  "variant": "baseline",
  "task": { "kind": "prompt", "prompt": "Explain durable execution." },
  "model": { "provider": "fake", "model": "fake-success" }
}
```

The server writes `config.json` and `RunCreated` before dispatching. A successful
response is `202` and contains the run view. The fake model is deterministic;
`openrouter` is accepted only when explicitly enabled by the server profile.

## Inspect and poll

`GET /api/runs/<run-id>` returns the server-derived status, safe manifest, normalized
events, native Temporal reference, and terminal evidence when available.

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

Cancellation is forwarded to the Temporal workflow. Repeating the request after a
terminal result is safe and returns the terminal run rather than changing it.

## Evidence

`GET /api/runs/<run-id>/evidence/<file>` exposes only these files:

```text
config.json
events.jsonl
trajectory.json
metrics.json
result.json
native/temporal.json
```

Unknown files and arbitrary paths are rejected. API errors use
`{ "error": { "code": string, "message": string } }`; messages never include
credentials or raw provider responses.
