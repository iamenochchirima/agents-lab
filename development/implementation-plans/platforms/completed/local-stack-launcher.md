# One-command local comparison stack

**Created:** `2026-09-16T12:22:00+02:00`
**Last updated:** `2026-09-16T12:37:00+02:00`
**Status:** Completed
**Owner:** Agent Harness Lab maintainers

## Purpose

Make the default local launcher start a usable comparison surface in one terminal.
The command must gate its success message on real service readiness and retain clear
logs when a dependency cannot start.

## Definition of done

```text
./scripts/run_local_stack.sh → Temporal + Restate + LangGraph + Vercel Workflows
→ Lab server + worker + web UI → reachable platform health and browser URLs
```

## Scope

- [x] Start or reuse local Temporal without requiring a second terminal.
- [x] Start native Restate, register the baseline service idempotently, and wait for it.
- [x] Start LangGraph and Vercel Workflows with their local runtime dependencies.
- [x] Start the existing Lab server, worker, and web app after platform readiness.
- [x] Replace existing Agent Harness Lab process groups on configured ports and retain
  per-service logs.
- [x] Document optional profiles that are intentionally not part of the default stack.

## Explicitly out of scope

- Inngest Dev Server, DBOS/PostgreSQL, Trigger.dev credentials, or AWS infrastructure.
- Changes to platform execution semantics or the browser UI.

## Failure and recovery rules

- A reachable Temporal process is reused and is not stopped by launcher cleanup.
- A locally started process is stopped with its process group on exit or startup failure.
- A later launcher invocation stops an existing repository-owned Lab process group before
  claiming the same port; an unrelated process is never killed by port preflight.
- A later launcher invocation also stops repository-owned Temporal workers, which do not
  expose a listening port and therefore need a separate process scan.
- A service that does not pass its readiness check fails the launcher and points to its log.
- Restate registration is retried and an existing registration for the same service URL is reused.
- LangGraph uses an ignored local virtual environment and the committed lock file; provider
  credentials are inherited from the existing local environment loader and never printed.

## Completion record

**Completed:** `2026-09-16T12:37:00+02:00`
**Commits:** deferred; no commit was requested for this slice

### Validation

- `bash -n scripts/run_local_stack.sh` — passed.
- `./scripts/run_local_stack.sh` — passed from a clean stack state; brought up Restate,
  registered `http://127.0.0.1:9080`, started LangGraph and Vercel Workflows, and then
  reached Lab server, web, and Temporal worker readiness. Temporal was already reachable
  and was correctly reused.
- `curl --fail http://127.0.0.1:4318/ready` — passed.
- Individual Lab health checks for Restate, LangGraph, and Vercel Workflows — passed;
  all returned `reachable: true`.
- Direct readiness checks for Restate Admin, LangGraph, and Vercel Workflows — passed.
- Ctrl-C cleanup — passed; ports 2024, 4318, 5173, 8080, 9070, 9080, and 9094 were
  released and no launcher-owned Lab services remained.
- Consecutive launcher invocation — passed; a second invocation stopped the first
  repository-owned stack and started a fresh stack on the same ports.
- Stale-worker replacement — passed; the launcher removed older repository-owned worker
  processes and the final stack had one Temporal worker process pair (watcher plus child).
- `git diff --check` — passed.

### Known limitations

- The aggregate `/health` endpoint remains `503 degraded` while optional Inngest, DBOS,
  and Trigger.dev profiles are not running. `/ready` and the individual priority platform
  health endpoints are the launcher gates for this local stack.
- The automatic Temporal-start branch was not exercised in the final run because a local
  Temporal server was already available; the launcher still preserves the existing
  process and starts one when the default local endpoint is unavailable.
