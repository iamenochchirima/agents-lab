# Temporal platform

Status: first local baseline is runnable.

This directory contains the Lab's Temporal integration. Temporal is the durable
execution platform for this slice; it is not the agent definition itself and it
does not own the Lab's normalized run records.

## Boundary

The intended flow is:

```text
Platform UI
  → Fastify server
  → immutable Lab run manifest
  → Temporal client / runner adapter
  → Temporal workflow and worker
  → model activity
  → workflow status and native details
  → server evidence in lab/runs/<run-id>/
```

Ownership is deliberately split:

| Area | Owner |
| --- | --- |
| Request validation, run IDs, manifests, API responses | `server/src/control-plane/` |
| Workflow scheduling, durable recovery, activity execution | Temporal and this directory |
| Temporal client boundary used by the server | `runner-adapter/` |
| The first runnable agent turn | `variants/baseline/` |
| Normalized `events.jsonl`, `trajectory.json`, `metrics.json`, and `result.json` | The server |
| Workflow history and Temporal-native execution details | Temporal |

The workflow must not write directly to `lab/runs/`. The server is the
single writer for normalized evidence and reconciles ordered workflow event
intents after a restart. This keeps the Lab record separate from Temporal's
own persistence and avoids presenting two competing sources of truth.

Temporal implements the server's generic platform runner seam. The common server
stores its execution reference as `native/temporal.json`, but only this directory
knows how to interpret its workflow ID, run ID, namespace, task queue, signals,
queries, and activity details.

Keep workflow determinism, activity boundaries, retry policy, cancellation,
signals, timers, and worker lifecycle decisions local to this directory. Do not
leak Temporal SDK types into the generic run domain or the browser.

## Local dependency

The first implementation requires a locally reachable Temporal development
server. The CLI's defaults are:

```text
gRPC endpoint: localhost:7233
Web UI:       http://localhost:8233
namespace:    default
```

Start it separately during local development:

```bash
temporal server start-dev
```

The development server is not a production deployment. Without a database file,
its workflow executions are lost when that server process exits. For a restart
or recovery exercise, use a deliberate local path:

```bash
temporal server start-dev --db-filename /tmp/agent-harness-lab-temporal.db
```

The Lab's server configuration, worker command, and local stack launcher are
implemented. Use the [local development guide](docs/local-development.md) for
the exact commands and the [architecture notes](docs/architecture.md) for the
ownership boundary.

## Related locations

- [`docs/`](docs/README.md) — Temporal-specific setup and design notes.
- [`runner-adapter/`](runner-adapter/README.md) — the server/Temporal client seam.
- [`variants/`](variants/README.md) — variants built on Temporal.
- [`variants/baseline/`](variants/baseline/README.md) — the first intentionally narrow variant.
