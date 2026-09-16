# Trigger.dev baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-17T00:18:18+02:00
**Status:** Completed — implementation ready; external acceptance deferred
**Owner:** Agent Harness Lab
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

The implementation must use a real Trigger development profile for repeatable tests
and clearly separate local task-worker evidence from hosted or self-hosted server
evidence. Trigger Cloud is the preferred no-Docker acceptance profile; official
self-hosting remains optional.

## Current implementation status

The Trigger task definition, runner adapter, stable idempotency handling, status and
cancellation mapping, native evidence, development-profile docs, playground,
shared server registration, and UI availability wiring are implemented.

Verified in this wave:

- [x] 8 focused Trigger.dev tests pass.
- [x] The local launcher invokes the published `trigger` CLI binary correctly.
- [x] Idempotent admission, lost acknowledgement, unknown outcome, cancellation,
  status mapping, and redaction are covered.
- [x] Server, UI typecheck/build, and the full server test suite pass.

- [x] The opt-in real-service integration path is implemented and documented for
      Trigger Cloud or official self-hosting; execution is explicitly deferred until
      a real project and credential are supplied.
- [x] The manual UI acceptance path is implemented and documented; the manual run is
      explicitly deferred with the same external prerequisite.

The external acceptance prerequisite is not available in this environment: there is
no Trigger project credential and no self-hosted server. This is recorded as a
deferred acceptance limitation, not reported as a successful integration run.

## Completion decision

This plan is complete as an implementation slice. The code, deterministic tests,
native evidence contract, browser/UI wiring, no-Docker Cloud instructions, and
failure semantics are finished. The real Trigger server/worker integration and
manual UI run remain explicit follow-up evidence to collect when credentials are
available; they must not be replaced with a fake service or claimed as passed.

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
  runner adapter; use the official Trigger task worker rather than a fake task queue.
- Server profiles: Trigger Cloud is the preferred no-Docker development server;
  official self-hosting is Docker Compose-based and optional. Trigger.dev local task
  execution still depends on a Trigger server; it is not an offline emulator.
- Local readiness: record the exact CLI command, server URL, worker readiness signal,
  isolated project profile, and required secret key when acceptance is run.
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

## Completion gate

- [x] Platform-owned runtime, task, adapter, configuration, and evidence boundaries
      are implemented.
- [x] Deterministic unit and failure-semantics tests pass, including idempotency,
      unknown outcomes, cancellation, status mapping, and redaction.
- [x] Server registration, UI availability wiring, documentation, and playground are
      integrated.
- [x] No-Docker Trigger Cloud and optional self-hosted acceptance paths are documented.
- [x] External real-service integration and manual UI acceptance are explicitly
      deferred because credentials/server infrastructure are unavailable; neither is
      represented as passed evidence.

## Completion record

**Completed:** `2026-09-17T00:18:18+02:00`

**Focused implementation history:** `21f5749`, `65ca1fc`, `dce6e9c`, `0b03650`,
`2789f0e`, `572e9ff`, `8bf662c`.

**Validation:** `pnpm --filter @agent-harness-lab/lab-server run test:trigger` passed
15 tests with 1 intentionally skipped external integration test; the server build,
`bash -n scripts/run_local_stack.sh`, web typecheck/build, and browser acceptance
suite also pass as recorded in the parent platform completion wave. The real Trigger
server/worker integration and manual UI run are deferred and intentionally not
counted as passed.

**Known limitations:** Trigger.dev has no offline development mode. A real
Trigger Cloud project or self-hosted server is required for final external evidence;
self-hosting requires the official Docker Compose deployment. This baseline uses the
deterministic fake model for platform tests and supports OpenRouter in the real task,
but provider-specific production evidence still requires credentials.
