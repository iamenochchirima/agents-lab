# Temporal local development

Status: implementation in progress.

The first Temporal slice depends on a local Temporal development server. The
Lab will connect to Temporal; it will not treat Temporal's database or Web UI as
the Lab's run-record store.

## Prerequisite

Verify that the CLI is available:

```bash
temporal version
```

Start the local server in a separate terminal:

```bash
temporal server start-dev
```

The default development connection is:

| Setting | Default |
| --- | --- |
| Frontend gRPC endpoint | `localhost:7233` |
| Temporal Web UI | `http://localhost:8233` |
| Namespace | `default` |

The default server keeps development state in a temporary store. To preserve
workflow executions across a deliberate process restart, provide a local
database path that is not committed to the repository:

```bash
temporal server start-dev --db-filename /tmp/agent-harness-lab-temporal.db
```

The Temporal CLI's development server is for local work, not production. A
production deployment will require an independently designed Temporal
deployment, access policy, persistence, and operational process; those choices
are outside this baseline slice.

## Expected Lab relationship

When the implementation is complete, the local stack will contain a React/Vite
UI, a Fastify control API, and a Temporal worker. The worker connects to the
Temporal server above. The browser talks only to the control API.

The run manifest is written before workflow dispatch. The control plane then
materializes normalized events and terminal records under
`lab/runs/<run-id>/`. Temporal workflow history remains the source of truth for
an in-flight workflow, while the Lab files are the inspectable evidence record.

## Current limitation

The Temporal worker, control API, and stack launcher are not yet runnable from
this directory. Do not use this page as a claim that a Temporal run has been
executed. Follow the active implementation plan for the remaining work and
update this page when the local commands become available.
