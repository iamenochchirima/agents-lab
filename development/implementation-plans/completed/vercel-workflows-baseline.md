# Vercel Workflows baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T17:40:00+02:00
**Status:** Complete — local baseline and shared UI acceptance verified; hosted profile remains deferred
**Owner:** Assigned platform agent
**Platform:** `vercel-workflows`
**Variant:** `baseline`

## Start here

Read the [parallel coordination plan](platform-parallel-implementation.md), the
[platform plan template](../templates/platform-baseline.md), the [generic runner
port](../../../server/src/control-plane/ports/README.md), and the [completed server
foundation](server-platform-foundation.md).

Use the official [Vercel Workflow repository](https://github.com/vercel/workflow),
its [Fastify integration guide](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/getting-started/fastify.mdx),
[testing guide](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/testing/index.mdx),
and [local World documentation](https://github.com/vercel/workflow/blob/main/packages/world-local/README.md),
along with current Vercel deployment documentation. Record whether the selected
baseline is locally reproducible or requires a Vercel project before marking it
runnable. Review the
[first-party source audit](../../../docs/research/platform-plan-source-audit.md)
before implementation.

## Purpose and definition of done

Implement one real `workflow` SDK execution profile for the common prompt request;
the model step may call OpenRouter directly and does not require the separate Vercel
AI SDK. The plan distinguishes a local development run from a hosted Vercel run,
captures the platform execution identity, and returns the normalized evidence needed
for `native/vercel-workflows.json`.

```text
POST /api/runs → Vercel runner adapter → workflow execution → evidence
```

If the workflow cannot be durably exercised without a hosted project, the plan may
keep the variant planned until a safe, reproducible project profile exists. It must
not label a mocked local response as Vercel durability.

## Ownership and parallel boundary

Owned files:

```text
server/src/platforms/vercel-workflows/**
server/tests/platforms/vercel-workflows/**
server/integration-tests/vercel-workflows-baseline.test.ts
development/playground/vercel-workflows-baseline/**
```

Do not edit common server contracts, root manifests/lockfiles, local-stack startup,
the web catalog, or documentation navigation. Hosted project setup remains
primary-agent integration work; shared local registration and launcher wiring are
complete.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js. `workflow` owns durable workflow execution;
  model/provider code is a separate step boundary.
- SDK/version: `workflow@5.0.0-beta.52`, `@workflow/builders@5.0.0-beta.52`,
  `@workflow/vitest@5.0.0-beta.52`, and `@workflow/world-local@5.0.0-beta.45` are
  pinned in the platform-owned manifest. No Vercel AI SDK dependency is required by
  this baseline.
- Infrastructure: the `workflow` package's local world, with its filesystem-backed
  JSON state and in-memory queue, plus an explicitly documented hosted test profile
  when local execution cannot prove the workflow semantics. The local world validates
  workflow API/replay behaviour; it is not Vercel-managed production infrastructure.
- Native identity: workflow execution/run identity, deployment/profile identity, and
  safe step/checkpoint metadata.
- Credentials: Vercel and provider credentials remain environment-only and never enter
  manifests, native evidence, logs, or model prompts.

## Implementation checklist

- [x] Add an isolated platform package, lockfile, TypeScript configuration, and
  generated-output ignore rules.
- [x] Compile the workflow and step with the official `StandaloneBuilder`; read the
  emitted manifest and generated `POST` flow handler rather than approximating the
  Workflow runtime.
- [x] Add a deterministic `fake` model and an optional OpenRouter model call inside a
  `"use step"` function.
- [x] Add the local service boundary: readiness, admission, native flow delivery,
  inspection, and cancellation routes.
- [x] Add a filesystem admission ledger with `pending` and `accepted` states. A
  pending state is retained when acceptance is ambiguous.
- [x] Resolve the platform-owned Workflow packages explicitly from source and
  compiled platform roots so the shared server build does not require a root
  package dependency to execute this local profile.
- [x] Keep `PlatformExecutionReference.executionId` as the stable Lab identity; keep
  `workflowId` and `workflowRunId` in native metadata.
- [x] Normalize completed, failed, cancelled, and reconciliation-required outcomes
  without storing provider credentials or response headers.
- [x] Add focused unit and real local-World integration tests.
- [x] Document local commands, route ownership, retries, cancellation, duplicate
  external calls, and local versus hosted semantics.
- [x] Register the runner in the shared server bootstrap and expose it to the shared UI.
  This was completed by the primary integration pass.
- [x] Record the hosted Vercel project and opt-in smoke test as a separate deferred profile; the local Workflow World is the accepted baseline and no hosted credentials are required.

## Lifecycle and failure semantics

The local service writes an admission reservation before calling `start()`. A
duplicate request with the same run ID and request hash returns the recorded native
run. A different request with that run ID is rejected. If the process stops after
the reservation but before the native ID is recorded, the outcome stays unknown and
the adapter produces a `reconciliation_required` normalized result; it does not
retry blindly or fabricate a failure.

The workflow is deterministic and calls one model step. The step records its native
attempt and step ID. Workflow's retry policy can repeat an OpenRouter request after a
retryable provider or transport error, so external model calls are at-least-once in
this baseline. The baseline also exercises a durable sleep branch and native
cancellation against the local World. Hosted deployment restart, Vercel deployment
identity, managed retention, and hosted failure behaviour remain unverified.

## Evidence and tests

Required checks include unit identity/configuration/redaction tests; local-World
tests where genuinely supported; hosted smoke tests behind an explicit opt-in
profile; failure, timeout, cancellation, and unknown-outcome tests; evidence
inspection after the client exits; and server/web compatibility checks. Native
evidence must retain platform workflow/run/step information while excluding tokens,
cookies, headers, and provider responses.

Validation completed for this slice:

- `npm run build:workflow` — passed; emitted the combined flow, webhook bundle, and
  manifest containing one workflow and one model step.
- `npm run typecheck` from `server/src/platforms/vercel-workflows` — passed.
- `npm test` from `server/src/platforms/vercel-workflows` — passed, 8 tests.
- `git diff --check -- server/src/platforms/vercel-workflows server/tests/platforms/vercel-workflows` — passed.
- `npm --prefix server run typecheck` — passed.
- `npm --prefix server run build` — passed.
- `node --test server/dist/tests/platforms/vercel-workflows/service.integration.test.js`
  after the root build — passed, 5 tests, using the platform-local Workflow install.
- `./scripts/run_local_stack.sh vercel-workflows` plus a shared `POST /api/runs`
  smoke using `fake-success` — passed; the launcher reached `/ready` on port 9094,
  the shared server completed the run through the local Workflow World, and the
  returned record included normalized events, trajectory, metrics, result, and the
  native `workflowRunId`.

## Documentation and handoff

Document local versus hosted semantics, required credentials, cost boundaries, exact
readiness checks, deployment profile, rollback, and known limitations. The platform
is runnable locally with the fake model. OpenRouter is optional and network-costing.
The hosted profile is not complete. The documented platform-local install/test path
is required because the shared server package does not yet install the Workflow SDK.
Use focused runtime, test, and docs commits. The handoff must list the primary
integration changes without editing shared files.

## Completion record

**Completed:** 2026-09-15T17:40:00+02:00<br>
**Focused commits:** `fe28ee9`, `b06f65e`, `ba5b564`, `b5b91e3`

### Validation

- `npm --prefix server test` — passed, 141 tests, including five local Workflow World integration tests.
- Local Workflow service checks — passed for completion, model failure, duplicate/conflicting admission, cancellation, pending-admission reconciliation, and active-run recovery after service restart.
- `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run build` — passed; build emitted only the existing large-chunk warning.
- Manual shared API/UI path — Vercel Workflows local service completed a fake-model run through the same generic run contract and exposed workflow identity in native evidence.
- `git diff --check` — passed for the focused platform changes.

### Known limitations

- The local Workflow World is not Vercel-managed infrastructure. Hosted deployment identity, retention, observability, and deployment restart behaviour remain unverified.
- OpenRouter was not called in this deterministic wave. The model step and provider boundary remain configured for an explicit opt-in profile.
