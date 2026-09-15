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

The platform-local protocol is defined in [`protocol/`](protocol/) and is validated independently by Pydantic and TypeScript. It uses `runId` as the stable Lab identity and LangGraph `thread_id` as the checkpoint identity. A checkpoint ID, graph run ID, and node task ID remain separate native details.

The TypeScript server defaults to `http://127.0.0.1:2024`; override it with
`AGENTLAB_LANGGRAPH_SERVICE_URL` when the Python service runs elsewhere. Start the
service from the repository root with:

```bash
cd server/src/platforms/langgraph
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock
uvicorn service.app:app --host 127.0.0.1 --port 2024
```

Use any Python 3.11 or 3.12 interpreter with its SQLite module enabled. If the
interpreter is named differently on the host, substitute that command for
`python3.11`; the service must not silently fall back to in-memory state.

## Runtime facts

The locked baseline currently uses:

- Python `>=3.11,<3.13` (the verified local runtime was Python 3.12.3).
- `langgraph==1.2.10`.
- `langgraph-checkpoint-sqlite==3.1.1`.
- FastAPI `0.141.1` and Uvicorn `0.53.0` for the platform-local HTTP seam.

The complete resolved environment is in [`requirements.lock`](requirements.lock). The baseline uses LangGraph's versioned `v2` stream parts for updates, tasks, and checkpoints. It does not claim token streaming for the raw OpenRouter request path.

## Native semantics

- SQLite checkpoints persist graph state across service process restarts when a checkpoint was written.
- The service's own run registry and redacted event log use the same SQLite file, but they are not the Lab's normalized evidence store.
- The first graph has one `model` node and no tools or external side effects.
- Fake models are deterministic. OpenRouter is opt-in through the Python process environment and its API key never crosses the JSON seam.
- Node retries are bounded. A retried model call can be duplicated; the baseline does not claim exactly-once model execution.
- Cancellation is cooperative. A process restart that interrupts an active run produces `unknown` and requires reconciliation rather than fabricated success or failure.

## Related docs

- [`docs/README.md`](docs/README.md) — implementation and semantics notes.
- [`runner-adapter/README.md`](runner-adapter/README.md) — TypeScript seam.
- [`variants/baseline/README.md`](variants/baseline/README.md) — graph scope.
- [deployment profile](../../../deployments/platforms/langgraph/README.md) — local operation.
- [development playground](../../../../development/playground/langgraph-baseline/README.md) — hands-on walkthrough.
