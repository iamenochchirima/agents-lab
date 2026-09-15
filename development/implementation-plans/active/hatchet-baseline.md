# Hatchet baseline platform

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T16:01:00+02:00
**Status:** Active — embedded local baseline validated; remote/full-stack profile remains optional
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

First-party sources verified on 2026-09-15:

- [TypeScript SDK reference](https://docs.hatchet.run/reference/typescript)
- [Runnable/task reference](https://docs.hatchet.run/reference/typescript/runnables)
- [Workers](https://docs.hatchet.run/v1/workers)
- [Retry policies](https://docs.hatchet.run/v1/retry-policies)
- [Timeouts](https://docs.hatchet.run/v1/timeouts)
- [Cancellation](https://docs.hatchet.run/v1/cancellation)
- [Idempotency](https://docs.hatchet.run/v1/idempotency)
- [Architecture and guarantees](https://docs.hatchet.run/v1/architecture-and-guarantees)
- [Embedded mode](https://docs.hatchet.run/v1/embedded)
- [Running Hatchet locally](https://docs.hatchet.run/v1/running-locally)
- [Docker Compose deployment](https://docs.hatchet.run/self-hosting/docker-compose)
- [Hatchet `v0.106.5` source release](https://github.com/hatchet-dev/hatchet/releases/tag/v0.106.5)
- [`@hatchet-dev/typescript-sdk` package metadata](https://www.npmjs.com/package/@hatchet-dev/typescript-sdk)

## Purpose and definition of done

Implement a Hatchet-backed prompt task using Hatchet's real scheduler, worker,
durable task, persistence, and inspection boundaries. The default local profile
uses the official TypeScript embedded engine so the Lab server can run without
Docker or an external Hatchet token. The same platform code supports an explicit
remote/full-stack profile for studying separately deployed Hatchet services.
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
web catalog, or documentation navigation. The primary agent owns registration and
shared launcher integration after the platform-only commits are reviewed; those
integration changes are now recorded in the handoff below.

## Runtime and infrastructure decision

- Language/runtime: TypeScript on Node.js for the runner/service and worker boundary.
- Required local infrastructure: none outside Node.js for the default embedded
  profile. Hatchet starts its sidecar and bundled Postgres from the platform-local
  SDK. The full server/persistence profile remains available behind explicit
  remote mode when its topology is the subject of an experiment.
- Native identity: Hatchet task/run identity, worker identity, attempt, and safe status.
- Model path: deterministic fake model first, explicit OpenRouter profile second.
- Keep Hatchet SDK types inside this platform directory or its service package.

Pinned versions:

| Dependency                    | Version    | Reason                                                      |
| ----------------------------- | ---------- | ----------------------------------------------------------- |
| Hatchet server images         | `v0.106.5` | Official current release selected for this implementation.  |
| Hatchet embedded engine       | `v0.106.5` | Pinned to the same engine release for the default local profile. |
| `@hatchet-dev/typescript-sdk` | `1.33.1`   | Current npm package version verified before implementation. |
| `@grpc/grpc-js`               | `1.14.4`   | Current patched version required by the SDK peer boundary.  |
| `zod`                         | `4.6.5`    | SDK peer dependency, pinned in the platform-local package.  |

The runner was checked against the pinned SDK's actual v1 calls: `HatchetClient.init`,
`client.task`, task `runNoWait`, `client.runs.get`, `client.runs.get_status`,
`client.runs.cancel`, `client.runs.list`, `client.workers.list`, `client.tenant.get`,
`client.worker`, `worker.registerWorkflows`, and `worker.waitUntilReady`.

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

Implementation checklist:

- [x] Add a platform-local package and lockfile with exact dependency pins.
- [x] Load the SDK from the platform-local dependency boundary in source and compiled layouts.
- [x] Validate topology, timeouts, retry policy, worker slots, tenant ID, and secret presence.
- [x] Define one standalone task with status idempotency keyed by `input.runId`.
- [x] Implement deterministic fake success, pre-dispatch retry, provider failure, timeout, cancel, and unknown-outcome fixtures.
- [x] Implement the explicit OpenRouter adapter without provider retries or secret-bearing evidence.
- [x] Implement embedded and remote worker hosts with registration and readiness waiting.
- [x] Keep `executionId` stable as `hatchet:<runId>`; retain native workflow/task IDs only in native evidence.
- [x] Map native statuses/events, attempts, retries, workers, and terminal output to the common runner port.
- [x] Preserve unknown admission as reconciliation-required and distinguish API-unavailable from worker-unavailable.
- [x] Add focused unit tests for config, SDK calls, models, task output, runner identity, lifecycle, failure, cancellation, and redaction.
- [x] Add opt-in embedded-engine integration tests for success and provider failure.
- [x] Add pinned full-stack local Compose deployment and a learning playground walkthrough.
- [x] Run the opt-in integration tests against the embedded local Hatchet engine without Docker.
- [x] Hand off shared platform-registry and launcher wiring to the primary agent.

Validation record for this implementation:

| Check                                                                                         | Result                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm install --ignore-scripts` in `server/src/platforms/hatchet`                              | Passed; 0 platform-package audit vulnerabilities.                                  |
| `npm audit --omit=dev --audit-level=high` in `server/src/platforms/hatchet`                   | Passed; 0 vulnerabilities.                                                          |
| Platform-local TypeScript check including source, tests, and integration test                 | Passed.                                                                            |
| `npx tsx --test tests/platforms/hatchet/*.test.ts integration-tests/hatchet-baseline.test.ts` | Passed; offline checks pass and integration remains opt-in.                         |
| `npx prettier --check` on Hatchet source, tests, docs, playground, and plan                   | Passed; all matched files use Prettier code style.                                  |
| `docker compose -f server/src/platforms/hatchet/deployment/docker-compose.yml config --quiet` | Passed.                                                                            |
| `AGENTLAB_RUN_HATCHET_INTEGRATION=1 node --test dist/integration-tests/hatchet-baseline.test.js` | Passed; 2 embedded-engine integration tests completed without Docker.              |
| `npm --prefix server test`                                                                     | Passed; 133 tests passed, 0 failed or cancelled.                                     |
| Shared `createControlPlaneRuntime()` startup and close smoke                           | Passed; all registered runners composed and embedded Hatchet shut down with no leftover process. |
| Scoped `git diff --check`                                                                     | Passed; no whitespace errors.                                                        |

Known limitations and integration requirements:

- The platform-local commits do not edit shared server bootstrap, platform registry,
  launcher scripts, root package manifests, web catalog, or navigation. The primary
  integration now registers the runner and exposes the worker command in those shared
  boundaries.
- The optional remote Hatchet Compose integration was not run. It still requires Docker
  services and a locally generated worker token. The default embedded integration is the
  validated no-Docker path.
- The embedded profile downloads a platform sidecar on first use and starts a bundled
  Postgres process. It avoids Docker but is not memory-free; its cache and data location
  are configurable through the documented environment variables.
- Hatchet native events are assigned a contiguous Lab source sequence after retrieval; the
  original Hatchet event type, ID ordering, worker, attempt, and retry data remain in the
  payload/native evidence. This is a normalized projection, not an exactly-once claim.
- Hatchet status-based idempotency is subject to its configured fallback TTL. A task whose
  key expires after an unresolved outcome needs an explicit operator reconciliation decision.

## Documentation and handoff

Document local server/worker setup, readiness, task semantics, recovery, permissions,
native evidence, and limitations. Commit runtime, tests/infrastructure, and docs
separately. The handoff must name all shared bootstrap/script changes for the primary
agent rather than editing them directly.
