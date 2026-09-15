# LangGraph local deployment profile

This profile runs the platform-local Python service. It does not start
`langgraph dev`: the official development server is in-memory and is not the
SQLite service used by this Lab baseline.

## Requirements

- Python 3.11–3.12 with SQLite support.
- A virtual environment created from `server/src/platforms/langgraph/pyproject.toml`.
- The locked dependencies in `server/src/platforms/langgraph/requirements.lock`.
- The TypeScript Lab server only after the primary integration agent registers
  the LangGraph adapter.

The verified implementation used Python 3.11.16 and the exact versions in the
platform lockfile. The environment can be created without changing the root
JavaScript package:

```bash
cd server/src/platforms/langgraph
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
```

Use any Python 3.11 or 3.12 interpreter with SQLite support if `python3.11` is
not the host's command name. The service requires the `sqlite3` module for its
checkpoint store and does not provide an in-memory fallback.

## Start

From the repository root:

```bash
export AGENTLAB_LANGGRAPH_STATE_DIR="$PWD/server/src/platforms/langgraph/.local"
export PYTHONPATH="$PWD/server/src/platforms/langgraph"
server/src/platforms/langgraph/.venv/bin/python -m uvicorn \
  service.app:app --host 127.0.0.1 --port 2024
```

The service binds to loopback. Check readiness:

```bash
curl --fail --silent --show-error http://127.0.0.1:2024/health
```

Readiness requires a writable state directory and reports the installed
LangGraph version. It does not require an OpenRouter key for fake-model runs.

## Direct service smoke run

```bash
curl --fail --silent --show-error \
  -X POST http://127.0.0.1:2024/v1/runs \
  -H 'content-type: application/json' \
  --data '{"runId":"manual-langgraph","prompt":"Say hello in one sentence.","systemInstruction":"Answer directly.","model":{"provider":"fake","model":"fake-success"},"graph":"baseline","threadId":"manual-langgraph","durability":"sqlite-sync","maxAttempts":2,"timeoutMs":30000}'

curl --fail --silent --show-error \
  http://127.0.0.1:2024/v1/runs/langgraph%3Amanual-langgraph
```

The service returns `queued` or `running` before the graph finishes. Poll the
inspection endpoint for a terminal result. `checkpoint` and the event list show
the native thread/checkpoint observation without exposing serialized state.

## Optional OpenRouter path

Set the key only in the Python service environment:

```bash
export OPENROUTER_API_KEY='local-only-key'
```

The key is never accepted in the request body, run manifest, native reference,
or event payload. A lost provider response is `unknown`, not an automatic
duplicate request.

## Reset and stop

Stop the process with `Ctrl-C`. To discard local service records and LangGraph
checkpoints, stop the process first and remove only the generated platform
state directory:

```bash
rm -rf server/src/platforms/langgraph/.local
```

The reset command is intentionally explicit because it destroys native
checkpoint history. A process restart does not silently delete state. In-flight
records that have no terminal record become `unknown` and require reconciliation.

## Shared integration handoff

This scoped profile does not edit `server/src/control-plane/`, the root launcher,
the server package manifest, the platform registry, or the Platform UI. The
primary integration agent must register the adapter only after this service is
reachable and then run the generic server integration path.
