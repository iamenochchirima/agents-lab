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

## Manual system comparison notes

The Studio comparison table stores independent user-authored cell items in SQLite,
using Node's built-in `node:sqlite` API. Use Node 22.13+ in the 22.x line or
Node 23.4+. No database service or additional package is required. The default file
is `lab/state/studio.sqlite`; set `STUDIO_DATABASE_PATH` to another file path.
Relative overrides resolve against the API process's working directory.

- `GET /comparison` returns `{ items: [{ id, category, agent, text }] }`.
- `PUT /comparison/items/:id` accepts exactly `{ category, agent, text }` and returns
  `{ item }`. Repeating a PUT updates that item without replacing other items.
- `DELETE /comparison/items/:id` returns 204, including when the item is absent.
- `POST /comparison/import` accepts `{ items: [...] }` and returns `{ imported }`.
  The entire import commits in one transaction. Existing IDs remain unchanged;
  retrying an import cannot replace a newer database edit.

Categories are the nineteen fixed study topics; agents are `hermes`, `openclaw`,
`pi`, and `waku`. IDs must contain 1–200 characters without control characters;
text may be empty and is limited to 20,000 characters. Imports require unique IDs,
at most 5,000 items, and a body under 16 MiB. Invalid bodies receive 400; oversized
bodies receive 413. Database failures receive 503 and never claim a successful
save. Server logs retain diagnostic details without returning local paths.

Each API instance owns and closes its database connection. WAL journaling, FULL
synchronous commits, and a five-second busy timeout support local persistence.
Successful mutation replies follow SQL commit, so an API restart preserves notes.
Lost acknowledgements can be retried with the same ID. Concurrent edits to the
same item use the last committed write; this API has no revision conflict checks,
user accounts, or per-user separation. Notes share one workspace database and do
not alter agent runtime state, chat history, or experiment evidence.

The browser's import preserves legacy drafts rather than deleting them. The
database and WAL/SHM sidecars are local state and must stay out of version control.
For a backup, stop the API before copying the SQLite file (copying a live file
without its outstanding WAL can omit committed notes). Node may emit an
experimental SQLite warning on supported releases. This change uses focused
TypeScript compilation and source inspection; it does not establish crash or
concurrency guarantees through fault injection.

## Lina architecture draft

Lina's authoring page saves a single workspace architecture document in the
`lina_architecture` table, in the same SQLite file configured by
`STUDIO_DATABASE_PATH`. It has its own connection with WAL journaling, FULL
synchronous commits and a five-second busy timeout; the connection closes with
the API. This is local disk persistence, not hosted storage or a cloud backup.
The document is a user-authored design, not an executable agent or run evidence.
The database starts with revision 0 and a null document; no architecture is seeded.

- `GET /lina` returns `{ revision, document }`.
- `PUT /lina` accepts exactly `{ revision, document }` and returns the committed
  `{ revision, document }` with revision incremented by one.
- Documents contain exactly `{ version: 1, nodes: [...], edges: [...] }`.
  Nodes contain `id`, `title`, `area`, `status`, `x`, `y`, `purpose`, `inputs`,
  `outputs`, `decisions`, `references`, and `experiments`. All are strings except
  finite numeric coordinates. Status is `proposed`, `studying`, or `decided`.
  Edges contain string `id`, `source`, `target`, and `label` fields.

The PUT revision must match the current database revision. The check and document
replacement happen in one transaction. A stale revision receives 409 with
`error`, `message`, and the current `revision` and `document`; it never overwrites
the newer architecture. A lost acknowledgement requires GET reconciliation
before retrying: repeating a PUT with an old revision conflicts, even when the
previous write succeeded. This API does not merge concurrent drafts.

The body limit is 2 MiB, with at most 500 nodes and 2,000 edges. IDs are 1–200
characters without control characters and must be unique within their respective
collections; edge endpoints must identify existing nodes. Titles are nonblank
and limited to 200 characters, areas to 100, detail fields to 20,000 each, and
edge labels to 500. Coordinates must fall within ±1,000,000. Invalid documents
receive 400 and oversized requests receive 413. Storage failures receive safe
503 errors; logs retain diagnostics and no successful save is claimed. Like the
comparison API, this workspace document has no authentication or user separation.

## Context retention experiment

`POST /context-experiments` runs the versioned `old-important-fact-v1` fixture with
both statically registered Context strategies. The request body is:

```json
{
  "apiVersion": "1",
  "comparisonId": "<UUID>",
  "caseId": "old-important-fact-v1",
  "maxRecentMessages": 4
}
```

The API rejects unknown fields, unsupported versions, malformed UUIDs, window sizes
outside 1–12, and bodies larger than 4 KiB. It always runs the budget-fitted
baseline first and the fixed recent-message window second. Each run gets a fresh
Memory session whose session ID is recorded in `config.json`; both runs share the
task, six prior messages, deterministic Replay model, token budget, and remaining
reference assembly. The config is written before execution and retains
`finishedAt: null`; each terminal `result.json` records its actual `finishedAt`
timestamp for recovery and inspection.

`GET /context-experiments/:comparisonId` reopens the safe comparison projection.
The UUID is a durable idempotency key: an identical POST joins an active operation
or returns saved evidence; reuse with a different request returns
`409 COMPARISON_ID_REUSED`. Use a fresh ID to create a new attempt after failure,
cancellation, interruption, or uncertain persistence. The API aborts the active
variant only after every attached POST caller disconnects.

Under `STUDIO_RUNS_ROOT`, the API writes
`context-comparisons/<comparison-id>/comparison.json` and ordinary
`run-<run-id>/config.json`, `events.jsonl`, and `result.json` artifacts. Comparison
manifests use private directories and files, atomic replacement, file and directory
sync, strict schema checks, no-follow reads, and size limits. Each run ID is
committed before its run starts. A later API instance reconciles a stale `running`
manifest from known terminal result files; missing or unreadable evidence remains
`interrupted` or `unknown`, and the API never resumes the run automatically. One API
process may write a runs root at a time.

The result retains normal Studio turn evidence, including model messages, Context
source dispositions, token estimate basis, and Observability receipts. An
Observability receipt of `partial` or `unknown` remains visible without changing the
turn's completion status. Replay emits request diagnostics; the experiment does not
grade answer quality or claim semantic retrieval. See the
[`context-retention experiment`](../../lab/experiments/context-retention/README.md)
for its controls and interpretation limits.
