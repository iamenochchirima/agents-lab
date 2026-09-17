# LangGraph baseline playground

This is a hands-on walkthrough for understanding one real LangGraph slice. It
is separate from `tests/`, `scenarios/`, and `experiments/`: the goal is to let
a contributor inspect the graph, protocol, SQLite file, and restart semantics.

## 1. Install the platform environment

```bash
cd server/src/platforms/langgraph
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
```

Use any Python 3.11 or 3.12 interpreter with the `sqlite3` module enabled if
the host uses a different command name. The baseline has no in-memory fallback.

## 2. Start the Python service

From the repository root:

```bash
export PYTHONPATH="$PWD/server/src/platforms/langgraph"
export AGENTLAB_LANGGRAPH_STATE_DIR="$PWD/server/src/platforms/langgraph/.local"
server/src/platforms/langgraph/.venv/bin/python -m uvicorn \
  service.app:app --host 127.0.0.1 --port 2024
```

## 3. Run one fake prompt

```bash
curl --fail --silent --show-error \
  -X POST http://127.0.0.1:2024/v1/runs \
  -H 'content-type: application/json' \
  --data '{"runId":"playground-run","prompt":"Explain why checkpoints matter.","systemInstruction":"Answer directly.","model":{"provider":"fake","model":"fake-success"},"graph":"baseline","threadId":"playground-run","durability":"sqlite-sync","maxAttempts":2,"timeoutMs":30000}'

curl --fail --silent --show-error \
  http://127.0.0.1:2024/v1/runs/langgraph%3Aplayground-run
```

Look at these fields in the inspection response:

- `events`: the service's ordered projection of graph start, model call, graph
  update, and checkpoint observations;
- `checkpoint`: the latest native checkpoint ID and step; and
- `metrics`: counts derived from the platform event log.

The model output is deterministic and does not require an API key.

## 4. Observe persistence

The SQLite file is:

```text
server/src/platforms/langgraph/.local/langgraph.sqlite
```

The `checkpoints` and `writes` tables belong to LangGraph's SQLite checkpointer.
The `service_runs` and `service_events` tables belong to the Lab's platform
service. Neither table is the normalized `lab/runs/` evidence store.

## 5. Observe restart semantics

Start a run with `fake-cancel`, stop the service while it is waiting, and start
the service again with the same state directory. The previous record is exposed
as `unknown` with `SERVICE_RESTARTED`. This is deliberate: a checkpoint proves
state was written, not that a provider call did not happen or that the run can
be resumed safely.

Run the automated service-process version of this observation with:

```bash
AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 \
AGENTLAB_LANGGRAPH_PYTHON="$PWD/server/src/platforms/langgraph/.venv/bin/python" \
pnpm --filter @agent-harness-lab/lab-server run build && \
AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 \
AGENTLAB_LANGGRAPH_PYTHON="$PWD/server/src/platforms/langgraph/.venv/bin/python" \
node --test server/dist/integration-tests/langgraph-baseline.test.js
```

The integration test starts the real platform-local Uvicorn service on a
temporary loopback port, uses a temporary SQLite directory, and removes that
directory when it exits. It covers a fake completion, a bounded retry, active
cancellation, service unavailability after shutdown, and a hard service restart
that turns an interrupted execution into an unknown/reconciliation-required
result. It does not start the shared TypeScript Lab server because registration
is a primary-integration handoff outside this platform-owned scope.

The playground does not claim hosted LangGraph deployment, Postgres durability,
automatic recovery, tools, or exactly-once model execution.
