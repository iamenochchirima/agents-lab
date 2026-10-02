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
comparison services (Restate, LangGraph, and Vercel Workflows), followed by the Lab
server, Temporal worker, and web app. It prints the URLs only after their readiness
checks pass. Running it again replaces an existing Agent Harness Lab stack on the
configured ports and replaces stale Lab Temporal workers. Press Ctrl-C to stop the
current stack; an existing Temporal process is not stopped.

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

To run the same connected profile through the four priority platform boundaries, keep the
stack running and use a shared context root:

```bash
AGENTLAB_LOCAL_FIXTURE_URL=http://127.0.0.1:9191 \
AGENTLAB_CONTEXT_ROOT="$PWD/lab/sessions" \
pnpm --filter @agent-harness-lab/lab-server run test:platform-capability-matrix
```

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

When using a non-default web port, the launcher passes the matching browser origin to
the server automatically. If the web app and server are started separately, set
`AGENTLAB_API_ORIGIN` to the web app's origin.
