# DBOS baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T17:40:00+02:00
**Status:** Complete — local baseline and shared UI acceptance verified
**Owner:** Assigned platform agent
**Platform:** `dbos`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](../active/platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](server-platform-foundation.md).

Use the official [DBOS TypeScript repository](https://github.com/dbos-inc/dbos)
and current DBOS documentation. Pin the DBOS package, Node version, and PostgreSQL
version in the first implementation commit. Review the [first-party source audit](../../../docs/research/platform-plan-source-audit.md)
before implementation.

## Purpose and definition of done

Implement a DBOS-backed prompt run whose workflow identity and progress are stored
in PostgreSQL. The runner must start, inspect, and cancel the DBOS workflow through
the platform-owned service and produce normalized records plus `native/dbos.json`.

```text
POST /api/runs → DBOS runner adapter → DBOS workflow + PostgreSQL → evidence
```

The local path must use a real PostgreSQL instance, not an in-memory substitute.

## Current implementation status

The DBOS workflow host, PostgreSQL-backed state boundary, runner adapter, safe native
step evidence, local operation/semantics docs, opt-in integration test, shared server
registration, and UI availability wiring are implemented.

Verified in this wave:

- [x] 7 focused DBOS unit/adapter tests pass.
- [x] A temporary native PostgreSQL 18 instance and DBOS service completed a
  fake-model run through the generic Lab API; no container was used.
- [x] The opt-in DBOS integration test passed from a fresh PostgreSQL/service start.
- [x] The generic evidence projection retained DBOS step metadata and refreshed the
  terminal native status to `SUCCESS`.
- [x] Server, UI typecheck/build, and the full server test suite pass.

The local baseline, shared server registration, and shared UI acceptance are complete.
The production DBOS Conductor profile remains outside this plan.

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/dbos/**
server/tests/platforms/dbos/**
server/integration-tests/dbos-baseline.test.ts
development/playground/dbos-baseline/**
```

Do not edit `server/src/control-plane/**`, root dependency manifests or lockfiles,
`scripts/run_local_stack.sh`, the web platform catalog, or `docs/navigation.json`.
The primary agent owns adapter registration and shared local-stack composition.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js.
- SDK: pin the exact `@dbos-inc/dbos-sdk` version from official package metadata
  before implementation; the open-source repository source is not a reproducible
  package pin by itself.
- Platform service: DBOS workflow host with a small HTTP control/readiness boundary.
- Required local infrastructure: isolated PostgreSQL database, schema, user, and port.
- The local baseline launches DBOS inside the application process. DBOS Conductor is
  a separate production/distributed recovery service and is out of scope here.
- State model: DBOS/ PostgreSQL workflow state is platform-owned; Lab evidence remains
  a separate projection and must not be treated as the workflow checkpoint.
- Native identity: DBOS workflow ID/run identity and safe database-backed status.
- Model path: deterministic fake model first; OpenRouter only through explicit config.

## Lifecycle, durability, and side effects

Define the transaction and workflow boundaries for admission, model request, result
recording, and cancellation. Test PostgreSQL restart, worker/service restart,
duplicate workflow start, retry/backoff, timeout, cancellation races, and ambiguous
external model calls. Use explicit at-least-once or at-most-once language; do not claim
exactly-once merely because state is stored in PostgreSQL. Orphan DBOS workflows must
remain inspectable but must not be adopted without a Lab manifest.

## Evidence and tests

Native evidence must include schema version, workflow identity, safe database/profile
identity, attempt and checkpoint metadata, and terminal status. It must never contain
database passwords, connection strings with credentials, provider headers, or raw
model responses.

Required checks:

- unit tests for workflow input, identity, transaction boundaries, status mapping,
  idempotency, and redaction;
- PostgreSQL integration tests for success, failure, retry, cancellation, restart,
  and reconciliation;
- duplicate/out-of-order event and terminal-result tests;
- unavailable database behaviour without fabricated completion;
- evidence inspection after the service exits;
- primary-agent server and web compatibility checks;
- a playground showing the DBOS state and Lab projection side by side.

## Documentation and handoff

Document PostgreSQL setup, schema lifecycle, DBOS state ownership, recovery rules,
credential boundaries, and exact test commands. Use focused runtime, test, and docs
commits. The handoff must list migrations/schema changes, required shared integration,
known limitations, and whether any DBOS semantics remain unverified.

## Completion record

**Completed:** 2026-09-15T17:40:00+02:00<br>
**Focused commits:** `7ff3463`, `507c2c6`, `b06f65e`, `ba5b564`, `b5b91e3`

### Validation

- `npm --prefix server test` — passed, 141 tests.
- DBOS native integration — passed against a temporary PostgreSQL 18 instance on loopback with the DBOS service; success, failure, retry, cancellation, and status projection paths completed without Docker.
- `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` — passed; build emitted only the existing large-chunk warning.
- Manual Chromium check — DBOS platform view completed run `10195e56-216c-4c5c-87be-8e0eb58a5831` with `Fake response: UI acceptance run for the DBOS baseline.`, seven lifecycle events, and `dbos:<run-id>` native execution identity.
- `git diff --check` — passed for the focused platform changes.

### Known limitations

- The local path uses native PostgreSQL and the DBOS application host. DBOS Conductor, distributed deployment, and production failover were not tested.
- The fake model is the deterministic acceptance path. OpenRouter remains optional and was not called in this wave.
