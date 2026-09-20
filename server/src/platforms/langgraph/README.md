# LangGraph platform

Status: baseline implementation and shared server registration complete. LangGraph is
advertised as runnable when the Lab server starts, but it reports unavailable until the
platform-local Python service is running.

This directory contains the Lab's first real Python LangGraph baseline. It is a local learning and comparison profile, not LangGraph Platform, LangSmith Deployment, or a production persistence recommendation.

## Boundary

```text
Lab server / generic runner seam
  -> runner-adapter/ (TypeScript HTTP adapter)
  -> service/ (FastAPI process and SQLite service records)
  -> variants/baseline/ (real LangGraph StateGraph)
  -> LangGraph SQLite checkpointer
```

The TypeScript adapter is the only part that knows the generic runner contract. The Python service owns graph execution, thread checkpoints, event sequencing, model calls, cancellation requests, and native execution state. The Lab server remains the sole writer of `lab/runs/<run-id>/` after the adapter projects that state through the common evidence store.

The Platform UI selects an OpenRouter model from the shared server catalog. The
Python graph service receives only the provider/model selection and reads the
provider key from its process environment.

The shared server resolves the selected capability profile before dispatch. The
`local-safe` profile enables the bounded `calculator` tool and the read-only
`fixture_lookup` connection, and adds the `research-summary` skill as untrusted
context. The `local-write-approved` profile also declares `fixture_write`, but
the server does not enable it unless the request contains a matching, unexpired
approval. The browser can select a profile but cannot add capabilities, widen
the allowlist, or provide credentials. LangGraph receives the resulting
`enabledNames` and `approvedNames` as part of the platform-local request.

Connection-backed tools use the shared opaque reference `conn_local_fixture`. In the full
local stack, `AGENTLAB_LOCAL_FIXTURE_URL` points the Python service at the separate local
fixture process (normally `http://127.0.0.1:9191`). The service sends bounded lookup and
write requests across that HTTP boundary, preserves the stable request/idempotency key,
and records only redacted connection evidence. If the fixture is unavailable, the graph
reports a failed read or an unknown write outcome; it does not silently use a different
provider. Direct graph unit tests may use the explicit in-process compatibility fixture,
which is not the production-shaped service path.

The platform-local protocol is defined in [`protocol/`](protocol/) and is validated independently by Pydantic and TypeScript. `runId` remains the stable Lab identity for one turn, while a Lab `sessionId` maps to one bounded hashed LangGraph `thread_id` for the conversation. `clientTurnId` makes one session turn retryable without starting a second graph execution. A checkpoint ID, graph run ID, and node task ID remain separate native details.

The TypeScript server defaults to `http://127.0.0.1:2024`; override it with
`AGENTLAB_LANGGRAPH_SERVICE_URL` when the Python service runs elsewhere. Both
processes must share `AGENTLAB_CONTEXT_ROOT` (the local stack sets this to
`lab/sessions`). Before dispatch, the TypeScript adapter prepares the Lab-owned
context snapshot and sends its session, turn, snapshot identity, compaction revision,
and context-window metadata through the protocol. It does not copy the prepared
message list into native metadata. The Python service loads the immutable snapshot,
rejects stale metadata, and reports the same budget and compaction metadata in its
native events.

```bash
cd server/src/platforms/langgraph
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock
AGENTLAB_CONTEXT_ROOT="$PWD/../../../../lab/sessions" uvicorn service.app:app --host 127.0.0.1 --port 2024
```

Use any Python 3.11 or 3.12 interpreter with its SQLite module enabled. If the
interpreter is named differently on the host, substitute that command for
`python3.11`; the service must not silently fall back to in-memory state.

The real-provider integration is opt-in because it makes two model requests and may
consume provider quota. With an ignored `server/.env` containing the local
`OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL`, run:

```bash
AGENTLAB_RUN_LANGGRAPH_OPENROUTER=1 \
  pnpm --filter @agent-harness-lab/lab-server exec tsx --test integration-tests/langgraph-baseline.test.ts
```

The test uses a temporary SQLite database and context directory, sends two turns
through the same LangGraph thread, and removes the temporary state afterward. It is
not part of the default test command.

## Runtime facts

The locked baseline currently uses:

- Python `>=3.11,<3.13` (verified runtimes are Python 3.11.16 and 3.12.3).
- `langgraph==1.2.10`.
- `langgraph-checkpoint-sqlite==3.1.1`.
- FastAPI `0.141.1` and Uvicorn `0.53.0` for the platform-local HTTP seam.

The launcher-selected local environment was verified with Python 3.11.16 and SQLite
3.53.1. A clean Python 3.12.3 virtual environment was also verified with SQLite 3.45.1.
The unrelated `/usr/local` Python 3.12.1 build does not expose `_sqlite3`, so the
launcher skips it and selects a working interpreter instead.

The complete resolved environment is in [`requirements.lock`](requirements.lock). The baseline uses LangGraph's versioned `v2` stream parts for updates, tasks, and checkpoints. It does not claim token streaming for the raw OpenRouter request path.

## Native semantics

- SQLite checkpoints persist graph state across service process restarts when a checkpoint was written.
- The service's own run registry and redacted event log use the same SQLite file, but they are not the Lab's normalized evidence store.
- The graph has a `model` node and a bounded `tools` node. The effective tool set
  comes from the server-resolved capability profile: `calculator` is a pure local
  tool, `fixture_lookup` reads deterministic provider-shaped local data, and
  `fixture_write` is a write-shaped fixture used to exercise approval handling.
  The fixture tools do not connect to an external provider. Tool names, arguments,
  limits, and approval are validated again at the Python execution boundary.
- A run using `local-safe` can read `alpha` from `fixture_lookup` and receives the
  bounded local fixture value. It cannot invoke `fixture_write`. A write-capable
  request without `fixture_write` in `approvedNames` is rejected with
  `APPROVAL_REQUIRED` before execution; a request with the matching approval
  receives the deterministic fixture acknowledgement. This is a policy and
  boundary test, not evidence of an external write or exactly-once side effect.
- The graph consumes a Lab-prepared context snapshot for normal server runs. The
  snapshot contains the exact messages, token budget, pressure, and compaction record
  used for the request. When its compaction revision advances, the graph replaces the
  older native checkpoint transcript before entering the next model node; unchanged
  revisions continue from the checkpoint. Direct service callers without a snapshot
  use an explicitly retained canonical-transcript compatibility path and are reported
  as `estimated`.
- The LangGraph checkpoint remains platform-native execution state. It does not replace
  the Lab context snapshot or become a second long-term memory store.
- Fake models are deterministic test fixtures. OpenRouter runs use the selected
  catalog model through the Python process environment, and its API key never
  crosses the JSON seam.
- The `fake-slow-success` fixture is reserved for process-replacement acceptance: it
  waits briefly, remains cancellable, and then completes without an external side
  effect. It is not a production model profile.
- Node retries are bounded. A retried model call can be duplicated; the baseline does not claim exactly-once model execution.
- Cancellation is cooperative. A process restart that interrupts an active run produces `unknown` and requires reconciliation rather than fabricated success or failure.

## Related docs

- [`docs/README.md`](docs/README.md) — implementation and semantics notes.
- [`runner-adapter/README.md`](runner-adapter/README.md) — TypeScript seam.
- [`variants/baseline/README.md`](variants/baseline/README.md) — graph scope.
- [deployment profile](../../../deployments/platforms/langgraph/README.md) — local operation.
- [development playground](../../../../development/playground/langgraph-baseline/README.md) — hands-on walkthrough.
