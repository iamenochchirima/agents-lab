# Studio API

Studio's independent HTTP host runs the versioned reference assembly from
`studio/assemblies/reference-agent/`. The browser submits text and inspects the
safe response projection over HTTP. It never imports or runs module packages.

## Run locally

```sh
pnpm --filter @agent-harness-lab/studio-api dev
pnpm --filter @agent-harness-lab/web dev
```

Or run both together with `./scripts/run_local_stack.sh studio`. Open `/studio`
and choose **Open assembly chat**. The API listens on `127.0.0.1:4320` by default
and permits `http://localhost:5173` as its web origin. Configure
`STUDIO_API_HOST`, `STUDIO_API_PORT`, `STUDIO_API_WEB_ORIGIN`,
`STUDIO_RUNS_ROOT`, or `VITE_AGENTLAB_STUDIO_API_URL` to change those defaults.

`STUDIO_RUNS_ROOT` defaults to the repository's `lab/runs/` directory. The host
creates a private `run-<run-id>/` directory containing `config.json`,
`events.jsonl`, and `result.json`. Input text, Context messages, and module
evidence are stored without redaction for local inspection. Keep the root private
and remove run folders when they are no longer needed. JSONL append, recovery, and
sync behavior is described in the Observability module documentation.

The chat API has no authentication and is for local development. Do not expose it
to an untrusted network.

## Chat endpoints

- `GET /health` returns the API host's identity.
- `GET /chat/assembly` returns the fixed assembly descriptor, all twelve selected
  implementations/configurations, and known limitations.
- `POST /chat/turns` accepts `{ conversationId, requestId, text, remember }`.
  The host creates source IDs, timestamps, and untrusted provenance. `requestId`
  is an idempotency key within the active process; `remember` requests a
  Safety-checked session Memory write after a successful turn.
- `POST /chat/scenarios/calculator/turns` runs the fixed `19 + 23` action scenario.
- `POST /chat/scenarios/computer/turns` clicks one named element in the controlled
  fixture page and returns before/after evidence.
- `DELETE /chat/sessions/:conversationId` closes and clears session Memory.

Scenario routes accept only a conversation ID and request ID; clients cannot
change the task or action arguments. Free-text requests use deterministic Replay,
except the two exact fixture task strings, which route to their fixed scripted
round trips.

Successful responses pair each Context result with the exact Model Interface
request and response. They include Memory decisions, planning proposal, action and
Safety receipts, Control observations, and the Observability append/flush status.
Persistence can be `durable`, `partial`, `failed`, or `unknown`; a successful chat
response does not imply that every run artifact reached durable storage. The
browser displays the persistence receipts and never receives local filesystem
paths. Failed turns return accumulated partial evidence when available and write a
terminal result record when the run directory remains writable.

## Run and session behavior

The host writes `config.json` before executing a turn, then the kernel generates
ordered protocol events and the JSONL recorder appends and flushes them. The host
writes `result.json` after success or a handled failure. Kernel event IDs,
sequences, timestamps, and module source identities are recorded with normalized
events and module-specific detail. Recorder receipts—not a successful model call—
determine the reported durability status. Events are written after the turn's
terminal path is known; they are not streamed while a run is active.

Memory and chat history are in process memory. API restart clears both. Each
session retains at most 80 prior user/assistant messages; the host keeps at most
32 sessions and 64 completed request IDs per session, evicting the least-recently
used idle session when needed. These caches do not provide durable idempotency
across restart or run resumption.

Browser disconnect cancels work that has not started and requests an evidence
flush. Cancellation cannot undo an already completed Environment operation. The
reference Environment only performs fixture arithmetic and changes an in-process
fixture page; it has no filesystem, process, desktop, browser, or network access.
No external LLM is called.

The API declares Fastify and `@fastify/cors` directly. It has no dependency on
`server/` or the Platform Lab runtime.
