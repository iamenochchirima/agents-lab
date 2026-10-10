# Local development

The Lab uses one pnpm workspace. Install its dependencies from the repository root:

```bash
pnpm install
```

The workspace includes the Lab server, web app, and platform packages under
`server/src/platforms/`.

## Lab server and web app

Use workspace filters when you need one package. The local stack launcher uses these
same filters:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/web run typecheck
./scripts/run_local_stack.sh
```

The one-command launcher starts or reuses local Temporal and starts the priority
comparison services (Restate, LangGraph, and Vercel Workflows; Mastra executes
in the API process), followed by the Lab
server, Temporal worker, and web app. It prints the URLs only after their readiness
checks pass. Running it again replaces an existing Agent Harness Lab stack on the
configured ports when the process carries an inspectable launcher instance identity.
Replacement follows that instance's watcher ancestry and stops its process tree;
it does not signal unrelated process-group siblings. Temporal workers are replaced
only when their launcher owner, endpoint, namespace, task queue, run root, context
root, and capability-host endpoint match the selected configuration. Other queues
and roots remain running. An unmarked worker already using the selected
configuration blocks a duplicate launch and is left untouched.

Ownership inspection uses Linux `/proc/<pid>/environ`. Unknown, unreadable,
manual, or older unmarked service owners are not automatically replaced. Stop the
original watcher explicitly before retrying a conflicting port or matching worker
configuration. On systems without readable `/proc`, automatic replacement is
unavailable. Press Ctrl-C to stop the current launcher-owned stack; an existing
Temporal server process is not stopped.

The launcher also starts the no-Docker local connection fixture at
`http://127.0.0.1:9191`. Platform capability runs use it through the opaque
`conn_local_fixture` reference. To run only the fixture while developing a connection
adapter:

```bash
./scripts/run_local_stack.sh local-fixture
curl http://127.0.0.1:9191/health
```

The fixture is provider-shaped test infrastructure, not a real external account. It
supports bounded lookup and idempotent write requests so platform adapters can be tested
over HTTP without Docker. A lost write acknowledgement remains `unknown`; the client
must not retry it automatically.

The legacy capability matrix below covers four platform boundaries, keep the
stack running and use a shared context root:

```bash
AGENTLAB_LOCAL_FIXTURE_URL=http://127.0.0.1:9191 \
AGENTLAB_CONTEXT_ROOT="$PWD/lab/sessions" \
pnpm --filter @agent-harness-lab/lab-server run test:platform-capability-matrix
```

This matrix does not exercise Vercel connected review delivery or establish
five-platform live acceptance. Vercel's native connected lifecycle check lives at
`server/tests/platforms/vercel-workflows/connected-native.test.ts`; see the
[connected tools guide](connected-agent-tools.md) for the five native boundaries
and the distinction between fixture checks and real-model evidence.

The matrix checks the read-only fixture, an explicitly approved write, and cancellation
through Temporal, Restate, LangGraph, and Mastra. Native platform suites separately cover
restart, replacement, reconciliation, and unavailable-service behaviour. Inspect a run's
`config.json`, `capabilities.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
`result.json`, `logs/operations.jsonl`, and `native/<platform>.json`; no file should
contain a token, authorization header, or raw provider body.

To roll back connected or side-effecting capability profiles while retaining pure local tools:

```bash
AGENTLAB_CONNECTED_CAPABILITIES_ENABLED=false ./scripts/run_local_stack.sh
```

The server reports affected profiles as unavailable and rejects their selection before
dispatch. Restore `true` only after the connection boundary is ready to accept traffic.

The fixture keeps state in its process and has no credential directory. Stop the local stack
to discard it. Real connection cleanup and credential rotation must happen in the configured
secret store; rotate the secret and reauthorize the opaque connection reference without
rewriting existing run evidence.

The aggregate server health can still be `degraded` when optional profiles such as
Inngest, DBOS, or Trigger.dev are not running. Check the individual platform health
endpoints or the platform status in the UI for the profiles included in the local stack.
Those optional services remain available through named commands in
[`scripts/README.md`](../../scripts/README.md).


The API composes its capability catalog and host before optional native runners
finish initializing. Temporal, Restate and Hatchet initialize independently;
`/ready` remains available while their platform health reports unreachable with
an initializing or unavailable message. A completed connection still requires
its native health probe to succeed. Failed initialization is attempted once per
server lifetime; correct the native service configuration and restart the API
to retry. The full launcher still waits for the required services in its selected
profile before printing its ready message.

Shutdown closes connected runners. It does not wait indefinitely for an optional
connector: a runner that arrives after shutdown is immediately closed and never
accepts runs. Native SDKs own resources acquired before returning a runner and
their timeout or cancellation behavior; this isolation adds no shared agent loop.

When using a non-default web port, the launcher passes the matching browser origin to
the server automatically. If the web app and server are started separately, set
`AGENTLAB_API_ORIGIN` to the web app's origin.

When starting services separately on a non-default API port, use the same
`AGENTLAB_API_PORT` for each launcher command, including workers and platform
services. For example, start the API with
`AGENTLAB_API_PORT=4319 ./scripts/run_local_stack.sh server` and the Temporal
worker with `AGENTLAB_API_PORT=4319 ./scripts/run_local_stack.sh worker`.
The launcher derives the browser proxy and internal capability host from that
port. `AGENTLAB_CAPABILITY_HOST_URL` overrides the internal endpoint when workers
reach the API at a different address. The browser origin is a separate setting.
