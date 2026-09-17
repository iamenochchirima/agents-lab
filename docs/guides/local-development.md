# Local development

The repository uses one pnpm workspace. Install dependencies from the repository root:

```bash
pnpm install
```

The workspace includes the Anesu harness, Lab server, web app, and the
platform packages under `server/src/platforms/`. They share `pnpm-lock.yaml`; do not
create package-local lockfiles.

## Anesu

For the daily standalone agent path:

```bash
cd anesu
pnpm run chat
```

Copy `anesu/.env.example` to `anesu/.env` once if you want to keep a
real provider, model, and API key between runs. That file is ignored by git. The same
command also works from the repository root as `pnpm run chat`.

Run its checks from the root with filters:

```bash
pnpm --filter @agent-harness-lab/anesu run typecheck
pnpm --filter @agent-harness-lab/anesu test
pnpm --filter @agent-harness-lab/anesu coverage
```

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

The aggregate server health can still be `degraded` when optional profiles such as
Inngest, DBOS, or Trigger.dev are not running. Check the individual platform health
endpoints or the platform status in the UI for the profiles included in the local stack.
Those optional services remain available through named commands in
[`scripts/README.md`](../../scripts/README.md).
