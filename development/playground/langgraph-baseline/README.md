# LangGraph baseline playground

This is a hands-on walkthrough for understanding the local LangGraph implementation.
It is not a test suite, scenario, experiment, benchmark, or retained run evidence.
The commands deliberately use deterministic fixtures so the execution boundary can be
inspected without spending provider quota.

## Start the local path

From the repository root, use the priority local stack:

```bash
./scripts/run_local_stack.sh
```

Open [`http://127.0.0.1:5173/platforms/langgraph/chat`](http://127.0.0.1:5173/platforms/langgraph/chat).
The page is the shared Platform Chat surface. Select a model, send a message, expand
`Context window`, `Native execution`, `Tool activity`, and `Run timeline`, then inspect
the run evidence links. The Python service is a separate local process; its readiness
is shown by the platform status rather than inferred from the browser.

If the aggregate stack is already running, the individual process commands are:

```bash
./scripts/run_local_stack.sh langgraph
./scripts/run_local_stack.sh server
./scripts/run_local_stack.sh frontend
```

The launcher uses the locked Python environment under
`server/src/platforms/langgraph/.venv` and keeps SQLite state in the configured local
state directory. No Docker container is required.

## Observe one deterministic turn

The generic server integration test is the reproducible command for a fake model and
does not require an OpenRouter key:

```bash
AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server exec tsx \
  integration-tests/langgraph-baseline.test.ts
```

The test starts an isolated Python service and temporary context/state directories.
It exercises a successful model turn, a calculator tool turn, shared context, bounded
pre-dispatch retry, cancellation, service replacement, Lab-server replacement, both
processes being replaced, stale projection, timeout, ambiguous provider outcome, and
provider-overflow recovery. It removes its temporary state when it finishes.

To inspect the native MCP boundary through the complete local stack, select the
server-owned `local-mcp-safe` profile in Platform Chat, or run the opt-in matrix:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:platform-mcp-matrix
```

The matrix sends `initialize`, `tools/list`, and `tools/call` through the LangGraph
service's native graph tool node. Expand **MCP connection** and **Native execution** in
the browser, then inspect the bounded `native/langgraph.json` record. A lost MCP
response is shown as `unknown`; the local read fixture does not establish exactly-once
behaviour.

## Follow the two-turn identity

The important identities are intentionally different:

```text
sessionId + clientTurnId  -> Lab admission and idempotency
runId                     -> one Lab evidence record per turn
langgraph:baseline:hash   -> stable native thread for the session
checkpoint ID             -> one LangGraph state version
```

The second turn reuses the native thread and loads the settled checkpoint, but it gets
a new `runId` and `clientTurnId`. Replaying the same client turn with the same request
fingerprint returns the original run instead of starting a second graph execution.

## Inspect interruption and recovery

The native service marks queued or running records as `unknown` when it starts after a
process interruption. The Lab adapter projects that state as
`reconciliation_required`. This is deliberately visible in Chat as “Run outcome needs
recovery.” A checkpoint does not prove that an OpenRouter request completed, so the
implementation does not fabricate an assistant response or blindly retry an ambiguous
provider call.

For the destructive browser replacement exercise, follow the explicit opt-in command
in [`apps/web/tests/browser/README.md`](../../../apps/web/tests/browser/README.md).
It requires a validated repository-owned PID and reopens the same SQLite path. Do not
use it against an unrelated service.

## What to inspect

- `server/src/platforms/langgraph/variants/baseline/graph.py` — graph nodes, tools,
  model boundary, and deterministic fixtures.
- `server/src/platforms/langgraph/service/store.py` — SQLite records, event ordering,
  startup reconciliation, and terminal immutability.
- `server/src/platforms/langgraph/runner-adapter/langgraph-runner.ts` — TypeScript
  protocol adapter, context preparation, recovery mapping, and normalized projection.
- `lab/runs/<run-id>/` — normalized Lab evidence when the run root is configured to a
  repository-visible location. Native SQLite state is separate from that evidence.

The implementation does not include long-term memory, remote OAuth accounts,
side-effecting external tools, hosted LangGraph deployment, or automatic in-flight
resume. Local MCP is included only as a deterministic protocol boundary: its endpoint
and selected tool are server-owned, its payloads are bounded, and its native graph
checkpoint does not prove that an interrupted provider call completed.
