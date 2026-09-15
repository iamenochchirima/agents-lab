# Trigger.dev baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T11:29:48+02:00
**Status:** Active
**Owner:** Assigned platform agent
**Platform:** `trigger-dev`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](../completed/server-platform-foundation.md).

Use the official [Trigger.dev repository](https://github.com/triggerdotdev/trigger.dev)
and its current local-development documentation. Pin the SDK, CLI, and runtime
versions in the first implementation commit rather than relying on a floating latest.
The [first-party source audit](../../../docs/research/platform-plan-source-audit.md)
must be reviewed before implementation.

## Purpose and definition of done

Implement a real Trigger.dev task run for the common prompt request. The runner must
submit a stable task invocation, inspect the platform run, route cancellation when
supported, and project normalized evidence plus `native/trigger-dev.json`.

```text
POST /api/runs → Trigger.dev runner adapter → local task run → normalized + native evidence
```

The implementation must use the local Trigger development profile for repeatable
tests and clearly separate local evidence from any hosted deployment evidence.

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/trigger-dev/**
server/tests/platforms/trigger-dev/**
server/integration-tests/trigger-dev-baseline.test.ts
development/playground/trigger-dev-baseline/**
```

Do not edit common control-plane files, root package manifests or lockfiles, the local
stack script, the web platform catalog, or documentation navigation. The primary agent
performs registration and shared launcher changes after this plan's commits are merged.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js.
- SDK/CLI: pin `@trigger.dev/sdk@4.5.14` and the matching CLI line from official
  release metadata; the reviewed source requires Node.js `>=18.20.0`.
- Runtime shape: platform-owned task service and worker process behind the generic
  runner adapter; use the official local dev server rather than a fake task queue.
- Local readiness: record the exact CLI command, server URL, worker readiness signal,
  isolated port/project profile, and required secret key. Trigger.dev local execution
  still depends on a Trigger server; it is not an offline emulator.
- Model path: deterministic fake model first, optional OpenRouter profile second.
- Native identity: Trigger task ID and run ID, plus safe attempt/status metadata.
- If the SDK requires root dependencies, stop and hand the dependency decision to the
  primary agent instead of editing the root manifest in parallel.

## Lifecycle and side effects

Document and test task admission, queued/running/terminal mapping, Trigger retries,
backoff, timeouts, task cancellation, worker restarts, lost acknowledgements, and
unknown outcomes. The stable `runId` must be the idempotency identity for admission.
Never retry an ambiguous external model call unless the platform and model adapter
provide a safe deduplication rule. An orphan Trigger run is evidence for inspection,
not a new Lab run.

## Evidence and tests

Native evidence must be versioned and contain only safe task/run identifiers, execution
status, attempt information, and platform URLs that do not embed credentials. Common
events remain the comparable projection; Trigger-specific task history stays native.

Required checks:

- unit tests for task request construction, status mapping, idempotency, redaction,
  and retry classification;
- local integration success, failure, cancellation, timeout, and unavailable-server;
- lost-start-acknowledgement and duplicate-admission tests;
- worker restart and server restart reconciliation;
- duplicate/out-of-order event and terminal-result tests;
- post-integration server and web typechecks/build;
- a playground walkthrough with inspectable run records.

## Documentation and handoff

Document local setup, worker readiness, task semantics, recovery, native evidence,
limitations, and the exact validation commands. Record release impact as local-only,
with no analytics unless a new UI interaction is added. Use separate commits for
runtime, tests/infrastructure, and docs. The final handoff must identify every file
changed and every shared integration action requested from the primary agent.
