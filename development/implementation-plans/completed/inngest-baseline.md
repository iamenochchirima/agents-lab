# Inngest baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T17:40:00+02:00
**Status:** Complete — local baseline and shared UI acceptance verified
**Owner:** Assigned platform agent
**Platform:** `inngest`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](server-platform-foundation.md).

Use the official [Inngest JavaScript SDK](https://github.com/inngest/inngest-js)
and [Inngest development server documentation](https://www.inngest.com/docs/local-development)
as implementation references. Pin versions and record the exact local commands in
the completion record. The [first-party source audit](../../../docs/research/platform-plan-source-audit.md)
must be reviewed before implementation.

## Purpose and definition of done

Implement one real Inngest-backed run that accepts the common prompt request, emits
an Inngest event with a stable idempotency identity, executes a function through the
local Inngest development server, and projects the result through the generic runner
contract. The run must be inspectable under `lab/runs/<run-id>/` with
`native/inngest.json` retaining the Inngest event/function/run identifiers.

```text
POST /api/runs → Inngest runner adapter → Inngest event/function → normalized + native evidence
```

This plan does not claim exactly-once execution. The implementation must document
Inngest's actual retry and delivery semantics and make the baseline side effects
idempotent.

## Current implementation status

The Inngest baseline service, runner adapter, durable-step function boundary, safe
native projection, local operation docs, playground, shared server registration,
and UI availability wiring are implemented. The platform-local integration test
now exercises the generic runner against a pre-registered function service, which
matches the real two-process topology.

Verified in this wave:

- [x] 9 focused Inngest tests pass.
- [x] The opt-in integration test passes against the pinned Inngest Dev Server v1.44.0.
- [x] The service starts independently and reports `/ready` separately from degraded
  Dev Server health.
- [x] Lost event acknowledgements reuse the stable event identity.
- [x] Cancellation records an asynchronous request without fabricating completion.
- [x] A native integration run covers success, deterministic failure, safe
  pre-dispatch retry, and cancellation requested before function start.
- [x] The retry fixture uses a short native `RetryAfterError`; the projection counts
  attempts from observed model-step requests.
- [x] Server, UI typecheck/build, and the full server test suite pass.

The local baseline, shared server registration, and shared UI acceptance are complete.
The optional hosted Inngest profile remains outside this plan.

Validation record for the no-container local path:

```text
AGENTLAB_RUN_INNGEST_INTEGRATION=1 \
AGENTLAB_INNGEST_DEV_SERVER_URL=http://127.0.0.1:8288 \
AGENTLAB_INNGEST_SERVICE_URL=http://127.0.0.1:9191 \
node server/dist/integration-tests/inngest-baseline.test.js
```

Passed on 2026-09-15 at 15:00 against Inngest Dev Server v1.44.0 started directly
with `npx --yes inngest-cli@1.44.0 dev` after the function service was registered;
the test reported 1 passed, 0 failed, 0 skipped. No container was used.

## Ownership and parallel boundary

The agent may change only:

```text
server/src/platforms/inngest/**
server/tests/platforms/inngest/**
server/integration-tests/inngest-baseline.test.ts
development/playground/inngest-baseline/**
```

The agent must not change `server/src/control-plane/**`, `server/package.json`,
`server/package-lock.json`, `scripts/run_local_stack.sh`, the web platform catalog,
or `docs/navigation.json`. The primary agent will register the adapter and add any
shared launcher integration after review.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js, with a platform-owned service process.
- SDK/CLI: pin the exact `inngest` SDK and Dev Server/CLI versions from official
  release metadata; do not use `@latest` in reproducible commands. The source audit
  observed SDK `4.20.0`.
- Platform service: a small Inngest function host with an HTTP status/control boundary.
- Local dependency: the official Inngest development server, with readiness checks
  for both the function endpoint and Dev Server/API (documented default UI port
  `8288`), plus an allocated port recorded in the platform README.
- Model path: fake model for deterministic tests; OpenRouter only through an explicit
  environment profile and never from workflow state or evidence.
- Native execution identity: event ID plus function run ID, with no secrets.
- Service package: keep its manifest inside `server/src/platforms/inngest/service/`
  if the SDK cannot be consumed without changing the root server dependency graph.

## Lifecycle and failure semantics

The adapter must define and test:

- event admission and the stable event/idempotency key derived from `runId`;
- the documented 24-hour retention limit of event/function idempotency keys; these
  keys are not permanent Lab execution identity;
- when an event is considered accepted versus when execution is unknown;
- how the function reports queued, running, completed, failed, and cancelled;
- Inngest retries, backoff, timeout, and duplicate delivery behaviour;
- cancellation races and the result when cancellation acknowledgement is lost;
- service restart and Inngest-run reconciliation;
- orphaned function runs with no Lab manifest, which must not be adopted;
- out-of-order or duplicate status events, projected idempotently;
- unavailable dev server behaviour without a fabricated result.

## Evidence and tests

Write normalized records through the common server path and native evidence only
through the Inngest-owned adapter/service. Native evidence must include a schema
version, platform and variant, event identity, function identity, run identity,
retry information, and safe status metadata. Do not persist tokens, credentials, or
raw provider headers.

Required checks:

- unit tests for event construction, status mapping, idempotency, and redaction;
- local Inngest integration test for success, failure, retry, cancellation, and
  unavailable service;
- duplicate event and lost-acknowledgement tests;
- restart/reconciliation test with a retained native run identity;
- server and web compatibility checks after primary integration;
- a playground walkthrough showing one request and every evidence file.

## Documentation and commit boundaries

Update the Inngest README, local-development guide, evidence schema, failure and
recovery semantics, and playground notes. Record analytics, logging, metrics,
version identity, rollout, rollback, security, and known limitations explicitly.

Use focused commits:

1. platform service and runner adapter;
2. tests, local readiness, and native evidence;
3. documentation and playground walkthrough.

The handoff must list changed files, exact commands and results, infrastructure
requirements, shared integration changes requested from the primary agent, and any
behaviour that remains unknown.

## Completion record

**Completed:** 2026-09-15T17:40:00+02:00<br>
**Focused commits:** `59c0797`, `a41acea`, `7849b46`, `b06f65e`, `ba5b564`, `b5b91e3`

### Validation

- `AGENTLAB_RUN_INNGEST_INTEGRATION=1 ... node server/dist/integration-tests/inngest-baseline.test.js` — passed, 1 integration test against Inngest Dev Server v1.44.0; no container used.
- `npm --prefix server test` — passed, 141 tests.
- `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` — passed; build emitted only the existing large-chunk warning.
- Manual Chromium check — Inngest platform view completed run `4519b5bc-5083-4932-b030-514c599a5f74` with `Fake response: UI acceptance run for the Inngest baseline.`, six lifecycle events, and `inngest:<run-id>` native execution identity.
- Shared compare check — the modal ran the same fake task through Mastra and Hatchet and displayed both completed outputs.
- `git diff --check` — passed for the focused platform changes.

### Known limitations

- The local acceptance uses the pinned Inngest Dev Server and a local function service. Hosted Inngest deployment and production retention were not tested.
- The fake model is the deterministic acceptance path. OpenRouter remains optional and was not called in this wave.
- The Dev Server and function service must run as separate processes; `/health` reports the distinction.
