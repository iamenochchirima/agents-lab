# Hatchet baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T11:29:48+02:00
**Status:** Active
**Owner:** Assigned platform agent
**Platform:** `hatchet`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](../completed/server-platform-foundation.md).

Use the official [Hatchet repository](https://github.com/hatchet-dev/hatchet) and
current TypeScript SDK/local-development documentation. Pin all SDK, server, and
worker versions in the implementation commit. Review the [first-party source audit](../../../docs/research/platform-plan-source-audit.md)
before implementation.

## Purpose and definition of done

Implement a Hatchet-backed prompt task using the full local server/worker stack. This
choice is deliberate: the baseline is intended to study Hatchet's scheduler, worker,
durable task, persistence, and inspection boundaries. Hatchet embedded TypeScript mode
is a separate future lightweight variant, not a silent fallback for this plan.
The runner must admit a task with a stable Lab identity, inspect its run, request
cancellation when supported, and produce normalized records plus
`native/hatchet.json`.

```text
POST /api/runs → Hatchet runner adapter → Hatchet task/worker → evidence
```

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/hatchet/**
server/tests/platforms/hatchet/**
server/integration-tests/hatchet-baseline.test.ts
development/playground/hatchet-baseline/**
```

Do not modify common server contracts, root manifests/lockfiles, local-stack startup,
web catalog, or documentation navigation. The primary agent handles registration and
shared launcher integration after the platform-only commits are reviewed.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js for the runner/service and worker boundary.
- Required local infrastructure: the documented full Hatchet server/persistence
  profile and worker, with isolated ports and readiness checks. Embedded mode may
  provide its own local sidecar/Postgres but is excluded from this variant because it
  does not have the same topology.
- Native identity: Hatchet task/run identity, worker identity, attempt, and safe status.
- Model path: deterministic fake model first, explicit OpenRouter profile second.
- Keep Hatchet SDK types inside this platform directory or its service package.

## Lifecycle and failure semantics

This baseline uses a Hatchet durable task. Define task admission, queueing, worker
pickup, retries, timeouts, cancellation,
duplicate starts, lost acknowledgements, worker restart, server restart, and orphan
task handling. The Lab run ID must be the idempotency key or be linked to a Hatchet
deduplication key. If the external outcome is unknown, retain a reconciliation state
instead of fabricating failure or success. Preserve Hatchet-native retry and worker
telemetry in native evidence.

## Evidence and tests

Native evidence must be versioned, safe, and readable after the Hatchet service is
offline. It must include task/run identity, worker/attempt metadata, retry state, and
safe dependency profile data, but no secrets or raw headers.

Required checks:

- unit identity, request, status, retry, cancellation, and redaction tests;
- local server/worker integration for success, failure, retry, timeout, and cancel;
- lost acknowledgement, duplicate start, worker restart, and server reconciliation;
- unavailable Hatchet dependency without a fabricated result;
- event ordering and idempotent terminal projection;
- post-integration server/web checks and a playground evidence walkthrough.

## Documentation and handoff

Document local server/worker setup, readiness, task semantics, recovery, permissions,
native evidence, and limitations. Commit runtime, tests/infrastructure, and docs
separately. The handoff must name all shared bootstrap/script changes for the primary
agent rather than editing them directly.
